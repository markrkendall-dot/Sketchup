import { beforeEach, describe, expect, it } from 'vitest';
import { getFaces } from '../derive/rooms';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import { existingViewSignature } from '../model/renovate';
import type { Level, Vec2, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const lid = () => defaultLevelId(store().plan);
const level = (): Level => store().plan.levels[lid()];
const wallsOf = (phase: Wall['phase']) => Object.values(level().walls).filter((w) => w.phase === phase);
const ext = { kind: 'exterior', thickness: 6, phase: 'existing' } as const;
const box = (pts: Vec2[]) => pts.forEach((p, i) => store().addWall(lid(), p, pts[(i + 1) % pts.length], ext));

// A 20' x 10' box split by an existing partition at x 120 with a door, which the design demolishes;
// a new partition at y 60 crosses it, and another new wall ends on it (a T).
let partition = '';
let door = '';
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  box([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 120 }, { x: 0, y: 120 }]);
  partition = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, { kind: 'interior', thickness: 4, phase: 'existing' })!.wallIds[0];
  door = store().addOpening(lid(), { wallId: partition, type: 'door', offset: 60, width: 30, height: 80, sill: 0, phase: 'existing' })!;
  store().setPhase(lid(), { walls: [partition], openings: [door] }, 'demo');
});

describe('a new wall and a demolished one', () => {
  it('cross without a node: the demolished wall and its door stay whole, the existing view unchanged', () => {
    const before = existingViewSignature(level());
    store().addWall(lid(), { x: 0, y: 60 }, { x: 240, y: 60 }, { kind: 'interior', thickness: 4, phase: 'new' });
    expect(wallsOf('demo')).toHaveLength(1);
    expect(level().openings[door]).toMatchObject({ wallId: partition, offset: 60 });
    // The new wall is split by the existing exterior walls it meets only.
    expect(wallsOf('new')).toHaveLength(1);
    expect(existingViewSignature(level())).toBe(before);
  });

  it('the All view still finds the rooms either side of each wall', () => {
    store().addWall(lid(), { x: 0, y: 60 }, { x: 240, y: 60 }, { kind: 'interior', thickness: 4, phase: 'new' });
    store().addWall(lid(), { x: 180, y: 0 }, { x: 180, y: 60 }, { kind: 'interior', thickness: 4, phase: 'new' });
    expect(getFaces(level(), 'existing').faces).toHaveLength(2);
    expect(getFaces(level(), 'proposed').faces).toHaveLength(3);
    const all = getFaces(level(), 'all');
    // Cut by the demolished x 120 wall and both new walls: west-north, middle-north, east-north, west-south, east-south.
    expect(all.faces.map((f) => Math.round(f.grossArea)).sort((a, b) => a - b)).toEqual([3600, 3600, 7200, 7200, 7200]);
    expect(all.openEnds).toEqual([]);
  });

  it('a new wall ending on a demolished one does not split it; keeping the wall splits it there', () => {
    const t = store().addWall(lid(), { x: 120, y: 30 }, { x: 240, y: 30 }, { kind: 'interior', thickness: 4, phase: 'new' })!;
    expect(wallsOf('demo')).toHaveLength(1);
    expect(getFaces(level(), 'all').openEnds).toEqual([]);
    store().setPhase(lid(), { walls: [partition], openings: [door] }, 'existing');
    // Now both stand: the partition is cut at the T.
    expect(wallsOf('existing').filter((w) => w.kind === 'interior')).toHaveLength(2);
    expect(t).toBeTruthy();
  });
});
