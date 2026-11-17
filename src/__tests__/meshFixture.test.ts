import { Box3, BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, decodeExportAssets, disposeExportScene, METRES_PER_INCH, toObj } from '../io/export3d';
import { normaliseMeshAsync, toAssetGlb } from '../io/meshAsset';
import { bytesToBase64, meshFixturePose } from '../model/meshAsset';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Id, MeshAsset, Plan } from '../model/types';
import { fixtureObstacles } from '../view3d/walk';
import { clearHistory, redo, undo, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();

/** GLTFExporter's binary path reads Blobs with FileReader, which node lacks (as in export3d.test.ts). */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
}

/** A 30" wide, 20" deep, 40" tall box as a stored asset. */
let asset: MeshAsset;
beforeAll(async () => {
  if (typeof globalThis.FileReader === 'undefined') (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
  const box = new Mesh(new BoxGeometry(30, 40, 20), new MeshStandardMaterial({ color: '#2a7f62' }));
  const glb = await toAssetGlb(await normaliseMeshAsync(box, { units: 'in', recentre: true, maxTriangles: 100, maxTextureSize: 64 }));
  asset = { id: 'chair', format: 'glb', data: bytesToBase64(glb.bytes), name: 'Chair', bytes: glb.bytes.length, size: glb.size, footprint: glb.footprint };
});

let lid: Id;
beforeEach(() => {
  store().setPlan(createEmptyPlan('Mesh test'));
  clearHistory();
  clearMeshCache();
  lid = defaultLevelId(store().plan);
});
afterEach(() => vi.restoreAllMocks());

/** The plan with a mesh fixture at (100, 50) facing down the plan, scaled 1.5, and a scan overlay. */
function planWithMeshes(): { plan: Plan; fid: Id } {
  const fid = store().addMeshFixture(lid, asset, { origin: { x: 100, y: 50 }, direction: 90, meshScale: 1.5 })!;
  expect(fid).toBeTruthy();
  const scan: MeshAsset = { ...asset, id: 'room', name: 'Room scan' };
  expect(store().setLevelScan(lid, { assetId: 'room', origin: { x: 10, y: 20 }, rotation: 30, elevation: 2, opacity: 0.5, visible: true }, scan)).toBe(true);
  return { plan: store().plan, fid };
}

describe('mesh fixtures and scan overlays in the file', () => {
  it('round-trip through migrate byte for byte', () => {
    const { plan, fid } = planWithMeshes();
    const f = plan.levels[lid].fixtures[fid];
    expect(f).toMatchObject({ kind: 'mesh', assetId: 'chair', meshScale: 1.5, width: 45, depth: 30, height: 60, label: 'Chair' });
    const text = JSON.stringify(plan);
    const back = migrate(JSON.parse(text));
    expect(JSON.stringify(back)).toBe(text);
    expect(back.levels[lid].scan).toEqual({ assetId: 'room', origin: { x: 10, y: 20 }, rotation: 30, elevation: 2, opacity: 0.5, visible: true });
    expect(Object.keys(back.assets!)).toEqual(['chair', 'room']);
  });

  it('drops an asset nothing refers to, and the assets key when none is left', () => {
    const { plan, fid } = planWithMeshes();
    const doc = JSON.parse(JSON.stringify(plan)) as Plan;
    doc.assets!.spare = { ...asset, id: 'spare' };
    expect(Object.keys(migrate(doc).assets!)).toEqual(['chair', 'room']);
    delete doc.levels[lid].fixtures[fid];
    delete doc.levels[lid].scan;
    expect('assets' in migrate(doc)).toBe(false);
  });

  it('drops a mesh fixture or an overlay whose asset is missing, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { plan, fid } = planWithMeshes();
    const doc = JSON.parse(JSON.stringify(plan)) as Plan;
    delete doc.assets!.chair;
    delete doc.assets!.room;
    const back = migrate(doc);
    expect(back.levels[lid].fixtures[fid]).toBeUndefined();
    expect(back.levels[lid].scan).toBeUndefined();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/dropped fixture .*mesh chair is missing[\s\S]*scan overlay/);
  });

  it('recomputes a mesh fixture size from its asset and drops a bad scale alone', () => {
    const { plan, fid } = planWithMeshes();
    const doc = JSON.parse(JSON.stringify(plan)) as Plan;
    Object.assign(doc.levels[lid].fixtures[fid], { width: 999, meshScale: -2 });
    const f = migrate(doc).levels[lid].fixtures[fid];
    expect(f.meshScale).toBeUndefined();
    expect([f.width, f.depth, f.height]).toEqual([30, 20, 40]);
  });

  it('refuses assetId on another kind, and a broken asset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { plan } = planWithMeshes();
    const doc = JSON.parse(JSON.stringify(plan)) as Plan;
    doc.assets!.chair = { ...doc.assets!.chair, data: 'not base64!' };
    expect(Object.keys(migrate(doc).assets ?? {})).toEqual(['room']);
    expect(warn).toHaveBeenCalled();
    expect(store().addFixture(lid, { kind: 'base', assetId: 'chair', origin: { x: 0, y: 0 }, direction: 90, width: 30, depth: 24, height: 34, elevation: 0, phase: 'existing' })).toBeNull();
  });
});

