import { beforeEach, describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import example from '../../docs/examples/146-mick-road.json';
import { getFloorOpeningLayout } from '../derive/floorOpenings';
import { clearMeshCache, getFloorOpeningMeshes, getLevelMeshes } from '../derive/meshes';
import { clearStaircaseLayouts, getStaircaseLayout, heightAt, STAIRCASE, type StairSolid } from '../derive/staircase';
import { stairIssues } from '../derive/stairChecks';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { pointInPolygon } from '../model/geometry';
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
/** True when some solid holds the point (plan p, height z) strictly inside. */
const solidAt = (solids: readonly StairSolid[], p: Vec2, z: number) => solids.some((s) => pointInPolygon(p, s.poly) && heightAt(s.zb, p) < z - 1e-6 && heightAt(s.zt, p) > z + 1e-6);

describe("the starter's Grand stair", () => {
  const starter = migrate(example as unknown) as Plan;
  const f = starter.levelOrder[1];
  const s = starter.levelOrder[2];
  const [scId] = Object.keys(starter.levels[f].staircases);
  const layout = getStaircaseLayout(starter, f, scId, 'proposed')!;

  it('is framed underneath, with a bullnose, in the default oak and white', () => {
    expect(layout.members).toEqual(['f-s2', 'f-s3', 'f-s4', 'f-s5']);
    expect(layout.style).toMatchObject({ underside: 'framed', startStep: 'bullnose', treadColor: '#b5835a', riserColor: '#f1efe8', newel: 'box', handrail: 'round', nosing: 1 });
    expect(layout.loose).toEqual([]);
  });

  it('has three box newels: on the platform, on the landing at the turn, and on the floor above at the top', () => {
    expect(layout.newels.map((n) => [n.at, n.bottom, n.size])).toEqual([
      [{ x: 40.25, y: 46.25 }, 7.2, 5.5],
      [{ x: 129.75, y: 46.25 }, 72, 5.5],
      [{ x: 129.75, y: 93.75 }, 108, 5.5],
    ]);
    // Each stands 4" over the highest rail that dies into it.
    const R = 108 / 15;
    const slope = R / 10.5;
    expect(layout.newels[1].top).toBeCloseTo(72 + R - 2.75 * slope + 36 + 4, 6);
  });

  it('runs two handrails 36" over the nosings, from newel face to newel face, with balusters at most 3 3/4" apart', () => {
    expect(layout.rails.map((r) => [r.a, r.b])).toEqual([
      [
        { x: 43, y: 46.25 },
        { x: 127, y: 46.25 },
      ],
      [
        { x: 129.75, y: 49 },
        { x: 129.75, y: 91 },
      ],
    ]);
    // Flight 1's rail at its foot: the first nosing (14.4") plus 36.
    expect(layout.rails[0].za).toBeCloseTo(108 / 15 + 108 / 15 + 36, 6);
    // At the top it meets the balcony guard's cap, 36" over the floor above.
    expect(layout.rails[1].zb).toBeCloseTo(108 + 36, 6);
    const balusters = layout.solids.filter((x) => x.group === 'rail' && x.mat === 'paint' && Math.abs(x.poly[0].x - x.poly[1].x) + Math.abs(x.poly[0].y - x.poly[1].y) < STAIRCASE.baluster + 1e-6);
    const ys = balusters.filter((b) => Math.abs(b.poly[0].x - 129.75) < 1).map((b) => Math.min(...b.poly.map((p) => p.y))).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1] - STAIRCASE.baluster).toBeLessThanOrEqual(3.75 + 1e-6);
  });

  it('leaves room under the landing and the top flight, holds the landing on a post at its free corner, and closes the slope over the closet walls', () => {
    expect(layout.landingPosts).toEqual([{ x: 128.75, y: 47.25 }]);
    // Under the landing, over the closet (x 141..168): open from the floor to 61 3/4".
    expect(solidAt(layout.solids, { x: 155, y: 28 }, 30)).toBe(false);
    expect(solidAt(layout.solids, { x: 155, y: 28 }, 65)).toBe(true);
    expect(heightAt(layout.undersides['f-s4']!, { x: 155, y: 28 })).toBeCloseTo(72 - 1 - 9.25, 6);
    // The closet's walls stand to the underside, and panels close the rest.
    expect(layout.wallsThrough).toEqual([]);
    expect(layout.solids.filter((x) => x.group === 'frame').length).toBeGreaterThanOrEqual(3);
  });

  it('puts a bullnose in front of the platform round the starting newel, its tread past the platform\'s nosing', () => {
    expect(layout.bullnose).not.toBeNull();
    const ys = layout.bullnose!.map((p) => p.y);
    // The platform climbs north from y 49; its nosing reaches y 50; the bullnose's tread starts there.
    expect(Math.min(...ys)).toBeCloseTo(50, 6);
    expect(Math.max(...ys)).toBeCloseTo(46.25 + STAIRCASE.bullnose + 1, 1);
  });

  it('dresses the balcony guard in its style, reaching on to its top newel with no post of its own beside it', () => {
    const fo = Object.values(starter.levels[s].floorOpenings)[0];
    const g = getFloorOpeningLayout(starter, s, fo.id, 'proposed')!;
    expect(g.style).toEqual({ treadColor: '#b5835a', paintColor: '#f1efe8' });
    expect(g.rail.length).toBe(2);
    // The guard's posts are box newels; none stands within a newel's width of the stair's top newel.
    const posts = g.railing.filter((b) => Math.abs(b.poly[0].x - b.poly[1].x) + Math.abs(b.poly[0].y - b.poly[1].y) > 5);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      const cx = p.poly.reduce((t, q) => t + q.x, 0) / 4;
      const cy = p.poly.reduce((t, q) => t + q.y, 0) / 4;
      expect(Math.hypot(cx - 129.75, cy - 93.75)).toBeGreaterThan(5.5);
    }
    const meshes = getFloorOpeningMeshes(starter, s, 'proposed');
    expect(meshes[0].rail).toBeDefined();
  });

  it('builds as one staircase mesh in parts, and exports Stairs, Stair framing and Stair railing in its colours', () => {
    const m = getLevelMeshes(starter, f, 'proposed');
    expect(m.stairs.filter((x) => ['f-s2', 'f-s3', 'f-s4', 'f-s5'].includes(x.id))).toEqual([]);
    expect(m.staircases).toHaveLength(1);
    expect(m.staircases[0].parts.map((p) => `${p.group} ${p.mat}`).sort()).toEqual(['frame paint', 'rail paint', 'rail tread', 'stair paint', 'stair tread']);
    const root = buildExportScene(starter, 'proposed', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: f });
    const names = new Map<string, Set<string>>();
    root.traverse((o) => {
      const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (mat?.name?.startsWith('stair_')) names.set(o.name, new Set([...(names.get(o.name) ?? []), mat.name]));
    });
    expect([...names.keys()].sort()).toEqual(['Guard', 'Stair framing', 'Stair railing', 'Stairs']);
    // The Proposed view draws new work in its own finish (phase.ts shownPhase).
    expect([...names.get('Stairs')!].sort()).toEqual(['stair_paint_existing_f1efe8', 'stair_tread_existing_b5835a']);
    disposeExportScene(root);
  });
});

