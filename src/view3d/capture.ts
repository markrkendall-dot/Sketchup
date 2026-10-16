import { BufferAttribute, BufferGeometry, DirectionalLight, Mesh, OrthographicCamera, ShaderMaterial, Vector3, type Scene, type WebGLRenderer } from 'three';
import { flushTextures } from './textureQueue';
import { planTerrain, type TerrainGrid } from '../derive/site';
import { getPlan } from '../store/planStore';
import { useUiStore, type ElevationFace } from '../store/uiStore';
import { planBox, sunShadowFit, type Box3d } from './bounds';
import { elevationFit, elevationGroundCut, elevationSun, type ElevationFit } from './elevation';
import { terrainMaterial } from './materials';
import { visible3dLevels } from './visibility';

// Elevation images from the live 3D view (DESIGN.md "3D"): Scene3D registers the canvas's state
// while it is mounted, and a capture renders the scene once more with its own camera, sun and
// ground cut.

/** The names Scene3D gives its sun light and drei's sky, so a capture can turn them to its face. */
export const SUN_LIGHT_NAME = 'sun';
export const SKY_NAME = 'sky';
/** The name of an elevation's ground cut (the live view's, and a capture's own). */
export const GROUND_CUT_NAME = 'elevation-ground';
/** Scene3D's camera far plane. */
const CAMERA_FAR = 40000;

type Xyz = [number, number, number];

/** What a capture uses of the live canvas (r3f's root state). */
export interface CaptureState {
  gl: WebGLRenderer;
  scene: Scene;
  /** The canvas size in CSS pixels. */
  size: { width: number; height: number };
  invalidate: () => void;
}

let live: (() => CaptureState) | null = null;

/**
 * Called from inside the Canvas (Scene3D) with a getter of its state; returns the function that
 * clears it again on unmount, so a capture without a 3D view finds nothing.
 */
export function registerCapture(get: () => CaptureState): () => void {
  live = get;
  return () => {
    if (live === get) live = null;
  };
}

/**
 * The ground cut in front of an elevation camera (elevation.ts elevationGroundCut) as a geometry
 * for the lawn material (its UVs are in inches like the terrain's). The caller disposes it.
 */
export function groundCutGeometry(terrain: TerrainGrid, fit: Pick<ElevationFit, 'axis' | 'position' | 'target'>): BufferGeometry {
  const cut = elevationGroundCut(terrain, fit);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(cut.positions, 3));
  g.setAttribute('uv', new BufferAttribute(cut.uvs, 2));
  g.setIndex(new BufferAttribute(cut.indices, 1));
  g.computeVertexNormals();
  return g;
}

/** The ground cut as a mesh: the lawn, neither casting nor receiving shadows (nothing stands in front of it). */
function groundCutMesh(geometry: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, terrainMaterial);
  mesh.name = GROUND_CUT_NAME;
  return mesh;
}

/**
 * Turn the sun light (and its shadow camera, fitted round `box` as Scene3D's SunLight does) and
 * the sky's sun toward `sun` for one render; returns the function that puts them back. Turning
 * and putting back both mark the shadow map for the next render: it is never redrawn on its own
 * (autoUpdate is off), and the map and its matrix are only refreshed when it is drawn.
 */
function aimSun(scene: Scene, sun: Xyz, box: Box3d): () => void {
  const undo: (() => void)[] = [];
  const light = scene.getObjectByName(SUN_LIGHT_NAME);
  if (light instanceof DirectionalLight) {
    const cam = light.shadow.camera;
    const position = light.position.clone();
    const target = light.target.position.clone();
    const frustum = [cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far] as const;
    const fit = sunShadowFit(box, sun);
    light.position.set(...fit.position);
    light.target.position.set(...fit.target);
    cam.left = -fit.half;
    cam.right = fit.half;
    cam.top = fit.half;
    cam.bottom = -fit.half;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
    undo.push(() => {
      light.position.copy(position);
      light.target.position.copy(target);
      [cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far] = frustum;
      cam.updateProjectionMatrix();
      light.shadow.needsUpdate = true;
    });
  }
  const sky = scene.getObjectByName(SKY_NAME);
  const uniform: unknown = sky instanceof Mesh && sky.material instanceof ShaderMaterial ? sky.material.uniforms.sunPosition?.value : null;
  if (uniform instanceof Vector3) {
    const was = uniform.clone();
    uniform.set(...sun);
    undo.push(() => uniform.copy(was));
  }
  return () => undo.forEach((f) => f());
}

/**
 * Render the elevation of one side (`face`) from the live 3D view as a PNG data URL, `scale` times
 * the canvas's resolution, or null when no 3D view is mounted. Framed like the elevation view
 * (`elevationFit` on the levels the view shows, at the canvas's aspect) by an orthographic camera
 * in inches, with its ground cut, lit by that face's sun with shadows; the view's own camera, sun,
 * pixel ratio and size are left as they were and the view redraws. Synchronous: the image is read
 * in the same task as the render, so the drawing buffer need not be preserved.
 */
export function captureElevation(face: ElevationFace, scale = 2): string | null {
  const state = live?.();
  if (!state) return null;
  // The picture shows every texture, painted or not yet (textureQueue.ts).
  flushTextures();
  const { gl, scene, size, invalidate } = state;
  const plan = getPlan();
  const ui = useUiStore.getState();
  const fit = elevationFit(planBox(plan, visible3dLevels(plan.levelOrder, ui)), face, size);
  const w = size.width / fit.zoom;
  const h = size.height / fit.zoom;
  const camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, CAMERA_FAR);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const ground = groundCutMesh(groundCutGeometry(planTerrain(plan, ui.viewMode), fit));
  const sunBox = planBox(plan);
  // An elevation view's own cut stands in front of the view's camera, which may differ: hidden here.
  const liveCut = scene.getObjectByName(GROUND_CUT_NAME);
  const liveCutShown = liveCut?.visible ?? false;
  const dpr = gl.getPixelRatio();
  let restoreSun = () => {};
  try {
    if (liveCut) liveCut.visible = false;
    scene.add(ground);
    restoreSun = aimSun(scene, elevationSun(face), sunBox);
    setRatio(gl, scale * dpr, size);
    gl.render(scene, camera);
    return gl.domElement.toDataURL('image/png');
  } finally {
    gl.setPixelRatio(dpr);
    gl.setSize(size.width, size.height, false);
    restoreSun();
    scene.remove(ground);
    ground.geometry.dispose();
    if (liveCut) liveCut.visible = liveCutShown;
    invalidate();
  }
}

/**
 * Set the renderer's pixel ratio (and its canvas's size) for a capture. The browser may give the
 * canvas a smaller drawing buffer than asked for (a size limit); the ratio then drops to fit, so
 * the image is smaller rather than cropped.
 */
function setRatio(gl: WebGLRenderer, ratio: number, size: { width: number; height: number }): void {
  gl.setPixelRatio(ratio);
  gl.setSize(size.width, size.height, false);
  const ctx = gl.getContext();
  const canvas = gl.domElement;
  const fits = Math.min(ctx.drawingBufferWidth / canvas.width, ctx.drawingBufferHeight / canvas.height);
  if (fits < 1) {
    gl.setPixelRatio(ratio * fits);
    gl.setSize(size.width, size.height, false);
  }
}