describe('store actions', () => {
  it('addMeshFixture, rescale, uniform resize, the overlay edits: each one undo step', () => {
    const before = store().plan;
    const { fid } = planWithMeshes();
    const fixture = () => store().plan.levels[lid].fixtures[fid];
    expect(store().rescaleMeshFixture(lid, fid, 2)).toBe(true);
    expect([fixture().width, fixture().depth, fixture().height]).toEqual([60, 40, 80]);
    // A new depth in the panel scales it evenly.
    store().updateFixture(lid, fid, { depth: 10 });
    expect(fixture().meshScale).toBe(0.5);
    expect([fixture().width, fixture().height]).toEqual([15, 20]);
    store().updateLevelScan(lid, { opacity: 0.8, rotation: -90 });
    expect(store().plan.levels[lid].scan).toMatchObject({ opacity: 0.8, rotation: 270 });
    store().updateLevelScan(lid, { opacity: 3 });
    expect(store().plan.levels[lid].scan!.opacity).toBe(0.8);
    store().removeLevelScan(lid);
    expect(store().plan.levels[lid].scan).toBeUndefined();
    undo();
    expect(store().plan.levels[lid].scan!.opacity).toBe(0.8);
    undo();
    undo();
    expect(fixture().meshScale).toBe(2);
    undo();
    expect(fixture().meshScale).toBe(1.5);
    redo();
    expect(fixture().meshScale).toBe(2);
    undo();
    undo();
    expect(store().plan.levels[lid].scan).toBeUndefined();
    undo();
    expect(store().plan.levels[lid].fixtures[fid]).toBeUndefined();
    expect(store().plan).toBe(before);
  });

  it('addAsset then a placement by id; an out-of-range scale is refused', () => {
    expect(store().addAsset(asset)).toBe('chair');
    const id = store().addMeshFixture(lid, 'chair', { origin: { x: 0, y: 0 }, direction: 0 });
    expect(store().plan.levels[lid].fixtures[id!]).toMatchObject({ width: 30, depth: 20, height: 40 });
    expect(store().rescaleMeshFixture(lid, id!, 1e6)).toBe(false);
    expect(store().addMeshFixture(lid, 'nope', { origin: { x: 0, y: 0 }, direction: 0 })).toBeNull();
    undo();
    undo();
    expect(store().plan.assets).toBeUndefined();
  });
});

describe('3D, walk and export', () => {
  it('getLevelMeshes gives a mesh fixture no parts but its pose; walking bumps into its box', () => {
    const { plan, fid } = planWithMeshes();
    const m = getLevelMeshes(plan, lid, 'proposed').fixtures.find((f) => f.id === fid)!;
    expect(m.parts).toEqual([]);
    expect(m.mesh).toMatchObject({ assetId: 'chair', scale: 1.5, width: 45, depth: 30, height: 60 });
    expect(fixtureObstacles(plan, lid, 'proposed', 0)).toHaveLength(1);
  });

  it('the pose puts the front (+Z) where the fixture faces and +X on its left, as derive/casework.ts', () => {
    const at = (direction: number, p: [number, number, number]) => {
      const pose = meshFixturePose({ origin: { x: 0, y: 0 }, direction, elevation: 0 });
      return new Vector3(...p).applyAxisAngle(new Vector3(0, 1, 0), pose.rotationY).toArray().map((v) => Math.round(v * 1e9) / 1e9 + 0);
    };
    // Facing +y on the plan (three +Z): no turn.
    expect(at(90, [0, 0, 1])).toEqual([0, 0, 1]);
    // Facing +x: the front is +X; its right (derive/casework.ts v = (-u.y, u.x)) is plan +y, so the asset's +X, its left, goes to -Z.
    expect(at(0, [0, 0, 1])).toEqual([1, 0, 0]);
    expect(at(0, [1, 0, 0])).toEqual([0, 0, -1]);
  });

  it('the GLB and OBJ exports hold the mesh fixture at its place and size, and the visible overlay', async () => {
    const { plan } = planWithMeshes();
    const assets = await decodeExportAssets(plan);
    const vis = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid };
    const root = buildExportScene(plan, 'proposed', vis, assets);
    const chair = root.getObjectByName('Scanned object (Chair)')!;
    expect(chair).toBeDefined();
    expect(root.getObjectByName('Scan overlay')).toBeDefined();
    root.updateMatrixWorld(true);
    const b = new Box3().setFromObject(chair);
    // Metres in the GLB scene: x 100 +- 22.5, y from the floor top up 60, z 50 .. 80 (facing +y).
    const inch = (v: number) => v / METRES_PER_INCH;
    const floorTop = chair.parent!.position.y;
    expect(inch(b.min.x)).toBeCloseTo(77.5, 3);
    expect(inch(b.max.x)).toBeCloseTo(122.5, 3);
    expect(inch(b.min.z)).toBeCloseTo(50, 3);
    expect(inch(b.max.z)).toBeCloseTo(80, 3);
    expect(inch(b.max.y - b.min.y)).toBeCloseTo(60, 3);
    expect(inch(b.min.y)).toBeCloseTo(floorTop, 3);
    // Hidden overlays are not exported.
    disposeExportScene(root);
    const hidden = buildExportScene(plan, 'proposed', { ...vis, showScan: false }, await decodeExportAssets(plan));
    expect(hidden.getObjectByName('Scan overlay')).toBeUndefined();
    // OBJ, in inches.
    const obj = toObj(hidden);
    expect(obj).toMatch(/Scanned object \(Chair\)/);
    const xs = [...obj.matchAll(/^v (\S+) \S+ \S+/gm)].map((m) => Number(m[1]));
    expect(Math.max(...xs)).toBeCloseTo(122.5, 3);
    disposeExportScene(hidden);
  });
});
