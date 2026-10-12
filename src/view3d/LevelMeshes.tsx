import { memo } from 'react';
import { getLevelElevations } from '../derive/levels';
import { getLevelMeshes } from '../derive/meshes';
import type { Id } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { counterColorOf } from '../model/casework';
import { caseworkMaterial, counterMaterial, fasciaMaterial, floorMaterial, openingMaterial, rafterMaterial, roofMaterial, stairsMaterial, wallMaterial } from './materials';

/**
 * One level's walls, slab, stairs and roofs in a group at the level's floor top. Geometry comes from the
 * memoized derive/meshes.ts cache, which owns it (and disposes it), so meshes use dispose={null}.
 * The selector returns the same object while nothing on the level changed.
 *
 * Shadows (Scene3D's sun): everything receives them; everything opaque casts them. Demolished work
 * is translucent red, so it casts none (a see-through wall would throw a solid shadow), and neither
 * do glass and screen walls.
 */
export const LevelMeshes = memo(function LevelMeshes({ levelId }: { levelId: Id }) {
  const viewMode = useUiStore((s) => s.viewMode);
  // The 3D bar's Roofs checkbox: off lifts every roof (with its fascia and rafter tails) off.
  const showRoofs = useUiStore((s) => s.show3dRoofs);
  const meshes = usePlanStore((s) => getLevelMeshes(s.plan, levelId, viewMode));
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[levelId]?.floorTop ?? 0);
  const counterColor = usePlanStore((s) => counterColorOf(s.plan.levels[levelId]?.finishes));
  return (
    <group position={[0, floorTop, 0]} name={`level:${levelId}`}>
      {meshes.floor && <mesh name="floor" geometry={meshes.floor} material={floorMaterial} castShadow receiveShadow dispose={null} />}
      {meshes.walls.map((w) => (
        <mesh
          key={w.id}
          name={`wall:${w.id}`}
          geometry={w.geometry}
          material={wallMaterial(w.phase, w.kind, w.finish, w.color)}
          renderOrder={w.phase === 'demo' ? 1 : 0}
          castShadow={w.phase !== 'demo' && w.finish !== 'screen'}
          receiveShadow
          dispose={null}
        />
      ))}
      {meshes.stairs.map((s) => (
        <mesh
          key={s.id}
          name={`stairs:${s.id}`}
          geometry={s.geometry}
          material={stairsMaterial(s.phase)}
          castShadow={s.phase !== 'demo'}
          receiveShadow
          dispose={null}
        />
      ))}
      {showRoofs && meshes.roofs.map((r) => (
        <group key={r.id}>
          <mesh
            name={`roof:${r.id}`}
            geometry={r.geometry}
            material={roofMaterial(r.finish, r.phase, r.color, r.weathering)}
            renderOrder={r.phase === 'demo' ? 1 : 0}
            castShadow={r.phase !== 'demo'}
            receiveShadow
            dispose={null}
          />
          {r.fascia && (
            <mesh
              name={`fascia:${r.id}`}
              geometry={r.fascia}
              material={fasciaMaterial(r.phase, r.boardColor)}
              renderOrder={r.phase === 'demo' ? 1 : 0}
              castShadow={r.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          )}
          {r.rafters && (
            <mesh
              name={`rafters:${r.id}`}
              geometry={r.rafters}
              material={rafterMaterial(r.phase, r.boardColor)}
              renderOrder={r.phase === 'demo' ? 1 : 0}
              castShadow={r.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          )}
        </group>
      ))}
      {meshes.fixtures.map((f) => (
        <group key={f.id} name={`fixture:${f.id}`}>
          {f.parts.map((p) => (
            <mesh
              key={p.part}
              name={`fixture:${f.id}:${p.part}`}
              geometry={p.geometry}
              material={caseworkMaterial(p.part, f.phase, f.frontColor)}
              renderOrder={f.phase === 'demo' ? 1 : 0}
              castShadow={f.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          ))}
        </group>
      ))}
      {meshes.counters.map((c) => (
        <mesh
          key={c.id}
          name={`counter:${c.id}`}
          geometry={c.geometry}
          material={counterMaterial(c.phase, counterColor)}
          renderOrder={c.phase === 'demo' ? 1 : 0}
          castShadow={c.phase !== 'demo'}
          receiveShadow
          dispose={null}
        />
      ))}
      {meshes.openings.map((o) => (
        <group key={o.id} name={`opening:${o.id}`}>
          {o.parts.map((p) => (
            <mesh
              key={p.part}
              name={`opening:${o.id}:${p.part}`}
              geometry={p.geometry}
              material={openingMaterial(p.part, o.phase, o.leafColor)}
              renderOrder={o.phase === 'demo' || p.part === 'glass' || p.part === 'screen' ? 1 : 0}
              castShadow={o.phase !== 'demo' && p.part !== 'glass' && p.part !== 'screen'}
              receiveShadow
              dispose={null}
            />
          ))}
        </group>
      ))}
    </group>
  );
});
