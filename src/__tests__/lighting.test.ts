import { Color, Matrix4, Mesh, MeshPhysicalMaterial, OrthographicCamera, Texture, Vector3, type MeshStandardMaterial } from 'three';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { clearMeshCache } from '../derive/meshes';
import { sunPosition } from '../derive/site';
import { buildExportScene, disposeExportScene, toGlb } from '../io/export3d';
import { createEmptyPlan, migrate } from '../model/plan';
import { clearHistory, usePlanStore } from '../store/planStore';
import { planBox, sunShadowFit, type Box3d } from '../view3d/bounds';
import { GRASS_COLOR, grassTexture } from '../view3d/groundTexture';
import {
  farGroundMaterial,
  GLASS_COLOR,
  GLASS_ENV_INTENSITY,
  GLASS_OPACITY,
  openingMaterial,
  setEnvironmentMap,
  terrainMaterial,
  wallFlatColor,
  wallMaterial,
} from '../view3d/materials';

// Batch A of the realism plan (DESIGN.md "3D"): glass, the lawn, the export's colours-only rule and
// the sun's shadow camera.

const store = () => usePlanStore.getState();

/** GLTFExporter's binary path reads Blobs with FileReader, which node lacks (as in export3d.test.ts). */
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
}

beforeAll(() => {
  if (typeof globalThis.FileReader === 'undefined') (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
});

beforeEach(() => clearMeshCache());

describe('glass', () => {
  it('is a physical material: dark, smooth, see-through, no depth write, reflecting the sky', () => {
    const glass = openingMaterial('glass', 'existing');
    expect(glass).toBeInstanceOf(MeshPhysicalMaterial);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBe(GLASS_OPACITY);
    expect(glass.depthWrite).toBe(false);
    expect(glass.roughness).toBe(0.05);
    expect(glass.metalness).toBe(0);
    expect(glass.envMapIntensity).toBe(GLASS_ENV_INTENSITY);
    expect(`#${glass.color.getHexString()}`).toBe(GLASS_COLOR);
    // No transmission pass: transparency is plain alpha blending.
    expect((glass as MeshPhysicalMaterial).transmission).toBe(0);
    // Shared per phase.
    expect(openingMaterial('glass', 'existing')).toBe(glass);
  });

  it('keeps the phase tints: new pulled toward green, demolished translucent red', () => {
    const glass = openingMaterial('glass', 'existing');
    const fresh = openingMaterial('glass', 'new');
    const demo = openingMaterial('glass', 'demo');
    expect(fresh).toBeInstanceOf(MeshPhysicalMaterial);
    expect(demo).toBeInstanceOf(MeshPhysicalMaterial);
    expect(fresh.color.g - fresh.color.r).toBeGreaterThan(glass.color.g - glass.color.r);
    expect(`#${demo.color.getHexString()}`).toBe('#e0413a');
    expect(demo.opacity).toBe(0.35);
    expect(fresh.opacity).toBe(GLASS_OPACITY);
  });

  it('carries the environment map Scene3D hands over; other materials do not', () => {
    const glass = openingMaterial('glass', 'existing');
    const demo = openingMaterial('glass', 'demo');
    const env = new Texture();
    setEnvironmentMap(env);
    expect(glass.envMap).toBe(env);
    expect(demo.envMap).toBe(env);
    // A glass material made after the hand-over gets it too.
    expect(openingMaterial('glass', 'new').envMap).toBe(env);
    expect(openingMaterial('trim', 'existing').envMap).toBeNull();
    expect(terrainMaterial.envMap).toBeNull();
    setEnvironmentMap(null);
    expect(glass.envMap).toBeNull();
  });
});

describe('the lawn and the flat colours', () => {
  it('has no texture without a canvas: the terrain is the flat lawn colour, and records it', () => {
    expect(grassTexture()).toBeNull();
    expect(terrainMaterial.map).toBeNull();
    expect(`#${terrainMaterial.color.getHexString()}`).toBe(GRASS_COLOR);
    expect(terrainMaterial.userData.flatColor).toBe(GRASS_COLOR);
    // The far ground is the same lawn, pulled toward the camera to win the seam's depth tie.
    expect(farGroundMaterial.userData.flatColor).toBe(GRASS_COLOR);
    expect(farGroundMaterial.polygonOffset).toBe(true);
    expect(farGroundMaterial.polygonOffsetFactor).toBeLessThan(0);
  });

  it('wall materials record their flat colour (the colour the export uses for a textured wall)', () => {
    for (const phase of ['existing', 'new', 'demo'] as const) {
      for (const finish of ['shingle', 'clapboard', 'plain'] as const) {
        expect(wallMaterial(phase, 'exterior', finish, '#5a3a35').userData.flatColor).toBe(wallFlatColor(phase, finish, '#5a3a35'));
      }
    }
  });
});

describe('export: colours only', () => {
  function sitePlan() {
    store().setPlan(createEmptyPlan('Lawn'));
    clearHistory();
    const first = store().plan.levelOrder[1];
    const corners = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 180 },
      { x: 0, y: 180 },
    ];
    corners.forEach((p, i) => store().addWall(first, p, corners[(i + 1) % 4], { kind: 'exterior', thickness: 6.5, phase: 'existing' }));
    store().addGradePoint({ at: { x: -20, y: -20 }, elevation: -4 });
    return { plan: store().plan, first };
  }
  const visibility = (activeLevelId: string) => ({ hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId });

  it('drops every map and normal map and uses the live material`s flat colour', () => {
    const { plan, first } = sitePlan();
    // Stand in for the browser, where the terrain carries the lawn texture under a white tint.
    const saved = { map: terrainMaterial.map, normalMap: terrainMaterial.normalMap, color: terrainMaterial.color.clone() };
    terrainMaterial.map = new Texture();
    terrainMaterial.normalMap = new Texture();
    terrainMaterial.color.set('#ffffff');
    try {
      const root = buildExportScene(plan, 'all', visibility(first));
      const terrain = root.getObjectByName('Terrain') as Mesh;
      const m = terrain.material as MeshStandardMaterial;
      expect(m.name).toBe('terrain');
      expect(m.map).toBeNull();
      expect(m.normalMap).toBeNull();
      expect(m.color.equals(new Color(GRASS_COLOR))).toBe(true);
      // The live material is untouched.
      expect(terrainMaterial.map).not.toBeNull();
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        expect((o.material as MeshStandardMaterial).map).toBeNull();
        expect((o.material as MeshStandardMaterial).normalMap).toBeNull();
      });
      disposeExportScene(root);
    } finally {
      terrainMaterial.map = saved.map;
      terrainMaterial.normalMap = saved.normalMap;
      terrainMaterial.color.copy(saved.color);
    }
  });

  it('writes glass as a plain glTF material named glass (no physical extensions at their defaults)', async () => {
    const { first } = sitePlan();
    const top = Object.values(store().plan.levels[first].walls).find((w) => {
      const l = store().plan.levels[first];
      return l.nodes[w.a].y === 0 && l.nodes[w.b].y === 0;
    })!;
    expect(store().addOpening(first, { wallId: top.id, type: 'window', offset: 120, width: 36, height: 48, sill: 36, phase: 'existing' })).not.toBeNull();
    const root = buildExportScene(store().plan, 'all', visibility(first));
    const glb = await toGlb(root);
    disposeExportScene(root);
    const view = new DataView(glb);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, view.getUint32(12, true)))) as {
      materials: { name: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] }; extensions?: object }[];
      extensionsUsed?: string[];
    };
    const glass = json.materials.find((m) => m.name === 'glass')!;
    expect(glass).toBeDefined();
    expect(glass.alphaMode).toBe('BLEND');
    expect(glass.pbrMetallicRoughness!.baseColorFactor![3]).toBeCloseTo(GLASS_OPACITY, 6);
    expect(glass.extensions).toBeUndefined();
    expect(json.extensionsUsed ?? []).toEqual([]);
  });
});

