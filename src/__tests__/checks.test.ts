import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIssues, issueCounts, issueId, issuesFor } from '../derive/checks';
import { clearFloorOpeningLayouts } from '../derive/floorOpenings';
import { CODE, codeRef } from '../model/codeLimits';
import { createEmptyPlan } from '../model/plan';
import type { Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { CHECKS_DELAY_MS, startChecks } from '../ui/checks';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// A 20' box of 6" exterior walls on the First and Second Floors (no grade points: the ground is
// under the basement's slab, so a First Floor deck stands high and a Basement deck low).
let b = '';
let f = '';
let s = '';
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  clearFloorOpeningLayouts();
  [b, f, s] = plan().levelOrder;
  for (const lid of [f, s]) {
    const c = rect(0, 0, 240, 240);
    for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' });
  }
});

describe('the code table', () => {
  it('quotes the 2024 numbering with the old one beside it', () => {
    expect(codeRef('riserMax')).toBe('R318.7.5.1 (was R311.7.5.1)');
    expect(codeRef('bearingWood')).toBe('R502.6');
    expect([CODE.riserMax.value, CODE.treadMin.value, CODE.guardDrop.value, CODE.headroom.value]).toEqual([8.25, 9, 30, 80]);
  });
});

describe('getIssues', () => {
  it('is empty for an empty plan, and the same array while the plan is the same object', () => {
    expect(getIssues(plan())).toEqual([]);
    expect(getIssues(plan())).toBe(getIssues(plan()));
  });

  it('finds a floor opening edge with no guard (an error), and keeps its id through an unrelated edit', () => {
    // North-west corner against the walls: the north and west edges are walls, the other two open.
    const id = store().addFloorOpening(s, { outline: rect(3, 3, 123, 99), phase: 'new', railings: [false, true, false, false] })!;
    const issues = getIssues(plan());
    expect(issues).toHaveLength(1);
    const [i] = issues;
    expect(i).toMatchObject({ code: 'guard.floor-opening', severity: 'error', category: 'guard', levelId: s, target: { floorOpenings: [id] }, ref: codeRef('guardDrop') });
    expect(i.message).toBe('South edge of a floor opening has no guard: a fall to the level below.');
    expect(i.at).toEqual({ x: 63, y: 99 });
    store().addWall(b, { x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'exterior', thickness: 8, phase: 'existing' });
    expect(getIssues(plan()).map((x) => x.id)).toEqual([i.id]);
    // Guarded: no issue.
    store().updateFloorOpening(s, id, { railings: [false, true, true, false] });
    expect(getIssues(plan())).toEqual([]);
  });

  it('finds a deck edge over 30" with no railing, not one near the ground, and none on demolished work', () => {
    const high = store().addDeck(f, { outline: rect(0, 240, 144, 336), elevation: -6, railings: [false, true, false, false], phase: 'new' })!;
    store().addDeck(b, { outline: rect(0, 240, 144, 336), elevation: -6, railings: [false, false, false, false], phase: 'new' });
    const issues = getIssues(plan());
    expect(issues.map((x) => [x.code, x.severity, x.levelId])).toEqual([['guard.deck-edge', 'warning', f]]);
    expect(issues[0].message).toBe('South and west edges of a deck are more than 30" above the ground with no railing.');
    expect(issues[0].target).toEqual({ decks: [high] });
    store().setPhase(f, { walls: [], openings: [], decks: [high] }, 'demo');
    expect(getIssues(plan())).toEqual([]);
  });

  it('orders by level, then severity', () => {
    store().addDeck(f, { outline: rect(0, 240, 144, 336), elevation: -6, railings: [false, false, false, false], phase: 'new' });
    store().addFloorOpening(s, { outline: rect(3, 3, 123, 99), phase: 'new', railings: [false, false, false, false] });
    expect(getIssues(plan()).map((x) => x.levelId)).toEqual([f, s]);
  });
});

describe('issue helpers', () => {
  it('makes ids from the code, the level and the sorted target ids', () => {
    expect(issueId('x', 'l1', { walls: ['b', 'a'], decks: [] })).toBe('x|l1|walls:a,b');
  });

  it('picks the issues about an element, and counts what to check apart from notes', () => {
    const id = store().addFloorOpening(s, { outline: rect(3, 3, 123, 99), phase: 'new', railings: [false, false, false, false] })!;
    const issues = getIssues(plan());
    expect(issuesFor(issues, s, { floorOpenings: [id] })).toHaveLength(1);
    expect(issuesFor(issues, f, { floorOpenings: [id] })).toEqual([]);
    expect(issuesFor(issues, s, { decks: [id] })).toEqual([]);
    expect(issueCounts([...issues, { ...issues[0], id: 'n', severity: 'info' }])).toEqual({ toCheck: 1, notes: 1 });
  });
});

describe('the checks runner', () => {
  it('fills uiStore.issues at start and again once edits settle', () => {
    vi.useFakeTimers();
    try {
      const stop = startChecks();
      expect(useUiStore.getState().issues).toEqual([]);
      store().addFloorOpening(s, { outline: rect(3, 3, 123, 99), phase: 'new', railings: [false, false, false, false] });
      expect(useUiStore.getState().issues).toEqual([]);
      vi.advanceTimersByTime(CHECKS_DELAY_MS);
      expect(useUiStore.getState().issues.map((i) => i.code)).toEqual(['guard.floor-opening']);
      stop();
    } finally {
      vi.useRealTimers();
      useUiStore.getState().setIssues([]);
    }
  });
});
