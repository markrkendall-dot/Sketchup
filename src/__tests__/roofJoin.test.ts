import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { viewPlanOf } from '../derive/optionView';
import { getLevelRoofs } from '../derive/roofJoin';
import {
  joinedCovers,
  joinRoof,
  roofBaseOutline,
  roofHeightAt,
  roofOutlineWithOverhang,
  roofRidgeLines,
  roofSolid,
  wallRoofProfile,
  type JoinOther,
  type JoinRegion,
} from '../derive/roofs';
import { pointInPolygon, polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, stackFloorTops } from '../model/plan';
import type { Id, Plan, Roof, Vec2 } from '../model/types';

type V3 = [number, number, number];

function tris(pos: number[]): [V3, V3, V3][] {
  const out: [V3, V3, V3][] = [];
  for (let i = 0; i < pos.length; i += 9) {
    out.push([
      [pos[i], pos[i + 1], pos[i + 2]],
      [pos[i + 3], pos[i + 4], pos[i + 5]],
      [pos[i + 6], pos[i + 7], pos[i + 8]],
    ]);
  }
  return out;
}

/**
 * Watertight: every edge used as often in one direction as in the other (vertices rounded to 1e-4).
 * Two cuts that meet at a point (valleys meeting at a ridge) share a vertical edge four ways.
 */
function closed(pos: number[]): boolean {
  const key = (v: V3) => v.map((c) => Math.round(c * 1e4)).join(',');
  const count = new Map<string, number>();
  for (const t of tris(pos)) {
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]);
      const b = key(t[(i + 1) % 3]);
      if (a === b) continue;
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n) return false;
  }
  return count.size > 0;
}

function volume(pos: number[]): number {
  let v = 0;
  for (const [a, b, c] of tris(pos)) v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return v;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const B = 96;
let nextId = 0;
const roof = (over: Partial<Roof> = {}): Roof => ({
  id: `r${nextId++}`,
  shape: 'gable',
  outline: rect(0, 0, 480, 300),
  ridgeAngle: 0,
  pitch: 6,
  overhang: 24,
  bearingOffset: 0,
  thickness: 2.5,
  fascia: 7,
  phase: 'existing',
  finish: 'metal',
  eave: 'open',
  ...over,
});

/** A roof placed for the checks: its bearing (in one common frame) and its join. */
interface Placed {
  roof: Roof;
  bearing: number;
  join: JoinRegion[] | null;
}

/** Each roof joined to the others (the earlier wins a tie), as getLevelRoofs does on one level. */
function joinAll(list: { roof: Roof; bearing?: number }[]): Placed[] {
  return list.map((me, i) => {
    const others: JoinOther[] = list.filter((_, j) => j !== i).map((o) => ({ roof: o.roof, bearing: o.bearing ?? B, wins: list.indexOf(o) < i }));
    return { roof: me.roof, bearing: me.bearing ?? B, join: joinRoof(me.roof, me.bearing ?? B, others) };
  });
}

const drawn = (r: Placed, p: Vec2) => (r.join ? joinedCovers(r.join, p) : pointInPolygon(p, roofOutlineWithOverhang(r.roof)));
const under = (r: Placed, p: Vec2) => roofHeightAt(r.roof, r.bearing, p)!;
const top = (r: Placed, p: Vec2) => under(r, p) + r.roof.thickness;

/**
 * The upper envelope, checked on a grid: where two roofs are both drawn their slabs do not overlap
 * in height (nothing pokes through); a roof drawn inside another's bearing outline is above it
 * (nothing hidden in the other's attic); and where a roof is not drawn inside its overhang outline,
 * another roof is drawn there at least as high (no hole).
 */
function checkEnvelope(placed: Placed[]): { cut: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of placed) for (const p of roofOutlineWithOverhang(r.roof)) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  let cut = 0;
  for (let x = x0 + 0.37; x < x1; x += 4.13) {
    for (let y = y0 + 0.29; y < y1; y += 4.07) {
      const p = { x, y };
      const inside = placed.filter((r) => pointInPolygon(p, roofOutlineWithOverhang(r.roof)));
      const shown = inside.filter((r) => drawn(r, p));
      for (const r of inside) {
        if (shown.includes(r)) continue;
        cut++;
        expect(shown.some((q) => top(q, p) >= top(r, p) - 1e-6), `a hole at ${x},${y}`).toBe(true);
      }
      for (const r of shown) {
        for (const q of shown) {
          if (q === r) continue;
          const lo = Math.max(under(r, p), under(q, p));
          const hi = Math.min(top(r, p), top(q, p));
          expect(hi - lo, `${r.roof.id} and ${q.roof.id} overlap at ${x},${y}`).toBeLessThan(1e-6);
          if (pointInPolygon(p, roofBaseOutline(q.roof))) expect(top(r, p), `${r.roof.id} inside ${q.roof.id} at ${x},${y}`).toBeGreaterThan(top(q, p) - 1e-6);
        }
      }
    }
  }
  return { cut };
}

