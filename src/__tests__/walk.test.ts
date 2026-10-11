import { describe, expect, it } from 'vitest';
import { createEmptyPlan } from '../model/plan';
import type { Plan, Wall } from '../model/types';
import { ENTRY_INSET, entryDoorPose, EYE_HEIGHT, eyeElevation, startLevel, stepLevel, walkLevels, walkStart, walkStartLevel, walkStep } from '../view3d/walk';
import type { Opening } from '../model/types';

/** First Floor: a 30' x 40' box, optionally with an interior divider across the middle. */
function plan(divider: boolean): Plan {
  const p = createEmptyPlan();
  const first = p.levels[p.levelOrder[1]];
  const nodes = { a: { x: 0, y: 0 }, b: { x: 360, y: 0 }, c: { x: 360, y: 480 }, d: { x: 0, y: 480 } };
  for (const [id, pt] of Object.entries(nodes)) first.nodes[id] = { id, ...pt };
  const wall = (id: string, a: string, b: string, extra: Partial<Wall> = {}): Wall => ({
    id,
    a,
    b,
    thickness: 6.5,
    kind: 'exterior',
    phase: 'existing',
    ...extra,
  });
  if (!divider) {
    for (const [i, pair] of ['ab', 'bc', 'cd', 'da'].entries()) first.walls[`w${i}`] = wall(`w${i}`, pair[0], pair[1]);
    return p;
  }
  first.nodes.m = { id: 'm', x: 360, y: 240 };
  first.nodes.n = { id: 'n', x: 0, y: 240 };
  first.walls.ab = wall('ab', 'a', 'b');
  first.walls.bm = wall('bm', 'b', 'm');
  first.walls.mc = wall('mc', 'm', 'c');
  first.walls.cd = wall('cd', 'c', 'd');
  first.walls.dn = wall('dn', 'd', 'n');
  first.walls.na = wall('na', 'n', 'a');
  first.walls.div = wall('div', 'n', 'm', { thickness: 4.5, kind: 'interior' });
  return p;
}

const ui = (p: Plan, extra: Partial<{ hidden3dLevels: string[]; only3dActiveAndBelow: boolean }> = {}) => ({
  hidden3dLevels: [],
  only3dActiveAndBelow: false,
  activeLevelId: p.levelOrder[1],
  ...extra,
});

describe('walk levels', () => {
  it('walks on the shown levels, starting on the active one', () => {
    const p = plan(false);
    const [b, f, s] = p.levelOrder;
    expect(walkLevels(p, ui(p))).toEqual([b, f, s]);
    expect(walkLevels(p, ui(p, { hidden3dLevels: [s] }))).toEqual([b, f]);
    expect(walkLevels(p, ui(p, { only3dActiveAndBelow: true }))).toEqual([b, f]);
    expect(walkLevels(p, ui(p, { hidden3dLevels: [b, f, s] }))).toEqual([b, f, s]);
    expect(startLevel([b, f, s], f)).toBe(f);
    expect(startLevel([b, s], f)).toBe(b);
    expect(stepLevel([b, f, s], f, 1)).toBe(s);
    expect(stepLevel([b, f, s], f, -1)).toBe(b);
    expect(stepLevel([b, f, s], s, 1)).toBeNull();
    expect(stepLevel([b, f, s], b, -1)).toBeNull();
  });

  it('eye height is 66" above each level\'s floor top', () => {
    const p = plan(false);
    const [b, f, s] = p.levelOrder;
    expect(eyeElevation(p, b)).toBe(-100 + EYE_HEIGHT);
    expect(eyeElevation(p, f)).toBe(8 + EYE_HEIGHT);
    expect(eyeElevation(p, s)).toBe(116 + EYE_HEIGHT);
  });
});

