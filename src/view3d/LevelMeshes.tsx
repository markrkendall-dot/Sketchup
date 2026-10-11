import { memo } from 'react';
import { getLevelElevations } from '../derive/levels';
import { getLevelMeshes } from '../derive/meshes';
import type { Id } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { fasciaMaterial, floorMaterial, openingMaterial, roofMaterial, stairsMaterial, wallMaterial } from './materials';

/**
 * One level's walls, slab, stairs and roofs in a group at the level's floor top. Geometry comes from the
 * memoized derive/meshes.ts cache, which owns it (and disposes it), so meshes use dispose={null}.
 * The selector returns the same object while nothing on the level changed.
 */
export const LevelMeshes = memo(function LevelMeshes({ levelId }: { levelId: Id }) {
  const viewMode = useUiStore((s) => s.viewMode);
  const meshes = usePlanStore((s) => getLevelMeshes(s.plan, levelId, viewMode));
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[levelId]?.floorTop ?? 0);
  return (
    <group position={[0, floorTop, 0]} name={`level:${levelId}`}>
      {meshes.floor && <mesh name="floor" geometry={meshes.floor} material={floorMaterial} dispose={null} />}
      {meshes.walls.map((w) => (
        <mesh
          key={w.id}
          name={`wall:${w.id}`}
          geometry={w.geometry}
          material={wallMaterial(w.phase, w.kind, w.finish, w.color)}
          renderOrder={w.phase === 'demo' ? 1 : 0}
          dispose={null}
        />
      ))}
      {meshes.stairs.map((s) => (
        <mesh key={s.id} name={`stairs:${s.id}`} geometry={s.geometry} material={stairsMaterial(s.phase)} dispose={null} />
      ))}
      {meshes.roofs.map((r) => (
        <group key={r.id}>
          <mesh
            name={`roof:${r.id}`}
            geometry={r.geometry}
            material={roofMaterial(r.finish, r.phase, r.color)}
            renderOrder={r.phase === 'demo' ? 1 : 0}
            dispose={null}
          />
          {r.fascia && (
            <mesh name={`fascia:${r.id}`} geometry={r.fascia} material={fasciaMaterial(r.phase)} renderOrder={r.phase === 'demo' ? 1 : 0} dispose={null} />
          )}
        </group>
      ))}
      {meshes.openings.map((o) => (
        <group key={o.id} name={`opening:${o.id}`}>
          {o.parts.map((p) => (
            <mesh
              key={p.part}
              name={`opening:${o.id}:${p.part}`}
              geometry={p.geometry}
              material={openingMaterial(p.part, o.phase)}
              renderOrder={o.phase === 'demo' || p.part === 'glass' ? 1 : 0}
              dispose={null}
            />
          ))}
        </group>
      ))}
    </group>
  );
});