function checkSolids(placed: Placed[]): void {
  for (const r of placed) {
    const s = roofSolid(r.roof, r.bearing, r.join);
    expect(closed(s.slab), `${r.roof.id} slab closed`).toBe(true);
    expect(volume(s.slab)).toBeGreaterThan(0);
    if (s.ridge.length) expect(closed(s.ridge), `${r.roof.id} ridge cap closed`).toBe(true);
    for (const b of s.boards) expect(closed(b)).toBe(true);
    for (const t of s.rafters) expect(closed(t)).toBe(true);
  }
}

/** Area drawn of a roof (sampled), in square inches. */
function drawnArea(r: Placed): number {
  const g = roofOutlineWithOverhang(r.roof);
  let n = 0;
  for (let x = -100.5; x < 700; x += 2) for (let y = -100.5; y < 700; y += 2) if (pointInPolygon({ x, y }, g) && drawn(r, { x, y })) n++;
  return n * 4;
}

beforeEach(() => {
  clearMeshCache();
});

// The main block: 40' x 25' outside faces, a 6:12 gable with the ridge along x (y 150, its
// underside 171"), 24" overhang. A wing runs south from its south wall (y 300).
const main = () => roof({ id: 'main' });

describe('a gable wing meeting a gable main roof at a right angle', () => {
  it('a lower ridge: the wing runs into the main roof and stops at the valleys; the main roof is whole above it', () => {
    // 10' wide, 7:12: its ridge underside 131", under the main ridge. Drawn into the main block to
    // its ridge; the trim takes off what is under the main roof.
    const wing = roof({ id: 'wing', outline: rect(180, 150, 300, 500), ridgeAngle: 90, pitch: 7, overhang: 18 });
    const placed = joinAll([{ roof: main() }, { roof: wing }]);
    const [m, w] = placed;
    expect(w.join).not.toBeNull();
    const { cut } = checkEnvelope(placed);
    expect(cut).toBeGreaterThan(0);
    checkSolids(placed);
    // The wing ridge meets the main plane at y 230: drawn south of it, not north.
    expect(drawn(w, { x: 241, y: 236 })).toBe(true);
    expect(drawn(w, { x: 241, y: 222 })).toBe(false);
    expect(drawn(m, { x: 241, y: 222 })).toBe(true);
    // The main roof is cut only under the wing, between the valleys.
    expect(drawn(m, { x: 241, y: 280 })).toBe(false);
    expect(drawn(m, { x: 185, y: 290 })).toBe(true);
    expect(drawn(m, { x: 100, y: 310 })).toBe(true);
    // The valleys: the wing's west slope meets the main's south slope where 7/12 (x - 180) = (300 - y) / 2.
    const lines = roofRidgeLines(w.roof, w.join);
    const valley = lines.find(([p, q]) => [p, q].every((v) => Math.abs((7 / 12) * (v.x - 180) - (300 - v.y) / 2) < 1e-6) && Math.abs(p.x - q.x) > 10);
    expect(valley).toBeDefined();
  });

  it('an equal ridge: the valleys meet at the main ridge', () => {
    // 25' wide at 6:12: its ridge at 171", the main's; drawn to 18" short of the main ridge, so its
    // overhang ends there.
    const wing = roof({ id: 'wing', outline: rect(90, 168, 390, 500), ridgeAngle: 90, pitch: 6, overhang: 18 });
    const placed = joinAll([{ roof: main() }, { roof: wing }]);
    checkEnvelope(placed);
    checkSolids(placed);
    const [m, w] = placed;
    expect(drawn(w, { x: 241, y: 160 })).toBe(true);
    expect(drawn(w, { x: 200, y: 160 })).toBe(false);
    expect(drawn(m, { x: 200, y: 160 })).toBe(true);
    expect(drawn(m, { x: 241, y: 200 })).toBe(false);
  });

  it('a higher ridge: a cross gable over the main roof, which is cut beneath it', () => {
    // 20' wide at 10:12: its ridge at 196", over the main ridge; drawn across the whole block.
    const wing = roof({ id: 'wing', outline: rect(120, 0, 360, 500), ridgeAngle: 90, pitch: 10, overhang: 18 });
    const placed = joinAll([{ roof: main() }, { roof: wing }]);
    checkEnvelope(placed);
    checkSolids(placed);
    const [m, w] = placed;
    expect(drawn(w, { x: 241, y: 151 })).toBe(true);
    expect(drawn(m, { x: 241, y: 151 })).toBe(false);
    // Near the wing's eaves the main roof is higher.
    expect(drawn(m, { x: 125, y: 151 })).toBe(true);
    expect(drawn(w, { x: 125, y: 151 })).toBe(false);
  });

  it('a gable wing into a hip main roof', () => {
    const hip = roof({ id: 'main', shape: 'hip' });
    const wing = roof({ id: 'wing', outline: rect(180, 150, 300, 500), ridgeAngle: 90, pitch: 7, overhang: 18 });
    const placed = joinAll([{ roof: hip }, { roof: wing }]);
    expect(checkEnvelope(placed).cut).toBeGreaterThan(0);
    checkSolids(placed);
    expect(drawn(placed[1], { x: 241, y: 236 })).toBe(true);
    expect(drawn(placed[1], { x: 241, y: 222 })).toBe(false);
  });
});

