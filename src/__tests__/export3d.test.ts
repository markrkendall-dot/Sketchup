import { Box3, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene, METRES_PER_INCH, toGlb, toObj, type ExportLevelVisibility } from '../io/export3d';
import { createEmptyPlan } from '../model/plan';
import type { Id, Phase, Plan } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;

/**
 * GLTFExporter's binary path reads Blobs with FileReader, which node 22 lacks. Node has Blob, so a
 * minimal FileReader over Blob.arrayBuffer() is enough.
 */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      let bin = '';
      for (const byte of new Uint8Array(b)) bin += String.fromCharCode(byte);
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
      this.onloadend?.();
    });
  }
}

beforeAll(() => {
  if (typeof globalThis.FileReader === 'undefined') {
    (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
  }
});

interface Fixture {
  plan: Plan;
  basement: Id;
  first: Id;
  second: Id;
}

/**
 * First Floor: a 30' x 40' exterior rectangle (centerlines) with a window on the top wall, a
 * demolished interior divider across the middle and stairs in the lower half. Second Floor: the
 * walls copied from below (the divider too). Basement: empty.
 */
function fixture(): Fixture {
  store().setPlan(createEmptyPlan('Test House'));
  clearHistory();
  const [basement, first, second] = store().plan.levelOrder;
  const corners = [
    { x: 0, y: 0 },
    { x: 360, y: 0 },
    { x: 360, y: 480 },
    { x: 0, y: 480 },
  ];
  corners.forEach((p, i) => store().addWall(first, p, corners[(i + 1) % 4], ext));
  store().addWall(first, { x: 0, y: 240 }, { x: 360, y: 240 }, { kind: 'interior', thickness: 4.5, phase: 'demo' });
  const top = Object.values(store().plan.levels[first].walls).find((w) => {
    const l = store().plan.levels[first];
    return l.nodes[w.a].y === 0 && l.nodes[w.b].y === 0;
  })!;
  expect(
    store().addOpening(first, { wallId: top.id, type: 'window', offset: 120, width: 36, height: 48, sill: 36, phase: 'existing' }),
  ).not.toBeNull();
  expect(
    store().addStairs(first, { origin: { x: 60, y: 450 }, direction: 270, width: 36, run: 120, phase: 'existing', cutsFloorAbove: true }),
  ).not.toBeNull();
  store().copyWallsFromLevel(first, second);
  return { plan: store().plan, basement, first, second };
}

const allVisible = (activeLevelId: Id): ExportLevelVisibility => ({
  hidden3dLevels: [],
  only3dActiveAndBelow: false,
  activeLevelId,
});

const meshNames = (g: Group) => g.children.map((c) => c.name);
const byName = (root: Group, name: string) => root.children.find((c) => c.name === name) as Group | undefined;

beforeEach(() => clearMeshCache());

describe('buildExportScene', () => {
  it('root named after the plan, scaled to metres, one group per non-empty visible level', () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'all', allVisible(first));
    expect(root.name).toBe('Test House');
    expect(root.scale.toArray()).toEqual([METRES_PER_INCH, METRES_PER_INCH, METRES_PER_INCH]);
    // The empty basement has nothing to export.
    expect(meshNames(root)).toEqual(['First Floor', 'Second Floor']);
    expect(byName(root, 'First Floor')!.position.y).toBe(8);
    expect(byName(root, 'Second Floor')!.position.y).toBe(116);
    disposeExportScene(root);
  });

  it('names the meshes Wall <n> (<kind>, <phase>), Floor and Stairs', () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'all', allVisible(first));
    const names = meshNames(byName(root, 'First Floor')!);
    expect(names.filter((n) => n === 'Floor')).toHaveLength(1);
    expect(names.filter((n) => n === 'Stairs')).toHaveLength(1);
    const walls = names.filter((n) => n.startsWith('Wall '));
    expect(walls).toHaveLength(7); // 4 sides, two of them split by the divider, plus the divider
    for (const n of walls) expect(n).toMatch(/^Wall \d+ \((exterior|interior), (existing|demo|new)\)$/);
    expect(walls.filter((n) => n.endsWith('(interior, demo)'))).toHaveLength(1);
    expect(new Set(walls).size).toBe(7);
    // Second Floor: the copied walls, a slab (with the stair hole), no stairs.
    const second = meshNames(byName(root, 'Second Floor')!);
    expect(second.filter((n) => n.startsWith('Wall '))).toHaveLength(7);
    expect(second).toContain('Floor');
    expect(second).not.toContain('Stairs');
    disposeExportScene(root);
  });

  it('the First Floor group measures 30\' x 40\' plus one wall thickness, in metres', () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'all', allVisible(first));
    // The structure only: window trim and sills project beyond the wall faces.
    const group = byName(root, 'First Floor')!;
    const box = new Box3();
    for (const c of group.children) if (c.name !== 'Window' && c.name !== 'Door') box.expandByObject(c);
    const t = 6.5 * METRES_PER_INCH;
    expect(box.max.x - box.min.x).toBeCloseTo(9.144 + t, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(12.192 + t, 6);
    expect(box.min.x).toBeCloseTo(-t / 2, 6);
    expect(box.min.z).toBeCloseTo(-t / 2, 6);
    // Slab bottom (floor top 8" minus 12" framing) to the stairs' top (Second Floor top, 116").
    expect(box.min.y).toBeCloseTo(-4 * METRES_PER_INCH, 6);
    expect(box.max.y).toBeCloseTo(116 * METRES_PER_INCH, 6);
    disposeExportScene(root);
  });

  it('clones the cached geometry, with normals and no colours; one material per phase/kind', () => {
    const { plan, first } = fixture();
    const cached = new Set<BufferGeometry>();
    for (const id of plan.levelOrder) {
      const m = getLevelMeshes(plan, id, 'all');
      for (const w of m.walls) cached.add(w.geometry);
      for (const s of m.stairs) cached.add(s.geometry);
      if (m.floor) cached.add(m.floor);
    }
    let disposedOriginals = 0;
    for (const g of cached) g.addEventListener('dispose', () => disposedOriginals++);
    const root = buildExportScene(plan, 'all', allVisible(first));
    const mats = new Set<MeshStandardMaterial>();
    let meshes = 0;
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      meshes++;
      const g = o.geometry as BufferGeometry;
      expect(cached.has(g)).toBe(false);
      expect(g.getAttribute('normal')).toBeDefined();
      expect(g.getAttribute('color')).toBeUndefined();
      expect(o.material).toBeInstanceOf(MeshStandardMaterial);
      const m = o.material as MeshStandardMaterial;
      expect(m.vertexColors).toBe(false);
      expect(m.map).toBeNull();
      mats.add(m);
    });
    expect(meshes).toBe(7 + 1 + 1 + 7 + 1 + 3); // + the window's trim, sash and glass
    expect([...mats].map((m) => m.name).sort()).toEqual([
      'floor',
      'glass',
      'sash',
      'stairs_existing',
      'trim',
      'wall_demo_interior',
      'wall_existing_exterior',
    ]);
    const demo = [...mats].find((m) => m.name === 'wall_demo_interior')!;
    expect(demo.transparent).toBe(true);
    disposeExportScene(root);
    expect(disposedOriginals).toBe(0);
  });

  it('roofs export as Roof meshes with roof_<finish>_<phase> materials, and follow the view mode', () => {
    const { first, second } = fixture();
    const roof = {
      shape: 'gable' as const,
      outline: [
        { x: -3.25, y: -3.25 },
        { x: 363.25, y: -3.25 },
        { x: 363.25, y: 483.25 },
        { x: -3.25, y: 483.25 },
      ],
      ridgeAngle: 90,
      pitch: 8,
      overhang: 24,
      bearingOffset: 0,
      thickness: 8,
      fascia: 6,
      phase: 'existing' as const,
      finish: 'metal' as const,
    };
    expect(store().addRoof(second, roof)).not.toBeNull();
    expect(store().addRoof(first, { ...roof, shape: 'shed', ridgeAngle: 270, pitch: 3, phase: 'demo', finish: 'shingle' })).not.toBeNull();
    const plan = store().plan;
    const root = buildExportScene(plan, 'all', allVisible(first));
    const roofs = (name: string) => byName(root, name)!.children.filter((c) => c.name === 'Roof') as Mesh[];
    expect(roofs('Second Floor')).toHaveLength(1);
    expect(roofs('First Floor')).toHaveLength(1);
    expect((roofs('Second Floor')[0].material as MeshStandardMaterial).name).toBe('roof_metal_existing');
    expect((roofs('First Floor')[0].material as MeshStandardMaterial).name).toBe('roof_shingle_demo');
    disposeExportScene(root);
    const proposed = buildExportScene(plan, 'proposed', allVisible(first));
    expect(byName(proposed, 'First Floor')!.children.some((c) => c.name === 'Roof')).toBe(false);
    expect(byName(proposed, 'Second Floor')!.children.some((c) => c.name === 'Roof')).toBe(true);
    disposeExportScene(proposed);
  });

  it('names opening materials: screen, door_leaf_<hex> for a leaf in another colour, then the phase', () => {
    const { first } = fixture();
    const l = store().plan.levels[first];
    const top = Object.values(l.walls).find((w) => l.nodes[w.a].y === 0 && l.nodes[w.b].y === 0)!;
    store().updateOpening(first, Object.keys(l.openings)[0], { glazing: 'screen', sashes: 2 });
    const door = (offset: number, phase: Phase, leafColor?: string) =>
      expect(store().addOpening(first, { wallId: top.id, type: 'door', offset, width: 36, height: 80, sill: 0, phase, ...(leafColor ? { leafColor } : {}) })).not.toBeNull();
    door(160, 'existing');
    door(200, 'existing', '#2f4a3a');
    door(240, 'new', '#2f4a3a');
    door(280, 'demo', '#2f4a3a');
    const root = buildExportScene(store().plan, 'all', allVisible(first));
    const parts = byName(root, 'First Floor')!.children.filter((c) => c.name === 'Window' || c.name === 'Door') as Mesh[];
    const names = new Set(parts.map((m) => (m.material as MeshStandardMaterial).name));
    expect([...names].sort()).toEqual(['door_leaf', 'door_leaf_2f4a3a', 'door_leaf_2f4a3a_new', 'door_leaf_demo', 'sash', 'sash_demo', 'sash_new', 'screen', 'trim', 'trim_demo', 'trim_new']);
    const screen = parts.find((m) => (m.material as MeshStandardMaterial).name === 'screen')!;
    expect(screen.name).toBe('Window');
    expect((screen.material as MeshStandardMaterial).transparent).toBe(true);
    expect((screen.material as MeshStandardMaterial).map).toBeNull();
    disposeExportScene(root);
  });

  it('the proposed view leaves the demolished wall out', () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'proposed', allVisible(first));
    const walls = meshNames(byName(root, 'First Floor')!).filter((n) => n.startsWith('Wall '));
    expect(walls).toHaveLength(6);
    expect(walls.some((n) => n.includes('demo'))).toBe(false);
    disposeExportScene(root);
  });

  it('hidden levels are left out', () => {
    const { plan, first, second } = fixture();
    const hidden = buildExportScene(plan, 'all', { ...allVisible(first), hidden3dLevels: [second] });
    expect(meshNames(hidden)).toEqual(['First Floor']);
    disposeExportScene(hidden);
    const below = buildExportScene(plan, 'all', { ...allVisible(first), only3dActiveAndBelow: true });
    expect(meshNames(below)).toEqual(['First Floor']);
    disposeExportScene(below);
    const none = buildExportScene(plan, 'all', { ...allVisible(first), hidden3dLevels: [...plan.levelOrder] });
    expect(none.children).toHaveLength(0);
  });
});

