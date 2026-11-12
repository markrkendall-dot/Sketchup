import type { DesignOption, Id, Level, Plan, ProposedLook, Room, Site } from '../model/types';
import { isOptionTagged, phaseIn, type Phased } from './phase';

// The plan as one design option sees it (DESIGN.md "Design options"): every entity tagged for other
// options only is as its change were never made (phase.ts phaseIn): a new one is left out (with the
// openings in a left-out wall and the corners only left-out walls used), a demolished one stands as
// existing. The option's own proposed look and room finishes replace the shared ones. Everything
// that draws, checks or exports the design reads this plan, so it follows the active option with no
// option logic of its own; the store keeps editing the real plan by the same ids.
//
// Memoized per source object and option: an untouched level (or site, or the whole plan when nothing
// is tagged) comes back as the same object, so the derive caches keyed on Level objects keep working
// and a level that differs between options is a different object in each (they never share a cache
// entry).

/** The option a plan shows for a wanted id: that one when the plan has it, else the first. */
export function resolveOptionId(plan: Pick<Plan, 'options'>, wanted: Id | null | undefined): Id | undefined {
  if (wanted && plan.options.some((o) => o.id === wanted)) return wanted;
  return plan.options[0]?.id;
}

export function optionOf(plan: Pick<Plan, 'options'>, id: Id | undefined): DesignOption | undefined {
  return plan.options.find((o) => o.id === id);
}

/** The proposed look in an option: each field the option sets, else the plan's. */
export function proposedLookIn(plan: Pick<Plan, 'proposedLook' | 'options'>, optionId: Id | undefined): ProposedLook | undefined {
  const own = optionOf(plan, optionId)?.proposedLook;
  if (!own) return plan.proposedLook;
  return { ...(plan.proposedLook ?? {}), ...own };
}

/** A room's proposed floor and walls in an option: the option's own where set, else the shared ones. */
export function roomFinishesIn(room: Room, optionId: Id | undefined): Pick<Room, 'proposedFloor' | 'proposedWall'> {
  const own = optionId !== undefined ? room.optionFinishes?.[optionId] : undefined;
  return { proposedFloor: own?.proposedFloor ?? room.proposedFloor, proposedWall: own?.proposedWall ?? room.proposedWall };
}

type Rec<T> = Record<Id, T>;

/** A record with each entity in the option: dropped, re-phased, or the same object. Same record when nothing changed. */
function recordIn<T extends Phased & { id: Id }>(rec: Rec<T>, optionId: Id, keep?: (e: T) => boolean): Rec<T> {
  let out: Rec<T> | null = null;
  for (const [id, e] of Object.entries(rec)) {
    const phase = isOptionTagged(e) ? phaseIn(e, optionId) : e.phase;
    const dropped = phase === null || (keep ? !keep(e) : false);
    const changed = !dropped && phase !== e.phase;
    if (!dropped && !changed) {
      if (out) out[id] = e;
      continue;
    }
    if (!out) {
      out = {};
      for (const [k, v] of Object.entries(rec)) {
        if (k === id) break;
        out[k] = v;
      }
    }
    if (dropped) continue;
    // Demolished in other options only: here it stands, as existing, in every option.
    const copy = { ...e, phase } as T & { optionIds?: Id[] };
    delete copy.optionIds;
    out[id] = copy;
  }
  return out ?? rec;
}

/** True when anything in the level depends on the option. */
function levelVaries(level: Level, optionId: Id): boolean {
  const recs: Rec<Phased>[] = [level.walls, level.openings, level.rooms, level.stairs, level.roofs, level.fixtures, level.decks, level.floorOpenings, level.joistZones, level.members];
  for (const rec of recs) for (const e of Object.values(rec ?? {})) if (isOptionTagged(e) && !e.optionIds!.includes(optionId)) return true;
  for (const r of Object.values(level.rooms)) if (r.optionFinishes?.[optionId]) return true;
  return false;
}

const levelCache = new WeakMap<Level, Map<Id, Level>>();

