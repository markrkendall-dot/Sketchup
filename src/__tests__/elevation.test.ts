import {
  BufferGeometry,
  DirectionalLight,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { sunPosition, terrainGrid, type TerrainGrid } from '../derive/site';
import { downloadBlob } from '../io/file';
import { dataUrlToBlob, downloadElevations, elevationFileName, NO_3D_VIEW } from '../io/exportElevation';
import { migrate } from '../model/plan';
import type { GradePoint, Site } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { ELEVATION_FACES, useUiStore, type ElevationFace } from '../store/uiStore';
import { planBox, type Box3d } from '../view3d/bounds';
import { captureElevation, GROUND_CUT_NAME, registerCapture, SKY_NAME, SUN_LIGHT_NAME } from '../view3d/capture';
import {
  ELEVATION_MARGIN,
  ELEVATION_MAX_SPAN,
  ELEVATION_STANDOFF,
  elevationFit,
  elevationGroundCut,
  elevationSun,
  GROUND_CUT_LIFT,
  GROUND_CUT_OFFSET,
  viewSun,
} from '../view3d/elevation';

// Batch E of the realism plan (DESIGN.md "3D"): the elevation presets' fit, their sun, the ground
// cut in front of the camera, the capture and the PNG export.

vi.mock('../io/file', async (importOriginal) => ({ ...(await importOriginal<typeof import('../io/file')>()), downloadBlob: vi.fn() }));

type Xyz = [number, number, number];
const v = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
/** From the target toward the camera: north from the road side (plan y < 0), east from larger x. */
const AXES: Record<ElevationFace, Xyz> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
/** The viewer's left (looking along -axis, +Y up). */
const left = (f: ElevationFace) => new Vector3(-AXES[f][2], 0, AXES[f][0]);

describe('elevationFit', () => {
  // x 0..400 (east-west), Y -100..300, plan y 0..300 (north-south).
  const box: Box3d = { min: [0, -100, 0], max: [400, 300, 300] };
  const size = { width: 1000, height: 800 };

  it('frames the north face straight on: camera on the centre line in front of the box, zoomed to 1 / 1.1 of the tighter side', () => {
    const f = elevationFit(box, 'north', size);
    expect(f.target).toEqual([200, 100, 150]);
    expect(f.axis).toEqual([0, 0, -1]);
    expect(f.width).toBe(400);
    expect(f.height).toBe(400);
    // Height-limited: 800 / 440 px per inch; the width would allow 1000 / 440.
    expect(f.zoom).toBeCloseTo(800 / (400 * ELEVATION_MARGIN), 12);
    // Half the depth (150) plus the standoff from the centre, toward the road (plan y < 0): the
    // standoff in front of the box's near side.
    expect(f.position).toEqual([200, 100, 150 - (150 + ELEVATION_STANDOFF)]);
    expect(f.position[2]).toBe(box.min[2] - ELEVATION_STANDOFF);
    expect(f.height * f.zoom).toBeCloseTo(size.height / ELEVATION_MARGIN, 9);
    expect(f.width * f.zoom).toBeLessThanOrEqual(size.width / ELEVATION_MARGIN);
  });

  it('frames the east and west faces across the plan y extent, from either side in x', () => {
    const e = elevationFit(box, 'east', size);
    const w = elevationFit(box, 'west', size);
    expect(e.width).toBe(300);
    expect(e.height).toBe(400);
    expect(e.zoom).toBeCloseTo(Math.min(1000 / 330, 800 / 440), 12);
    expect(e.position).toEqual([400 + ELEVATION_STANDOFF, 100, 150]);
    expect(w.position).toEqual([-ELEVATION_STANDOFF, 100, 150]);
    // A wide, low canvas is width-limited.
    const wide = elevationFit(box, 'east', { width: 600, height: 2000 });
    expect(wide.zoom).toBeCloseTo(600 / 330, 12);
  });

  it('north and south look at each other across the box, and so do east and west', () => {
    for (const [a, b] of [
      ['north', 'south'],
      ['east', 'west'],
    ] as const) {
      const fa = elevationFit(box, a, size);
      const fb = elevationFit(box, b, size);
      expect(fa.target).toEqual(fb.target);
      const da = v(fa.target).sub(v(fa.position)).normalize();
      const db = v(fb.target).sub(v(fb.position)).normalize();
      expect(da.dot(db)).toBeCloseTo(-1, 12);
      // Each looks along the line through the other camera, level (no tilt).
      expect(v(fb.position).sub(v(fa.position)).normalize().dot(da)).toBeCloseTo(1, 12);
      expect(da.y).toBe(0);
      expect(fa.zoom).toBe(fb.zoom);
    }
    // Both stand outside the box, on opposite sides.
    expect(elevationFit(box, 'north', size).position[2]).toBeLessThan(box.min[2]);
    expect(elevationFit(box, 'south', size).position[2]).toBeGreaterThan(box.max[2]);
    expect(elevationFit(box, 'west', size).position[0]).toBeLessThan(box.min[0]);
    expect(elevationFit(box, 'east', size).position[0]).toBeGreaterThan(box.max[0]);
  });

  it('stays finite for a canvas not measured yet and a flat box', () => {
    const flat: Box3d = { min: [0, 0, 0], max: [100, 0, 100] };
    for (const face of ELEVATION_FACES) {
      const f = elevationFit(flat, face, { width: 0, height: 0 });
      expect(Number.isFinite(f.zoom) && f.zoom > 0).toBe(true);
    }
  });
});

describe('elevation sun', () => {
  const distance = Math.hypot(...sunPosition(0));

  it('lights each face from behind the viewer, 45 degrees up and 30 degrees to their left', () => {
    for (const face of ELEVATION_FACES) {
      const sun = v(elevationSun(face));
      expect(sun.length()).toBeCloseTo(distance, 9);
      // Above the horizon at 45 degrees.
      expect(sun.y).toBeGreaterThan(0);
      expect(Math.atan2(sun.y, Math.hypot(sun.x, sun.z))).toBeCloseTo(Math.PI / 4, 12);
      // Behind the viewer (on the camera's side of the face), turned 30 degrees to their left.
      const flat = new Vector3(sun.x, 0, sun.z).normalize();
      expect(flat.dot(v(AXES[face]))).toBeCloseTo(Math.cos(Math.PI / 6), 12);
      expect(flat.dot(left(face))).toBeCloseTo(Math.sin(Math.PI / 6), 12);
      // So the face itself is lit.
      expect(sun.clone().normalize().dot(v(AXES[face]))).toBeGreaterThan(0.5);
    }
    // Looking south at the north face, the viewer's left is east: the sun is north-north-east.
    const [x, , z] = elevationSun('north');
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
  });

  it('perspective keeps the plan sun (turned with the north angle); an elevation ignores the north angle', () => {
    expect(viewSun('perspective', 0)).toEqual(sunPosition(0));
    expect(viewSun('perspective', 120)).toEqual(sunPosition(120));
    expect(viewSun('east', 0)).toEqual(elevationSun('east'));
    expect(viewSun('east', 120)).toEqual(elevationSun('east'));
  });
});

describe('elevation ground cut', () => {
  const gp = (x: number, y: number, elevation: number, id = `g${x},${y}`): GradePoint => ({ id, at: { x, y }, elevation });
  const site = (...points: GradePoint[]): Pick<Site, 'gradePoints'> => ({ gradePoints: Object.fromEntries(points.map((p) => [p.id, p])) });
  const bounds = { minX: 0, minY: 0, maxX: 318, maxY: 306 };
  const box: Box3d = { min: [0, -110, 0], max: [318, 340, 306] };
  const size = { width: 1052, height: 851 };

  /**
   * The rendered ground's height at (x, z): the grid triangle under the point, interpolated (what a
   * ray down onto the drawn triangles hits). Triangles are bucketed by 24" cell once, so a lookup
   * tests a handful of them rather than the whole grid.
   */
  function groundAt(grid: TerrainGrid) {
    const pos = grid.positions;
    const idx = grid.indices;
    const CELL = 24;
    const buckets = new Map<string, number[]>();
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [pos[idx[t] * 3], pos[idx[t + 1] * 3], pos[idx[t + 2] * 3]];
      const zs = [pos[idx[t] * 3 + 2], pos[idx[t + 1] * 3 + 2], pos[idx[t + 2] * 3 + 2]];
      for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) {
        for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
          const k = `${i},${j}`;
          const list = buckets.get(k);
          if (list) list.push(t);
          else buckets.set(k, [t]);
        }
      }
    }
    return (x: number, z: number) => {
      let best = NaN;
      for (const t of buckets.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-12) continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        const wc = 1 - wa - wb;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        // The topmost surface, as a ray from above would hit first.
        if (!(y <= best)) best = y;
      }
      return best;
    };
  }

  function check(grid: TerrainGrid, face: ElevationFace) {
    const fit = elevationFit(box, face, size);
    const cut = elevationGroundCut(grid, fit);
    const p = cut.positions;
    const n = p.length / 3;
    expect(n % 2).toBe(0);
    expect(cut.uvs.length).toBe(n * 2);
    const axis = v(fit.axis);
    const plane = v(fit.position).addScaledVector(axis, -GROUND_CUT_OFFSET);
    const right = new Vector3(axis.z, 0, -axis.x);
    const at = (k: number) => new Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    const height = groundAt(grid);
    const us: number[] = [];
    for (let k = 0; k < n; k += 2) {
      const top = at(k);
      const bottom = at(k + 1);
      // In the plane just past the camera's near plane, facing it.
      expect(top.clone().sub(plane).dot(axis)).toBeCloseTo(0, 6);
      expect(bottom.x).toBe(top.x);
      expect(bottom.z).toBe(top.z);
      expect(bottom.y).toBeLessThan(fit.target[1] - ELEVATION_MAX_SPAN + 1);
      const u = top.clone().sub(plane).dot(right);
      us.push(u);
      // On the grid, the top is the drawn ground plus the lift.
      const inside = top.x >= grid.bounds.minX && top.x <= grid.bounds.maxX && top.z >= grid.bounds.minY && top.z <= grid.bounds.maxY;
      if (inside) expect(top.y - GROUND_CUT_LIFT).toBeCloseTo(height(top.x, top.z), 3);
    }
    // Left to right across the whole span either side.
    for (let k = 1; k < us.length; k++) expect(us[k]).toBeGreaterThanOrEqual(us[k - 1]);
    expect(us[0]).toBeCloseTo(-ELEVATION_MAX_SPAN, 6);
    expect(us[us.length - 1]).toBeCloseTo(ELEVATION_MAX_SPAN, 6);
    // Every grid line and diagonal crossed is a sample: halfway between two samples on the grid the
    // drawn ground is their average (it is straight between them).
    for (let k = 0; k + 2 < n; k += 2) {
      const a = at(k);
      const b = at(k + 2);
      const m = a.clone().add(b).multiplyScalar(0.5);
      const inside = Math.min(a.x, b.x) >= grid.bounds.minX && Math.max(a.x, b.x) <= grid.bounds.maxX && Math.min(a.z, b.z) >= grid.bounds.minY && Math.max(a.z, b.z) <= grid.bounds.maxY;
      if (inside && a.distanceTo(b) > 1e-6) expect(height(m.x, m.z) + GROUND_CUT_LIFT).toBeCloseTo(m.y, 3);
    }
    // Every triangle faces the camera.
    const idx = cut.indices;
    expect(idx.length).toBe((n / 2 - 1) * 6);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [at(idx[t]), at(idx[t + 1]), at(idx[t + 2])];
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      if (normal.length() > 1e-9) expect(normal.normalize().dot(axis)).toBeGreaterThan(0.999);
    }
  }

  it('follows the drawn ground along the camera plane for every face, on sloping ground', () => {
    const grid = terrainGrid(site(gp(0, 0, -4), gp(318, 0, -20), gp(0, 306, -76), gp(318, 306, -90), gp(160, 150, 12)), bounds, -104);
    for (const face of ELEVATION_FACES) check(grid, face);
  });

  it('is flat at the fallback ground without grade points', () => {
    const grid = terrainGrid(site(), bounds, -104);
    const cut = elevationGroundCut(grid, elevationFit(box, 'south', size));
    for (let k = 0; k < cut.positions.length / 3; k += 2) expect(cut.positions[k * 3 + 1]).toBe(-104 + GROUND_CUT_LIFT);
    check(grid, 'south');
  });
});

