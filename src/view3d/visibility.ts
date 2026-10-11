import type { Id } from '../model/types';
import type { UiState } from '../store/uiStore';

/** Levels the 3D view shows, bottom to top: checked ones, optionally only up to the active level. */
export function visible3dLevels(
  levelOrder: readonly Id[],
  ui: Pick<UiState, 'hidden3dLevels' | 'only3dActiveAndBelow' | 'activeLevelId'>,
): Id[] {
  const active = levelOrder.indexOf(ui.activeLevelId);
  return levelOrder.filter(
    (id, i) => !ui.hidden3dLevels.includes(id) && !(ui.only3dActiveAndBelow && active >= 0 && i > active),
  );
}
