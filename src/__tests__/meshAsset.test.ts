import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { normaliseMeshAsync, toAssetGlb, triangleCountOf, convexHull } from '../io/meshAsset';
import { base64ToBytes, bytesToBase64, meshFixtureSize, scaleForDimension, withoutUnusedAssets } from '../model/meshAsset';
import type { MeshAsset, Plan } from '../model/types';

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

beforeAll(() => {
  if (typeof globalThis.FileReader === 'undefined') (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
});

const boundsOf = (o: { updateMatrixWorld: (f: boolean) => void }) => {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o as never);
};

describe('normaliseMesh', () => {
  it('a 1 x 0.5 x 2 m box off at (3, 1, -2) comes out in inches, centred on x, back on z = 0, bottom on y = 0', async () => {
    const box = new Mesh(new BoxGeometry(1, 2, 0.5), new MeshStandardMaterial({ color: '#c04020' }));
    box.position.set(3, 1, -2);
    const root = new Group();
    root.add(box);
    const out = await normaliseMeshAsync(root, { units: 'm', recentre: true, maxTriangles: 1000, maxTextureSize: 256 });
    const b = boundsOf(out);
    const inch = 1 / 0.0254;
    expect(b.min.x).toBeCloseTo(-inch / 2, 3);
    expect(b.max.x).toBeCloseTo(inch / 2, 3);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(2 * inch, 3);
    expect(b.min.z).toBeCloseTo(0, 6);
    expect(b.max.z).toBeCloseTo(0.5 * inch, 3);
    expect(triangleCountOf(out)).toBe(12);
  });

  it('without recentring the source origin stays put (a room scan), and inches stay inches', async () => {
    const box = new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial());
    box.position.set(100, 5, 50);
    const out = await normaliseMeshAsync(box, { units: 'in', recentre: false, maxTriangles: 1000, maxTextureSize: 256 });
    const b = boundsOf(out);
    expect(b.min.toArray().map((v) => Math.round(v))).toEqual([95, 0, 45]);
    expect(b.max.toArray().map((v) => Math.round(v))).toEqual([105, 10, 55]);
  });

  it('a dense sphere is decimated to the budget, keeping its UVs and vertex colours, and its size', async () => {
    const g = new SphereGeometry(0.4, 256, 128);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([g.getAttribute('position').getY(i) > 0 ? 1 : 0.2, 0.5, 0.3], i * 3);
    g.setAttribute('color', new (g.getAttribute('position').constructor as typeof import('three').BufferAttribute)(colors, 3));
    const sphere = new Mesh(g, new MeshStandardMaterial({ vertexColors: true }));
    expect(triangleCountOf(sphere)).toBeGreaterThan(60000);
    const out = await normaliseMeshAsync(sphere, { units: 'm', recentre: true, maxTriangles: 5000, maxTextureSize: 256 });
    const tris = triangleCountOf(out);
    expect(tris).toBeLessThanOrEqual(5000);
    expect(tris).toBeGreaterThan(1000);
    const mesh = out.children[0] as Mesh;
    expect(mesh.geometry.getAttribute('uv')).toBeDefined();
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
    expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true);
    const size = boundsOf(out).getSize(new Vector3());
    const d = 0.8 / 0.0254;
    // Decimation keeps the silhouette's extremes within a few percent.
    for (const v of size.toArray()) expect(Math.abs(v - d) / d).toBeLessThan(0.05);
    expect(boundsOf(out).min.y).toBeCloseTo(0, 6);
  });

  it('refuses a file with no triangles', async () => {
    await expect(normaliseMeshAsync(new Group(), { units: 'm', recentre: true, maxTriangles: 10, maxTextureSize: 16 })).rejects.toThrow(/no surfaces/);
  });
});

describe('toAssetGlb', () => {
  it('writes a GLB that GLTFLoader reads back with the same bounds, and reports its size [w, d, h] and footprint', async () => {
    const box = new Mesh(new BoxGeometry(30, 40, 20), new MeshStandardMaterial({ color: '#336699' }));
    const norm = await normaliseMeshAsync(box, { units: 'in', recentre: true, maxTriangles: 100, maxTextureSize: 64 });
    const glb = await toAssetGlb(norm);
    expect(glb.size).toEqual([30, 20, 40]);
    expect(glb.triangles).toBe(12);
    expect(glb.footprint).toHaveLength(4);
    expect(glb.footprint!.map((p) => [p.x, p.y]).sort()).toEqual([[-15, 0], [-15, 20], [15, 0], [15, 20]].sort());
    const back = await new GLTFLoader().parseAsync(glb.bytes.buffer.slice(glb.bytes.byteOffset, glb.bytes.byteOffset + glb.bytes.byteLength) as ArrayBuffer, '');
    const b = boundsOf(back.scene);
    expect(b.min.toArray()).toEqual([-15, 0, 0].map((v) => expect.closeTo(v, 4)));
    expect(b.max.toArray()).toEqual([15, 40, 20].map((v) => expect.closeTo(v, 4)));
    // Base64 survives the round trip.
    expect(base64ToBytes(bytesToBase64(glb.bytes))).toEqual(glb.bytes);
  });

  it('convexHull: a square with points inside is its four corners', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
    ]);
    expect(hull).toHaveLength(4);
  });
});

describe('asset sizes and rescaling', () => {
  const asset: Pick<MeshAsset, 'size'> = { size: [20, 18, 32] };
  it('a fixture is its asset times its scale', () => {
    expect(meshFixtureSize(asset, 1.5)).toEqual({ width: 30, depth: 27, height: 48 });
  });
  it('rescale by a known dimension: the height measured 34" gives 34/32', () => {
    expect(scaleForDimension(asset, 'height', 34)).toBeCloseTo(34 / 32, 12);
    expect(scaleForDimension(asset, 'width', 10)).toBe(0.5);
    expect(scaleForDimension(asset, 'depth', 0)).toBeNull();
    expect(scaleForDimension(asset, 'depth', 1e9)).toBeNull();
  });
  it('withoutUnusedAssets keeps what fixtures and overlays name, and drops the key when nothing is left', () => {
    const a = (id: string): MeshAsset => ({ id, format: 'glb', data: 'AAAA', name: id, bytes: 3, size: [1, 1, 1] });
    const plan = {
      levels: { l: { fixtures: { f: { kind: 'mesh', assetId: 'x' } }, scan: { assetId: 'y' } } },
      assets: { x: a('x'), y: a('y'), z: a('z') },
    } as unknown as Pick<Plan, 'levels' | 'assets'>;
    expect(Object.keys(withoutUnusedAssets(plan).assets!)).toEqual(['x', 'y']);
    const none = { levels: { l: { fixtures: {} } }, assets: { z: a('z') } } as unknown as Pick<Plan, 'levels' | 'assets'>;
    expect('assets' in withoutUnusedAssets(none)).toBe(false);
  });
});
