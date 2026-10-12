import { Grid, Sky } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, Color, DirectionalLight, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type Object3D } from 'three';
import { fallbackElevation } from '../derive/site';
import { usePlanStore } from '../store/planStore';
import { useUiStore, type UiState, type View3dPreset } from '../store/uiStore';
import { focusCanvas } from '../ui/focus';
import { planBox, sunShadowFit } from './bounds';
import { registerCapture, SKY_NAME, SUN_LIGHT_NAME } from './capture';
import { Controls } from './Controls';
import { viewSun } from './elevation';
import { LevelMeshes } from './LevelMeshes';
import { setEnvironmentMap } from './materials';
import { FarGround, SiteColumns, Terrain } from './SiteMeshes';
import { visible3dLevels } from './visibility';

// Light (DESIGN.md "3D"): the sun casts shadows, a hemisphere light is the sky's fill, drei's Sky
// is the backdrop, and a gradient sky rendered once into a PMREM environment map is what glass
// reflects. Only glass carries that map: on every material it cost about 270 ms a frame in
// headless SwiftShader, and on matte surfaces it adds little over the hemisphere light.

/**
 * The sun's intensity. With ACES tone mapping at exposure 1 the sun and the fill below put the
 * sunlit south stain at about its own colour and the shaded north face at about half of it.
 */
const SUN_INTENSITY = 5.2;
/** The sky's fill: blue-white from above, the lawn's bounce from below. */
const HEMISPHERE_SKY = '#e1ebf6';
const HEMISPHERE_GROUND = '#a39f7c';
const HEMISPHERE_INTENSITY = 2.4;
/** Tone mapping exposure (ACES): a little above 1 lifts the shaded faces without clipping the sunlit ones. */
const EXPOSURE = 1.1;
/** Shadow map size (2048: a texel is under half an inch on the starter house). */
const SHADOW_MAP_SIZE = 2048;
/** Depth bias (normalized depth) and normal offset (inches) against shadow acne. */
const SHADOW_BIAS = -0.0002;
const SHADOW_NORMAL_BIAS = 1.5;
/**
 * drei's Sky is a box this wide round the origin, drawn at the far plane; the camera has to stay
 * inside it, and the far ground (1000' from the terrain's centre) does too.
 */
const SKY_DISTANCE = 30000;
/** Camera far plane: the far ground's corners from anywhere inside the sky box. */
const CAMERA_FAR = 40000;
/**
 * Opaque meshes draw in render order: the house (0), then the ground (SiteMeshes GROUND_RENDER_ORDER,
 * 1), then the sky, so the depth test rejects hidden ground and sky pixels before they are shaded.
 */
const SKY_RENDER_ORDER = 2;
/** The environment gradient (sRGB): blue zenith, pale horizon, grass green-brown below. */
const ENV_ZENITH = '#4d80bf';
const ENV_HORIZON = '#dde5ec';
const ENV_GROUND = '#5e6044';

/** The UI settings that change what the 3D scene holds (and so its shadows). */
function sceneUiChanged(s: UiState, prev: UiState): boolean {
  return (
    s.viewMode !== prev.viewMode ||
    s.activeLevelId !== prev.activeLevelId ||
    s.hidden3dLevels !== prev.hidden3dLevels ||
    s.only3dActiveAndBelow !== prev.only3dActiveAndBelow ||
    s.show3dRoofs !== prev.show3dRoofs ||
    s.siteMode !== prev.siteMode
  );
}

/** Re-render the demand-driven canvas when the plan or a 3D-relevant UI setting changes. */
function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const offPlan = usePlanStore.subscribe((s, prev) => {
      if (s.plan !== prev.plan) invalidate();
    });
    // Not the whole ui store: the draft changes on every mouse move over the 2D plan.
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        sceneUiChanged(s, prev) ||
        s.show3dGrid !== prev.show3dGrid ||
        s.layout !== prev.layout ||
        s.splitRatio !== prev.splitRatio ||
        s.view3dPreset !== prev.view3dPreset
      )
        invalidate();
    });
    return () => {
      offPlan();
      offUi();
    };
  }, [invalidate]);
  return null;
}

/** Dev-only: expose the live scene for end-to-end checks. */
function DebugHandle() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!import.meta.env.DEV || !window.__homeplan) return;
    window.__homeplan.scene3d = { scene, camera, controls, invalidate };
    return () => {
      if (window.__homeplan?.scene3d?.scene === scene) delete window.__homeplan.scene3d;
    };
  }, [scene, camera, controls, invalidate]);
  return null;
}