describe('roofs that do not meet in height, or only touch', () => {
  it('a lean-to below the eave of a higher roof is not trimmed (the roof is drawn exactly as alone)', () => {
    // The upper roof on a storey above (its bearing 108" higher); the shed against its south wall,
    // its high edge 18" short of the wall so the overhang ends at the wall face.
    const upper = { roof: main(), bearing: B + 108 };
    const shed = roof({ id: 'shed', shape: 'shed', outline: rect(100, 318, 380, 420), ridgeAngle: 90, pitch: 4, overhang: 18 });
    const placed = joinAll([upper, { roof: shed }]);
    expect(placed[0].join).toBeNull();
    expect(placed[1].join).toBeNull();
    checkEnvelope(placed);
    expect(roofSolid(shed, B, placed[1].join)).toEqual(roofSolid(shed, B));
  });

  it('an overhang that passes clear under another roof is left whole; one run into the wall above is cut at its face', () => {
    const upper = { roof: main(), bearing: B + 108 };
    // Drawn to the wall: its high-side overhang runs 18" into the storey above (inside its outline).
    const shed = roof({ id: 'shed', shape: 'shed', outline: rect(100, 300, 380, 420), ridgeAngle: 90, pitch: 4, overhang: 18 });
    const placed = joinAll([upper, { roof: shed }]);
    expect(placed[0].join).toBeNull();
    expect(placed[1].join).not.toBeNull();
    expect(drawn(placed[1], { x: 200, y: 290 })).toBe(false);
    expect(drawn(placed[1], { x: 200, y: 310 })).toBe(true);
    checkSolids(placed);
  });

  it('two roofs whose overhangs overlap at one height meet in a valley over the wall between them', () => {
    // Two blocks side by side, ridges along y, sharing the wall at x 240: their eave overhangs
    // overlap; each is drawn only on its own side.
    const west = roof({ id: 'west', outline: rect(0, 0, 240, 300), ridgeAngle: 90 });
    const east = roof({ id: 'east', outline: rect(240, 0, 480, 300), ridgeAngle: 90 });
    const placed = joinAll([{ roof: west }, { roof: east }]);
    checkEnvelope(placed);
    checkSolids(placed);
    expect(drawn(placed[0], { x: 236, y: 150 })).toBe(true);
    expect(drawn(placed[0], { x: 244, y: 150 })).toBe(false);
    expect(drawn(placed[1], { x: 244, y: 150 })).toBe(true);
    expect(drawn(placed[1], { x: 236, y: 150 })).toBe(false);
  });

  it('roofs that only touch along an edge, or whose overhangs pass one over the other, are not changed', () => {
    const a = roof({ id: 'a', outline: rect(0, 0, 200, 200), overhang: 0 });
    const b = roof({ id: 'b', outline: rect(200, 0, 400, 200), overhang: 0 });
    expect(joinAll([{ roof: a }, { roof: b }]).every((p) => p.join === null)).toBe(true);
    // A low roof 30" away whose overhang passes under the other's eave, 40" lower.
    const c = roof({ id: 'c', outline: rect(230, 0, 400, 200), overhang: 24 });
    const placed = joinAll([{ roof: roof({ id: 'd', outline: rect(0, 0, 200, 200) }) }, { roof: c, bearing: B - 40 }]);
    expect(placed.every((p) => p.join === null)).toBe(true);
  });
});