describe('a staircase against the code', () => {
  let f = '';
  let sc = '';
  const R = 108 / 15;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    clearStaircaseLayouts();
    clearMeshCache();
    [, f] = plan().levelOrder;
    const s2 = plan().levelOrder[2];
    for (const lid of [f, s2]) {
      const c = rect(0, 0, 240, 240);
      for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' });
    }
    store().addFloorOpening(s2, { outline: rect(3, 3, 237, 120), phase: 'new' });
    const piece = (over: Partial<NewStairs>): string => store().addStairs(f, { origin: { x: 0, y: 0 }, direction: 0, width: 42, run: 84, phase: 'new', cutsFloorAbove: false, ...over })!;
    // 8 risers east along the north wall (its inside face y 3) to a landing in the north-east corner
    // (x 195..237), then 6 south along the east wall.
    const a = piece({ origin: { x: 111, y: 24 }, rise: 8 * R, risers: 8, railings: { right: true } });
    const l = piece({ origin: { x: 195, y: 24 }, run: 42, base: 8 * R, rise: R, risers: 1 });
    const b = piece({ origin: { x: 216, y: 45 }, direction: 90, width: 42, run: 6 * 10.5, base: 9 * R, risers: 6, railings: { right: true } });
    sc = store().groupStairs(f, [a, l, b], { underside: 'framed' })!;
  });
  const codes = () => stairIssues(plan()).map((i) => i.code).sort();

  it('passes in its default style', () => {
    expect(codes()).toEqual([]);
  });

  it('wants nosings of 3/4" to 1 1/4" on treads under 11", a handrail of 34" to 38", balusters under 4 3/8" apart, a graspable rail', () => {
    store().updateStaircase(f, sc, { nosing: 1.5, handrailHeight: 40, balusterGap: 5, handrail: 'board' });
    expect(codes()).toEqual(['stair.baluster-gap', 'stair.handrail-grip', 'stair.handrail-grip', 'stair.handrail-height', 'stair.nosing']);
  });

  it('reports a wall rising into the framed underside, and none once it stops under it', () => {
    // A partition under the landing, north to south.
    store().addWall(f, { x: 216, y: 0 }, { x: 216, y: 45 }, { kind: 'interior', thickness: 4, phase: 'new' });
    expect(codes()).toContain('stair.wall-through');
    const wall = Object.values(plan().levels[f].walls).find((w) => w.kind === 'interior')!;
    const under = heightAt(getStaircaseLayout(plan(), f, sc, 'proposed')!.undersides[Object.values(plan().levels[f].stairs)[1].id]!, { x: 216, y: 20 });
    store().updateWalls(f, [wall.id], { heightOverride: under });
    expect(codes()).not.toContain('stair.wall-through');
  });

  it('warns about a piece not joined to the rest', () => {
    const lone = store().addStairs(f, { origin: { x: 60, y: 200 }, direction: 0, width: 36, run: 36, rise: 21.6, risers: 3, phase: 'new', cutsFloorAbove: false })!;
    store().groupStairs(f, [...Object.keys(plan().levels[f].stairs)], { id: sc });
    expect(plan().levels[f].stairs[lone].staircaseId).toBe(sc);
    expect(codes()).toContain('stair.chain-broken');
  });
});
