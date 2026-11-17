// A room scan's overlay GLB (docs/scan/<name>/overlay.glb, written by `npm run scan` from the
// bundle's mesh.ply, scripts/scan/overlay.ts) as a plan asset and a level's scan overlay
// (Level.scan, DESIGN.md "Mesh assets"). Synchronous and free of three, so a hand-written plan
// script (scripts/kitchen-plan.ts and the like) can call attachScanOverlay as it calls the other
// planLib helpers, and the plan it builds is the same bytes every run.
//
// The GLB's vertices already sit where the draft has the room (the tidy is baked in), so by default
// the overlay goes on at 0,0, unturned, on the floor. A plan script that draws the room somewhere
// else on its level passes the origin (and turn) that moves the draft's 0,0 there.
import { bytesToBase64, DEFAULT_SCAN_OPACITY, meshAssetProblem } from '../../src/model/meshAsset';
import type { Id, MeshAsset, ScanOverlay } from '../../src/model/types';
import { store } from '../planLib';
import { nodeFs, pathOf } from './nodeFs';

/** The asset id an overlay of the scan called `name` gets: fixed, so the plan JSON is stable. */
export const overlayAssetId = (name: string): Id => `scan-${name}`;

/**
 * The bounding size of a GLB (inches: [width along X, depth along Z, height along Y]) from the
 * min and max its POSITION accessors carry. Only for GLBs whose nodes are not moved, turned or
 * scaled (what toAssetGlb writes from normaliseMesh); throws otherwise.
 */
export function glbSize(bytes: Uint8Array): [number, number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('the GLB has no JSON chunk first');
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    nodes?: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes?: { primitives: { attributes: Record<string, number> }[] }[];
    accessors?: { min?: number[]; max?: number[] }[];
  };
  for (const n of gltf.nodes ?? []) {
    if (n.translation || n.rotation || n.scale || n.matrix) throw new Error('the GLB moves its nodes: its size cannot be read from the accessors');
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of gltf.meshes ?? []) {
    for (const p of m.primitives) {
      const a = gltf.accessors?.[p.attributes.POSITION];
      if (!a?.min || !a.max) throw new Error('a GLB position accessor has no min and max');
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k]);
        max[k] = Math.max(max[k], a.max[k]);
      }
    }
  }
  if (!(max[0] >= min[0])) throw new Error('the GLB has no meshes');
  const dim = (k: number) => Math.max(0.01, Number((max[k] - min[k]).toFixed(3)) + 0);
  return [dim(0), dim(2), dim(1)];
}

/** An overlay GLB as a plan asset (its id overlayAssetId(name)). */
export function overlayAsset(bytes: Uint8Array, name: string, label = `${name} scan`): MeshAsset {
  const asset: MeshAsset = { id: overlayAssetId(name), format: 'glb', data: bytesToBase64(bytes), name: label, bytes: bytes.byteLength, size: glbSize(bytes) };
  const problem = meshAssetProblem(asset);
  if (problem) throw new Error(`the scan overlay cannot be stored: ${problem}`);
  return asset;
}

export type OverlayPlacement = Partial<Pick<ScanOverlay, 'origin' | 'rotation' | 'elevation' | 'opacity' | 'visible'>>;

/** The overlay of an asset: at 0,0 unturned on the floor, visible at DEFAULT_SCAN_OPACITY, unless `at` says otherwise. */
export function scanOverlayOf(assetId: Id, at: OverlayPlacement = {}): ScanOverlay {
  return { assetId, origin: at.origin ?? { x: 0, y: 0 }, rotation: at.rotation ?? 0, elevation: at.elevation ?? 0, opacity: at.opacity ?? DEFAULT_SCAN_OPACITY, visible: at.visible ?? true };
}

/**
 * Put the overlay GLB at `glbPath` (docs/scan/<name>/overlay.glb) on a level of the plan the
 * planLib store holds, as Level.scan with its asset. The scan's name is the GLB's folder's. Returns
 * the asset id; throws when the store refuses it.
 */
export function attachScanOverlay(levelId: Id, glbPath: string | URL, at: OverlayPlacement = {}): Id {
  const path = pathOf(glbPath);
  const folder = path.split(/[\\/]/).slice(-2, -1)[0] || 'room';
  const asset = overlayAsset(new Uint8Array(nodeFs().readFileSync(path)), folder);
  if (!store().setLevelScan(levelId, scanOverlayOf(asset.id, at), asset)) throw new Error(`the scan overlay ${path} was refused on level ${levelId}`);
  return asset.id;
}
