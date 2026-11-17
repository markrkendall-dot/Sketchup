import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Vector3, type Material, type Object3D, type Texture } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { Vec2 } from '../model/types';

// Mesh assets (DESIGN.md "Mesh assets"): an imported or scanned mesh brought into the asset
// convention and written as the small GLB a plan stores. No DOM needed (node scripts and tests use
// it too), except texture downscaling, which draws on a canvas and is skipped without one.
//
// The convention: inches; three's axes as the app uses them (Y up, plan x = X, plan y = Z). A
// fixture's mesh (recentre) has its bounding box centred on X, its back edge on Z = 0 and its front
// toward +Z (glTF's front), and its bottom on Y = 0: a fixture's frame, origin at the middle of its
// back edge. A scan overlay's mesh (no recentre) keeps the scan's own origin.

export interface NormaliseOptions {
  /** The source's length unit: metres (glTF, USDZ, an ARKit PLY) or inches. */
  units: 'm' | 'in';
  /** Move the bounding box into the fixture convention (else keep the source's origin). */
  recentre: boolean;
  /** Most triangles the result may have (decimated with meshoptimizer to fit). */
  maxTriangles: number;
  /** Longest texture side, px (only with a DOM). */
  maxTextureSize: number;
}

/** Default budgets: an object about 1.5 MB, a room overlay about 3 MB. */
export const OBJECT_BUDGET = { maxTriangles: 60000, maxTextureSize: 1024 } as const;
export const SCAN_BUDGET = { maxTriangles: 120000, maxTextureSize: 1024 } as const;

/** glTF and USD are in metres; the plan is in inches (io/export3d.ts METRES_PER_INCH). */
const INCHES_PER_METRE = 1 / 0.0254;

/** One mesh's triangles, baked into the result's frame, by attribute. */
interface Piece {
  position: Float32Array;
  normal: Float32Array | null;
  uv: Float32Array | null;
  /** RGBA. */
  color: Float32Array | null;
  index: Uint32Array;
}

/** The float values of an attribute (de-normalised), itemSize wide (padding with `fill`). */
function floats(attr: BufferAttribute | undefined, width: number, fill = 1): Float32Array | null {
  if (!attr) return null;
  const n = attr.count;
  const out = new Float32Array(n * width);
  const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < width; c++) out[i * width + c] = c < attr.itemSize ? get[c].call(attr, i) : fill;
  }
  return out;
}

/** A mesh's geometry split by material (its groups), each piece with its own index. */
function piecesOf(mesh: Mesh, scale: number): { material: Material; piece: Piece }[] {
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  if (scale !== 1) g.scale(scale, scale, scale);
  const pos = floats(g.getAttribute('position') as BufferAttribute, 3)!;
  const nrm = floats(g.getAttribute('normal') as BufferAttribute | undefined, 3);
  const uv = floats(g.getAttribute('uv') as BufferAttribute | undefined, 2);
  const col = floats(g.getAttribute('color') as BufferAttribute | undefined, 4);
  const count = pos.length / 3;
  const full = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: count }, (_, i) => i);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: full.length, materialIndex: 0 }];
  g.dispose();
  const out: { material: Material; piece: Piece }[] = [];
  for (const grp of groups) {
    const material = mats[grp.materialIndex ?? 0] ?? mats[0];
    const end = Math.min(full.length, grp.start + (Number.isFinite(grp.count) ? grp.count : full.length));
    const index = full.slice(grp.start, end - ((end - grp.start) % 3));
    if (index.length) out.push({ material, piece: { position: pos, normal: nrm, uv, color: col, index } });
  }
  return out;
}

/** Several pieces sharing a material as one (only the attributes every piece has). */
function mergePieces(pieces: Piece[]): Piece {
  if (pieces.length === 1) return pieces[0];
  const all = <K extends 'normal' | 'uv' | 'color'>(k: K) => pieces.every((p) => p[k]);
  const width = { position: 3, normal: 3, uv: 2, color: 4 } as const;
  const verts = pieces.reduce((n, p) => n + p.position.length / 3, 0);
  const cat = (k: 'position' | 'normal' | 'uv' | 'color') => {
    const out = new Float32Array(verts * width[k]);
    let at = 0;
    for (const p of pieces) {
      out.set(p[k]!, at);
      at += p[k]!.length;
    }
    return out;
  };
  const index = new Uint32Array(pieces.reduce((n, p) => n + p.index.length, 0));
  let at = 0;
  let base = 0;
  for (const p of pieces) {
    for (let i = 0; i < p.index.length; i++) index[at + i] = p.index[i] + base;
    at += p.index.length;
    base += p.position.length / 3;
  }
  return { position: cat('position'), normal: all('normal') ? cat('normal') : null, uv: all('uv') ? cat('uv') : null, color: all('color') ? cat('color') : null, index };
}