describe('file formats', () => {
  it('writes a binary glTF that GLTFLoader reads back with the same hierarchy and size', async () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'proposed', allVisible(first));
    const glb = await toGlb(root);
    disposeExportScene(root);
    const view = new DataView(glb);
    expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);

    // The JSON chunk keeps the names exactly (GLTFLoader sanitizes them: spaces become _).
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, view.getUint32(12, true)))) as {
      nodes: { name: string; children?: number[]; scale?: number[]; translation?: number[] }[];
      materials: { name: string }[];
    };
    const node = (name: string) => json.nodes.find((n) => n.name === name)!;
    expect(node('Test House').scale).toEqual([METRES_PER_INCH, METRES_PER_INCH, METRES_PER_INCH]);
    expect(node('Test House').children!.map((i) => json.nodes[i].name)).toEqual(['First Floor', 'Second Floor']);
    expect(node('First Floor').translation).toEqual([0, 8, 0]);
    const ffNames = node('First Floor').children!.map((i) => json.nodes[i].name);
    expect(ffNames).toContain('Floor');
    expect(ffNames).toContain('Stairs');
    expect(ffNames.filter((n) => n.startsWith('Wall '))).toHaveLength(6);
    expect(json.materials.map((m) => m.name).sort()).toEqual(['floor', 'glass', 'sash', 'stairs_existing', 'trim', 'wall_existing_exterior']);

    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const ff = gltf.scene.getObjectByName('First_Floor')!;
    expect(ff.parent!.scale.x).toBeCloseTo(METRES_PER_INCH, 9);
    gltf.scene.updateMatrixWorld(true);
    const box = new Box3();
    // The structure only: window trim and sills project beyond the wall faces.
    ff.children.forEach((c) => {
      if (c.name !== 'Window' && c.name !== 'Door') box.expandByObject(c);
    });
    expect(box.max.x - box.min.x).toBeCloseTo(9.144 + 6.5 * METRES_PER_INCH, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(12.192 + 6.5 * METRES_PER_INCH, 5);
  });

  it('writes an OBJ in inches with one named object per mesh, prefixed by its level', () => {
    const { plan, first } = fixture();
    const root = buildExportScene(plan, 'all', allVisible(first));
    const obj = toObj(root);
    disposeExportScene(root);
    const objects = obj.split('\n').filter((l) => l.startsWith('o '));
    expect(objects).toContain('o First Floor - Floor');
    expect(objects).toContain('o First Floor - Stairs');
    expect(objects).toContain('o Second Floor - Floor');
    expect(objects.filter((l) => l.startsWith('o First Floor - Wall '))).toHaveLength(7);
    const xs = obj
      .split('\n')
      .filter((l) => l.startsWith('v '))
      .map((l) => Number(l.split(' ')[1]));
    expect(xs.length).toBeGreaterThan(100);
    // Inches: the exterior faces at -3.25" and 363.25".
    expect(Math.min(...xs)).toBeCloseTo(-3.25, 6);
    expect(Math.max(...xs)).toBeCloseTo(363.25, 6);
    expect(obj).toContain('usemtl wall_existing_exterior');
  });
});
