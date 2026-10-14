import { memo } from 'react';
import { getLevelElevations } from '../derive/levels';
import { getDeckMeshes, getFloorOpeningMeshes, getLevelMeshes, getMemberMeshes, openingPartColor } from '../derive/meshes';
import type { Id } from '../model/types';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { counterColorOf } from '../model/casework';
import { caseworkMaterial, counterMaterial, deckMaterial, memberMaterial, fasciaMaterial, railingMaterial, stairPartMaterial, floorFinishMaterial, floorMaterial, openingMaterial, rafterMaterial, roofMaterial, roomWallMaterial, stairsMaterial, wallMaterial } from './materials';

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
  // Decks have their own memo: they depend on the ground and other levels (derive/meshes.ts getDeckMeshes).
  const decks = usePlanStore((s) => getDeckMeshes(s.plan, levelId, viewMode));
  // So do the guards round floor openings (the level's walls and the stairs below).
  const guards = usePlanStore((s) => getFloorOpeningMeshes(s.plan, levelId, viewMode));
  // And beams and posts (a post runs up to the beam over it).
  const members = usePlanStore((s) => getMemberMeshes(s.plan, levelId, viewMode));
  const floorTop = usePlanStore((s) => getLevelElevations(s.plan)[levelId]?.floorTop ?? 0);
  const counterColor = usePlanStore((s) => counterColorOf(s.plan.levels[levelId]?.finishes));
  return (
    <group position={[0, floorTop, 0]} name={`level:${levelId}`}>
      {meshes.floor && <mesh name="floor" geometry={meshes.floor} material={floorMaterial} castShadow receiveShadow dispose={null} />}
      {meshes.floorFinishes.map((f) => (
        <mesh key={f.roomId} name={`floor-finish:${f.roomId}`} geometry={f.geometry} material={floorFinishMaterial(f.phase, f.finish, f.color)} receiveShadow dispose={null} />
      ))}
      {meshes.walls.map((w) => (
        <group key={w.id}>
          <mesh
            name={`wall:${w.id}`}
            geometry={w.geometry}
            material={wallMaterial(w.phase, w.kind, w.finish, w.color)}
            renderOrder={w.phase === 'demo' ? 1 : 0}
            castShadow={w.phase !== 'demo' && w.finish !== 'screen'}
            receiveShadow
            dispose={null}
          />
          {/* The faces a room dresses (never a demolished or screen wall's): they cast like the wall. */}
          {w.faces?.map((f) => (
            <mesh
              key={`${f.side}:${f.band}`}
              name={`wall:${w.id}:${f.side}:${f.band}`}
              geometry={f.geometry}
              material={roomWallMaterial(w.phase, f.finish, f.color)}
              castShadow
              receiveShadow
              dispose={null}
            />
          ))}
          {/* The outside face below an exterior band, in the band's finish (never a screen). */}
          {w.band && (
            <mesh
              name={`wall:${w.id}:band`}
              geometry={w.band.geometry}
              material={wallMaterial(w.phase, w.kind, w.band.finish, w.band.color)}
              castShadow
              receiveShadow
              dispose={null}
            />
          )}
        </group>
      ))}
      {meshes.stairs.map((s) => (
        <group key={s.id}>
          <mesh name={`stairs:${s.id}`} geometry={s.geometry} material={stairsMaterial(s.phase)} castShadow={s.phase !== 'demo'} receiveShadow dispose={null} />
          {s.railing && (
            <mesh
              name={`stairs:${s.id}:railing`}
              geometry={s.railing}
              material={railingMaterial(s.phase)}
              renderOrder={s.phase === 'demo' ? 1 : 0}
              castShadow={s.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          )}
        </group>
      ))}
      {meshes.staircases.map((sc) => (
        <group key={sc.id} name={`staircase:${sc.id}`}>
          {sc.parts.map((p) => (
            <mesh
              key={`${p.group}|${p.mat}`}
              name={`staircase:${sc.id}:${p.group}:${p.mat}`}
              geometry={p.geometry}
              material={stairPartMaterial(p.mat, sc.phase, p.mat === 'tread' ? sc.treadColor : sc.paintColor)}
              renderOrder={sc.phase === 'demo' ? 1 : 0}
              castShadow={sc.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          ))}
        </group>
      ))}
      {decks.map((d) => (
        <group key={d.id} name={`deck:${d.id}`}>
          {(
            [
              ['boards', d.boards, 'boards'],
              ['frame', d.frame, 'frame'],
              ['railing', d.railing, 'boards'],
            ] as const
          ).map(([name, geometry, part]) =>
            geometry ? (
              <mesh
                key={name}
                name={`deck:${d.id}:${name}`}
                geometry={geometry}
                material={deckMaterial(part, d.phase, d.color)}
                renderOrder={d.phase === 'demo' ? 1 : 0}
                castShadow={d.phase !== 'demo'}
                receiveShadow
                dispose={null}
              />
            ) : null,
          )}
        </group>
      ))}
      {guards.map((g) => (
        <group key={g.id}>
          <mesh
            name={`floor-opening:${g.id}:railing`}
            geometry={g.railing}
            material={g.style ? stairPartMaterial('paint', g.phase, g.style.paintColor) : railingMaterial(g.phase)}
            renderOrder={g.phase === 'demo' ? 1 : 0}
            castShadow={g.phase !== 'demo'}
            receiveShadow
            dispose={null}
          />
          {g.rail && g.style && (
            <mesh
              name={`floor-opening:${g.id}:rail`}
              geometry={g.rail}
              material={stairPartMaterial('tread', g.phase, g.style.treadColor)}
              renderOrder={g.phase === 'demo' ? 1 : 0}
              castShadow={g.phase !== 'demo'}
              receiveShadow
              dispose={null}
            />
          )}
        </group>
      ))}
      {members.map((m) => (
        <group key={m.id} name={`member:${m.id}`}>
          {(
            [
              [m.kind, m.body],
              ['footing', m.footing],
            ] as const
          ).map(([part, geometry]) =>
            geometry ? (
              <mesh
                key={part}
                name={`member:${m.id}:${part}`}
                geometry={geometry}
                material={memberMaterial(part, m.phase, part === 'footing' ? undefined : m.color)}
                renderOrder={m.phase === 'demo' ? 1 : 0}
                castShadow={m.phase !== 'demo'}
                receiveShadow
                dispose={null}
              />
            ) : null,
          )}
        </group>
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
              material={openingMaterial(p.part, o.phase, openingPartColor(o, p.part))}
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
