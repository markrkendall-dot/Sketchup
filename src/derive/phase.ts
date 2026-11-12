import type { Id, Level, Opening, Phase, ViewMode, Wall } from '../model/types';


// Phase visibility (DESIGN.md "Plan document"): the existing view shows what is there today
// (existing + demo), the proposed view shows the finished result (existing + new), and the all
// view shows everything with phase styling. Visibility is applied at render / hit-test / snap
// time; the stored plan and its derived graph and footprints always contain every element.

export function isVisible(phase: Phase, viewMode: ViewMode): boolean {
  switch (viewMode) {
    case 'existing':
      return phase !== 'new';
    case 'proposed':
      return phase !== 'demo';
    default:
      return true;
  }
}

/**
 * The phase an element is drawn in. Red and green only help where the two layouts overlay, in the
 * All view; the Existing view shows the house as it stands, so what the design demolishes is drawn
 * as existing (solid, in its own finish), and the Proposed view shows the finished house, so new
 * work is drawn as existing too.
 */
export function shownPhase(phase: Phase, viewMode: ViewMode): Phase {
  if (viewMode === 'existing' && phase === 'demo') return 'existing';
  if (viewMode === 'proposed' && phase === 'new') return 'existing';
  return phase;
}

/** An opening shows only when both it and its host wall are visible. */
export function isOpeningVisible(opening: Opening, wall: Wall | undefined, viewMode: ViewMode): boolean {
  return !!wall && isVisible(opening.phase, viewMode) && isVisible(wall.phase, viewMode);
}

/**
 * Two phases can be seen together in at least one non-"all" view. A demolished opening and a new
 * one in the same spot never coexist (a door replaced by a window), so they may overlap.
 */
export function phasesCoexist(p: Phase, q: Phase): boolean {
  return !((p === 'demo' && q === 'new') || (p === 'new' && q === 'demo'));
}

// Design options (DESIGN.md "Design options"): a new or demolished entity may name the options its
// change belongs to (optionIds). In an option it does not name, its change was never made: a new one
// is absent and a demolished one still stands, as existing. phaseIn is the one place that rule lives;
// derive/optionView.ts applies it to a whole plan for the active option, so everything downstream
// (the plan layers, rooms, checks, 3D, walk, the exports) sees only that option's changes and tests
// phase as before. The Existing view ignores options: what is there today is the same in all of them.

/** An entity with a phase (a room label's is optional: absent is existing) and option tags. */
export interface Phased {
  readonly phase?: Phase;
  readonly optionIds?: readonly Id[];
}

/** True when the entity's change belongs to some options only (a new or demolished entity with tags). */
export function isOptionTagged(e: Phased): boolean {
  return (e.phase ?? 'existing') !== 'existing' && !!e.optionIds && e.optionIds.length > 0;
}

/**
 * The phase an entity has in design option `optionId`, or null where it does not exist there: an
 * entity tagged for other options only is as if its change were never made (new: absent; demolished:
 * existing). Untagged and existing entities, and an undefined option, keep their own phase.
 */
export function phaseIn(e: Phased, optionId: Id | undefined): Phase | null {
  const p = e.phase ?? 'existing';
  if (optionId === undefined || !isOptionTagged(e) || e.optionIds!.includes(optionId)) return p;
  return p === 'new' ? null : 'existing';
}

/** Stands for "an option neither entity names" in the pairwise tests below. */
const OTHER_OPTION = '\u0000other';

/** The options worth testing for a pair: every one either names, and one neither does. */
function pairOptions(p: Phased, q: Phased): Id[] {
  const out = new Set<Id>([OTHER_OPTION]);
  if (isOptionTagged(p)) for (const id of p.optionIds!) out.add(id);
  if (isOptionTagged(q)) for (const id of q.optionIds!) out.add(id);
  return [...out];
}

/** Both entities exist together in at least one design option (whatever their phases there). */
export function optionsMeet(p: Phased, q: Phased): boolean {
  return pairOptions(p, q).some((o) => phaseIn(p, o) !== null && phaseIn(q, o) !== null);
}

/**
 * Two entities can be seen together in at least one non-"all" view of at least one design option:
 * phasesCoexist on the phases they have in some option where both exist. Without tags it is
 * phasesCoexist on their own phases.
 */
export function entitiesCoexist(p: Phased, q: Phased): boolean {
  return pairOptions(p, q).some((o) => {
    const a = phaseIn(p, o);
    const b = phaseIn(q, o);
    return a !== null && b !== null && phasesCoexist(a, b);
  });
}

/** Ids of nodes that touch at least one visible wall. */
export function visibleNodeIds(level: Pick<Level, 'walls'>, viewMode: ViewMode): Set<Id> {
  const out = new Set<Id>();
  for (const w of Object.values(level.walls)) {
    if (!isVisible(w.phase, viewMode)) continue;
    out.add(w.a);
    out.add(w.b);
  }
  return out;
}

export const VIEW_MODES: readonly ViewMode[] = ['existing', 'proposed', 'all'];

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  existing: 'Existing',
  proposed: 'Proposed',
  all: 'All',
};

export const PHASE_LABEL: Record<Phase, string> = {
  existing: 'Existing',
  demo: 'Demolish',
  new: 'New',
};