describe('an L-shaped hip', () => {
  it('is two hips joined at a valley, the solid closed, every edge an eave', () => {
    const ell = roof({ shape: 'hip', outline: [{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 480, y: 240 }, { x: 240, y: 240 }, { x: 240, y: 480 }, { x: 0, y: 480 }] });
    const s = roofSolid(ell, B);
    expect(closed(s.slab)).toBe(true);
    expect(closed(s.ridge)).toBe(true);
    // The valley from the reflex corner (out to the overhang's corner) runs on at 45 degrees into the
    // hip from the outer corner: one straight line on the plan.
    const lines = roofRidgeLines(ell);
    const valley = lines.find(([p, q]) => [p, q].some((v) => Math.abs(v.x - 264) < 1e-6 && Math.abs(v.y - 264) < 1e-6));
    expect(valley).toBeDefined();
    const [p, q] = valley!;
    expect(Math.abs(p.x - q.x)).toBeCloseTo(Math.abs(p.y - q.y), 6);
    // Two ridges meeting over the corner and the four end hips: seven lines in all.
    expect(lines).toHaveLength(7);
    // Nothing in the missing quarter but the overhang.
    expect(roofHeightAt(ell, B, { x: 360, y: 360 })).toBeNull();
    // Every board along the outline is a run of rafter tails (open eaves): no rake boards.
    expect(s.boards).toHaveLength(0);
    expect(s.rafters.length).toBeGreaterThan(40);
    // The valley's overhang is one surface: nothing hangs under it.
    const placed: Placed = { roof: ell, bearing: B, join: null };
    expect(roofHeightAt(placed.roof, B, { x: 250, y: 250 })).toBeCloseTo(B - 10 * 0.5, 9);
  });
});

