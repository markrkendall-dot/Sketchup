import { beforeEach, describe, expect, it } from 'vitest';
import { spanWithout, wallBearings } from '../derive/structure';
import { structureIssues } from '../derive/structureChecks';
import { createEmptyPlan } from '../model/plan';
import type { Id, Vec2, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const box = (lid: Id, r: Vec2[], phase: Wall['phase'] = 'existing') => {
  for (let i = 0; i < 4; i++) store().addWall(lid, r[i], r[(i + 1) % 4], { kind: 'exterior', thickness: 6.5, phase });
};
/** The wall on a level whose centerline runs through p. */
const wallThrough = (lid: Id, p: Vec2): Wall => {
  const l = plan().levels[lid];
  const w = Object.values(l.walls).find((w) => {
    const a = l.nodes[w.a];
    const b = l.nodes[w.b];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return Math.abs(cross) < 1e-6 && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
  });
  if (!w) throw new Error(`no wall through ${JSON.stringify(p)}`);
  return w;
};
const beam = (lid: Id, a: Vec2, b: Vec2, over: Record<string, unknown> = {}) =>
  store().addMember(lid, { kind: 'beam', a, b, width: 3.5, depth: 11.875, mount: 'flush', phase: 'new', ...over })!;
const post = (lid: Id, at: Vec2, over: Record<string, unknown> = {}) => store().addMember(lid, { kind: 'post', at, width: 5.5, depth: 5.5, rotation: 0, phase: 'new', ...over })!;
const issues = () => structureIssues(plan());
const codes = () => issues().map((i) => i.code);

// A 30' x 40' house (centerlines, 6 1/2" exterior walls) on the basement, first and second floors,
// joists north-south over every level, and an existing partition across the First Floor at y 240.
let b = '';
let f = '';
let s = '';
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  [b, f, s] = plan().levelOrder;
  for (const lid of [b, f, s]) {
    box(lid, rect(0, 0, 360, 480));
    store().setLevelFraming(lid, { joists: 90 });
  }
  store().addWall(f, { x: 0, y: 240 }, { x: 360, y: 240 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
});

describe('which walls bear', () => {
  it('a partition the joists cross mid-span, the exterior walls they bear on; not the ones along them', () => {
    const fb = wallBearings(plan(), 'existing')[f];
    expect(fb.get(wallThrough(f, { x: 180, y: 240 }).id)).toMatchObject({ bearing: true, explicit: false });
    expect(fb.get(wallThrough(f, { x: 180, y: 240 }).id)!.reason).toMatch(/mid-span \(40'-0" without it\)/);
    expect(fb.get(wallThrough(f, { x: 180, y: 0 }).id)).toMatchObject({ bearing: true, reason: 'an exterior wall the joists bear on' });
    expect(fb.get(wallThrough(f, { x: 0, y: 100 }).id)).toMatchObject({ bearing: false, reason: 'an exterior wall along the joists' });
  });

  it('not when the joists span 14\' or less without it, run along it, or it is new or short', () => {
    store().addWall(f, { x: 0, y: 100 }, { x: 360, y: 100 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    // y 100: 100" north to y 0 and 140" south to y 240.
    expect(spanWithout(plan(), f, wallThrough(f, { x: 180, y: 100 }), 'existing')).toBe(240);
    expect(wallBearings(plan(), 'existing')[f].get(wallThrough(f, { x: 180, y: 100 }).id)?.bearing).toBe(true);
    store().addWall(f, { x: 0, y: 400 }, { x: 360, y: 400 }, { kind: 'interior', thickness: 4.5, phase: 'new' });
    store().addWall(f, { x: 180, y: 240 }, { x: 180, y: 400 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    store().addWall(f, { x: 100, y: 440 }, { x: 140, y: 440 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    const pb = wallBearings(plan(), 'proposed')[f];
    expect(pb.get(wallThrough(f, { x: 180, y: 400 }).id)?.bearing).toBe(false); // new
    expect(pb.get(wallThrough(f, { x: 180, y: 300 }).id)?.bearing).toBe(false); // along the joists
    expect(pb.get(wallThrough(f, { x: 120, y: 440 }).id)?.bearing).toBe(false); // 40" long
  });

  it('a mark wins; a bearing wall, a post or a beam end above it makes a wall bear', () => {
    const w = wallThrough(f, { x: 180, y: 240 });
    store().updateWalls(f, [w.id], { bearing: false });
    expect(wallBearings(plan(), 'existing')[f].get(w.id)).toMatchObject({ bearing: false, explicit: true });
    store().addWall(b, { x: 0, y: 200 }, { x: 360, y: 200 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    store().addWall(b, { x: 180, y: 0 }, { x: 180, y: 200 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    store().addWall(b, { x: 60, y: 200 }, { x: 60, y: 480 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    store().updateWalls(f, [w.id], { bearing: true });
    const bb = () => wallBearings(plan(), 'proposed')[b];
    // y 200 is 40" off the wall above, more than the joists' depth: it is bearing by its span.
    expect(bb().get(wallThrough(b, { x: 300, y: 200 }).id)?.reason).toMatch(/mid-span/);
    post(f, { x: 180, y: 100 });
    expect(bb().get(wallThrough(b, { x: 180, y: 100 }).id)).toMatchObject({ bearing: true, reason: 'a post above stands on it' });
    beam(b, { x: 60, y: 300 }, { x: 360, y: 300 });
    expect(bb().get(wallThrough(b, { x: 60, y: 400 }).id)).toMatchObject({ bearing: true, reason: "a beam's end bears on it" });
  });
});

describe('structure checks', () => {
  const takeOut = () => store().setPhase(f, { walls: [wallThrough(f, { x: 180, y: 240 }).id], openings: [] }, 'demo');

  it('a bearing wall taken out wants its load picked up within the joists\' depth', () => {
    takeOut();
    const [i] = issues();
    expect([i.code, i.severity, i.ref]).toEqual(['structure.bearing-removed', 'warning', 'R502.4']);
    expect(i.message).toMatch(/likely bearing.*over 30'-0"/);
    beam(f, { x: 0, y: 252 }, { x: 360, y: 252 }); // 12" off: too far
    expect(codes()).toContain('structure.bearing-removed');
    store().setPlan({ ...plan() });
    const id = Object.keys(plan().levels[f].members)[0];
    store().placeMembers(f, { [id]: { a: { x: 0, y: 250 }, b: { x: 360, y: 250 } } });
    expect(codes()).not.toContain('structure.bearing-removed');
  });

  it('nothing to pick up where the floor above is gone too', () => {
    store().deleteEntities(s, { nodes: Object.keys(plan().levels[s].nodes), walls: Object.keys(plan().levels[s].walls) });
    takeOut();
    expect(codes()).toEqual([]);
  });

  it('a beam end bears 1 1/2" on a wall, or on a post or another beam', () => {
    beam(f, { x: 0, y: 200 }, { x: 360, y: 200 });
    expect(codes()).toEqual([]);
    beam(f, { x: 2.75, y: 100 }, { x: 200, y: 100 });
    expect(issues().map((i) => i.message)).toEqual([`The beam's west end bears 1/2" on the wall, under the 1 1/2" needed: run it further onto the wall.`, `The beam's east end has nothing under it: end it on a wall, a post or another beam.`]);
  });

  it('follows the load down to a footing', () => {
    takeOut();
    beam(f, { x: 0, y: 240 }, { x: 360, y: 240 });
    const p = post(f, { x: 180, y: 240 });
    expect(issues().map((i) => [i.code, i.levelId === b])).toEqual([['structure.load-path', true]]);
    const bp = post(b, { x: 180, y: 240 });
    expect(codes()).toEqual(['structure.footing']);
    store().updateMember(b, bp, { footing: { width: 24, thickness: 12 } });
    expect(codes()).toEqual([]);
    // With nothing drawn in the basement, the trace says so as a note.
    store().deleteEntities(b, { nodes: Object.keys(plan().levels[b].nodes), walls: Object.keys(plan().levels[b].walls), members: [bp] });
    // (the post's load, and each end of the beam on the exterior walls)
    expect(issues().map((i) => [i.code, i.severity])).toEqual(Array(3).fill(['structure.load-path', 'info']));
    expect(p).toBeTruthy();
  });

  it('notes headers round a new floor opening across the joists', () => {
    store().addFloorOpening(s, { outline: rect(100, 100, 200, 160), phase: 'new' });
    expect(issues().map((i) => [i.code, i.at])).toEqual([
      ['structure.opening-header', { x: 150, y: 100 }],
      ['structure.opening-header', { x: 150, y: 160 }],
    ]);
    beam(f, { x: 0, y: 160 }, { x: 360, y: 160 });
    expect(issues().map((i) => [i.code, i.severity, i.message])).toEqual([['structure.opening-header', 'info', "HDR: the floor opening's north edge cuts 8'-4\" of joists: a doubled header on joist hangers, and trimmers at its ends."]]);
  });

  it('notes a header for a new opening in an existing bearing wall only', () => {
    store().addOpening(f, { wallId: wallThrough(f, { x: 180, y: 0 }).id, type: 'window', offset: 180, width: 36, height: 48, sill: 36, phase: 'new' });
    store().addOpening(f, { wallId: wallThrough(f, { x: 0, y: 100 }).id, type: 'window', offset: 100, width: 36, height: 48, sill: 36, phase: 'new' });
    expect(issues().filter((i) => i.code === 'structure.wall-opening').map((i) => i.at)).toEqual([{ x: 180, y: 0 }]);
  });

  it('asks for the joists where a wall comes out and they are not set', () => {
    store().setLevelFraming(f, undefined);
    takeOut();
    expect(issues().map((i) => [i.code, i.severity])).toEqual([['structure.framing-unset', 'warning']]);
  });
});