describe('sun shadow camera', () => {
  /** The box's corners in the light camera's view space for a fit (x, y across, depth along the light). */
  function cornersInLightView(box: Box3d, fit: ReturnType<typeof sunShadowFit>) {
    const cam = new OrthographicCamera(-fit.half, fit.half, fit.half, -fit.half, fit.near, fit.far);
    cam.position.set(...fit.position);
    cam.lookAt(new Vector3(...fit.target));
    cam.updateMatrixWorld();
    const view = new Matrix4().copy(cam.matrixWorldInverse);
    const out: Vector3[] = [];
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push(new Vector3(x, y, z).applyMatrix4(view));
    return out;
  }

  it('centres on the box, puts the light twice its radius toward the sun, and frames all of it', () => {
    const box: Box3d = { min: [-84, -104, -40], max: [481, 340.75, 339] };
    const r = 0.5 * Math.hypot(565, 444.75, 379);
    for (const north of [0, 90, 215]) {
      const sun = sunPosition(north);
      const fit = sunShadowFit(box, sun);
      expect(fit.target).toEqual([198.5, 118.375, 149.5]);
      const d = new Vector3(...sun).normalize();
      const offset = new Vector3(...fit.position).sub(new Vector3(...fit.target));
      expect(offset.length()).toBeCloseTo(2 * r, 6);
      expect(offset.normalize().dot(d)).toBeCloseTo(1, 9);
      expect(fit.half).toBeCloseTo(1.1 * r, 9);
      expect(fit.near).toBeCloseTo(r / 2, 9);
      expect(fit.far).toBeCloseTo(2 * r + 1.1 * r + (2 * r) / d.y, 6);
      for (const c of cornersInLightView(box, fit)) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(fit.half);
        expect(Math.abs(c.y)).toBeLessThanOrEqual(fit.half);
        // The camera looks down -z.
        expect(-c.z).toBeGreaterThanOrEqual(fit.near);
        expect(-c.z).toBeLessThanOrEqual(fit.far);
      }
    }
  });

  it('reaches the ground a shadow falls on below the box, and keeps a low sun finite', () => {
    const box: Box3d = { min: [0, 0, 0], max: [300, 300, 300] };
    const fit = sunShadowFit(box, [0, 1, 1]);
    // The box's top corner throws its shadow 300" down the 45 degree ray onto ground 300" below the box.
    const top = new Vector3(300, 300, 300);
    const ground = top.clone().addScaledVector(new Vector3(0, -1, -1).normalize(), 600 * Math.SQRT2);
    const depth = ground.clone().sub(new Vector3(...fit.position)).dot(new Vector3(0, -1, -1).normalize());
    expect(depth).toBeLessThan(fit.far);
    expect(Number.isFinite(sunShadowFit(box, [1, 0.001, 0]).far)).toBe(true);
    expect(sunShadowFit(box, [1, 0.001, 0]).far).toBeLessThan(20 * 300);
  });

  it('fits the starter house with a texel of about half an inch at 2048', () => {
    const plan = migrate(example);
    const fit = sunShadowFit(planBox(plan), sunPosition(plan.site.northAngle));
    // Just over 1/2" since the proposed entry canopy carried the foyer's roof 5' further west.
    expect((2 * fit.half) / 2048).toBeLessThan(0.52);
  });
});

describe('planBox and free-standing walls', () => {
  it('a wall that closes no room (a retaining wall) does not widen the box', () => {
    const plan = migrate(example);
    const box = planBox(plan);
    // The retaining wall runs to x -984; the house (with its porch roofs) starts near x -114.
    expect(box.min[0]).toBeGreaterThan(-200);
  });
});
