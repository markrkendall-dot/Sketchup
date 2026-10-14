// Guards: a deck edge high over the ground, or a floor opening's edge, with nothing to stop a fall
// (checks.ts). Both read the layouts the 3D and the panels use, in the proposed view.

import { CODE, codeRef } from '../model/codeLimits';
import type { Plan, Vec2 } from '../model/types';
import { issueId, type Issue } from './checks';
import { compassName, edgeOutward, getDeckLayout } from './decks';
import { getFloorOpeningLayout } from './floorOpenings';
import { isVisible } from './phase';

const VIEW = 'proposed';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mid = (outline: readonly Vec2[], i: number): Vec2 => {
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
/** "North and west edges", from edge indices. */
const edgeNames = (outline: readonly Vec2[], edges: number[], northAngle: number) =>
  capitalize(edges.map((i) => compassName(edgeOutward(outline, i), northAngle)).join(' and '));

export function guardIssues(plan: Plan): Issue[] {
  const out: Issue[] = [];
  const north = plan.site.northAngle;
  for (const levelId of plan.levelOrder) {
    const level = plan.levels[levelId];
    if (!level) continue;
    for (const deck of Object.values(level.decks ?? {})) {
      if (!isVisible(deck.phase, VIEW)) continue;
      const layout = getDeckLayout(plan, levelId, deck.id, VIEW);
      if (!layout) continue;
      const open = deck.outline.flatMap((_, i) => (!deck.railings[i] && !layout.supported[i] && layout.edgeDrops[i] > CODE.guardDrop.value ? [i] : []));
      if (!open.length) continue;
      const target = { decks: [deck.id] };
      out.push({
        id: issueId('guard.deck-edge', levelId, target),
        code: 'guard.deck-edge',
        severity: 'warning',
        category: 'guard',
        levelId,
        at: mid(deck.outline, open[0]),
        outline: deck.outline,
        message: `${edgeNames(deck.outline, open, north)} ${open.length === 1 ? 'edge of a deck is' : 'edges of a deck are'} more than 30" above the ground with no railing.`,
        ref: codeRef('guardDrop'),
        target,
      });
    }
    for (const fo of Object.values(level.floorOpenings ?? {})) {
      if (!isVisible(fo.phase, VIEW)) continue;
      const layout = getFloorOpeningLayout(plan, levelId, fo.id, VIEW);
      if (!layout) continue;
      const open = fo.outline.flatMap((_, i) => (!fo.railings[i] && !layout.supported[i] ? [i] : []));
      if (!open.length) continue;
      const target = { floorOpenings: [fo.id] };
      out.push({
        id: issueId('guard.floor-opening', levelId, target),
        code: 'guard.floor-opening',
        severity: 'error',
        category: 'guard',
        levelId,
        at: mid(fo.outline, open[0]),
        outline: fo.outline,
        message: `${edgeNames(fo.outline, open, north)} ${open.length === 1 ? 'edge of a floor opening has' : 'edges of a floor opening have'} no guard: a fall to the level below.`,
        ref: codeRef('guardDrop'),
        target,
      });
    }
  }
  return out;
}
