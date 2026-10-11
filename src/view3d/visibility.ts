import type { Id } from '../model/types';
import type { UiState } from '../store/uiStore';

/** Levels the 3D view shows, bottom to top: checked ones, optionally only up to the active level (not in site mode). */
export function visible3dLevels(
  levelOrder: readonly Id[],
  ui: Pick<UiState, 'hidden3dLevels' | 'only3dActiveAndBelow' | 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>,
): Id[] {
  const active = levelOrder.indexOf(ui.activeLevelId);
  // Site mode parks the active level at the lowest one; "only active and below" would then hide the house.
  const only = ui.only3dActiveAndBelow && !ui.siteMode;
  return levelOrder.filter((id, i) => !ui.hidden3dLevels.includes(id) && !(only && active >= 0 && i > active));
}
