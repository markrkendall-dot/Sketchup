// A room bundle's mesh.ply (docs/scan/FORMAT.md: the ARKit reconstruction mesh, metres, in the
// bundle's world frame, sRGB vertex colours) to the small GLB a scan overlay stores, in node.
//
// The tidy that put the walls where the draft has them (scanToPlan.ts worldToDraft: metres to
// inches, the squaring turn, the shift to x 0 y 0, the floor to height 0) is baked into the
// vertices, so the overlay sits on the draft walls at Level.scan origin 0,0, rotation 0. Then the
// asset path the app uses (io/meshAsset.ts normaliseMesh, not recentred, and toAssetGlb), stepping
// the triangle budget down until the GLB is no larger than MAX_ASSET_BYTES.
//
// Colours: PLY's bytes are sRGB; glTF's COLOR_0 is linear. The PLY is read with three's colour
// management off, so its bytes come through untouched, and turned to linear floats here (not to
// linear bytes, which would band the dark end). The GLB keeps them as floats.
import { BufferAttribute, ColorManagement, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { normaliseMeshAsync, SCAN_BUDGET, toAssetGlb } from '../../src/io/meshAsset';
import { MAX_ASSET_BYTES } from '../../src/model/meshAsset';
import { worldToDraft, type ScanDraft } from './scanToPlan';

/** GLTFExporter's binary path reads Blobs with FileReader, which node lacks: a minimal one over Blob.arrayBuffer(). */
export function ensureFileReader(): void {
  if (typeof globalThis.FileReader !== 'undefined') return;
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
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
}

/** An sRGB channel (0..1) as linear light (the sRGB transfer function, as three's ColorManagement). */
export const srgbToLinear = (c: number): number => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

/** mesh.ply as a geometry: positions in world metres, colours (if any) as linear floats. */
export function readPly(bytes: Uint8Array): BufferGeometry {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const was = ColorManagement.enabled;
  ColorManagement.enabled = false;
  let g: BufferGeometry;
  try {
    g = new PLYLoader().parse(buffer);
  } finally {
    ColorManagement.enabled = was;
  }
  if (!g.index || g.index.count < 3) throw new Error('mesh.ply has no faces (a point cloud?)');
  const c = g.getAttribute('color') as BufferAttribute | undefined;
  if (c) {
    const out = new Float32Array(c.count * 3);
    for (let i = 0; i < c.count; i++) {
      out[i * 3] = srgbToLinear(c.getX(i));
      out[i * 3 + 1] = srgbToLinear(c.getY(i));
      out[i * 3 + 2] = srgbToLinear(c.getZ(i));
    }
    g.setAttribute('color', new BufferAttribute(out, 3));
  }
  return g;
}

export interface OverlayGlb {
  bytes: Uint8Array;
  triangles: number;
  /** The triangles in mesh.ply. */
  sourceTriangles: number;
  /** [width X, depth Z, height Y], inches. */
  size: [number, number, number];
  colours: boolean;
}

export interface OverlayOptions {
  /** Start from this many triangles (SCAN_BUDGET's). */
  maxTriangles?: number;
  /** The largest GLB (MAX_ASSET_BYTES). */
  maxBytes?: number;
}

/**
 * mesh.ply's bytes to the overlay GLB, the draft's tidy baked in. Each try over `maxBytes` goes
 * again with three quarters of the triangles; under 2,000 it gives up with an Error. The same
 * input gives the same bytes.
 */
export async function plyToOverlayGlb(ply: Uint8Array, tidy: ScanDraft['tidy'], opts: OverlayOptions = {}): Promise<OverlayGlb> {
  ensureFileReader();
  const g = readPly(ply);
  const sourceTriangles = g.index!.count / 3;
  const move = worldToDraft(tidy);
  const pos = g.getAttribute('position') as BufferAttribute;
  const baked = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) baked.set(move(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
  g.setAttribute('position', new BufferAttribute(baked, 3));
  g.deleteAttribute('normal');
  const colours = !!g.getAttribute('color');
  const mesh = new Mesh(g, new MeshStandardMaterial({ vertexColors: colours, color: colours ? '#ffffff' : '#b8b2a7', roughness: 0.9, metalness: 0 }));
  mesh.name = 'Room scan';
  const maxBytes = opts.maxBytes ?? MAX_ASSET_BYTES;
  let budget = opts.maxTriangles ?? SCAN_BUDGET.maxTriangles;
  for (;;) {
    const glb = await toAssetGlb(await normaliseMeshAsync(mesh, { units: 'in', recentre: false, maxTriangles: budget, maxTextureSize: SCAN_BUDGET.maxTextureSize }));
    if (glb.bytes.byteLength <= maxBytes) return { bytes: glb.bytes, triangles: glb.triangles, sourceTriangles, size: glb.size, colours };
    const next = Math.floor(Math.min(budget, glb.triangles) * 0.75);
    if (next < 2000) throw new Error(`the scan mesh is still ${glb.bytes.byteLength} bytes at ${glb.triangles} triangles (the most a plan takes is ${maxBytes})`);
    budget = next;
  }
}
