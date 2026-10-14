import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { resolveWallMove } from '../ui/wallMove';

/**
 * "Moving an existing wall": asked when a wall of the house as it stands is moved while drawing new
 * work (ui/wallMove.ts requestWallMove). Rebuild it there (R): the old wall demolished, the moved one
 * and the pieces joining it new; correct the drawing (C): it was drawn in the wrong place, so it moves
 * in every view; Esc leaves it where it was. The keys are taken before the tools see them.
 */
export function WallMovePrompt() {
  const req = useUiStore((s) => s.wallMovePrompt);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Undo and the like close the question first.
        resolveWallMove('cancel');
        return;
      }
      const k = e.key.toLowerCase();
      const choice = k === 'r' || k === 'enter' ? 'renovate' : k === 'c' ? 'correct' : k === 'escape' ? 'cancel' : null;
      if (!choice) return;
      e.preventDefault();
      e.stopPropagation();
      resolveWallMove(choice);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req]);
  if (!req) return null;
  const n = Object.keys(req.shifts).length;
  return (
    <div className="wall-move-prompt" role="dialog" aria-label="Moving an existing wall">
      <h3>Moving {n === 1 ? 'an existing wall' : `${n} existing walls`}</h3>
      <p className="panel-note">You are drawing new work, and {n === 1 ? 'this wall is' : 'these walls are'} part of the house as it stands.</p>
      <div className="wall-move-choices">
        <button className="primary" onClick={() => resolveWallMove('renovate')} title="R or Enter">
          <strong>Rebuild it there</strong>
          <small>The old wall demolished where it is; the moved wall, and the pieces that join it to its neighbours, new.</small>
        </button>
        <button onClick={() => resolveWallMove('correct')} title="C">
          <strong>Correct the drawing</strong>
          <small>It was drawn in the wrong place: move it in every view.</small>
        </button>
        <button onClick={() => resolveWallMove('cancel')} title="Esc">
          Leave it
        </button>
      </div>
    </div>
  );
}