describe('walls under joined roofs', () => {
  const line = (a: Vec2, b: Vec2, t = 6) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const normal = { x: dir.y, y: -dir.x };
    const h = t / 2;
    const poly = [
      { x: a.x + normal.x * h - dir.x * h, y: a.y + normal.y * h - dir.y * h },
      { x: b.x + normal.x * h + dir.x * h, y: b.y + normal.y * h + dir.y * h },
      { x: b.x - normal.x * h + dir.x * h, y: b.y - normal.y * h + dir.y * h },
      { x: a.x - normal.x * h - dir.x * h, y: a.y - normal.y * h - dir.y * h },
    ];
    return { a, dir, normal, thickness: t, length: len, poly };
  };

  it('the main gable end under a wing drawn into it keeps its full gable; a wing end wall stops under the main roof', () => {
    // The wing along x, running into the main block's east gable end (x 480) and drawn on into it.
    const wing = roof({ id: 'wing', outline: rect(420, 90, 700, 210), ridgeAngle: 0, pitch: 6, overhang: 18 });
    const placed = joinAll([{ roof: main() }, { roof: wing }]);
    const onLevel = placed.map((p) => ({ roof: p.roof, bearing: p.bearing, join: p.join }));
    const gableEnd = wallRoofProfile(line({ x: 477, y: 3 }, { x: 477, y: 297 }), B, onLevel, onLevel)!;
    // Its peak is the main ridge (171"), not notched down to the wing.
    expect(Math.max(...gableEnd.h)).toBeCloseTo(B + 150 * 0.5, 6);
    // A wing wall standing under the main roof's overhang (x 490) stops under the main roof.
    const stub = wallRoofProfile(line({ x: 490, y: 120 }, { x: 490, y: 180 }), B, [onLevel[1]], onLevel)!;
    for (const [i, s] of stub.s.entries()) {
      const p = { x: 490, y: 120 + s };
      expect(stub.h[i]).toBeLessThanOrEqual(roofHeightAt(main(), B, p)! + 1e-6);
    }
  });
});

// ---- On a plan: levels, phases and options

const ROOF_BASE = { pitch: 6, overhang: 24, bearingOffset: 0, thickness: 2.5, fascia: 7, finish: 'metal', eave: 'open' } as const;

function planWith(levels: Record<string, Partial<Roof>[]>): { plan: Plan; ids: Id[] } {
  const plan = createEmptyPlan('Join', 'basementTwoStorey');
  const s = plan.structures[plan.structureOrder[0]];
  const ids = s.levelOrder;
  const next = { ...plan, levels: { ...plan.levels } };
  for (const [i, roofs] of Object.entries(levels)) {
    const id = ids[Number(i)];
    const rec: Record<Id, Roof> = {};
    roofs.forEach((r, k) => {
      const full = { id: `${id}-${k}`, shape: 'gable', outline: rect(0, 0, 480, 300), ridgeAngle: 0, phase: 'existing', ...ROOF_BASE, ...r } as Roof;
      rec[full.id] = full;
    });
    next.levels[id] = { ...next.levels[id], roofs: rec };
  }
  return { plan: next, ids };
}

