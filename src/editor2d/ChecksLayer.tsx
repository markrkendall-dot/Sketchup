import { memo } from 'react';
import { useUiStore } from '../store/uiStore';

/** A marker's radius on screen, px. */
const MARK_PX = 7;

/**
 * The code checks' markers on the active level (editor only, never in the plan export): a disc per
 * issue at constant screen size, red for an error, orange to check, blue for a note (notes only
 * while the checks list is open), and the picked issue's element outlined. Shown in the proposed and
 * all views, which hold the design the checks judge.
 */
export const ChecksLayer = memo(function ChecksLayer() {
  const levelId = useUiStore((s) => s.activeLevelId);
  const show = useUiStore((s) => s.viewMode !== 'existing' && !s.siteMode);
  const issues = useUiStore((s) => s.issues);
  const open = useUiStore((s) => s.checksOpen);
  const picked = useUiStore((s) => s.pickedIssueId);
  const k = useUiStore((s) => s.viewport.k);
  if (!show) return null;
  const here = issues.filter((i) => i.levelId === levelId && (open || i.severity !== 'info'));
  if (!here.length) return null;
  const pick = here.find((i) => i.id === picked);
  const r = MARK_PX / k;
  return (
    <g className="layer-checks" pointerEvents="none">
      {pick?.outline && <polygon className="check-outline" points={pick.outline.map((p) => `${p.x},${p.y}`).join(' ')} />}
      {here.map((i) => (
        <g key={i.id} className={`check-mark severity-${i.severity}${i.id === picked ? ' picked' : ''}`} transform={`translate(${i.at.x} ${i.at.y})`}>
          <title>{i.message}</title>
          <circle r={r} />
          <text y={r * 0.45} fontSize={r * 1.3}>
            {i.severity === 'info' ? 'i' : '!'}
          </text>
        </g>
      ))}
    </g>
  );
});
