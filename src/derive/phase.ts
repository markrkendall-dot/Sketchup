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
