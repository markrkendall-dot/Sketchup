// Design option edits (DESIGN.md "Design options"), on a plan or an immer draft of one, in place.
// The store wraps each in one undo step.
import { isOptionTagged, phaseIn, type Phased } from '../derive/phase';
import { knownOptionIds, mergeLeftoverJoints, newId, normalizeLevel } from './plan';
import type { DesignOption, Id, Level, Phase, Plan, Site } from './types';

type Tagged = Phased & { id: Id; phase?: Phase; optionIds?: Id[] };

/** The records of a level whose entities carry a phase and option tags (walls and openings apart). */
const LEVEL_RECORDS = ['rooms', 'stairs', 'roofs', 'fixtures', 'decks', 'floorOpenings', 'joistZones', 'members'] as const;
const SITE_RECORDS = ['columns', 'surfaces', 'fences'] as const;

const records = (level: Level): Record<Id, Tagged>[] => [level.walls, level.openings, ...LEVEL_RECORDS.map((k) => level[k] as Record<Id, Tagged>)];
const siteRecords = (site: Site): Record<Id, Tagged>[] => SITE_RECORDS.map((k) => site[k] as Record<Id, Tagged>);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** "Option A", "Option B", ...: the first letter no option of the plan is named after. */
export function nextOptionName(plan: Pick<Plan, 'options'>): string {
  const names = new Set(plan.options.map((o) => o.name.trim().toLowerCase()));
  for (let i = 0; i < 26; i++) {
    const name = `Option ${String.fromCharCode(65 + i)}`;
    if (!names.has(name.toLowerCase())) return name;
  }
  return `Option ${plan.options.length + 1}`;
}

/** Add an empty option (nothing is tagged for it, so it starts as the changes every option shares). */
export function addOptionTo(plan: Plan, name?: string): DesignOption {
  const opt: DesignOption = { id: newId(), name: name?.trim() || nextOptionName(plan) };
  plan.options.push(opt);
  return opt;
}

/**
 * Add an option that starts as a copy of option `srcId`: every new entity tagged for it is copied
 * under a new id and tagged for the copy only, so editing one leaves the other alone. References
 * between copied entities follow (an opening to its copied wall, a flight to its copied staircase); a
 * copied wall keeps a corner it shares with a wall every option has and gets its own copy of a corner
 * only option walls use. A demolition tagged for the source is tagged for the copy too (the same
 * existing entity, demolished in both). The source's own proposed look and room finishes are copied.
 * Null when there is no such option.
 */
export function duplicateOptionIn(plan: Plan, srcId: Id, name?: string): DesignOption | null {
  const src = plan.options.find((o) => o.id === srcId);
  if (!src) return null;
  const opt: DesignOption = { id: newId(), name: name?.trim() || nextOptionName(plan) };
  if (src.proposedLook) opt.proposedLook = clone(src.proposedLook);
  plan.options.push(opt);
  const dst = opt.id;
  const inSrc = (e: Tagged) => isOptionTagged(e) && e.optionIds!.includes(srcId);
  const copyOf = <T extends Tagged>(e: T): T => ({ ...clone(e), id: newId(), optionIds: [dst] });
  const copyInto = <T extends Tagged>(rec: Record<Id, T>, map?: Map<Id, Id>, fix?: (copy: T) => void) => {
    for (const e of Object.values(rec)) {
      if (!inSrc(e)) continue;
      if (e.phase === 'demo') {
        e.optionIds = [...e.optionIds!, dst];
        continue;
      }
      const c = copyOf(e);
      fix?.(c);
      rec[c.id] = c;
      map?.set(e.id, c.id);
    }
  };
  for (const level of Object.values(plan.levels)) {
    // Corners only option walls use are the option's own: a copied wall gets copies of those.
    const allOptions = (nodeId: Id) => Object.values(level.walls).some((w) => (w.a === nodeId || w.b === nodeId) && !(w.phase === 'new' && isOptionTagged(w)));
    const nodeMap = new Map<Id, Id>();
    const nodeFor = (id: Id): Id => {
      if (allOptions(id)) return id;
      let mapped = nodeMap.get(id);
      if (!mapped) {
        mapped = newId();
        nodeMap.set(id, mapped);
        const n = level.nodes[id];
        level.nodes[mapped] = { id: mapped, x: n.x, y: n.y };
      }
      return mapped;
    };
    const wallMap = new Map<Id, Id>();
    copyInto(level.walls, wallMap, (w) => {
      w.a = nodeFor(w.a);
      w.b = nodeFor(w.b);
    });
    // Openings: tagged ones as above; any other opening in a copied wall exists only where the wall
    // does, so the copy wall gets a copy of it.
    for (const o of Object.values(level.openings)) {
      const toWall = wallMap.get(o.wallId);
      if (inSrc(o) && o.phase === 'demo') {
        o.optionIds = [...o.optionIds!, dst];
        if (!toWall) continue;
      }
      if (!inSrc(o) && !toWall) continue;
      const c = copyOf(o);
      if (toWall) c.wallId = toWall;
      level.openings[c.id] = c;
    }
    // Staircases whose pieces are all the source's new pieces are the source's: copy them too.
    const scMap = new Map<Id, Id>();
    for (const sc of Object.values(level.staircases)) {
      const pieces = Object.values(level.stairs).filter((st) => st.staircaseId === sc.id);
      if (pieces.length && pieces.every((st) => st.phase === 'new' && inSrc(st))) {
        const c = { ...clone(sc), id: newId() };
        level.staircases[c.id] = c;
        scMap.set(sc.id, c.id);
      }
    }
    copyInto(level.stairs, undefined, (st) => {
      if (st.staircaseId && scMap.has(st.staircaseId)) st.staircaseId = scMap.get(st.staircaseId);
    });
    for (const k of ['rooms', 'roofs', 'fixtures', 'decks', 'floorOpenings', 'joistZones', 'members'] as const) copyInto(level[k] as Record<Id, Tagged>);
    for (const r of Object.values(level.rooms)) {
      const own = r.optionFinishes?.[srcId];
      if (own) r.optionFinishes![dst] = clone(own);
    }
    if (wallMap.size) normalizeLevel(level);
  }
  for (const rec of siteRecords(plan.site)) copyInto(rec);
  return opt;
}