describe('walkStart', () => {
  it('starts at the centre of the outer face', () => {
    const p = plan(false);
    expect(walkStart(p, p.levelOrder[1], 'all', p.levelOrder)).toEqual({ at: { x: 180, y: 240 }, dir: { x: 1, y: 0 } });
  });

  it('moves into a room when the centre is inside a wall', () => {
    const p = plan(true);
    const { at } = walkStart(p, p.levelOrder[1], 'all', p.levelOrder);
    expect(at.x).toBeCloseTo(180, 6);
    expect(Math.abs(at.y - 240)).toBeGreaterThan(60);
    // Without the divider (proposed view of a demolished divider would be the same) it is the centre.
    p.levels[p.levelOrder[1]].walls.div.phase = 'demo';
    expect(walkStart(p, p.levelOrder[1], 'proposed', p.levelOrder).at).toEqual({ x: 180, y: 240 });
  });

  it('a level without a closed outline starts at the middle of the shown levels', () => {
    const p = plan(false);
    const { at } = walkStart(p, p.levelOrder[0], 'all', p.levelOrder);
    expect(at).toEqual({ x: 180, y: 240 });
  });
});

describe('walkStep', () => {
  const close = (v: [number, number], w: [number, number]) => {
    expect(v[0]).toBeCloseTo(w[0], 9);
    expect(v[1]).toBeCloseTo(w[1], 9);
  };
  it('moves along the look direction in the horizontal plane', () => {
    close(walkStep(0, 1, 0, 10), [0, -10]); // yaw 0 looks along -Z
    close(walkStep(0, 0, 1, 10), [10, 0]);
    close(walkStep(-Math.PI / 2, 1, 0, 10), [10, 0]); // looking along +x
    close(walkStep(-Math.PI / 2, 0, 1, 10), [0, 10]); // right of +x is +z (down the plan)
    close(walkStep(-Math.PI / 2, -1, 0, 10), [-10, 0]);
  });
  it('diagonals are not faster', () => {
    const [dx, dz] = walkStep(0.3, 1, 1, 10);
    expect(Math.hypot(dx, dz)).toBeCloseTo(10, 9);
    close(walkStep(0.3, 0, 0, 10), [0, 0]);
  });
});

describe('walking from site mode (REVIEW-2 A4)', () => {
  it('starts on the first floor, the level the site view shows, not the lowest', () => {
    const p = plan(false);
    const [b, f, s] = p.levelOrder;
    const site = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: b, siteMode: true };
    expect(walkStartLevel(p, site)).toBe(f);
    // "Only active and below" keeps the first floor and the basement.
    expect(walkLevels(p, { ...site, only3dActiveAndBelow: true })).toEqual([b, f]);
    expect(walkStartLevel(p, { ...site, only3dActiveAndBelow: true })).toBe(f);
    // Outside site mode the active level rules, as before.
    expect(walkStartLevel(p, { ...site, siteMode: false })).toBe(b);
    expect(walkStartLevel(p, { ...site, activeLevelId: s, siteMode: false })).toBe(s);
    // The first floor hidden in 3D: the lowest shown.
    expect(walkStartLevel(p, { ...site, hidden3dLevels: [f] })).toBe(b);
    // The start point is in the first floor's box.
    const { at } = walkStart(p, walkStartLevel(p, site)!, 'all', walkLevels(p, site));
    expect(at).toEqual({ x: 180, y: 240 });
  });
});

