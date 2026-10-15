import { memo } from 'react';
import { getFarGroundGeometry, getFenceMeshes, getSiteMeshes, getSurfaceMeshes, getTerrainGeometry } from '../derive/meshes';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { chimneyPartMaterial, columnMaterial, farGroundMaterial, fenceMaterial, surfaceMaterial, terrainMaterial } from './materials';

/**
 * The ground draws after the house's opaque meshes (which keep render order 0), so the depth test
 * rejects the lawn hidden behind the house before its texture and shadows are computed.
 */
const GROUND_RENDER_ORDER = 1;

/**
 * The ground: one mesh over the plan plus a 100' margin, from the memoized terrain geometry
 * (derive/meshes.ts getTerrainGeometry, which owns and disposes it), with the lowest level's
 * footprint cut out of it down to under its slab and a skirt round its edge. The selector returns
 * the same geometry while the grade points, the plan bounds, the fallback elevation and that
 * footprint are unchanged. It receives shadows and casts none.
 */
export const Terrain = memo(function Terrain() {
  const viewMode = useUiStore((s) => s.viewMode);
  const geometry = usePlanStore((s) => getTerrainGeometry(s.plan, viewMode));
  return <mesh name="terrain" geometry={geometry} material={terrainMaterial} renderOrder={GROUND_RENDER_ORDER} receiveShadow dispose={null} />;
});

/**
 * The far ground: the lawn from the terrain's edge out to 1000' from its centre, falling to the
 * bottom of the terrain's skirt there (derive/meshes.ts getFarGroundGeometry), so the horizon
 * shows ground under the sky.
 */
export const FarGround = memo(function FarGround() {
  const viewMode = useUiStore((s) => s.viewMode);
  const geometry = usePlanStore((s) => getFarGroundGeometry(s.plan, viewMode));
  return <mesh name="far-ground" geometry={geometry} material={farGroundMaterial} renderOrder={GROUND_RENDER_ORDER} receiveShadow dispose={null} />;
});

/**
 * The site's columns (chimneys, posts, flues, piers) in absolute elevation, hidden by the view mode like walls,
 * with a capped chimney's cap and spark arrestor. They cast and receive shadows; a demolished one
 * (translucent) casts none, and neither does the arrestor (a see-through wire mesh, drawn after the
 * opaque meshes like a window screen).
 */
export const SiteColumns = memo(function SiteColumns() {
  const viewMode = useUiStore((s) => s.viewMode);
  const meshes = usePlanStore((s) => getSiteMeshes(s.plan, viewMode));
  return (
    <group name="site">
      {meshes.columns.map((c) => (
        <group key={c.id}>
          <mesh
            name={`column:${c.id}`}
            geometry={c.geometry}
            material={columnMaterial(c.kind, c.phase, c.color)}
            renderOrder={c.phase === 'demo' ? 1 : 0}
            castShadow={c.phase !== 'demo'}
            receiveShadow
            dispose={null}
          />
          {c.parts?.map((p) => (
            <mesh
              key={p.part}
              name={`column:${c.id}:${p.part}`}
              geometry={p.geometry}
              material={chimneyPartMaterial(p.part, c.phase)}
              renderOrder={c.phase === 'demo' || p.part === 'arrestor' ? 1 : 0}
              castShadow={c.phase !== 'demo' && p.part !== 'arrestor'}
              receiveShadow
              dispose={null}
            />
          ))}
        </group>
      ))}
    </group>
  );
});

/**
 * The site's ground surfaces (gravel, asphalt, concrete, stone) draped on the terrain 1" above it
 * (derive/meshes.ts getSurfaceMeshes), hidden by the view mode like walls. Drawn with the ground
 * (after the house's opaque meshes) and a polygon offset toward the camera, so the lawn never shows
 * through; they receive the sun's shadows and cast none.
 */
export const SiteSurfaces = memo(function SiteSurfaces() {
  const viewMode = useUiStore((s) => s.viewMode);
  const meshes = usePlanStore((s) => getSurfaceMeshes(s.plan, viewMode));
  return (
    <group name="site-surfaces">
      {meshes.map((sf) => (
        <mesh
          key={sf.id}
          name={`surface:${sf.id}`}
          geometry={sf.geometry}
          material={surfaceMaterial(sf.material, sf.phase, sf.color)}
          renderOrder={GROUND_RENDER_ORDER}
          receiveShadow
          dispose={null}
        />
      ))}
    </group>
  );
});

/**
 * The site's split-rail fences (derive/meshes.ts getFenceMeshes): the posts and rails in the fence's
 * colour, the logs' ends in the end grain's. They cast and receive shadows; a demolished one
 * (translucent) casts none.
 */
export const SiteFences = memo(function SiteFences() {
  const viewMode = useUiStore((s) => s.viewMode);
  const meshes = usePlanStore((s) => getFenceMeshes(s.plan, viewMode));
  return (
    <group name="site-fences">
      {meshes.map((f) => (
        <group key={f.id}>
          {(['body', 'end'] as const).map((part) => (
            <mesh
              key={part}
              name={`fence:${f.id}:${part}`}
              geometry={part === 'body' ? f.body : f.ends}
              material={fenceMaterial(part, f.phase, f.color)}
              renderOrder={f.phase === 'demo' ? 1 : 0}
              castShadow={f.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          ))}
        </group>
      ))}
    </group>
  );
});