/** A level as an option sees it (memoized per Level object and option). */
export function levelIn(level: Level, optionId: Id | undefined): Level {
  if (optionId === undefined) return level;
  let byOption = levelCache.get(level);
  if (!byOption) levelCache.set(level, (byOption = new Map()));
  const hit = byOption.get(optionId);
  if (hit) return hit;
  let out = level;
  if (levelVaries(level, optionId)) {
    const walls = recordIn(level.walls, optionId);
    const openings = recordIn(level.openings, optionId, (o) => !!walls[o.wallId]);
    let nodes = level.nodes;
    if (walls !== level.walls) {
      const used = new Set<Id>();
      for (const w of Object.values(walls)) {
        used.add(w.a);
        used.add(w.b);
      }
      if (Object.keys(level.nodes).some((id) => !used.has(id))) nodes = Object.fromEntries(Object.entries(level.nodes).filter(([id]) => used.has(id)));
    }
    let rooms = recordIn(level.rooms, optionId);
    if (Object.values(rooms).some((r) => r.optionFinishes?.[optionId])) {
      rooms = { ...rooms };
      for (const [id, r] of Object.entries(rooms)) {
        if (!r.optionFinishes?.[optionId]) continue;
        const next: Room = { ...r, ...roomFinishesIn(r, optionId) };
        if (!next.proposedFloor) delete next.proposedFloor;
        if (!next.proposedWall) delete next.proposedWall;
        rooms[id] = next;
      }
    }
    const stairs = recordIn(level.stairs, optionId);
    let staircases = level.staircases;
    if (stairs !== level.stairs) {
      const used = new Set(Object.values(stairs).map((s) => s.staircaseId));
      if (Object.keys(staircases).some((id) => !used.has(id))) staircases = Object.fromEntries(Object.entries(staircases).filter(([id]) => used.has(id)));
    }
    out = {
      ...level,
      nodes,
      walls,
      openings,
      rooms,
      stairs,
      staircases,
      roofs: recordIn(level.roofs, optionId),
      fixtures: recordIn(level.fixtures, optionId),
      decks: recordIn(level.decks, optionId),
      floorOpenings: recordIn(level.floorOpenings, optionId),
      joistZones: recordIn(level.joistZones, optionId),
      members: recordIn(level.members, optionId),
    };
  }
  byOption.set(optionId, out);
  return out;
}

const siteCache = new WeakMap<Site, Map<Id, Site>>();

/** The site as an option sees it (memoized like levelIn). */
export function siteIn(site: Site, optionId: Id | undefined): Site {
  if (optionId === undefined) return site;
  let byOption = siteCache.get(site);
  if (!byOption) siteCache.set(site, (byOption = new Map()));
  const hit = byOption.get(optionId);
  if (hit) return hit;
  const columns = recordIn(site.columns, optionId);
  const surfaces = recordIn(site.surfaces, optionId);
  const fences = recordIn(site.fences, optionId);
  const out = columns === site.columns && surfaces === site.surfaces && fences === site.fences ? site : { ...site, columns, surfaces, fences };
  byOption.set(optionId, out);
  return out;
}

const planCache = new WeakMap<Plan, Map<Id, Plan>>();

/**
 * The plan as design option `optionId` sees it (the first option when it names none the plan has).
 * The same object when nothing in the plan depends on the option.
 */
export function viewPlanOf(plan: Plan, optionId?: Id | null): Plan {
  const id = resolveOptionId(plan, optionId);
  if (id === undefined) return plan;
  let byOption = planCache.get(plan);
  if (!byOption) planCache.set(plan, (byOption = new Map()));
  const hit = byOption.get(id);
  if (hit) return hit;
  let levels = plan.levels;
  for (const [lid, level] of Object.entries(plan.levels)) {
    const next = levelIn(level, id);
    if (next === level) continue;
    if (levels === plan.levels) levels = { ...plan.levels };
    levels[lid] = next;
  }
  const site = siteIn(plan.site, id);
  const own = optionOf(plan, id)?.proposedLook;
  let out = plan;
  if (levels !== plan.levels || site !== plan.site || own) {
    out = { ...plan, levels, site };
    const look = proposedLookIn(plan, id);
    if (look) out.proposedLook = look;
  }
  byOption.set(id, out);
  return out;
}