describe('walk start at the entry door (REVIEW-2 C5)', () => {
  const door = (id: string, wallId: string, offset: number, extra: Partial<Opening> = {}): Opening => ({
    id,
    wallId,
    type: 'door',
    offset,
    width: 36,
    height: 80,
    sill: 0,
    phase: 'existing',
    swing: { hinge: 'a', side: 'left' },
    ...extra,
  });

  it('starts 24" inside an exterior door at its centre, looking into the house', () => {
    const p = plan(false);
    const first = p.levels[p.levelOrder[1]];
    // The west wall runs d (0, 480) -> a (0, 0): a door 100" from d is at y 380.
    first.openings.o1 = door('o1', 'w3', 100);
    const pose = walkStart(p, first.id, 'all', p.levelOrder);
    expect(pose.at.x).toBeCloseTo(ENTRY_INSET, 6);
    expect(pose.at.y).toBeCloseTo(380, 6);
    expect(pose.dir.x).toBeCloseTo(1, 6);
    expect(pose.dir.y).toBeCloseTo(0, 6);
    // On the north wall a -> b the door looks south.
    delete first.openings.o1;
    first.openings.o2 = door('o2', 'w0', 90);
    const north = entryDoorPose(p, first.id, 'all')!;
    expect(north.at.x).toBeCloseTo(90, 6);
    expect(north.at.y).toBeCloseTo(ENTRY_INSET, 6);
    expect(north.dir.y).toBeCloseTo(1, 6);
  });

  it('ignores windows, interior doors and doors hidden in the view', () => {
    const p = plan(true);
    const first = p.levels[p.levelOrder[1]];
    first.openings.w = door('w', 'ab', 100, { type: 'window', sill: 30 });
    first.openings.i = door('i', 'div', 100);
    first.openings.d = door('d', 'cd', 100, { phase: 'demo' });
    expect(entryDoorPose(p, first.id, 'proposed')).toBeNull();
    // The demolished door shows in the existing view: the south wall, looking north.
    const pose = entryDoorPose(p, first.id, 'existing')!;
    expect(pose.at.y).toBeCloseTo(480 - ENTRY_INSET, 6);
    expect(pose.dir.y).toBeCloseTo(-1, 6);
  });

  it('a door between the house and a closed porch looks into the house, not the porch', () => {
    const p = plan(false);
    const first = p.levels[p.levelOrder[1]];
    // A porch west of the west wall, y 0..96: rooms on both sides of the wall piece with the door.
    first.nodes.p1 = { id: 'p1', x: -66, y: 0 };
    first.nodes.p2 = { id: 'p2', x: -66, y: 96 };
    first.nodes.p3 = { id: 'p3', x: 0, y: 96 };
    first.walls.w3 = { ...first.walls.w3, b: 'p3' };
    first.walls.w4 = { id: 'w4', a: 'p3', b: 'a', thickness: 6.5, kind: 'exterior', phase: 'existing' };
    first.walls.w5 = { id: 'w5', a: 'a', b: 'p1', thickness: 6.5, kind: 'exterior', phase: 'existing' };
    first.walls.w6 = { id: 'w6', a: 'p1', b: 'p2', thickness: 6.5, kind: 'exterior', phase: 'existing' };
    first.walls.w7 = { id: 'w7', a: 'p2', b: 'p3', thickness: 6.5, kind: 'exterior', phase: 'existing' };
    first.openings.o = door('o', 'w4', 48);
    const pose = entryDoorPose(p, first.id, 'all')!;
    expect(pose.at.x).toBeCloseTo(ENTRY_INSET, 6);
    expect(pose.at.y).toBeCloseTo(48, 6);
    expect(pose.dir.x).toBeCloseTo(1, 6);
  });

  it('"Walk from here" wins on its own level, looking east', () => {
    const p = plan(false);
    const [b, f] = p.levelOrder;
    p.levels[f].openings.o1 = door('o1', 'w3', 100);
    const from = { levelId: f, point: { x: 200, y: 300 } };
    expect(walkStart(p, f, 'all', p.levelOrder, from)).toEqual({ at: { x: 200, y: 300 }, dir: { x: 1, y: 0 } });
    // Another level: the usual rule.
    expect(walkStart(p, f, 'all', p.levelOrder, { ...from, levelId: b }).at.x).toBeCloseTo(ENTRY_INSET, 6);
    expect(walkStart(p, f, 'all', p.levelOrder, null).at.x).toBeCloseTo(ENTRY_INSET, 6);
  });
});
