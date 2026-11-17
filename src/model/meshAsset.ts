// Mesh assets (DESIGN.md "Mesh assets"): the checks, sizes and bookkeeping for Plan.assets, mesh
// fixtures and level scan overlays. Pure data, no three: shared by the loader (model/plan.ts
// migrate), the store, the panel and the tests. Loading and writing the GLB itself is
// io/meshAsset.ts; decoding it for the 3D view is view3d/assets.ts.

import type { Fixture, Id, MeshAsset, Plan, ScanOverlay, Vec2 } from './types';

/** The largest asset the app takes, bytes of GLB (about 4 MB; base64 makes it a third more in the file). */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
/** What the mesh file picker offers (io/meshImport.ts reads them). */
export const MESH_ACCEPT = '.glb,.gltf,.usdz,.usd,.usdc,.usda,.ply,model/gltf-binary,model/gltf+json,model/vnd.usdz+zip';
/** A scan overlay's opacity when it is loaded. */
export const DEFAULT_SCAN_OPACITY = 0.6;
/** The scale a mesh fixture may take, so a typo cannot make a mile-wide chair. */
export const MESH_SCALE_RANGE = { min: 0.01, max: 100 } as const;

/** Which of a mesh's three sizes: its width (X), depth (Z) or height (Y). */
export type MeshDimension = 'width' | 'depth' | 'height';
export const MESH_DIMENSIONS: readonly MeshDimension[] = ['width', 'depth', 'height'];
const DIM_INDEX: Record<MeshDimension, 0 | 1 | 2> = { width: 0, depth: 1, height: 2 };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPoint = (v: unknown): v is Vec2 => isObject(v) && isNum(v.x) && isNum(v.y);
/** Standard base64 (RFC 4648 alphabet with padding), not empty. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Why a stored asset cannot be used, or null. */
export function meshAssetProblem(a: unknown): string | null {
  if (!isObject(a)) return 'not an object';
  if (typeof a.id !== 'string' || !a.id) return 'needs an id';
  if (a.format !== 'glb') return `unknown format ${String(a.format)}`;
  if (typeof a.data !== 'string' || a.data.length % 4 !== 0 || !BASE64.test(a.data)) return 'the data must be base64';
  if (typeof a.name !== 'string') return 'needs a name';
  if (!isNum(a.bytes) || a.bytes <= 0 || !Number.isInteger(a.bytes)) return 'needs its length in bytes';
  if (a.bytes > MAX_ASSET_BYTES * 1.5) return 'too large';
  if (!Array.isArray(a.size) || a.size.length !== 3 || !a.size.every((v) => isNum(v) && v > 0)) return 'needs a positive size';
  if (a.footprint !== undefined && !(Array.isArray(a.footprint) && a.footprint.length >= 3 && a.footprint.every(isPoint))) return 'the footprint must be three or more points';
  return null;
}

/** Why a scan overlay cannot be used (asset ids checked against `assets` when given), or null. */
export function scanOverlayProblem(s: unknown, assets?: Readonly<Record<Id, unknown>>): string | null {
  if (!isObject(s)) return 'not an object';
  if (typeof s.assetId !== 'string' || !s.assetId) return 'needs an asset';
  if (assets && !assets[s.assetId]) return `its asset ${s.assetId} is missing`;
  if (!isPoint(s.origin)) return 'needs a position';
  if (!isNum(s.rotation) || !isNum(s.elevation)) return 'needs a rotation and an elevation';
  if (!isNum(s.opacity) || s.opacity < 0 || s.opacity > 1) return 'the opacity must be 0 to 1';
  if (typeof s.visible !== 'boolean') return 'visible must be true or false';
  return null;
}

/** A mesh fixture's scale (absent: 1). */
export const meshScaleOf = (f: Pick<Fixture, 'meshScale'>): number => f.meshScale ?? 1;

export const isMeshScale = (v: unknown): v is number => isNum(v) && v >= MESH_SCALE_RANGE.min && v <= MESH_SCALE_RANGE.max;