describe('view preset in the ui store', () => {
  beforeEach(() => useUiStore.setState({ view3dPreset: 'perspective', cameraMode: 'orbit', walkLevelId: null, walkLocked: false, layout: '3d' }));

  it('starts in perspective; an elevation sets it; the same preset again changes nothing', () => {
    expect(useUiStore.getInitialState().view3dPreset).toBe('perspective');
    useUiStore.getState().setView3dPreset('north');
    expect(useUiStore.getState().view3dPreset).toBe('north');
    const before = useUiStore.getState();
    useUiStore.getState().setView3dPreset('north');
    expect(useUiStore.getState()).toBe(before);
  });

  it('walking returns to perspective (the walk needs the perspective camera)', () => {
    useUiStore.getState().setView3dPreset('east');
    useUiStore.getState().setCameraMode('walk');
    expect(useUiStore.getState().cameraMode).toBe('walk');
    expect(useUiStore.getState().view3dPreset).toBe('perspective');
    // Back to orbit keeps perspective.
    useUiStore.getState().setCameraMode('orbit');
    expect(useUiStore.getState().view3dPreset).toBe('perspective');
  });

  it('an elevation while walking leaves walk mode', () => {
    useUiStore.getState().setCameraMode('walk');
    useUiStore.setState({ walkLevelId: 'l1', walkLocked: true });
    useUiStore.getState().setView3dPreset('west');
    const s = useUiStore.getState();
    expect([s.view3dPreset, s.cameraMode, s.walkLevelId, s.walkLocked]).toEqual(['west', 'orbit', null, false]);
  });
});

