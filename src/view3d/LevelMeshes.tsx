import { memo } from 'react';
import { getLevelElevations } from '../derive/levels';
import { getLevelMeshes } from '../derive/meshes';
import type { Id } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { floorMaterial, stairsMaterial, wallMaterial } from './materials';

/**
 * One level's walls, slab and stairs in a group at the level's floor top. Geometry comes from the
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
          material={wallMaterial(w.phase, w.kind)}
          renderOrder={w.phase === 'demo' ? 1 : 0}
          dispose={null}
        />
      ))}
      {meshes.stairs.map((s) => (
        <mesh key={s.id} name={`stairs:${s.id}`} geometry={s.geometry} material={stairsMaterial(s.phase)} dispose={null} />
      ))}
    </group>
  );
});
