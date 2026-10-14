import type { BufferGeometry } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFloorOpeningLayouts, FLOOR_OPENING_HOLE_INSET, floorOpeningHole, floorOpeningSupportedEdges, getFloorOpeningLayout } from '../derive/floorOpenings';
import { clearMeshCache, getFloorOpeningMeshes, getLevelMeshes, triangleCount } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { planSvg } from '../io/exportPlan';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, migrate, MIGRATIONS, SCHEMA_VERSION } from '../model/plan';
import type { Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Area of the slab's top face (y = 0, level-local). */
function slabTopArea(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  let area = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const [ay, by, cy] = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
    if (Math.abs(ay) > 1e-6 || Math.abs(by) > 1e-6 || Math.abs(cy) > 1e-6) continue;
    const [ax, az, bx, bz, cx, cz] = [pos.getX(i), pos.getZ(i), pos.getX(i + 1), pos.getZ(i + 1), pos.getX(i + 2), pos.getZ(i + 2)];
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return area;
}

// A 20' x 20' box of 6" exterior walls (centerlines 0..240, inside faces 3..237) on the First and
// Second Floors; 96" walls and 12" floors, so 108" floor to floor. The Second Floor's opening sits
// in its north-west corner against the walls' inside faces: x 3..123, y 3..99.
let f = '';
let s = '';
const OUTLINE = rect(3, 3, 123, 99);
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  clearFloorOpeningLayouts();
  clearMeshCache();
  [, f, s] = plan().levelOrder;
  for (const lid of [f, s]) {
    const c = rect(0, 0, 240, 240);
    for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' });
  }
});
const addOpening = (railings?: boolean[]) => store().addFloorOpening(s, { outline: OUTLINE, phase: 'new', ...(railings ? { railings } : {}) })!;
/** A flight on the First Floor climbing north to the opening's south edge at x 87..123, its top one riser (7.2") under the Second Floor. */
const flightToEdge = () =>
  store().addStairs(f, { origin: { x: 105, y: 141 }, direction: 270, width: 36, run: 42, base: 72, rise: 28.8, risers: 4, phase: 'new', cutsFloorAbove: false })!;

describe('floor opening store actions', () => {
  const opening = (id: string) => plan().levels[s].floorOpenings[id];

  it('adds (railings one per edge, all on by default), patches in one undo step, phases and deletes', () => {
    const id = addOpening();
    expect(opening(id)).toEqual({ id, outline: OUTLINE, railings: [true, true, true, true], phase: 'new' });
    const before = plan();
    store().updateFloorOpening(s, id, { railings: [true, true, true, true] });
    expect(plan()).toBe(before);
    store().updateFloorOpening(s, id, { railings: [false, true, true, false] });
    expect(opening(id).railings).toEqual([false, true, true, false]);
    undo();
    expect(opening(id).railings).toEqual([true, true, true, true]);
    // A new outline refits the railings: a fifth corner adds a railed edge.
    store().updateFloorOpening(s, id, { outline: [...OUTLINE, { x: 3, y: 60 }] });
    expect(opening(id).railings).toEqual([true, true, true, true, true]);
    store().setPhase(s, { walls: [], openings: [], floorOpenings: [id] }, 'demo');
    expect(opening(id).phase).toBe('demo');
    store().deleteEntities(s, { ...EMPTY_SELECTION, floorOpenings: [id] });
    expect(plan().levels[s].floorOpenings).toEqual({});
  });

  it('refuses an outline of two points or no area, and a patch that would make one', () => {
    expect(store().addFloorOpening(s, { outline: OUTLINE.slice(0, 2), phase: 'new' })).toBeNull();
    expect(store().addFloorOpening(s, { outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], phase: 'new' })).toBeNull();
    const id = addOpening();
    const before = plan();
    store().updateFloorOpening(s, id, { outline: OUTLINE.slice(0, 2) });
    expect(plan()).toBe(before);
  });
});

describe('floor openings in files', () => {
  it('schema 5 adds floor openings to every level; a v4 file gains empty records', () => {
    expect(SCHEMA_VERSION).toBe(5);
    const v4 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 4 }));
    for (const l of Object.values(v4.levels) as Record<string, unknown>[]) delete l.floorOpenings;
    const up = MIGRATIONS[4](v4);
    expect(up.schemaVersion).toBe(5);
    for (const l of Object.values(up.levels as Record<string, Record<string, unknown>>)) expect(l.floorOpenings).toEqual({});
    const loaded = migrate(v4);
    for (const id of loaded.levelOrder) expect(loaded.levels[id].floorOpenings).toEqual({});
  });

  it('keeps a good opening, fits its railings, drops a broken one with a warning, and round-trips', () => {
    const doc = JSON.parse(JSON.stringify(createEmptyPlan()));
    const lid = doc.levelOrder[2];
    doc.levels[lid].floorOpenings = {
      good: { id: 'good', outline: OUTLINE, railings: [false, true], phase: 'new', extra: 1 },
      flat: { id: 'flat', outline: OUTLINE.slice(0, 2), railings: [], phase: 'new' },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = migrate(doc);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped floor opening flat'));
    warn.mockRestore();
    expect(loaded.levels[lid].floorOpenings).toEqual({ good: { id: 'good', outline: OUTLINE, railings: [false, true, true, true], phase: 'new' } });
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(loaded))))).toBe(JSON.stringify(loaded));
  });
});