/**
 * 12" cells, 10' sections, an overlay on the ground ("Grid" in the 3D bar). It sits 1" above the
 * flat ground used without grade points (the bottom of the lowest slab), so it never z-fights the
 * terrain; terrain that rises above it hides it, which is what a grid under the ground should do.
 */
function GroundGrid() {
  const on = useUiStore((s) => s.show3dGrid);
  const y = usePlanStore((s) => fallbackElevation(s.plan));
  if (!on) return null;
  return (
    <Grid
      position={[0, y + 1, 0]}
      args={[1, 1]}
      cellSize={12}
      sectionSize={120}
      cellThickness={0.6}
      sectionThickness={1.1}
      cellColor="#c3c9d1"
      sectionColor="#97a0ab"
      infiniteGrid
      fadeDistance={9000}
      fadeStrength={1.2}
    />
  );
}

/** The sun's direction for the view: the plan's sun in perspective, the elevation's own (elevation.ts viewSun). */
function useViewSun(): [number, number, number] {
  const north = usePlanStore((s) => s.plan.site.northAngle);
  const preset = useUiStore((s) => s.view3dPreset);
  return useMemo(() => viewSun(preset, north), [preset, north]);
}

/**
 * The sun: a directional light from the south-west in plan terms (`sunPosition`, turned with the
 * plan's north angle) casting shadows, its shadow camera fitted round the whole plan (`planBox`,
 * `sunShadowFit`) on every plan change. An elevation lights its face from behind the viewer
 * instead (elevation.ts `elevationSun`), refitting the shadow camera the same way. r3f applies
 * props to the light, never to its shadow camera, so the effect updates that camera's projection
 * itself; the light's target is put in the scene so its world matrix follows its position. The
 * shadow map does not depend on the camera, so it is drawn only on the frame after the scene or
 * the sun changes (the plan, a UI setting that changes what the scene holds, the view preset), not
 * on every orbit frame.
 */
function SunLight() {
  const plan = usePlanStore((s) => s.plan);
  const sun = useViewSun();
  const invalidate = useThree((s) => s.invalidate);
  const light = useMemo(() => {
    const l = new DirectionalLight('#ffffff', SUN_INTENSITY);
    l.name = SUN_LIGHT_NAME;
    l.castShadow = true;
    l.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    l.shadow.bias = SHADOW_BIAS;
    l.shadow.normalBias = SHADOW_NORMAL_BIAS;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
    return l;
  }, []);
  const fit = useMemo(() => sunShadowFit(planBox(plan), sun), [plan, sun]);
  const { half, near, far } = fit;
  const [px, py, pz] = fit.position;
  useEffect(() => {
    const cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
    invalidate();
  }, [light, half, near, far, px, py, pz, invalidate]);
  useEffect(() => {
    const redraw = () => {
      light.shadow.needsUpdate = true;
    };
    const offPlan = usePlanStore.subscribe((s, prev) => {
      if (s.plan !== prev.plan) redraw();
    });
    const offUi = useUiStore.subscribe((s, prev) => {
      if (sceneUiChanged(s, prev)) redraw();
    });
    return () => {
      offPlan();
      offUi();
    };
  }, [light]);
  // The shadow map's render target.
  useEffect(() => () => light.dispose(), [light]);
  return (
    <>
      <primitive object={light} position={fit.position} />
      <primitive object={light.target} position={fit.target} />
    </>
  );
}

/** Names drei's sky mesh, so an elevation capture can turn its sun (capture.ts). */
const nameSky = (sky: Object3D | null) => {
  if (sky) sky.name = SKY_NAME;
};

/**
 * The sky backdrop: drei's Sky (Preetham) with the sun where the light is. Its shader is costly per
 * pixel and it sits at the far plane, so it is drawn after every opaque mesh (a group's render
 * order orders everything in it) and the depth test can skip the pixels something else covers.
 */
function SkyDome() {
  const sun = useViewSun();
  return (
    <group renderOrder={SKY_RENDER_ORDER}>
      <Sky ref={nameSky} distance={SKY_DISTANCE} sunPosition={sun} turbidity={6} rayleigh={1.5} />
    </group>
  );
}

/** Lets the Export menu render elevations from this canvas while it is mounted (capture.ts). */
function CaptureHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => registerCapture(get), [get]);
  return null;
}

