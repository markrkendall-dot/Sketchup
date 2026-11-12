import { getLevelElevations } from '../derive/levels';
import { siteGhostLevelId } from '../derive/site';
import { allLevelIds, firstStructure, structureOf, structuresOf } from '../model/structures';
import type { Id, Plan } from '../model/types';
import type { UiState } from '../store/uiStore';

type LevelUi = Pick<UiState, 'hidden3dLevels' | 'only3dActiveAndBelow' | 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>;

/**
 * The level the 3D view treats as the active one: the active level, except in site mode, which
 * parks the active level at the main structure's lowest one; there it is the level the site view
 * ghosts (its ground floor, model/plan.ts groundLevelId: the first floor over a basement).
 */
export function active3dLevel(plan: Pick<Plan, 'structures' | 'structureOrder'>, ui: Pick<UiState, 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>): Id {
  if (!ui.siteMode) return ui.activeLevelId;
  const main = firstStructure(plan);
  return (main && siteGhostLevelId(main)) ?? ui.activeLevelId;
}

/**
 * Levels the 3D view shows, each structure's bottom to top, in structure order: the checked ones,
 * optionally ("Only active level and below") only up to the active level (active3dLevel) in its
 * structure, and in the other structures only those whose floor is not above the active level's.
 */
export function visible3dLevels(plan: Plan, ui: LevelUi): Id[] {
  const ids = allLevelIds(plan).filter((id) => !ui.hidden3dLevels.includes(id));
  if (!ui.only3dActiveAndBelow) return ids;
  const activeId = active3dLevel(plan, ui);
  const own = structureOf(plan, activeId);
  if (!own) return ids;
  const elev = getLevelElevations(plan);
  const top = elev[activeId]?.floorTop ?? Infinity;
  const keep = new Set<Id>();
  for (const s of structuresOf(plan)) {
    if (s === own) {
      const i = s.levelOrder.indexOf(activeId);
      s.levelOrder.forEach((id, j) => j <= i && keep.add(id));
    } else for (const id of s.levelOrder) if ((elev[id]?.floorTop ?? 0) <= top + 1e-9) keep.add(id);
  }
  return ids.filter((id) => keep.has(id));
}