describe('captureElevation', () => {
  const size = { width: 800, height: 600 };
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    usePlanStore.getState().setPlan(migrate(example));
    useUiStore.setState({ hidden3dLevels: [], only3dActiveAndBelow: false, siteMode: false, viewMode: 'all' });
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  /** A scene with the sun and the sky as Scene3D names them, and a stand-in renderer that records each render. */
  function setup(opts: { dpr?: number; maxBuffer?: number; onRender?: () => void } = {}) {
    const scene = new Scene();
    const light = new DirectionalLight();
    light.name = SUN_LIGHT_NAME;
    light.position.set(-700, 1600, 1100);
    light.target.position.set(1, 2, 3);
    Object.assign(light.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 5, far: 50 });
    light.shadow.needsUpdate = false;
    scene.add(light, light.target);
    const sky = new Mesh(new BufferGeometry(), new ShaderMaterial({ uniforms: { sunPosition: { value: new Vector3(-700, 1600, 1100) } } }));
    sky.name = SKY_NAME;
    scene.add(sky);
    let ratio = opts.dpr ?? 1;
    const canvas = { width: size.width * ratio, height: size.height * ratio, toDataURL: vi.fn(() => DATA_URL) };
    const renders: { camera: Camera; ratio: number; canvas: number[]; sun: Vector3; target: Vector3; needsUpdate: boolean; far: number; skySun: Vector3; ground: boolean }[] = [];
    const gl = {
      getPixelRatio: () => ratio,
      setPixelRatio: (r: number) => {
        ratio = r;
      },
      setSize: (w: number, h: number) => {
        canvas.width = Math.floor(w * ratio);
        canvas.height = Math.floor(h * ratio);
      },
      getContext: () => ({
        drawingBufferWidth: Math.min(canvas.width, opts.maxBuffer ?? Infinity),
        drawingBufferHeight: Math.min(canvas.height, opts.maxBuffer ?? Infinity),
      }),
      domElement: canvas,
      render: (s: Scene, camera: Camera) => {
        opts.onRender?.();
        renders.push({
          camera,
          ratio,
          canvas: [canvas.width, canvas.height],
          sun: light.position.clone(),
          target: light.target.position.clone(),
          needsUpdate: light.shadow.needsUpdate,
          far: light.shadow.camera.far,
          skySun: (sky.material.uniforms.sunPosition.value as Vector3).clone(),
          ground: !!s.getObjectByName(GROUND_CUT_NAME),
        });
      },
    };
    const invalidate = vi.fn();
    unregister = registerCapture(() => ({ gl: gl as unknown as WebGLRenderer, scene, size, invalidate }));
    return { scene, light, sky, canvas, renders, invalidate, ratio: () => ratio };
  }

  it('is null with no 3D view mounted', () => {
    expect(captureElevation('north')).toBeNull();
    const { scene } = setup();
    unregister?.();
    unregister = null;
    expect(captureElevation('north')).toBeNull();
    expect(scene.children.length).toBe(3);
  });

  it('renders once with an orthographic camera fitted like the view, at twice the resolution, then reads the canvas', () => {
    const t = setup();
    expect(captureElevation('north')).toBe(DATA_URL);
    expect(t.canvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(t.renders.length).toBe(1);
    const r = t.renders[0];
    expect(r.ratio).toBe(2);
    expect(r.canvas).toEqual([1600, 1200]);
    const plan = usePlanStore.getState().plan;
    const fit = elevationFit(planBox(plan), 'north', size);
    const cam = r.camera as OrthographicCamera;
    expect(cam).toBeInstanceOf(OrthographicCamera);
    expect(cam.zoom).toBe(1);
    expect(cam.right - cam.left).toBeCloseTo(size.width / fit.zoom, 9);
    expect(cam.top - cam.bottom).toBeCloseTo(size.height / fit.zoom, 9);
    expect(cam.position.toArray()).toEqual(fit.position);
    expect(cam.getWorldDirection(new Vector3()).dot(new Vector3(0, 0, 1))).toBeCloseTo(1, 12);
    // The face's sun: the light, its target and the sky, with the shadow map redrawn; the ground cut is in.
    expect(r.sun.clone().sub(r.target).normalize().dot(v(elevationSun('north')).normalize())).toBeCloseTo(1, 9);
    expect(r.skySun.toArray()).toEqual(elevationSun('north'));
    expect(r.needsUpdate).toBe(true);
    expect(r.ground).toBe(true);
  });

  it('puts back the pixel ratio, the canvas size, the sun, the shadow camera and the sky, removes its ground cut, and redraws', () => {
    const t = setup({ dpr: 1.5 });
    const before = t.scene.children.length;
    captureElevation('east', 2);
    expect(t.renders[0].ratio).toBe(3);
    expect(t.ratio()).toBe(1.5);
    expect(t.canvas.width).toBe(1200);
    expect(t.canvas.height).toBe(900);
    expect(t.light.position.toArray()).toEqual([-700, 1600, 1100]);
    expect(t.light.target.position.toArray()).toEqual([1, 2, 3]);
    const cam = t.light.shadow.camera;
    expect([cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far]).toEqual([-10, 10, 10, -10, 5, 50]);
    // The map was drawn for the capture's sun: the view redraws it for its own.
    expect(t.light.shadow.needsUpdate).toBe(true);
    expect((t.sky.material.uniforms.sunPosition.value as Vector3).toArray()).toEqual([-700, 1600, 1100]);
    expect(t.scene.children.length).toBe(before);
    expect(t.scene.getObjectByName(GROUND_CUT_NAME)).toBeUndefined();
    expect(t.invalidate).toHaveBeenCalledTimes(1);
  });

  it('hides an elevation view`s own ground cut while it renders, and only its own cut is in the scene then', () => {
    const live = new Mesh(new BufferGeometry());
    live.name = GROUND_CUT_NAME;
    const seen: { liveShown: boolean; cuts: number }[] = [];
    const t = setup({
      onRender: () => {
        let cuts = 0;
        t.scene.traverse((o) => {
          if (o.name === GROUND_CUT_NAME && o !== live) cuts++;
        });
        seen.push({ liveShown: live.visible, cuts });
      },
    });
    t.scene.add(live);
    captureElevation('south');
    expect(seen).toEqual([{ liveShown: false, cuts: 1 }]);
    expect(live.visible).toBe(true);
    expect(t.scene.children.filter((o) => o.name === GROUND_CUT_NAME)).toEqual([live]);
  });

  it('asks for less when the browser caps the drawing buffer, so the image is smaller rather than cropped', () => {
    const t = setup({ maxBuffer: 1000 });
    captureElevation('west', 2);
    const r = t.renders[0];
    expect(r.canvas[0]).toBeLessThanOrEqual(1000);
    expect(r.ratio).toBeCloseTo(1.25, 9);
    expect(t.ratio()).toBe(1);
  });
});

