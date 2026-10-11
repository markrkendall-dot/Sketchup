import { memo } from 'react';
import { getSiteMeshes, getTerrainGeometry } from '../derive/meshes';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { columnMaterial, terrainMaterial } from './materials';

/**
 * The ground: one mesh over the plan plus a 40' margin, from the memoized terrain geometry
 * (derive/meshes.ts getTerrainGeometry, which owns and disposes it). The selector returns the same
 * geometry while the grade points, the plan bounds and the fallback elevation are unchanged.
 */
export const Terrain = memo(function Terrain() {
  const geometry = usePlanStore((s) => getTerrainGeometry(s.plan));
  return <mesh name="terrain" geometry={geometry} material={terrainMaterial} dispose={null} />;
});

/** The site's columns (chimney, posts) in absolute elevation, hidden by the view mode like walls. */
export const SiteColumns = memo(function SiteColumns() {
  const viewMode = useUiStore((s) => s.viewMode);
  const meshes = usePlanStore((s) => getSiteMeshes(s.plan, viewMode));
  return (
    <group name="site">
      {meshes.columns.map((c) => (
        <mesh
          key={c.id}
          name={`column:${c.id}`}
          geometry={c.geometry}
          material={columnMaterial(c.kind, c.phase)}
          renderOrder={c.phase === 'demo' ? 1 : 0}
          dispose={null}
        />
      ))}
    </group>
  );
});