/** Only the vertices the index uses, renumbered in first-use order. */
function compact(p: Piece): Piece {
  const remap = new Int32Array(p.position.length / 3).fill(-1);
  let n = 0;
  const index = new Uint32Array(p.index.length);
  for (let i = 0; i < p.index.length; i++) {
    const v = p.index[i];
    if (remap[v] < 0) remap[v] = n++;
    index[i] = remap[v];
  }
  const take = (src: Float32Array | null, w: number) => {
    if (!src) return null;
    const out = new Float32Array(n * w);
    for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) out.set(src.subarray(v * w, v * w + w), remap[v] * w);
    return out;
  };
  return { position: take(p.position, 3)!, normal: take(p.normal, 3), uv: take(p.uv, 2), color: take(p.color, 4), index };
}

/**
 * Fewer triangles (about `target`), keeping the vertices' own normals, UVs and colours: the
 * simplifier only drops vertices. An attribute-aware pass first (seams and colour edges weigh
 * against a collapse), then a sloppy one if that could not get there (an open scan with many
 * borders).
 */
function simplify(p: Piece, target: number): Piece {
  const tris = p.index.length / 3;
  if (tris <= target) return p;
  const want = Math.max(3, Math.floor(target) * 3);
  let index = p.index;
  const weights: number[] = [];
  const parts: [Float32Array, number, number][] = [];
  if (p.uv) parts.push([p.uv, 2, 0.5]);
  if (p.color) parts.push([p.color, 3, 0.5]);
  const n = p.position.length / 3;
  const stride = parts.reduce((s, [, w]) => s + w, 0);
  let packed: Float32Array | null = null;
  if (stride) {
    packed = new Float32Array(n * stride);
    let off = 0;
    for (const [src, w, weight] of parts) {
      const srcW = src.length / n;
      for (let v = 0; v < n; v++) for (let c = 0; c < w; c++) packed[v * stride + off + c] = src[v * srcW + c];
      off += w;
      for (let c = 0; c < w; c++) weights.push(weight);
    }
  }
  [index] = packed
    ? MeshoptSimplifier.simplifyWithAttributes(index, p.position, 3, packed, stride, weights, null, want, 1)
    : MeshoptSimplifier.simplify(index, p.position, 3, want, 1);
  if (index.length > want) [index] = MeshoptSimplifier.simplifySloppy(index, p.position, 3, null, want, 1);
  return compact({ ...p, index });
}

/** A texture's image drawn no larger than `max` px on its longest side (needs a DOM). */
function downscaleTexture(tex: Texture, max: number): void {
  if (typeof document === 'undefined') return;
  const img = tex.image as { width?: number; height?: number } | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!(w > max || h > max)) return;
  const f = max / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * f));
  canvas.height = Math.max(1, Math.round(h * f));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  tex.image = canvas;
  tex.needsUpdate = true;
}

const KEPT_TEXTURE_SLOTS: ReadonlySet<string> = new Set(['map', 'alphaMap', 'emissiveMap']);
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;

/**
 * A copy of `source` in the asset convention (inches, recentred or not), its meshes merged per
 * material and decimated to `maxTriangles` (a share of the budget each, by size), with UVs and
 * vertex colours kept and textures (with a DOM) no larger than `maxTextureSize`. Points and lines
 * are left out. Throws when there are no triangles. Await MeshoptSimplifier.ready first
 * (normaliseMeshAsync does).
 */