describe('elevation export', () => {
  beforeEach(() => vi.mocked(downloadBlob).mockClear());

  it('names the files after the plan and the side', () => {
    expect(elevationFileName({ name: '146 Mick Road (starter)' }, 'north')).toBe('146-mick-road-starter-north-elevation.png');
    expect(elevationFileName({ name: '  ' }, 'west')).toBe('homeplan-west-elevation.png');
  });

  it('turns a base64 data URL into a Blob of its type', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => dataUrlToBlob('data:text/plain,hello')).toThrow();
  });

  it('downloads the four sides at 2x, north first, after all four are rendered', () => {
    const asked: [ElevationFace, number][] = [];
    const capture = (face: ElevationFace, scale: number) => {
      asked.push([face, scale]);
      expect(downloadBlob).not.toHaveBeenCalled();
      return 'data:image/png;base64,iVBORw0KGgo=';
    };
    downloadElevations({ ...migrate(example), name: 'Mick Road' }, capture);
    expect(asked).toEqual([
      ['north', 2],
      ['south', 2],
      ['east', 2],
      ['west', 2],
    ]);
    const calls = vi.mocked(downloadBlob).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(['mick-road-north-elevation.png', 'mick-road-south-elevation.png', 'mick-road-east-elevation.png', 'mick-road-west-elevation.png']);
    for (const [blob] of calls) expect(blob.type).toBe('image/png');
  });

  it('downloads nothing without a 3D view', () => {
    expect(() => downloadElevations(migrate(example), () => null)).toThrow(NO_3D_VIEW);
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