const ENV_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ENV_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
varying vec3 vDir;
void main() {
  float y = normalize(vDir).y;
  vec3 sky = mix(horizon, zenith, sqrt(max(y, 0.0)));
  vec3 below = mix(mix(horizon, ground, 0.6), ground, min(1.0, -y * 8.0));
  gl_FragColor = vec4(y >= 0.0 ? sky : below, 1.0);
}`;

/**
 * The sky glass reflects, made once per renderer without any network asset: a sphere with a
 * gradient (blue zenith, pale horizon, green-brown ground) rendered into a PMREM environment map,
 * handed to the materials that carry it (materials.ts setEnvironmentMap). Disposed with the canvas.
 */
function SkyEnvironment() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.toneMappingExposure = EXPOSURE;
    const geometry = new SphereGeometry(50, 32, 16);
    const material = new ShaderMaterial({
      vertexShader: ENV_VERTEX,
      fragmentShader: ENV_FRAGMENT,
      uniforms: {
        zenith: { value: new Color(ENV_ZENITH) },
        horizon: { value: new Color(ENV_HORIZON) },
        ground: { value: new Color(ENV_GROUND) },
      },
      side: BackSide,
      depthWrite: false,
    });
    const envScene = new Scene();
    envScene.add(new Mesh(geometry, material));
    const pmrem = new PMREMGenerator(gl);
    const target = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
    pmrem.dispose();
    geometry.dispose();
    material.dispose();
    setEnvironmentMap(target.texture);
    invalidate();
    return () => {
      setEnvironmentMap(null);
      target.dispose();
    };
  }, [gl, invalidate]);
  return null;
}

function Levels() {
  const order = usePlanStore((s) => s.plan.levelOrder);
  const hidden = useUiStore((s) => s.hidden3dLevels);
  const only = useUiStore((s) => s.only3dActiveAndBelow);
  const active = useUiStore((s) => s.activeLevelId);
  const siteMode = useUiStore((s) => s.siteMode);
  const shown = useMemo(
    () => visible3dLevels(order, { hidden3dLevels: hidden, only3dActiveAndBelow: only, activeLevelId: active, siteMode }),
    [order, hidden, only, active, siteMode],
  );
  return (
    <>
      {shown.map((id) => (
        <LevelMeshes key={id} levelId={id} />
      ))}
    </>
  );
}

/** The view buttons in the 3D bar: the perspective orbit and the four elevations. */
const PRESET_BUTTONS: { preset: View3dPreset; label: string; title: string }[] = [
  { preset: 'perspective', label: 'Perspective', title: 'Perspective: orbit round the model (drag to orbit, right-drag to pan, scroll to zoom)' },
  { preset: 'north', label: 'N', title: 'North elevation: straight-on view of the north face' },
  { preset: 'south', label: 'S', title: 'South elevation: straight-on view of the south face' },
  { preset: 'east', label: 'E', title: 'East elevation: straight-on view of the east face' },
  { preset: 'west', label: 'W', title: 'West elevation: straight-on view of the west face' },
];

/** Small overlay toolbar: level and roof visibility, the view presets, Fit 3D, and the walk mode toggle. */
function View3dToolbar() {
  const order = usePlanStore((s) => s.plan.levelOrder);
  const names = usePlanStore((s) => s.plan.levelOrder.map((id) => s.plan.levels[id]?.name ?? '').join('\u0000'));
  const hidden = useUiStore((s) => s.hidden3dLevels);
  const only = useUiStore((s) => s.only3dActiveAndBelow);
  const grid = useUiStore((s) => s.show3dGrid);
  const roofs = useUiStore((s) => s.show3dRoofs);
  const walking = useUiStore((s) => s.cameraMode === 'walk');
  const preset = useUiStore((s) => s.view3dPreset);
  // The standalone viewer has no walk mode (keyboard driven) and no grid.
  const viewer = useUiStore((s) => s.viewerMode);
  const { toggle3dLevel, setOnly3dActiveAndBelow, setShow3dGrid, setShow3dRoofs, requestFit3d, setCameraMode, setView3dPreset } = useUiStore.getState();
  const nameList = names.split('\u0000');
  return (
    <div className="view3d-toolbar" role="toolbar" aria-label="3D view">
      {order.map((id, i) => (
        <label key={id} title="Show this level in 3D">
          <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggle3dLevel(id)} />
          {nameList[i]}
        </label>
      ))}
      <span className="sep" />
      <label title="Hide the levels above the one being edited">
        <input type="checkbox" checked={only} onChange={(e) => setOnly3dActiveAndBelow(e.target.checked)} />
        Only active level and below
      </label>
      <label title="Untick to lift the roofs off and look down into the top floor">
        <input type="checkbox" checked={roofs} onChange={(e) => setShow3dRoofs(e.target.checked)} />
        Roofs
      </label>
      {!viewer && (
        <label title="Grid lines on the ground (12 inch cells, 10 foot sections)">
          <input type="checkbox" checked={grid} onChange={(e) => setShow3dGrid(e.target.checked)} />
          Grid
        </label>
      )}
      <span className="sep" />
      <div className="group" role="group" aria-label="View">
        {PRESET_BUTTONS.map((b) => {
          const on = !walking && preset === b.preset;
          return (
            <button
              key={b.preset}
              className={on ? 'active' : ''}
              aria-pressed={on}
              disabled={walking}
              title={b.title}
              onClick={() => {
                // The elevation already showing: frame it again (after a pan or zoom).
                if (b.preset === preset) {
                  if (b.preset !== 'perspective') requestFit3d();
                } else setView3dPreset(b.preset);
                focusCanvas();
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => {
          requestFit3d();
          focusCanvas();
        }}
        disabled={walking} title="Frame the visible levels in the 3D view">
        Fit 3D
      </button>
      {!viewer && (
        <button
          className={walking ? 'active' : ''}
          aria-pressed={walking}
          onClick={() => {
            setCameraMode(walking ? 'orbit' : 'walk');
            focusCanvas();
          }}
          title="Walk through the model in first person (F); Esc returns to orbit"
        >
          Walk <kbd>F</kbd>
        </button>
      )}
    </div>
  );
}

/** Walk mode: a crosshair and the controls hint. */
function WalkOverlay() {
  const locked = useUiStore((s) => s.walkLocked);
  const levelId = useUiStore((s) => s.walkLevelId);
  const levelName = usePlanStore((s) => (levelId ? (s.plan.levels[levelId]?.name ?? '') : ''));
  return (
    <>
      <div className="walk-crosshair" aria-hidden="true" />
      <div className="walk-hint" role="status">
        {levelName && <strong>{levelName}</strong>}
        <span>{locked ? 'Mouse looks around' : 'Click the view to look around with the mouse (or drag)'}</span>
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> / arrows walk, <kbd>Shift</kbd> runs
        </span>
        <span>
          <kbd>Q</kbd> / <kbd>E</kbd> level down / up
        </span>
        <span>
          <kbd>Esc</kbd> back to orbit
        </span>
        <span className="walk-note">Walls are not solid in walk mode.</span>
      </div>
    </>
  );
}

/**
 * The 3D model: the sky, the terrain and the far ground round it, one group per level at its
 * elevation, the site's columns, orbit or walk controls, an optional ground grid, the sun with its
 * shadows, the sky's fill and the environment map glass reflects.
 * Renders on demand only (frameloop="demand") while orbiting, so an idle model costs nothing.
 */
export default function Scene3D() {
  // Walking moves the camera every frame; orbiting renders only on change.
  const walking = useUiStore((s) => s.cameraMode === 'walk');
  // A retina tablet renders the sky and the shadow map full screen: a lower cap keeps it fluid.
  const viewer = useUiStore((s) => s.viewerMode);
  return (
    <section className={`view3d-host${walking ? ' walking' : ''}`} aria-label="3D view">
      <Canvas
        className="view3d-canvas"
        frameloop={walking ? 'always' : 'demand'}
        dpr={viewer ? [1, 1.5] : [1, 2]}
        // PCF filtering: what r3f's default "soft" falls back to in three 0.186, without the warning.
        shadows="percentage"
        camera={{ fov: 50, near: 1, far: CAMERA_FAR, position: [900, 700, 1200] }}
        gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      >
        <color attach="background" args={['#e9edf1']} />
        <SkyDome />
        <SkyEnvironment />
        <hemisphereLight args={[HEMISPHERE_SKY, HEMISPHERE_GROUND, HEMISPHERE_INTENSITY]} />
        <SunLight />
        <Terrain />
        <FarGround />
        <GroundGrid />
        <Levels />
        <SiteColumns />
        <Controls />
        <InvalidateOnChange />
        <CaptureHandle />
        <DebugHandle />
      </Canvas>
      <View3dToolbar />
      {walking && <WalkOverlay />}
    </section>
  );
}
