import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { getIssues } from '../derive/checks';
import { flightLinks, stairChains } from '../derive/stairChain';
import { stairIssues } from '../derive/stairChecks';
import { createEmptyPlan, migrate } from '../model/plan';
import type { Plan, Vec2 } from '../model/types';
import { clearHistory, usePlanStore, type NewStairs } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// A 20' box of 6" exterior walls (inside faces 3..237) on the First and Second Floors, 108" floor to
// floor. The Second Floor is open over the north half (a floor opening with its guards), so a
// flight there has headroom.
let f = '';
let s = '';
function reset() {
  store().setPlan(createEmptyPlan());
  clearHistory();
  [, f, s] = plan().levelOrder;
  for (const lid of [f, s]) {
    const c = rect(0, 0, 240, 240);
    for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' });
  }
  store().addFloorOpening(s, { outline: rect(3, 3, 237, 120), phase: 'new' });
}
beforeEach(reset);

/** A new flight climbing east along the north wall (its left side on the wall), from x 20. */
const east = (over: Partial<NewStairs> = {}) => {
  const width = over.width ?? 36;
  const id = store().addStairs(f, { origin: { x: 20, y: 3 + width / 2 }, direction: 0, width, run: 140, risers: 14, phase: 'new', cutsFloorAbove: false, railings: { right: true }, ...over });
  if (!id) throw new Error('flight rejected');
  return id;
};
const codes = () => stairIssues(plan()).map((i) => i.code);
const without = (list: string[], ...drop: string[]) => list.filter((c) => !drop.includes(c));

describe('a flight against the code', () => {
  it('passes at 14 risers of 7 5/7" on 10" treads, 36" wide, railed on its open side (but for the board rail)', () => {
    east();
    expect(codes()).toEqual(['stair.handrail-grip']);
  });

  it('allows risers up to 8 1/4" and no more', () => {
    east({ base: 9, risers: 12, run: 120 }); // 99 / 12 = 8.25
    expect(without(codes(), 'stair.handrail-grip')).toEqual([]);
    reset();
    east({ base: 8.4, risers: 12, run: 120 }); // 99.6 / 12 = 8.3
    expect(without(codes(), 'stair.handrail-grip', 'stair.headroom')).toEqual(['stair.riser-max']);
  });

  it('wants treads of 9" and more, and 36" of width', () => {
    east({ run: 126 }); // 9
    expect(without(codes(), 'stair.handrail-grip')).toEqual([]);
    reset();
    east({ run: 124.6, width: 34 }); // 8.9
    expect(without(codes(), 'stair.handrail-grip', 'stair.headroom').sort()).toEqual(['stair.tread-min', 'stair.width']);
  });

  it('wants a handrail on four risers or more, not on three', () => {
    east({ rise: 21.6, risers: 3, run: 36, railings: undefined });
    expect(codes()).toEqual([]);
    reset();
    east({ rise: 28.8, risers: 4, run: 40, railings: undefined });
    expect(codes()).toEqual(['stair.handrail-missing']);
  });

  it('wants a guard on an open side more than 30" up, not on the side along a wall', () => {
    east({ railings: undefined });
    const guard = stairIssues(plan()).filter((i) => i.code === 'stair.guard-missing');
    expect(guard.map((i) => [i.category, i.severity, i.message])).toEqual([
      ['guard', 'error', 'A flight climbing east: its right side is more than 30" over the floor with no railing or wall.'],
    ]);
  });

  it('wants 6\'8" of headroom under the floor above, which a hole in it gives', () => {
    // Along the south wall, under the Second Floor's slab.
    const under = { origin: { x: 20, y: 219 }, railings: { left: true } };
    east(under);
    expect(codes()).toContain('stair.headroom');
    reset();
    east({ ...under, cutsFloorAbove: true });
    expect(codes()).not.toContain('stair.headroom');
  });

  it('counts a beam over the flight in the headroom', () => {
    east();
    expect(codes()).not.toContain('stair.headroom');
    // A dropped beam across the flight's foot, 84 1/8" up: about 5'-2" over the nosings there.
    store().addMember(f, { kind: 'beam', a: { x: 60, y: 3 }, b: { x: 60, y: 120 }, width: 3.5, depth: 11.875, mount: 'dropped', phase: 'new' });
    expect(stairIssues(plan()).find((i) => i.code === 'stair.headroom')?.message).toMatch(/under the floor or beam above/);
  });

  it('does not check existing stairs', () => {
    east({ phase: 'existing', railings: undefined, run: 100, width: 30 });
    expect(codes()).toEqual([]);
  });
});

describe('a stairway of pieces', () => {
  /** A flight of 4 risers of 7.2" east to a 1-riser landing in the north-east corner, then a flight south. */
  const turn = (landing: { width: number; run: number }, second: Partial<NewStairs> = {}) => {
    const a = east({ rise: 28.8, risers: 4, run: 40 }); // x 20..60, top 28.8
    const l = store().addStairs(f, { origin: { x: 60, y: 3 + landing.width / 2 }, direction: 0, width: landing.width, run: landing.run, base: 28.8, rise: 7.2, risers: 1, phase: 'new', cutsFloorAbove: false })!;
    const b = store().addStairs(f, { origin: { x: 60 + landing.run / 2, y: 3 + landing.width }, direction: 90, width: landing.run, run: 72, base: 36, risers: 10, phase: 'new', cutsFloorAbove: false, railings: { right: true }, ...second })!;
    return [a, l, b];
  };

  it('chains the pieces through the landing\'s side', () => {
    const [a, l, b] = turn({ width: 36, run: 36 });
    expect(flightLinks(plan(), f, 'proposed')).toEqual([
      { from: a, to: l, edge: 1 },
      { from: l, to: b, edge: 2 },
    ]);
    expect(stairChains(plan(), f, 'proposed')).toEqual([[a, l, b]]);
  });

  it('wants the landing as wide as the flights and 36" deep', () => {
    turn({ width: 36, run: 36 });
    expect(codes()).not.toContain('stair.landing-size');
    reset();
    turn({ width: 30, run: 36 });
    expect(codes()).toContain('stair.landing-size');
  });

  it('wants its risers within 3/8" of each other, the last one up to the floor counted', () => {
    // 72 / 10 = 7.2 like the rest: fine. 72 over 9 risers is 8": an error.
    turn({ width: 36, run: 36 });
    expect(codes()).not.toContain('stair.uniformity');
    reset();
    turn({ width: 36, run: 36 }, { risers: 9, run: 81 });
    expect(codes()).toContain('stair.uniformity');
  });
});

describe('the starter', () => {
  const starter = migrate(example as unknown) as Plan;

  it('chains its grand stair: platform, flight east, landing, flight south', () => {
    const fid = starter.levelOrder[1];
    expect(stairChains(starter, fid, 'proposed')).toEqual([['f-s2', 'f-s3', 'f-s4', 'f-s5']]);
    // Each leaves the piece below by its side but the first flight, which arrives at the landing's bottom.
    expect(flightLinks(starter, fid, 'proposed').map((l) => [l.from, l.to, l.edge])).toEqual([
      ['f-s2', 'f-s3', 2],
      ['f-s3', 'f-s4', 1],
      ['f-s4', 'f-s5', 2],
    ]);
  });

  it('has nothing to check: the Grand stair\'s round rail is graspable', () => {
    expect(getIssues(starter).filter((i) => i.category === 'stair').map((i) => `${i.code} ${i.target.stairs?.join(',')}`)).toEqual([]);
  });
});
