import { useEffect, useMemo, useState } from 'react';
import { Material, Mesh, Object3D, Texture, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { base64ToBytes } from '../model/meshAsset';
import type { Id, MeshAsset, Plan } from '../model/types';

// Decoded mesh assets for the 3D view (DESIGN.md "Mesh assets"). Each asset's GLB is decoded once
// with GLTFLoader into a template scene, kept by asset id and by the identity of its data string
// (an asset replaced under the same id decodes again). Users get clones that share the template's
// geometry and materials (or their own materials, for an opacity), so a template is disposed only
// when its asset leaves the plan (pruneAssetCache).

interface Entry {
  data: string;
  promise: Promise<Group>;
  template: Group | null;
  failed: boolean;
}

const cache = new Map<Id, Entry>();
const listeners = new Set<() => void>();

/** Be told whenever an asset finishes decoding (the 3D view redraws, and its shadows); returns the unsubscribe. */
export function onMeshAssetDecoded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Decode an asset (once per id and data). */
export function loadMeshAsset(asset: Pick<MeshAsset, 'id' | 'data'>): Promise<Group> {
  const hit = cache.get(asset.id);
  if (hit && hit.data === asset.data) return hit.promise;
  if (hit) disposeEntry(hit);
  const bytes = base64ToBytes(asset.data);
  const entry: Entry = { data: asset.data, template: null, failed: false, promise: Promise.resolve(null as unknown as Group) };
  entry.promise = new GLTFLoader().parseAsync(bytes.buffer as ArrayBuffer, '').then(
    (gltf) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.updateMatrixWorld(true);
      if (cache.get(asset.id) === entry) entry.template = scene;
      for (const fn of listeners) fn();
      return scene;
    },
    (err: unknown) => {
      entry.failed = true;
      console.warn(`HomePlan: could not decode mesh asset ${asset.id}`, err);
      for (const fn of listeners) fn();
      throw err;
    },
  );
  // A failure is reported once, above; callers that only await readiness do not see it again.
  entry.promise.catch(() => undefined);
  cache.set(asset.id, entry);
  return entry.promise;
}

/** The decoded template now (null while decoding, or when it failed or is not loaded). */
export function meshAssetTemplate(asset: Pick<MeshAsset, 'id' | 'data'>): Group | null {
  const hit = cache.get(asset.id);
  return hit && hit.data === asset.data ? hit.template : null;
}

function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof Texture) textures.add(v);
      mat.dispose();
    }
  });
  for (const t of textures) t.dispose();
}

function disposeEntry(e: Entry): void {
  if (e.template) disposeObject(e.template);
  e.template = null;
}

/** Drop (and dispose) the decoded assets the plan no longer has, or has with other data. */
export function pruneAssetCache(plan: Pick<Plan, 'assets'>): void {
  for (const [id, e] of cache) {
    if (plan.assets?.[id]?.data === e.data) continue;
    disposeEntry(e);
    cache.delete(id);
  }
}

/** Forget every decoded asset (tests, a plan swap). */
export function clearAssetCache(): void {
  for (const e of cache.values()) disposeEntry(e);
  cache.clear();
}

/**
 * A copy of a template for one placement: shared geometry; its own materials when `opacity` is
 * under 1 (a demolished fixture, a scan overlay), which disposeMeshClone frees. `overlay` (a scan
 * overlay, which lies on the walls and floor it was scanned from) also gets its own materials,
 * drawn a little toward the camera so it does not flicker through the faces it sits on.
 */
export function cloneMeshAsset(template: Group, opacity = 1, overlay = false): Object3D {
  const copy = template.clone(true);
  if (opacity < 1 || overlay) {
    copy.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const one = (mat: Material) => {
        const c = mat.clone();
        c.transparent = true;
        c.opacity = opacity;
        c.depthWrite = false;
        c.userData.ownClone = true;
        if (overlay) {
          c.polygonOffset = true;
          c.polygonOffsetFactor = -1;
          c.polygonOffsetUnits = -4;
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
      m.castShadow = false;
    });
  }
  return copy;
}

/** Set the opacity of a see-through copy's own materials. */
export function setCloneOpacity(copy: Object3D, opacity: number): void {
  copy.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.userData.ownClone) mat.opacity = opacity;
  });
}

/** Free what cloneMeshAsset made for a copy (its own materials; the geometry is the template's). */
export function disposeMeshClone(copy: Object3D): void {
  copy.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.userData.ownClone) mat.dispose();
  });
}

/**
 * A clone of the plan's asset for one placement, or null while it decodes (or when the plan has
 * no such asset, or it failed). Re-renders when the decode finishes. `overlay`: a scan overlay
 * (cloneMeshAsset).
 */
export function useMeshAsset(plan: Pick<Plan, 'assets'>, assetId: Id | undefined, opacity = 1, overlay = false): Object3D | null {
  const asset = assetId ? plan.assets?.[assetId] : undefined;
  const [, bump] = useState(0);
  const template = asset ? meshAssetTemplate(asset) : null;
  useEffect(() => {
    if (!asset || template) return;
    let live = true;
    const fn = () => {
      if (live) bump((n) => n + 1);
    };
    const off = onMeshAssetDecoded(fn);
    void loadMeshAsset(asset).catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, [asset, template]);
  // Its own materials only once it is see-through; a new opacity is set on them in place.
  const seeThrough = opacity < 1 || overlay;
  const copy = useMemo(() => (template ? cloneMeshAsset(template, seeThrough ? 0.5 : 1, overlay) : null), [template, seeThrough, overlay]);
  useEffect(() => () => void (copy && disposeMeshClone(copy)), [copy]);
  useEffect(() => {
    if (copy && seeThrough) setCloneOpacity(copy, opacity);
  }, [copy, seeThrough, opacity]);
  return copy;
}