/** The fixture size an asset at a scale gives: width, depth and height, inches. */
export function meshFixtureSize(asset: Pick<MeshAsset, 'size'>, scale: number): Pick<Fixture, 'width' | 'depth' | 'height'> {
  return { width: asset.size[0] * scale, depth: asset.size[1] * scale, height: asset.size[2] * scale };
}

/**
 * Rescale by a known dimension (the idea of model/underlay.ts calibrateScale): the uniform scale
 * that makes the asset's `dim` measure `real` inches. Null when the size is not usable or the
 * scale would leave MESH_SCALE_RANGE.
 */
export function scaleForDimension(asset: Pick<MeshAsset, 'size'>, dim: MeshDimension, real: number): number | null {
  if (!isNum(real) || real <= 0) return null;
  const base = asset.size[DIM_INDEX[dim]];
  if (!(base > 0)) return null;
  const scale = real / base;
  return isMeshScale(scale) ? scale : null;
}

/** The size of a dimension of an asset at a scale. */
export const meshDimensionOf = (asset: Pick<MeshAsset, 'size'>, dim: MeshDimension, scale = 1): number => asset.size[DIM_INDEX[dim]] * scale;

/** The asset ids the plan's mesh fixtures and scan overlays name. */
export function referencedAssetIds(plan: Pick<Plan, 'levels'>): Set<Id> {
  const out = new Set<Id>();
  for (const level of Object.values(plan.levels)) {
    for (const f of Object.values(level.fixtures ?? {})) if (f.kind === 'mesh' && f.assetId) out.add(f.assetId);
    if (level.scan) out.add(level.scan.assetId);
  }
  return out;
}

/**
 * The plan without the assets nothing refers to (the plan itself when every one is used; the
 * `assets` key left out when none is). For saving: an undone deletion may still need an asset in
 * memory, so the store keeps them and the file does not.
 */
export function withoutUnusedAssets<P extends Pick<Plan, 'levels' | 'assets'>>(plan: P): P {
  const assets = plan.assets;
  if (!assets) return plan;
  const used = referencedAssetIds(plan);
  const ids = Object.keys(assets);
  if (ids.length && ids.every((id) => used.has(id))) return plan;
  const kept: Record<Id, MeshAsset> = {};
  for (const id of ids) if (used.has(id)) kept[id] = assets[id];
  const out = { ...plan };
  if (Object.keys(kept).length) out.assets = kept;
  else delete out.assets;
  return out;
}

/** Bytes as standard base64 (in chunks, so a few MB does not overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Standard base64 back to bytes. */
export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A footprint point (the asset's X and Z as x and y, inches) in a mesh fixture's frame (derive/casework.ts: s across, d from the back). */
export function footprintToLocal(p: Vec2, scale: number): { s: number; d: number } {
  // Asset +X is the fixture's left (-s): see DESIGN.md "Mesh assets" (the front faces +Z).
  return { s: -p.x * scale, d: p.y * scale };
}

/** Where a mesh in the asset convention stands, level-local in three's axes: a translation, a turn about +Y (radians) and a uniform scale. */
export interface MeshPose {
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

/**
 * A mesh fixture's pose (DESIGN.md "Mesh assets"): the asset's origin (the middle of its back edge)
 * at the fixture's origin and bottom, its front (+Z) turned to face `direction` (a plan angle, 0 =
 * +x, 90 = +y), scaled by its meshScale. Turning by 90 degrees less the direction about +Y takes
 * +Z to the front and +X to the fixture's left, as derive/casework.ts lays a fixture out.
 */
export function meshFixturePose(f: Pick<Fixture, 'origin' | 'direction' | 'elevation' | 'meshScale'>): MeshPose {
  return { position: [f.origin.x, f.elevation, f.origin.y], rotationY: Math.PI / 2 - (f.direction * Math.PI) / 180, scale: meshScaleOf(f) };
}

/** A scan overlay's pose: its 0,0 at its origin and elevation, turned clockwise on the plan (a negative turn about +Y, like a structure). */
export function scanOverlayPose(s: Pick<ScanOverlay, 'origin' | 'rotation' | 'elevation'>): MeshPose {
  return { position: [s.origin.x, s.elevation, s.origin.y], rotationY: (-s.rotation * Math.PI) / 180, scale: 1 };
}
