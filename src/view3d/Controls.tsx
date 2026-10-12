import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { MOUSE, OrthographicCamera as OrthographicCameraImpl, PerspectiveCamera, TOUCH, Vector3 } from 'three';
import { planTerrain } from '../derive/site';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore, type ElevationFace } from '../store/uiStore';
import { planBox } from './bounds';
import { GROUND_CUT_NAME, groundCutGeometry } from './capture';
import { ELEVATION_MAX_SPAN, elevationFit, type ElevationFit } from './elevation';
import { FirstPerson } from './FirstPerson';
import { terrainMaterial } from './materials';
import { visible3dLevels } from './visibility';

/** Camera pose kept across unmounts (switching to the 2D layout, to walk mode or to an elevation, and back). */
let saved: { position: Vector3; target: Vector3 } | null = null;

/** Seen from the south-east (plan +x, +y), above. */
const VIEW_DIR = new Vector3(0.85, 0.75, 1.25).normalize();

/**
 * How far the orbit camera may back away from its target: drei's Sky is a box 30000" wide round
 * the origin (Scene3D SKY_DISTANCE) that the camera has to stay inside.
 */
const MAX_DISTANCE = 14000;
/** Scene3D's camera far plane, for the elevations' orthographic camera. */
const CAMERA_FAR = 40000;
/** In an elevation there is nothing to orbit: the left button pans too. */
const ELEVATION_MOUSE = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
const ELEVATION_TOUCH = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN };

/**
 * The 3D camera controls: orbit, an elevation, or the first-person walk. Exactly one is mounted at
 * a time; the orbit pose is saved when the orbit controls unmount and restored when they mount
 * again. Walking always starts from perspective (uiStore.setCameraMode resets the preset).
 */
export function Controls() {
  const mode = useUiStore((s) => s.cameraMode);
  const preset = useUiStore((s) => s.view3dPreset);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  // r3f resizes only the default camera: the perspective camera misses a resize while an
  // elevation's orthographic camera is the default, so it takes the canvas's aspect again here.
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const { width, height } = get().size;
    const aspect = width / height;
    if (!(aspect > 0) || Math.abs(camera.aspect - aspect) < 1e-9) return;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, get, invalidate]);

  if (mode === 'walk') return <FirstPerson />;
  return preset === 'perspective' ? <OrbitView /> : <ElevationView face={preset} />;
}

/**
 * Orbit controls. On first mount the camera frames the whole plan (target at the bounding box
 * centre); the Fit button (uiStore.requestFit3d) re-frames the visible levels.
 */
function OrbitView() {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const fitRequest = useUiStore((s) => s.fit3dRequest);

  const fit = useCallback(() => {
    const controls = ref.current;
    if (!controls || !(camera instanceof PerspectiveCamera)) return;
    const ui = useUiStore.getState();
    const plan = getPlan();
    const box = planBox(plan, visible3dLevels(plan.levelOrder, ui));
    const center = new Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    const radius = 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    // Fit the bounding sphere in the narrower of the two field-of-view angles.
    const half = (camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(half) * Math.min(1, camera.aspect));
    const distance = (Math.max(radius, 60) / Math.sin(halfH)) * 1.05;
    camera.position.copy(center).addScaledVector(VIEW_DIR, distance);
    controls.target.copy(center);
    controls.update();
    invalidate();
  }, [camera, invalidate]);

  // First mount: restore the previous pose, or frame the plan. The cleanup saves the pose (leaving
  // the 3D layout, or switching to walk mode or an elevation) from the controls object captured here.
  useEffect(() => {
    // Coming back from an elevation, the first commit still sees its orthographic camera; drei
    // puts the perspective camera back as that one unmounts, and this runs again with it.
    if (!(camera instanceof PerspectiveCamera)) return;
    const controls = ref.current;
    if (saved && controls) {
      camera.position.copy(saved.position);
      controls.target.copy(saved.target);
      controls.update();
      invalidate();
    } else fit();
    return () => {
      if (controls) saved = { position: camera.position.clone(), target: controls.target.clone() };
    };
  }, [camera, fit, invalidate]);

  const first = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest !== first.current) fit();
  }, [fitRequest, fit]);

  return <OrbitControls ref={ref} makeDefault enableDamping={false} maxPolarAngle={Math.PI * 0.495} maxDistance={MAX_DISTANCE} />;
}

/**
 * A straight-on orthographic elevation of one side (`face`): its own drei orthographic camera
 * (made the default while mounted; drei restores the perspective camera on unmount) and orbit
 * controls that pan and zoom but never rotate or tilt. It frames the visible levels with
 * `elevationFit` on mount, when the face changes, and on Fit 3D. The camera stands inside the
 * terrain's area, so the ground is cut in front of it (elevation.ts elevationGroundCut); panning
 * keeps the camera in that plane, so the cut follows a fit only.
 */
function ElevationView({ face }: { face: ElevationFace }) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const fitRequest = useUiStore((s) => s.fit3dRequest);
  const viewMode = useUiStore((s) => s.viewMode);
  const terrain = usePlanStore((s) => planTerrain(s.plan, viewMode));
  const [cutAt, setCutAt] = useState<ElevationFit | null>(null);
  const ground = useMemo(() => (cutAt ? groundCutGeometry(terrain, cutAt) : null), [terrain, cutAt]);
  useEffect(() => () => ground?.dispose(), [ground]);

  const fit = useCallback(() => {
    const controls = ref.current;
    // The first commit still sees the perspective camera: drei makes the orthographic one the
    // default in a layout effect, and this runs again with it.
    if (!controls || !(camera instanceof OrthographicCameraImpl)) return;
    const ui = useUiStore.getState();
    const plan = getPlan();
    const { size } = get();
    const f = elevationFit(planBox(plan, visible3dLevels(plan.levelOrder, ui)), face, size);
    camera.position.set(...f.position);
    camera.zoom = f.zoom;
    camera.updateProjectionMatrix();
    controls.target.set(...f.target);
    controls.minZoom = Math.max(size.width, size.height) / ELEVATION_MAX_SPAN;
    controls.update();
    setCutAt(f);
    invalidate();
  }, [camera, face, get, invalidate]);

  useEffect(() => fit(), [fit, fitRequest]);

  return (
    <>
      <OrthographicCamera makeDefault near={1} far={CAMERA_FAR} />
      {ground && <mesh name={GROUND_CUT_NAME} geometry={ground} material={terrainMaterial} dispose={null} />}
      <OrbitControls
        ref={ref}
        makeDefault
        enableRotate={false}
        enableDamping={false}
        minPolarAngle={Math.PI / 2}
        maxPolarAngle={Math.PI / 2}
        maxDistance={MAX_DISTANCE}
        mouseButtons={ELEVATION_MOUSE}
        touches={ELEVATION_TOUCH}
      />
    </>
  );
}