export function normaliseMesh(source: Object3D, opts: NormaliseOptions): Group {
  source.updateMatrixWorld(true);
  const scale = opts.units === 'm' ? INCHES_PER_METRE : 1;
  const byMaterial = new Map<Material, Piece[]>();
  source.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry?.getAttribute('position')) return;
    for (const { material, piece } of piecesOf(m, scale)) {
      const list = byMaterial.get(material);
      if (list) list.push(piece);
      else byMaterial.set(material, [piece]);
    }
  });
  let merged = [...byMaterial].map(([material, pieces]) => ({ material, piece: compact(mergePieces(pieces)) }));
  const total = merged.reduce((n, m) => n + m.piece.index.length / 3, 0);
  if (!total) throw new Error('This file has no surfaces (triangles) to show.');
  if (total > opts.maxTriangles) {
    const ratio = opts.maxTriangles / total;
    merged = merged.map((m) => ({ material: m.material, piece: simplify(m.piece, Math.max(1, Math.floor((m.piece.index.length / 3) * ratio))) }));
  }
  // Where the convention puts it.
  const box = new Box3();
  for (const { piece } of merged) {
    for (let i = 0; i < piece.position.length; i += 3) box.expandByPoint(new Vector3(piece.position[i], piece.position[i + 1], piece.position[i + 2]));
  }
  const shift = opts.recentre ? new Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -box.min.z) : new Vector3();
  const out = new Group();
  out.name = source.name || 'Mesh';
  for (const { material, piece } of merged) {
    const g = new BufferGeometry();
    const pos = piece.position;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += shift.x;
      pos[i + 1] += shift.y;
      pos[i + 2] += shift.z;
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    if (piece.uv) g.setAttribute('uv', new BufferAttribute(piece.uv, 2));
    if (piece.color) {
      // RGB unless a colour is see-through.
      let alpha = false;
      for (let i = 3; i < piece.color.length; i += 4) if (piece.color[i] < 0.999) alpha = true;
      const w = alpha ? 4 : 3;
      const n = piece.color.length / 4;
      const c = new Float32Array(n * w);
      for (let v = 0; v < n; v++) for (let k = 0; k < w; k++) c[v * w + k] = piece.color[v * 4 + k];
      g.setAttribute('color', new BufferAttribute(c, w));
    }
    g.setIndex(new BufferAttribute(piece.index, 1));
    if (piece.normal) g.setAttribute('normal', new BufferAttribute(piece.normal, 3));
    else g.computeVertexNormals();
    const mat = material.clone();
    if (piece.color && 'vertexColors' in mat) mat.vertexColors = true;
    // A plan file carries every byte of an asset, so only the colour survives: normal, roughness
    // and the other maps are dropped, and an opaque colour map is stored as JPEG.
    const slots = mat as unknown as Record<string, Texture | null | undefined> & { transparent?: boolean; alphaTest?: number };
    for (const slot of TEXTURE_SLOTS) {
      const tex = slots[slot];
      if (!tex) continue;
      if (!KEPT_TEXTURE_SLOTS.has(slot)) {
        slots[slot] = null;
        continue;
      }
      downscaleTexture(tex, opts.maxTextureSize);
      if (slot === 'map' && !slots.transparent && !slots.alphaTest) tex.userData = { ...tex.userData, mimeType: 'image/jpeg' };
    }
    mat.needsUpdate = true;
    const mesh = new Mesh(g, mat);
    mesh.name = material.name || out.name;
    out.add(mesh);
  }
  out.updateMatrixWorld(true);
  return out;
}

/** normaliseMesh once the simplifier's WebAssembly is ready. */
export async function normaliseMeshAsync(source: Object3D, opts: NormaliseOptions): Promise<Group> {
  await MeshoptSimplifier.ready;
  return normaliseMesh(source, opts);
}

/** Triangles in an object's meshes. */
export function triangleCountOf(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

/** The convex hull of points (Andrew's monotone chain), counter-clockwise; collinear points dropped. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** v to `digits` decimals, without float noise in the JSON (31.496, not 31.496000000000002). */
const round = (v: number, digits: number) => Number(v.toFixed(digits)) + 0;

export interface AssetGlb {
  bytes: Uint8Array;
  /** [width along X, depth along Z, height along Y], inches. */
  size: [number, number, number];
  /** Its outline seen from above (asset X and Z as x and y, inches); absent when it has no area. */
  footprint?: Vec2[];
  triangles: number;
}

/**
 * The binary glTF an asset stores (the GLTFExporter approach of io/export3d.ts), with its bounding
 * size and its floor outline. In node, GLTFExporter needs a FileReader (the tests supply one).
 */
export async function toAssetGlb(root: Object3D): Promise<AssetGlb> {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('The mesh is empty.');
  const pts: Vec2[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push({ x: v.x, y: v.z });
    }
  });
  const hull = convexHull(pts).map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) }));
  const out = await new GLTFExporter().parseAsync(root, { binary: true, trs: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('glTF exporter returned JSON, expected binary');
  const s = box.getSize(new Vector3());
  // A flat mesh (a rug) still has some height, so the fixture it makes has a positive size.
  const dim = (x: number) => Math.max(0.01, round(x, 3));
  const size: [number, number, number] = [dim(s.x), dim(s.z), dim(s.y)];
  return { bytes: new Uint8Array(out), size, ...(hull.length >= 3 ? { footprint: hull } : {}), triangles: triangleCountOf(root) };
}