/** Rename an option; false when there is no such option or the name is blank. */
export function renameOptionIn(plan: Plan, id: Id, name: string): boolean {
  const opt = plan.options.find((o) => o.id === id);
  const v = name.trim();
  if (!opt || !v || opt.name === v) return false;
  opt.name = v;
  return true;
}

/**
 * Delete an option and what is its alone: a new entity tagged for it only is removed (with the
 * openings in a removed wall and the corners nothing else uses), one tagged for other options too
 * just loses the tag; a demolition tagged for it only is undone (the entity is existing again), one
 * tagged for others too loses the tag. Its room finishes go. The last option cannot be deleted
 * (false).
 */
export function deleteOptionFrom(plan: Plan, id: Id): boolean {
  if (plan.options.length < 2 || !plan.options.some((o) => o.id === id)) return false;
  plan.options = plan.options.filter((o) => o.id !== id);
  const strip = (rec: Record<Id, Tagged>): boolean => {
    let removed = false;
    for (const e of Object.values(rec)) {
      if (!isOptionTagged(e) || !e.optionIds!.includes(id)) continue;
      const rest = e.optionIds!.filter((x) => x !== id);
      if (rest.length) e.optionIds = rest;
      else if (e.phase === 'new') {
        delete rec[e.id];
        removed = true;
      } else {
        // Demolished in this option only: it stays, as it is today.
        e.phase = 'existing';
        delete e.optionIds;
      }
    }
    return removed;
  };
  for (const level of Object.values(plan.levels)) {
    let walls = false;
    // The corners of the walls this option alone builds: a T left there may join its walls again.
    const ends = Object.values(level.walls).flatMap((w) => (w.phase === 'new' && isOptionTagged(w) && w.optionIds!.length === 1 && w.optionIds![0] === id ? [w.a, w.b] : []));
    for (const [i, rec] of records(level).entries()) {
      const removed = strip(rec);
      if (i === 0 && removed) walls = true;
    }
    for (const r of Object.values(level.rooms)) {
      if (!r.optionFinishes?.[id]) continue;
      delete r.optionFinishes[id];
      if (Object.keys(r.optionFinishes).length === 0) delete r.optionFinishes;
    }
    // A staircase none of whose pieces is left goes with them.
    const used = new Set(Object.values(level.stairs).map((s) => s.staircaseId));
    for (const scId of Object.keys(level.staircases)) if (!used.has(scId)) delete level.staircases[scId];
    // Openings in removed walls and corners no wall uses go; walls that now stand together join.
    if (walls) {
      normalizeLevel(level);
      mergeLeftoverJoints(level, ends);
    } else for (const o of Object.values(level.openings)) if (!level.walls[o.wallId]) delete level.openings[o.id];
  }
  for (const rec of siteRecords(plan.site)) strip(rec);
  return true;
}

