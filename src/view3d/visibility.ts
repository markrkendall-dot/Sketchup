import { siteGhostLevelId } from '../derive/site';
import type { Id } from '../model/types';
import type { UiState } from '../store/uiStore';

type LevelUi = Pick<UiState, 'hidden3dLevels' | 'only3dActiveAndBelow' | 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>;

/**
 * The level the 3D view treats as the active one: the active level, except in site mode, which
 * parks the active level at the lowest one; there it is the level the site view ghosts (the first
 * floor, the level above the lowest).
 */
export function active3dLevel(levelOrder: readonly Id[], ui: Pick<UiState, 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>): Id {
  return ui.siteMode ? (siteGhostLevelId({ levelOrder }) ?? ui.activeLevelId) : ui.activeLevelId;
}

/** Levels the 3D view shows, bottom to top: checked ones, optionally only up to the active level (active3dLevel). */
export function visible3dLevels(levelOrder: readonly Id[], ui: LevelUi): Id[] {
  const active = levelOrder.indexOf(active3dLevel(levelOrder, ui));
  const only = ui.only3dActiveAndBelow;
  return levelOrder.filter((id, i) => !ui.hidden3dLevels.includes(id) && !(only && active >= 0 && i > active));
}