describe('joins on a plan', () => {
  it('a porch roof on the storey below runs into the upper roof and the upper wall', () => {
    // The main roof on the upper storey; a porch gable on the lower one, its ridge into the house.
    const { plan, ids } = planWith({ 2: [{}], 1: [{ outline: rect(180, 280, 300, 420), ridgeAngle: 90, pitch: 12, overhang: 18 }] });
    const lower = getLevelRoofs(plan, ids[1], 'existing');
    expect(lower.own).toHaveLength(1);
    const porch = lower.own[0];
    expect(porch.join).not.toBeNull();
    // Cut inside the house (inside the upper roof's outline), drawn outside it.
    expect(joinedCovers(porch.join!, { x: 241, y: 290 })).toBe(false);
    expect(joinedCovers(porch.join!, { x: 241, y: 310 })).toBe(true);
    // The upper roof seen from the lower level is up a storey.
    const tops = stackFloorTops(plan.structures[plan.structureOrder[0]], plan.levels);
    const upper = lower.building.find((r) => r.roof.id.startsWith(ids[2]))!;
    expect(upper.bearing).toBeCloseTo(tops[2] - tops[1] + plan.levels[ids[2]].wallHeight, 9);
  });

  it('a new wing trims the existing roof only in the views it is in; a demolished roof trims nothing in Proposed', () => {
    const wing = { outline: rect(180, 150, 300, 500), ridgeAngle: 90, pitch: 7, overhang: 18, phase: 'new' } as const;
    const { plan, ids } = planWith({ 1: [{}, wing] });
    const mainId = `${ids[1]}-0`;
    const joinIn = (built: { plan: Plan; ids: Id[] }, view: 'existing' | 'proposed' | 'all', p: Plan = built.plan) =>
      getLevelRoofs(p, built.ids[1], view).own.find((r) => r.roof.id === `${built.ids[1]}-0`)!.join;
    const first = { plan, ids };
    expect(joinIn(first, 'existing')).toBeNull();
    expect(joinIn(first, 'proposed')).not.toBeNull();
    // Demolished: it stands in Existing and trims nothing in Proposed (where it is not shown).
    const demo = planWith({ 1: [{}, { ...wing, phase: 'demo' }] });
    expect(joinIn(demo, 'existing')).not.toBeNull();
    expect(joinIn(demo, 'proposed')).toBeNull();
    // A wing of another option only.
    const tagged = planWith({ 1: [{}, { ...wing, optionIds: ['option-b'] }] });
    const two = { ...tagged.plan, options: [...tagged.plan.options, { id: 'option-b', name: 'Option B' }] };
    expect(joinIn(tagged, 'proposed', viewPlanOf(two, 'option-b'))).not.toBeNull();
    expect(joinIn(tagged, 'proposed', viewPlanOf(two, two.options[0].id))).toBeNull();
    // A demolished and a new roof never stand together: in All they do not trim each other.
    const swap = planWith({ 1: [{ phase: 'demo' }, wing] });
    expect(joinIn(swap, 'all')).toBeNull();
    // The 3D meshes follow: the roof's geometry differs once the wing trims it.
    const a = getLevelMeshes(plan, ids[1], 'existing').roofs.find((r) => r.id === mainId)!;
    const b = getLevelMeshes(plan, ids[1], 'proposed').roofs.find((r) => r.id === mainId)!;
    expect(a.geometry.getAttribute('position').count).not.toBe(b.geometry.getAttribute('position').count);
  });

  it('roofs of different buildings never trim each other', () => {
    const { plan } = planWith({ 1: [{}] });
    // A wing as a second building at the same place as the house's roof.
    const other = createEmptyPlan('Garage', 'single');
    const sid = other.structureOrder[0];
    const gid = other.structures[sid].levelOrder[0];
    const two: Plan = {
      ...plan,
      structures: { ...plan.structures, [sid]: { ...other.structures[sid], baseFloorElevation: 0 } },
      structureOrder: [...plan.structureOrder, sid],
      levels: { ...plan.levels, [gid]: { ...other.levels[gid], roofs: { g: { id: 'g', shape: 'gable', outline: rect(180, 150, 300, 500), ridgeAngle: 90, phase: 'existing', ...ROOF_BASE } as Roof } } },
    };
    expect(getLevelRoofs(two, gid, 'existing').own[0].join).toBeNull();
    expect(polygonSignedArea(rect(0, 0, 1, 1))).not.toBe(0);
  });
});

describe('the drawn area', () => {
  it('a lower wing takes off less of the main roof than its own buried part', () => {
    const wing = roof({ id: 'wing', outline: rect(180, 150, 300, 500), ridgeAngle: 90, pitch: 7, overhang: 18 });
    const [m, w] = joinAll([{ roof: main() }, { roof: wing }]);
    const whole = (r: Roof): Placed => ({ roof: r, bearing: B, join: null });
    expect(drawnArea(m)).toBeLessThan(drawnArea(whole(m.roof)));
    expect(drawnArea(w)).toBeLessThan(drawnArea(whole(w.roof)));
  });
});
