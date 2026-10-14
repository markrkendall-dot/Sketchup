import { useState } from 'react';
import { issueCounts, type Issue, type Severity } from '../derive/checks';
import { CODE_EDITION } from '../model/codeLimits';
import { usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore, type Selection } from '../store/uiStore';

const SEVERITY_WORD: Record<Severity, string> = { error: 'Error', warning: 'Check', info: 'Note' };

/**
 * Go to an issue: the proposed view (the checks judge it) on the issue's level, its element
 * selected, the plan centred on the spot at the same zoom, and the issue picked (outlined).
 */
export function showIssue(issue: Issue): void {
  const ui = useUiStore.getState();
  if (ui.layout === '3d') ui.setLayout('split');
  if (ui.viewMode === 'existing') ui.setViewMode('proposed');
  if (ui.activeLevelId !== issue.levelId || ui.siteMode) ui.setActiveLevel(issue.levelId);
  const t = issue.target;
  const selection: Selection = {
    ...EMPTY_SELECTION,
    walls: t.walls ?? [],
    openings: t.openings ?? [],
    stairs: t.stairs ?? [],
    decks: t.decks ?? [],
    floorOpenings: t.floorOpenings ?? [],
  };
  const now = useUiStore.getState();
  now.setSelection(selection);
  const { width, height } = now.canvasSize;
  const k = now.viewport.k;
  now.setViewport({ k, tx: width / 2 - issue.at.x * k, ty: height / 2 - issue.at.y * k });
  now.setPickedIssue(issue.id);
}

/** The checks list over the plan (status bar "N to check"): what the proposed design needs to look at again. */
export function ChecksPanel() {
  const open = useUiStore((s) => s.checksOpen);
  const issues = useUiStore((s) => s.issues);
  const picked = useUiStore((s) => s.pickedIssueId);
  const levels = usePlanStore((s) => s.plan.levels);
  const order = usePlanStore((s) => s.plan.levelOrder);
  const [showNotes, setShowNotes] = useState(false);
  if (!open) return null;
  const { toCheck, notes } = issueCounts(issues);
  const shown = issues.filter((i) => showNotes || i.severity !== 'info');
  return (
    <section className="checks-panel" aria-label="Checks">
      <header>
        <h3>Checks</h3>
        <span className="checks-count">
          {toCheck} to check{notes ? `, ${notes} ${notes === 1 ? 'note' : 'notes'}` : ''}
        </span>
        <button className="checks-close" aria-label="Close the checks" title="Close" onClick={() => useUiStore.getState().setChecksOpen(false)}>
          ×
        </button>
      </header>
      {notes > 0 && (
        <label className="check-row">
          <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
          Show notes
        </label>
      )}
      {shown.length === 0 ? (
        <p className="panel-note">Nothing to check in the proposed design.</p>
      ) : (
        order
          .filter((lid) => shown.some((i) => i.levelId === lid))
          .map((lid) => (
            <div key={lid} className="checks-level">
              <h4>{levels[lid]?.name ?? lid}</h4>
              <ul>
                {shown
                  .filter((i) => i.levelId === lid)
                  .map((i) => (
                    <li key={i.id} className={`check-item severity-${i.severity}${picked === i.id ? ' picked' : ''}`}>
                      <span className="check-severity">{SEVERITY_WORD[i.severity]}</span>
                      <span className="check-message">
                        {i.message} <span className="check-ref">{i.ref}</span>
                      </span>
                      <button onClick={() => showIssue(i)} title="Select it and centre the plan on it">
                        Show
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))
      )}
      <p className="panel-note">Checked against the {CODE_EDITION}. Verify the numbers against the code text.</p>
    </section>
  );
}
