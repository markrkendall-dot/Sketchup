import { describe, expect, it } from 'vitest';
import { getLevelElevations } from '../derive/levels';
import { isOpeningVisible, isVisible, phasesCoexist, visibleNodeIds } from '../derive/phase';
import { snapPoint } from '../editor2d/snap';
import { hitTest } from '../editor2d/tools/selectTool';
import { createEmptyPlan } from '../model/plan';
import type { Level, Opening, Phase, ViewMode, Wall } from '../model/types';

describe('getLevelElevations', () => {
  it('follows the DESIGN.md elevation rule for the default plan', () => {
    const plan = createEmptyPlan();
    const [b, f, s] = plan.levelOrder;
    const e = getLevelElevations(plan);
    // Basement: floor top at baseFloorElevation; 4" slab.
    expect(e[b]).toEqual({ floorTop: -100, ceiling: -4, slabBottom: -104 });
    // First floor: -100 + 96 + 12.
    expect(e[f]).toEqual({ floorTop: 8, ceiling: 104, slabBottom: -4 });
    expect(e[s]).toEqual({ floorTop: 116, ceiling: 212, slabBottom: 104 });
  });

  it('propagates wall heights, floor thicknesses and the base elevation', () => {
    const plan = createEmptyPlan();
    const [b, f, s] = plan.levelOrder;
    plan.baseFloorElevation = 0;
    plan.levels[b].wallHeight = 90;
    plan.levels[f].wallHeight = 108;
    plan.levels[s].floorThickness = 14;
    const e = getLevelElevations(plan);
    expect(e[b].floorTop).toBe(0);
    expect(e[f].floorTop).toBe(102);
    expect(e[f].ceiling).toBe(210);
    expect(e[s].floorTop).toBe(224);
    expect(e[s].slabBottom).toBe(210);
    // The slab of level i sits directly on the ceiling of level i-1.
    expect(e[s].slabBottom).toBe(e[f].ceiling);
  });

  it('handles a single level', () => {
    const plan = createEmptyPlan();
    plan.levelOrder = [plan.levelOrder[0]];
    const e = getLevelElevations(plan);
    expect(Object.keys(e)).toEqual(plan.levelOrder);
  });
});

describe('isVisible', () => {
  const table: [Phase, ViewMode, boolean][] = [
    ['existing', 'existing', true],
    ['demo', 'existing', true],
    ['new', 'existing', false],
    ['existing', 'proposed', true],
    ['demo', 'proposed', false],
    ['new', 'proposed', true],
    ['existing', 'all', true],
    ['demo', 'all', true],
    ['new', 'all', true],
  ];
  it.each(table)('%s in %s view -> %s', (phase, mode, expected) => {
    expect(isVisible(phase, mode)).toBe(expected);
  });

  const wall = (phase: Phase): Wall => ({ id: 'w', a: 'a', b: 'b', thickness: 6, kind: 'exterior', phase });
  const opening = (phase: Phase): Opening => ({
    id: 'o',
    wallId: 'w',
    type: 'door',
    offset: 50,
    width: 36,
    height: 80,
    sill: 0,
    phase,
  });

  it('a demolished opening on an existing wall is closed up in the proposed view', () => {
    expect(isOpeningVisible(opening('demo'), wall('existing'), 'proposed')).toBe(false);
    expect(isOpeningVisible(opening('demo'), wall('existing'), 'existing')).toBe(true);
  });
  it('a new opening on an existing wall is hidden in the existing view', () => {
    expect(isOpeningVisible(opening('new'), wall('existing'), 'existing')).toBe(false);
    expect(isOpeningVisible(opening('new'), wall('existing'), 'proposed')).toBe(true);
  });
  it('an opening on a hidden wall is hidden', () => {
    expect(isOpeningVisible(opening('existing'), wall('demo'), 'proposed')).toBe(false);
    expect(isOpeningVisible(opening('existing'), undefined, 'all')).toBe(false);
  });
  it('demo and new never coexist', () => {
    expect(phasesCoexist('demo', 'new')).toBe(false);
    expect(phasesCoexist('new', 'demo')).toBe(false);
    expect(phasesCoexist('existing', 'new')).toBe(true);
    expect(phasesCoexist('demo', 'demo')).toBe(true);
  });
});

describe('visibility in snapping and hit testing', () => {
  // A demolished wall along y=0 and a new wall along y=100.
  const level: Level = {
    id: 'L',
    name: 'L',
    wallHeight: 96,
    floorThickness: 12,
    nodes: {
      n1: { id: 'n1', x: 0, y: 0 },
      n2: { id: 'n2', x: 100, y: 0 },
      n3: { id: 'n3', x: 0, y: 100 },
      n4: { id: 'n4', x: 100, y: 100 },
    },
    walls: {
      demo: { id: 'demo', a: 'n1', b: 'n2', thickness: 6, kind: 'exterior', phase: 'demo' },
      fresh: { id: 'fresh', a: 'n3', b: 'n4', thickness: 6, kind: 'interior', phase: 'new' },
    },
    fixtures: {},
    openings: {
      o1: { id: 'o1', wallId: 'demo', type: 'window', offset: 50, width: 30, height: 48, sill: 36, phase: 'demo' },
    },
    rooms: {},
    stairs: {},
    roofs: {},
    decks: {},
    floorOpenings: {},
  };
  const ctx = { level, k: 1, snapGrid: 1, orthoLock: true, shift: false } as const;

  it('visibleNodeIds follows the walls', () => {
    expect([...visibleNodeIds(level, 'proposed')].sort()).toEqual(['n3', 'n4']);
    expect([...visibleNodeIds(level, 'all')]).toHaveLength(4);
  });

  it('hidden walls and their nodes do not snap', () => {
    expect(snapPoint({ x: 2, y: 2 }, { ...ctx, viewMode: 'all' }).kind).toBe('node');
    expect(snapPoint({ x: 2, y: 2 }, { ...ctx, viewMode: 'proposed' }).nodeId).toBeUndefined();
    expect(snapPoint({ x: 30, y: 3 }, { ...ctx, viewMode: 'existing' }).kind).toBe('wall');
    expect(snapPoint({ x: 30, y: 3 }, { ...ctx, viewMode: 'proposed' }).kind).not.toBe('wall');
    expect(snapPoint({ x: 30, y: 97 }, { ...ctx, viewMode: 'existing' }).kind).not.toBe('wall');
  });

  it('hidden walls and openings are not hit; openings win over their wall', () => {
    expect(hitTest(level, { x: 50, y: 1 }, 1, 'all')).toEqual({ kind: 'opening', id: 'o1' });
    expect(hitTest(level, { x: 20, y: 1 }, 1, 'all')).toEqual({ kind: 'wall', id: 'demo' });
    expect(hitTest(level, { x: 50, y: 1 }, 1, 'proposed')).toBeNull();
    expect(hitTest(level, { x: 50, y: 99 }, 1, 'existing')).toBeNull();
    expect(hitTest(level, { x: 50, y: 99 }, 1, 'proposed')).toEqual({ kind: 'wall', id: 'fresh' });
  });
});
