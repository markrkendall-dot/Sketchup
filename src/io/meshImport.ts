import type { Object3D } from 'three';
import { bytesToBase64, MAX_ASSET_BYTES } from '../model/meshAsset';
import { newId } from '../model/plan';
import type { MeshAsset } from '../model/types';
import { normaliseMeshAsync, OBJECT_BUDGET, SCAN_BUDGET, toAssetGlb, type NormaliseOptions } from './meshAsset';

// Importing a mesh file in the browser (DESIGN.md "Mesh assets"): glTF (.glb, or a .gltf with its
// buffers embedded), USDZ (Apple Object Capture, Reality Composer) or PLY (an ARKit scan, with
// vertex colours), normalised and decimated to a small GLB asset. The UI imports this module
// dynamically and it imports each loader dynamically, so the loaders, three's exporter and the
// simplifier load only when a file is imported and the editor's bundle does not grow.

export interface ImportMeshOptions {
  /** true: an object placed as a fixture (recentred); false: a room scan overlay (its origin kept). */
  recentre?: boolean;
  maxTriangles?: number;
  maxTextureSize?: number;
}

export interface ImportedMesh {
  asset: MeshAsset;
  triangles: number;
}

const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** The file's scene, in its own units (metres for all three formats). */
async function readScene(file: File): Promise<Object3D> {
  const ext = extOf(file.name);
  const buffer = await file.arrayBuffer();
  if (ext === 'glb' || ext === 'gltf') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    try {
      const gltf = await new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(buffer) : buffer, '');
      return gltf.scene;
    } catch (err) {
      throw new Error(`Could not read ${file.name} as glTF${ext === 'gltf' ? ' (a .gltf must have its buffers and images embedded; export a .glb instead)' : ''}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
  if (ext === 'usdz' || ext === 'usd' || ext === 'usdc' || ext === 'usda') {
    const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js');
    try {
      // parse() returns the group at once; its textures arrive through onLoad.
      return await new Promise<Object3D>((resolve, reject) => {
        let done = false;
        const group = new USDLoader().parse(
          buffer,
          '',
          (g) => {
            done = true;
            resolve(g);
          },
          (e) => {
            done = true;
            reject(e instanceof Error ? e : new Error(String(e)));
          },
        );
        // A file with no textures may never call back.
        setTimeout(() => {
          if (!done) resolve(group);
        }, 4000);
      });
    } catch (err) {
      throw new Error(`Could not read ${file.name} as USDZ: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
  if (ext === 'ply') {
    const [{ PLYLoader }, { Mesh, MeshStandardMaterial }] = await Promise.all([import('three/examples/jsm/loaders/PLYLoader.js'), import('three')]);
    const geometry = new PLYLoader().parse(buffer);
    // PLYLoader indexes the faces it reads: no index, no faces.
    if (!geometry.index) throw new Error(`${file.name} is a point cloud with no faces; export the scan as a mesh.`);
    const colours = !!geometry.getAttribute('color');
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: colours, color: colours ? '#ffffff' : '#b8b2a7', roughness: 0.9 }));
    mesh.name = file.name.replace(/\.[^.]+$/, '');
    return mesh;
  }
  throw new Error(`${file.name}: HomePlan reads .glb, .gltf, .usdz and .ply meshes.`);
}

/**
 * Read a mesh file and make a plan asset of it (DESIGN.md "Mesh assets"): in inches, in the asset
 * convention (recentred for an object, its origin kept for a scan), at most about 60,000 triangles
 * with textures no larger than 1024 px for an object (a scan gets more triangles). If the GLB is
 * still over 4 MB it tries once at half the budget, then refuses with a readable Error.
 */
export async function importMeshFile(file: File, opts: ImportMeshOptions = {}): Promise<ImportedMesh> {
  const recentre = opts.recentre ?? true;
  const budget = recentre ? OBJECT_BUDGET : SCAN_BUDGET;
  const source = await readScene(file);
  const base: NormaliseOptions = { units: 'm', recentre, maxTriangles: opts.maxTriangles ?? budget.maxTriangles, maxTextureSize: opts.maxTextureSize ?? budget.maxTextureSize };
  let glb = await toAssetGlb(await normaliseMeshAsync(source, base));
  if (glb.bytes.length > MAX_ASSET_BYTES) {
    glb = await toAssetGlb(await normaliseMeshAsync(source, { ...base, maxTriangles: Math.floor(base.maxTriangles / 2), maxTextureSize: Math.max(256, base.maxTextureSize / 2) }));
  }
  if (glb.bytes.length > MAX_ASSET_BYTES) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    throw new Error(`${file.name} is still ${mb(glb.bytes.length)} MB after decimating it (the most a plan takes is ${mb(MAX_ASSET_BYTES)} MB). Simplify it or shrink its textures first.`);
  }
  const name = file.name.replace(/\.[^.]+$/, '').trim() || 'Scanned object';
  const asset: MeshAsset = { id: newId(), format: 'glb', data: bytesToBase64(glb.bytes), name, bytes: glb.bytes.length, size: glb.size, ...(glb.footprint ? { footprint: glb.footprint } : {}) };
  return { asset, triangles: glb.triangles };
}