describe('floor opening layout', () => {
  it('needs no guard along the walls: the north and west edges are supported', () => {
    const id = addOpening();
    expect(floorOpeningSupportedEdges(plan(), s, plan().levels[s].floorOpenings[id], 'proposed')).toEqual([true, false, false, true]);
    const layout = getFloorOpeningLayout(plan(), s, id, 'proposed')!;
    expect(layout.supported).toEqual([true, false, false, true]);
    // Guards on the east and south edges only, standing on the floor outside the hole.
    expect(layout.caps).toHaveLength(2);
    for (const cap of layout.caps) for (const p of cap) expect(p.x >= 123 - 1e-9 || p.y >= 99 - 1e-9).toBe(true);
    expect(Math.max(...layout.railing.map((b) => b.top))).toBe(36);
    expect(Math.min(...layout.railing.map((b) => b.bottom))).toBe(0);
  });

  it('opens the guard where a flight from the level below arrives, one riser under the floor', () => {
    const id = addOpening();
    flightToEdge();
    const layout = getFloorOpeningLayout(plan(), s, id, 'proposed')!;
    expect(layout.openings.map((o) => [o.edge, o.from, o.to])).toEqual([[2, 0, 36]]);
    // The south guard (edge 2 runs from x 123 to x 3) starts past the flight, at x 87.
    const south = layout.caps.find((c) => c.every((p) => p.y >= 99 - 1e-9))!;
    expect(Math.max(...south.map((p) => p.x))).toBeCloseTo(87, 9);
    // Existing view: the new flight and the new opening are not there.
    expect(getFloorOpeningLayout(plan(), s, id, 'existing')!.openings).toEqual([]);
  });

  it('has no guard on an edge whose railing is off, and none at all with every edge off', () => {
    const id = addOpening([true, false, true, true]);
    expect(getFloorOpeningLayout(plan(), s, id, 'proposed')!.caps).toHaveLength(1);
    const none = addOpening([false, false, false, false]);
    expect(getFloorOpeningLayout(plan(), s, none, 'proposed')!.railing).toEqual([]);
  });
});

describe('floor openings in 3D, on the plan and in exports', () => {
  const holeArea = Math.abs(polygonSignedArea(floorOpeningHole({ outline: OUTLINE })));

  it('cuts the slab even drawn flush to the walls, a quarter inch in', () => {
    expect(holeArea).toBeCloseTo((120 - 2 * FLOOR_OPENING_HOLE_INSET) * (96 - 2 * FLOOR_OPENING_HOLE_INSET), 6);
    const full = slabTopArea(getLevelMeshes(plan(), s, 'proposed').floor!);
    addOpening();
    expect(slabTopArea(getLevelMeshes(plan(), s, 'proposed').floor!)).toBeCloseTo(full - holeArea, 3);
    // A new opening is not in the existing slab.
    expect(slabTopArea(getLevelMeshes(plan(), s, 'existing').floor!)).toBeCloseTo(full, 3);
  });

  it('drops a stair hole inside the opening (the opening covers it)', () => {
    addOpening();
    const withOpening = slabTopArea(getLevelMeshes(plan(), s, 'proposed').floor!);
    store().addStairs(f, { origin: { x: 60, y: 90 }, direction: 270, width: 36, run: 60, phase: 'new', cutsFloorAbove: true, holeStart: 0 });
    expect(slabTopArea(getLevelMeshes(plan(), s, 'proposed').floor!)).toBeCloseTo(withOpening, 3);
  });

  it('builds the guard mesh, draws "open to below" with the guard on the plan, and exports a Guard', () => {
    const id = addOpening();
    const meshes = getFloorOpeningMeshes(plan(), s, 'proposed');
    // Phase colours only in the All view (the Proposed view draws new work solid).
    expect(meshes.map((m) => [m.id, m.phase])).toEqual([[id, 'existing']]);
    expect(getFloorOpeningMeshes(plan(), s, 'all').map((m) => m.phase)).toEqual(['new']);
    expect(triangleCount(meshes[0].railing)).toBeGreaterThan(0);
    expect(getFloorOpeningMeshes(plan(), s, 'proposed')).toBe(meshes);
    expect(getFloorOpeningMeshes(plan(), s, 'existing')).toEqual([]);
    const svg = planSvg(plan(), s, 'all');
    expect(svg).toContain('class="floor-opening phase-new"');
    expect(svg).toContain('Open to below');
    expect(svg).toContain('floor-opening-rail');
    expect(planSvg(plan(), s, 'existing')).not.toContain('class="floor-opening ');
    const root = buildExportScene(plan(), 'proposed', { activeLevelId: s, only3dActiveAndBelow: false, hidden3dLevels: [] });
    expect(root.getObjectByName('Guard')).toBeTruthy();
    disposeExportScene(root);
  });
});