/** Selected entities by kind, as the store's EntitySelection names them. */
export interface TagSelection {
  walls?: Id[];
  openings?: Id[];
  rooms?: Id[];
  stairs?: Id[];
  roofs?: Id[];
  fixtures?: Id[];
  decks?: Id[];
  floorOpenings?: Id[];
  members?: Id[];
  joistZones?: Id[];
  columns?: Id[];
  surfaces?: Id[];
  fences?: Id[];
  /** A staircase's pieces. */
  staircases?: Id[];
}

const sameIds = (p: readonly Id[] | undefined, q: readonly Id[] | undefined) => (p ?? []).length === (q ?? []).length && (p ?? []).every((x, i) => x === q![i]);

/**
 * Put the selected new and demolished entities in options `optionIds` (undefined or empty: every
 * option); existing ones are left alone. A new wall takes the new openings in it that were in the
 * same options as it. Returns true when anything changed.
 */
export function setEntityOptionsIn(plan: Plan, levelId: Id, sel: TagSelection, optionIds: Id[] | undefined): boolean {
  const level = plan.levels[levelId];
  const ids = knownOptionIds(optionIds, new Set(plan.options.map((o) => o.id)));
  let changed = false;
  let wallsChanged = false;
  const apply = (e: Tagged | undefined): boolean => {
    if (!e || (e.phase ?? 'existing') === 'existing' || sameIds(e.optionIds, ids)) return false;
    if (ids) e.optionIds = [...ids];
    else delete e.optionIds;
    changed = true;
    return true;
  };
  if (level) {
    for (const wid of sel.walls ?? []) {
      const w = level.walls[wid];
      if (!w) continue;
      const before = w.optionIds;
      if (!apply(w)) continue;
      wallsChanged = true;
      if (w.phase !== 'new') continue;
      for (const o of Object.values(level.openings)) if (o.wallId === wid && o.phase === 'new' && sameIds(o.optionIds, before)) apply(o);
    }
    for (const id of sel.openings ?? []) apply(level.openings[id]);
    const pieces = new Set(sel.staircases ?? []);
    for (const st of Object.values(level.stairs)) if (sel.stairs?.includes(st.id) || (st.staircaseId && pieces.has(st.staircaseId))) apply(st);
    for (const k of ['rooms', 'roofs', 'fixtures', 'decks', 'floorOpenings', 'members', 'joistZones'] as const) {
      const rec = level[k] as Record<Id, Tagged>;
      for (const id of sel[k] ?? []) apply(rec[id]);
    }
    if (wallsChanged) normalizeLevel(level);
  }
  for (const k of SITE_RECORDS) for (const id of sel[k] ?? []) apply((plan.site[k] as Record<Id, Tagged>)[id]);
  return changed;
}

/**
 * Set an entity's phase as the work option sees it (the store's setPhase), in place; returns true
 * when it changed. With no work option (a plan of one option) the phase is simply set and tags go
 * with an existing phase. With one, the change is that option's: demolishing tags the demolition
 * for it (adding it to a demolition other options already make), marking existing takes it back
 * out (an all-options demolition then stays in the other options), and marking new makes it new
 * work of that option.
 */
export function applyPhaseIn(e: Tagged, phase: Phase, work: Id | undefined, allOptions: readonly Id[]): boolean {
  const before = JSON.stringify([e.phase ?? 'existing', e.optionIds ?? null]);
  const setPhase = (p: Phase) => {
    e.phase = p;
  };
  if (!work) {
    setPhase(phase);
    if (phase === 'existing') delete e.optionIds;
  } else {
    const cur = e.phase ?? 'existing';
    if (phaseIn(e, work) === phase) return false;
    if (phase === 'demo') {
      if (cur === 'demo' && isOptionTagged(e)) e.optionIds = [...e.optionIds!, work];
      else {
        setPhase('demo');
        e.optionIds = [work];
      }
    } else if (phase === 'existing') {
      const others = cur === 'demo' ? (isOptionTagged(e) ? e.optionIds! : allOptions).filter((x) => x !== work) : [];
      if (others.length) e.optionIds = [...others];
      else {
        setPhase('existing');
        delete e.optionIds;
      }
    } else {
      setPhase('new');
      e.optionIds = [work];
    }
  }
  return JSON.stringify([e.phase ?? 'existing', e.optionIds ?? null]) !== before;
}
