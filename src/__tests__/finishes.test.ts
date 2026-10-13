import { produce } from 'immer';
import { FrontSide, type BufferGeometry } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeFootprints } from '../derive/footprint';
import { buildWallGeometry, clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { muntinCounts, openingFill, sashSpans, shutterWidth, type FillBox, type FillInput } from '../derive/openings3d';
import { DEFAULT_EXTERIOR_COLOR, DEFAULT_INTERIOR_COLOR, DEFAULT_LEAF_COLOR, normalizeHex, roofColorOf, WALL_FINISHES, WALL_FINISH_LABEL, wallColorOf, wallFinishOf } from '../model/finish';
import { createEmptyPlan, createLevel, migrate, SCHEMA_VERSION } from '../model/plan';
import type { Level, Opening, Plan, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import {
  blendPixels,
  blockFaces,
  brightness,
  CLAPBOARD_COURSE,
  courseBoundaries,
  hexToRgb,
  newWorkColor,
  NEW_WORK_GREEN,
  normalFromHeight,
  PX_PER_INCH,
  RELIEF,
  seeded,
  shingleCourses,
  shingleJoints,
  sidingHeight,
  sidingTexture,
  sidingTextures,
  TEXTURE_PX,
  TILE_INCHES,
} from '../view3d/textures';
import { openingMaterial, wallFlatColor } from '../view3d/materials';
import { wallMaterial } from '../view3d/materials';

const store = () => usePlanStore.getState();

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

/** A single free-standing wall 0..240 along x at y = 0. */
function oneWall(openings: Opening[] = []) {
  const level: Level = createLevel('t', 96, 12);
  level.nodes.p = { id: 'p', x: 0, y: 0 };
  level.nodes.q = { id: 'q', x: 240, y: 0 };
  const wall: Wall = { id: 'w', a: 'p', b: 'q', thickness: 6.5, kind: 'exterior', phase: 'existing' };
  level.walls.w = wall;
  const fp = computeFootprints(level, 'all').get('w')!;
  return { level, wall, fp, openings };
}

const win = (o: Partial<Opening> = {}): Opening => ({ id: 'o1', wallId: 'w', type: 'window', offset: 120, width: 36, height: 48, sill: 36, phase: 'existing', ...o });

function range(g: BufferGeometry, attr: 'position' | 'uv', k: number, longFacesOnly = false): [number, number] {
  const a = g.getAttribute(attr);
  const n = g.getAttribute('normal');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.count; i++) {
    if (longFacesOnly && Math.abs(n.getZ(i)) < 0.99) continue;
    const v = k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : a.getZ(i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

describe('wall UVs in inches', () => {
  it('u spans the wall length and v spans 0 to the height', () => {
    const { wall, fp } = oneWall();
    const g = buildWallGeometry(fp, wall, [], 96);
    const uv = g.getAttribute('uv');
    expect(uv).toBeDefined();
    expect(uv.count).toBe(g.getAttribute('position').count);
    // The long faces run along the wall; the end caps map across it (-3.25 to 3.25).
    const [u0, u1] = range(g, 'uv', 0, true);
    const [v0, v1] = range(g, 'uv', 1, true);
    expect(u0).toBeCloseTo(0, 6);
    expect(u1).toBeCloseTo(240, 6);
    expect(range(g, 'uv', 0)[0]).toBeCloseTo(-3.25, 6);
    expect(v0).toBeCloseTo(0, 6);
    expect(v1).toBeCloseTo(96, 6);
  });

  it('is continuous across the pieces around an opening: u is the position along the wall, v the height', () => {
    const o = win();
    const { wall, fp } = oneWall([o]);
    const g = buildWallGeometry(fp, wall, [o], 96);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    let longFaces = 0;
    for (let i = 0; i < pos.count; i++) {
      // Long faces (normal along +-z): u equals x along the wall, v equals Y.
      if (Math.abs(nor.getZ(i)) > 0.99) {
        longFaces++;
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 5);
        expect(uv.getY(i)).toBeCloseTo(pos.getY(i), 5);
      }
    }
    expect(longFaces).toBeGreaterThan(30);
  });

  it('runs along the wall also for a wall drawn the other way', () => {
    const { level } = oneWall();
    level.walls.w.a = 'q';
    level.walls.w.b = 'p';
    const fp = computeFootprints(level, 'all').get('w')!;
    const g = buildWallGeometry(fp, level.walls.w, [], 96);
    // Still measured from the wall's start: now at x = 240, running toward -x.
    const [u0, u1] = range(g, 'uv', 0, true);
    expect(u0).toBeCloseTo(0, 6);
    expect(u1).toBeCloseTo(240, 6);
  });
});

describe('opening fills', () => {
  const base: FillInput = { type: 'window', j0: 100, j1: 136, bottom: 36, top: 84, thickness: 6.5 };
  const count = (boxes: ReturnType<typeof openingFill>, kind: string) => boxes.filter((b) => b.kind === kind).length;

  it('a 36 x 48 window with 2 x 3 lites: 1 vertical + 2 horizontal muntins, one glass pane, a sill', () => {
    expect(muntinCounts({ cols: 2, rows: 3 })).toEqual({ vertical: 1, horizontal: 2 });
    const boxes = openingFill({ ...base, lites: { cols: 2, rows: 3 } });
    expect(count(boxes, 'muntin')).toBe(3);
    expect(count(boxes, 'glass')).toBe(1);
    expect(count(boxes, 'sill')).toBe(1);
    expect(count(boxes, 'sashFrame')).toBe(4);
    expect(count(boxes, 'trim')).toBe(3); // head and two jambs
    expect(count(boxes, 'shutter')).toBe(0);
    const vertical = boxes.filter((b) => b.kind === 'muntin' && b.s1 - b.s0 < 1);
    expect(vertical).toHaveLength(1);
    // The default grid for a window is 2 x 3.
    expect(openingFill(base).filter((b) => b.kind === 'muntin')).toHaveLength(3);
  });

  it('dimensions: sash frame 1.5", muntins 0.75", glass 0.25" thick at mid-wall, sill 1.5" projecting 1" past the trim', () => {
    const boxes = openingFill(base);
    const frame = boxes.find((b) => b.kind === 'sashFrame' && b.s0 === 100)!;
    expect(frame.s1 - frame.s0).toBeCloseTo(1.5, 9);
    const glass = boxes.find((b) => b.kind === 'glass')!;
    expect(glass.d1 - glass.d0).toBeCloseTo(0.25, 9);
    expect(glass.d0 + glass.d1).toBeCloseTo(0, 9);
    expect(glass.s0).toBeCloseTo(101.5, 9);
    expect(glass.y0).toBeCloseTo(37.5, 9);
    const muntin = boxes.find((b) => b.kind === 'muntin' && b.s1 - b.s0 < 1)!;
    expect(muntin.s1 - muntin.s0).toBeCloseTo(0.75, 9);
    const sill = boxes.find((b) => b.kind === 'sill')!;
    expect(sill.y1 - sill.y0).toBeCloseTo(1.5, 9);
    expect(sill.y1).toBeCloseTo(36, 9);
    // The trim projects 1" from the face at d = 3.25, the sill 1" more.
    expect(sill.d0).toBeCloseTo(3.25, 9);
    expect(sill.d1).toBeCloseTo(5.25, 9);
    // Trim: 4" wide by default, on the outside only.
    const head = boxes.find((b) => b.kind === 'trim' && b.y0 === 84)!;
    expect(head.y1 - head.y0).toBeCloseTo(4, 9);
    expect(head.s1 - head.s0).toBeCloseTo(36 + 8, 9);
    expect(boxes.filter((b) => b.kind === 'trim').every((b) => b.d0 >= 3.25 - 1e-9)).toBe(true);
    expect(openingFill({ ...base, trim: 6 }).find((b) => b.kind === 'trim' && b.y0 === 84)!.y1).toBeCloseTo(90, 9);
  });

  it('shutters: a board each side flanking the trim, one sash wide within 10" to 18", with two battens across it', () => {
    const plain = openingFill(base);
    const shut = openingFill({ ...base, shutters: true });
    expect(shut.length - plain.length).toBe(6);
    const boards = shut.filter((b) => b.kind === 'shutter');
    const battens = shut.filter((b) => b.kind === 'batten');
    expect(boards).toHaveLength(2);
    expect(battens).toHaveLength(4);
    expect(shut.filter((b) => b.part === 'shutter')).toHaveLength(6);
    // A 36" window of one sash: 36 clamps to 18.
    for (const b of boards) {
      expect(b.s1 - b.s0).toBeCloseTo(18, 9);
      expect(b.d1 - b.d0).toBeCloseTo(1, 9);
      expect(b.d0).toBeCloseTo(3.25, 9);
    }
    expect(boards[0].s1).toBeCloseTo(100 - 4, 9);
    expect(boards[1].s0).toBeCloseTo(136 + 4, 9);
    // Battens: 3" tall, 0.75" proud of the board, centred at a quarter and three quarters of the height.
    for (const b of battens) {
      expect(b.y1 - b.y0).toBeCloseTo(3, 9);
      expect(b.d0).toBeCloseTo(4.25, 9);
      expect(b.d1).toBeCloseTo(5, 9);
    }
    expect(battens.map((b) => (b.y0 + b.y1) / 2).sort((p, q) => p - q)).toEqual([48, 48, 72, 72]);
    // Each batten lies across its own board.
    for (const t of battens) expect(boards.some((b) => t.s0 >= b.s0 - 1e-9 && t.s1 <= b.s1 + 1e-9)).toBe(true);
  });

  it('shutter width is the window width over its sashes, clamped to 10" to 18"', () => {
    const width = (w: number, sashes?: number) => {
      const boxes = openingFill({ ...base, j0: 0, j1: w, sashes, shutters: true });
      const boards = boxes.filter((b) => b.kind === 'shutter');
      expect(boards).toHaveLength(2);
      expect(boards[0].s1 - boards[0].s0).toBeCloseTo(boards[1].s1 - boards[1].s0, 9);
      return boards[0].s1 - boards[0].s0;
    };
    expect(width(90, 3)).toBeCloseTo(18, 9); // 30 clamps to 18
    expect(width(48, 4)).toBeCloseTo(12, 9);
    expect(width(24, 2)).toBeCloseTo(12, 9);
    expect(width(36, 6)).toBeCloseTo(10, 9); // 6 clamps to 10
    expect(width(14)).toBeCloseTo(14, 9);
    for (const [w, n] of [[90, 3], [48, 4], [24, 2], [36, 6], [14, 1], [200, 1]]) {
      expect(shutterWidth(w, n)).toBeCloseTo(Math.min(18, Math.max(10, w / n)), 9);
    }
  });

  it('a door has a leaf with a recessed panel and no sill; a passage has nothing', () => {
    const door = openingFill({ type: 'door', j0: 100, j1: 136, bottom: 0, top: 80, thickness: 6.5 });
    expect(door.filter((b) => b.kind === 'leaf').length).toBe(4); // two stiles, two rails
    expect(count(door, 'panel')).toBe(1);
    expect(count(door, 'sill')).toBe(0);
    expect(count(door, 'glass')).toBe(0);
    expect(count(door, 'muntin')).toBe(0);
    const leaf = door.find((b) => b.kind === 'leaf')!;
    const panel = door.find((b) => b.kind === 'panel')!;
    expect(leaf.d1 - leaf.d0).toBeCloseTo(1.75, 9);
    expect(panel.d1 - panel.d0).toBeLessThan(leaf.d1 - leaf.d0); // recessed
    expect(door.every((b) => (b.part === 'leaf') === (b.kind === 'leaf' || b.kind === 'panel'))).toBe(true);
    expect(openingFill({ type: 'passage', j0: 100, j1: 148, bottom: 0, top: 80, thickness: 6.5 })).toEqual([]);
  });

  it('a glazed door (more than 1 x 1 lites) has glass and muntins instead of the panel', () => {
    const door = openingFill({ type: 'door', j0: 100, j1: 136, bottom: 0, top: 80, thickness: 6.5, lites: { cols: 2, rows: 3 } });
    expect(count(door, 'panel')).toBe(0);
    expect(count(door, 'glass')).toBe(1);
    expect(count(door, 'muntin')).toBe(3);
  });

  it('every box is inside its own bounds and has positive size', () => {
    for (const lites of [{ cols: 1, rows: 1 }, { cols: 3, rows: 2 }, { cols: 12, rows: 12 }]) {
      for (const b of openingFill({ ...base, lites, shutters: true })) {
        expect(b.s1).toBeGreaterThan(b.s0);
        expect(b.d1).toBeGreaterThan(b.d0);
        expect(b.y1).toBeGreaterThan(b.y0);
      }
    }
  });
});

describe('sashes, screens and doors', () => {
  const count = (boxes: FillBox[], kind: string) => boxes.filter((b) => b.kind === kind).length;
  const width = (b: FillBox) => b.s1 - b.s0;
  const bySpan = (p: FillBox, q: FillBox) => p.s0 - q.s0;
  /** A 144" x 60" picture window, sill 30" above the floor. */
  const wide: FillInput = { type: 'window', j0: 0, j1: 144, bottom: 30, top: 90, thickness: 6.5 };
  const door: FillInput = { type: 'door', j0: 0, j1: 36, bottom: 0, top: 80, thickness: 6.5 };

  it('3 sashes with 2 x 3 lites: 2 mullions, 3 glass panes, 9 muntins, a frame of four boards per sash', () => {
    const boxes = openingFill({ ...wide, sashes: 3, lites: { cols: 2, rows: 3 } });
    expect(count(boxes, 'mullion')).toBe(2);
    expect(count(boxes, 'glass')).toBe(3);
    expect(count(boxes, 'muntin')).toBe(9);
    expect(count(boxes, 'sashFrame')).toBe(12);
    // Mullions: 2" wide, the full hole height, as deep as the sashes, in the sash material.
    const sash = (144 - 2 * 2) / 3;
    const mullions = boxes.filter((b) => b.kind === 'mullion').sort(bySpan);
    mullions.forEach((m, i) => {
      expect(m.part).toBe('sash');
      expect(width(m)).toBeCloseTo(2, 9);
      expect(m.s0).toBeCloseTo((i + 1) * sash + i * 2, 9);
      expect([m.y0, m.y1]).toEqual([30, 90]);
      expect(m.d1 - m.d0).toBeCloseTo(1.75, 9);
    });
    // Each pane sits inside its own sash's 1.5" frame.
    for (const g of boxes.filter((b) => b.kind === 'glass')) expect(width(g)).toBeCloseTo(sash - 3, 9);
    // One sash is the window as before.
    expect(count(openingFill(wide), 'mullion')).toBe(0);
    expect(count(openingFill({ ...wide, sashes: 1 }), 'sashFrame')).toBe(4);
  });

  it('a fixed centre pane: side sashes min(24, (w - 4) / 4), 24 / 92 / 24 at 144", the middle pane undivided', () => {
    expect(sashSpans(0, 144, 3, true).map(([a, b]) => b - a)).toEqual([24, 92, 24]);
    expect(sashSpans(0, 118, 3, true).map(([a, b]) => b - a)).toEqual([24, 66, 24]);
    expect(sashSpans(0, 40, 3, true).map(([a, b]) => b - a)).toEqual([9, 18, 9]);
    const boxes = openingFill({ ...wide, sashes: 3, fixedCenter: true, lites: { cols: 2, rows: 3 } });
    expect(boxes.filter((b) => b.kind === 'glass').sort(bySpan).map(width)).toEqual([21, 89, 21]);
    expect(count(boxes, 'mullion')).toBe(2);
    // Muntins only in the side sashes.
    expect(count(boxes, 'muntin')).toBe(6);
    expect(boxes.filter((b) => b.kind === 'muntin').every((b) => b.s1 <= 24 || b.s0 >= 120)).toBe(true);
    // Only with 3 sashes: 4 stay equal.
    expect(sashSpans(0, 144, 4, true).map(([a, b]) => b - a)).toEqual([34.5, 34.5, 34.5, 34.5]);
  });

  it('sashSpans: one span per sash from jamb to jamb; unusable counts are one sash, more than 6 is 6', () => {
    expect(sashSpans(10, 46)).toEqual([[10, 46]]);
    expect(sashSpans(0, 36, 2)).toEqual([
      [0, 17],
      [19, 36],
    ]);
    expect(sashSpans(0, 36, 0)).toEqual([[0, 36]]);
    expect(sashSpans(0, 36, Number.NaN)).toEqual([[0, 36]]);
    expect(sashSpans(0, 120, 9)).toHaveLength(6);
    // A narrow window keeps every sash wider than its mullions.
    const narrow = sashSpans(0, 6, 6);
    narrow.forEach(([a, b], i) => {
      expect(b - a).toBeGreaterThan(0.5);
      if (i > 0) expect(a - narrow[i - 1][1]).toBeLessThan(b - a);
    });
    expect(narrow[5][1]).toBe(6);
  });

  it('a screened window: one screen per sash in a 1" frame, no glass and no muntins', () => {
    const boxes = openingFill({ ...wide, j1: 44, glazing: 'screen', lites: { cols: 2, rows: 3 } });
    expect(count(boxes, 'glass')).toBe(0);
    expect(count(boxes, 'muntin')).toBe(0);
    const screens = boxes.filter((b) => b.kind === 'screen');
    expect(screens).toHaveLength(1);
    expect(screens[0].part).toBe('screen');
    expect(screens[0].s0).toBeCloseTo(1, 9);
    expect(width(screens[0])).toBeCloseTo(42, 9);
    expect(screens[0].y0).toBeCloseTo(31, 9);
    expect(screens[0].d0 + screens[0].d1).toBeCloseTo(0, 9);
    expect(boxes.filter((b) => b.kind === 'sashFrame').every((b) => Math.min(width(b), b.y1 - b.y0) === 1)).toBe(true);
    expect(count(openingFill({ ...wide, sashes: 3, glazing: 'screen' }), 'screen')).toBe(3);
  });

  it('a screen door: a 1.5" frame, a 4" mid rail at 36", screen above and below it, no panel', () => {
    const boxes = openingFill({ ...door, glazing: 'screen', lites: { cols: 3, rows: 3 }, halfLite: true });
    expect(count(boxes, 'panel')).toBe(0);
    expect(count(boxes, 'glass')).toBe(0);
    expect(count(boxes, 'muntin')).toBe(0);
    expect(count(boxes, 'doorFrame')).toBe(3);
    const frame = boxes.filter((b) => b.kind === 'leaf');
    expect(frame).toHaveLength(4);
    expect(frame.every((b) => Math.min(width(b), b.y1 - b.y0) === 1.5)).toBe(true);
    const rails = boxes.filter((b) => b.kind === 'midRail');
    expect(rails).toHaveLength(1);
    expect(rails[0].part).toBe('leaf');
    expect(rails[0].y1 - rails[0].y0).toBeCloseTo(4, 9);
    expect((rails[0].y0 + rails[0].y1) / 2).toBeCloseTo(36, 9);
    const screens = boxes.filter((b) => b.kind === 'screen').sort((p, q) => p.y0 - q.y0);
    expect(screens.map((b) => b.part)).toEqual(['screen', 'screen']);
    // Under the mid rail from the bottom rail; above it to the top rail (under the frame's 1.5" head).
    expect([screens[0].y0, screens[0].y1]).toEqual([1.5, 34]);
    expect([screens[1].y0, screens[1].y1]).toEqual([38, 77]);
    expect(screens.every((b) => b.s0 === 3 && b.s1 === 33)).toBe(true);
  });

  it('a half-lite door: the lite grid glazes the upper 55% of the panel area, two panels below either side of a 5" stile', () => {
    const boxes = openingFill({ ...door, halfLite: true, lites: { cols: 3, rows: 3 } });
    expect(count(boxes, 'glass')).toBe(1);
    expect(count(boxes, 'panel')).toBe(2);
    expect(count(boxes, 'muntin')).toBe(4);
    // Panel area: inside 5" stiles, a 5" top rail and an 8" bottom rail, under the 1.5" head: 8" to 73.5".
    const glass = boxes.find((b) => b.kind === 'glass')!;
    expect(glass.y1).toBeCloseTo(73.5, 9);
    expect(glass.y1 - glass.y0).toBeCloseTo(0.55 * 65.5, 9);
    const panels = boxes.filter((b) => b.kind === 'panel').sort(bySpan);
    for (const p of panels) {
      expect(p.y0).toBeCloseTo(8, 9);
      expect(p.y1).toBeLessThan(glass.y0);
      expect(p.part).toBe('leaf');
    }
    expect(panels[1].s0 - panels[0].s1).toBeCloseTo(5, 9);
    // A door's muntins are the leaf's (its colour); a window's are the sash's (white).
    expect(boxes.filter((b) => b.kind === 'muntin').every((b) => b.part === 'leaf')).toBe(true);
    expect(openingFill(wide).filter((b) => b.kind === 'muntin').every((b) => b.part === 'sash')).toBe(true);
    // A 1 x 1 grid still glazes the upper part: one pane, no muntins.
    const plain = openingFill({ ...door, halfLite: true });
    expect([count(plain, 'glass'), count(plain, 'muntin'), count(plain, 'panel')]).toEqual([1, 0, 2]);
  });

  it('a double door: two full leaves meeting at the centre, in one frame', () => {
    const wideDoor = { ...door, j1: 72 };
    const single = openingFill(wideDoor);
    const double = openingFill({ ...wideDoor, sashes: 2 });
    expect(count(single, 'leaf')).toBe(4);
    expect(count(double, 'leaf')).toBe(8);
    expect(count(double, 'panel')).toBe(2);
    expect(count(double, 'doorFrame')).toBe(3);
    // The stiles: two per leaf, the inner two meeting at the middle of the 69" between the jambs.
    const stiles = double.filter((b) => b.kind === 'leaf' && b.y0 === 0 && b.y1 === 78.5).sort(bySpan);
    expect(stiles.map((b) => [b.s0, b.s1])).toEqual([
      [1.5, 6.5],
      [31, 36],
      [36, 41],
      [65.5, 70.5],
    ]);
    // A glazed double door has a lite grid per leaf; more than two leaves is still a double door.
    expect(count(openingFill({ ...wideDoor, sashes: 2, lites: { cols: 1, rows: 3 } }), 'glass')).toBe(2);
    expect(count(openingFill({ ...wideDoor, sashes: 4 }), 'leaf')).toBe(8);
    // Double screen doors: a mid rail and two screens per leaf.
    const screens = openingFill({ ...wideDoor, sashes: 2, glazing: 'screen' });
    expect([count(screens, 'midRail'), count(screens, 'screen')]).toEqual([2, 4]);
  });

  it('a sliding door: two glazed panels framed like sashes, one per track, overlapping 2" at the middle', () => {
    const slider: FillInput = { ...door, j1: 72, sliding: true };
    const boxes = openingFill(slider);
    // The door frame, then each panel's four boards round one pane: no leaf and no panel.
    expect([count(boxes, 'doorFrame'), count(boxes, 'leaf'), count(boxes, 'panel'), count(boxes, 'sashFrame')]).toEqual([3, 0, 0, 8]);
    // Inside the 1.5" frame the panels run 1.5..37 and 35..70.5 with 2.5" stiles, the start one in
    // the outside track (d > 0), the other inside, each half the leaf's 1.75".
    const stiles = boxes.filter((b) => b.kind === 'sashFrame' && b.y1 - b.y0 > 70).sort(bySpan);
    expect(stiles.map((b) => [b.s0, b.s1, b.d0, b.d1])).toEqual([
      [1.5, 4, 0, 0.875],
      [34.5, 37, 0, 0.875],
      [35, 37.5, -0.875, 0],
      [68, 70.5, -0.875, 0],
    ]);
    // One pane each, between a 4" bottom rail and a 2.5" top rail under the frame's head.
    const glass = boxes.filter((b) => b.kind === 'glass').sort(bySpan);
    expect(glass.map((b) => [b.s0, b.s1, b.y0, b.y1])).toEqual([
      [4, 34.5, 4, 76],
      [37.5, 68, 4, 76],
    ]);
    expect([glass[0].d0 > 0, glass[1].d1 < 0]).toEqual([true, true]);
    // A lite grid per panel; its boards and muntins are the sash's (the window colour), each in its track.
    const grid = openingFill({ ...slider, lites: { cols: 2, rows: 4 } });
    expect(count(grid, 'muntin')).toBe(8);
    expect(grid.filter((b) => b.kind === 'muntin' || b.kind === 'sashFrame').every((b) => b.part === 'sash')).toBe(true);
    expect(grid.filter((b) => b.kind === 'muntin').every((b) => b.d0 >= 0 || b.d1 <= 0)).toBe(true);
    // Leaves and half lite do not apply; with a screen, a screen fills each panel.
    expect(openingFill({ ...slider, sashes: 2, halfLite: true })).toEqual(boxes);
    const screens = openingFill({ ...slider, glazing: 'screen' });
    expect([count(screens, 'screen'), count(screens, 'glass')]).toEqual([2, 0]);
  });

  it('whatever the options, every box has a positive size and the sashes, leaves and panes stay inside the hole', () => {
    for (const type of ['window', 'door'] as const) {
      for (const [j1, top] of [
        [144, 90],
        [20, 50],
        [6, 36],
      ]) {
        for (const sashes of [1, 2, 3, 6]) {
          for (const glazing of ['glass', 'screen'] as const) {
            for (const flag of [false, true]) {
              const input: FillInput = { type, j0: 0, j1, bottom: 30, top, thickness: 6.5, sashes, glazing, fixedCenter: flag, halfLite: flag, sliding: flag, shutters: flag, lites: { cols: 3, rows: 4 } };
              const boxes = openingFill(input);
              expect(boxes.length).toBeGreaterThan(5);
              for (const b of boxes) {
                expect(b.s1 - b.s0).toBeGreaterThan(0);
                expect(b.d1 - b.d0).toBeGreaterThan(0);
                expect(b.y1 - b.y0).toBeGreaterThan(0);
                if (b.part === 'trim' || b.part === 'shutter') continue;
                expect(b.s0).toBeGreaterThanOrEqual(-1e-9);
                expect(b.s1).toBeLessThanOrEqual(j1 + 1e-9);
                expect(b.y0).toBeGreaterThanOrEqual(30 - 1e-9);
                expect(b.y1).toBeLessThanOrEqual(top + 1e-9);
                expect(Math.max(-b.d0, b.d1)).toBeLessThanOrEqual(1.75 / 2 + 1e-9);
              }
            }
          }
        }
      }
    }
  });
});

describe('opening fill meshes', () => {
  /** A closed 240" square on First Floor, with the given openings on the wall along y = 0. */
  function house(openings: Partial<Opening>[]): { plan: Plan; first: string } {
    const plan = createEmptyPlan();
    const first = plan.levelOrder[1];
    const l = plan.levels[first];
    const nodes = { a: [0, 0], b: [240, 0], c: [240, 240], d: [0, 240] } as const;
    for (const [id, [x, y]] of Object.entries(nodes)) l.nodes[id] = { id, x, y };
    (['ab', 'bc', 'cd', 'da'] as const).forEach((pair, i) => {
      l.walls[`w${i}`] = { id: `w${i}`, a: pair[0], b: pair[1], thickness: 6.5, kind: 'exterior', phase: 'existing' };
    });
    openings.forEach((o, i) => {
      l.openings[`o${i}`] = win({ id: `o${i}`, wallId: 'w0', ...o });
    });
    return { plan, first };
  }

  it('a window gets trim, sash and glass; a door trim, sash and leaf; a passage nothing', () => {
    const { plan, first } = house([{ offset: 60 }, { type: 'door', offset: 120, height: 80, sill: 0 }, { type: 'passage', offset: 180, width: 48, height: 80, sill: 0 }]);
    const m = getLevelMeshes(plan, first, 'all');
    expect(m.openings.map((o) => o.type)).toEqual(['window', 'door']);
    expect(m.openings[0].parts.map((p) => p.part).sort()).toEqual(['glass', 'sash', 'trim']);
    expect(m.openings[1].parts.map((p) => p.part).sort()).toEqual(['leaf', 'sash', 'trim']);
    expect(getLevelMeshes(plan, first, 'all')).toBe(m);
  });

  it('puts trim, sill and shutters on the outside of the wall', () => {
    const { plan, first } = house([{ shutters: true }]);
    const parts = getLevelMeshes(plan, first, 'all').openings[0].parts;
    const trim = parts.find((p) => p.part === 'trim')!.geometry;
    // The wall along y = 0 has the room below it (y > 0): outside is y < 0, face at -3.25.
    const [z0, z1] = range(trim, 'position', 2);
    expect(z1).toBeCloseTo(-3.25, 5);
    expect(z0).toBeCloseTo(-5.25, 5);
    // The shutter boards are 1" thick on the face, their battens 0.75" proud of them.
    const [sz0, sz1] = range(parts.find((p) => p.part === 'shutter')!.geometry, 'position', 2);
    expect(sz1).toBeCloseTo(-3.25, 5);
    expect(sz0).toBeCloseTo(-5, 5);
    // The glass is mid-wall.
    const [gz0, gz1] = range(parts.find((p) => p.part === 'glass')!.geometry, 'position', 2);
    expect((gz0 + gz1) / 2).toBeCloseTo(0, 5);
    expect(gz1 - gz0).toBeCloseTo(0.25, 5);
  });

  it('reuses an opening fill until the opening, its wall or the wall height changes', () => {
    const { plan, first } = house([{}, { offset: 180 }]);
    const m1 = getLevelMeshes(plan, first, 'all');
    const next = produce(plan, (d) => {
      d.levels[first].openings.o1.shutters = true;
    });
    const m2 = getLevelMeshes(next, first, 'all');
    expect(m2.openings[0].parts[0].geometry).toBe(m1.openings[0].parts[0].geometry);
    expect(m2.openings[1].parts.some((p) => p.part === 'shutter')).toBe(true);
    expect(m2.openings[1].parts[0].geometry).not.toBe(m1.openings[1].parts[0].geometry);
  });

  it('hides the fill of an opening the view mode hides', () => {
    const { plan, first } = house([{ phase: 'new' }]);
    expect(getLevelMeshes(plan, first, 'existing').openings).toHaveLength(0);
    expect(getLevelMeshes(plan, first, 'proposed').openings).toHaveLength(1);
  });

  it('a screened window has a screen part and no glass; a door reports its leaf colour; the parts carry UVs in inches', () => {
    const { plan, first } = house([{ glazing: 'screen', sashes: 2 }, { type: 'door', offset: 180, height: 80, sill: 0, leafColor: '#2f4a3a' }]);
    const m = getLevelMeshes(plan, first, 'all');
    expect(m.openings[0].parts.map((p) => p.part).sort()).toEqual(['sash', 'screen', 'trim']);
    expect(m.openings[0].leafColor).toBe(DEFAULT_LEAF_COLOR);
    expect(m.openings[1].leafColor).toBe('#2f4a3a');
    // The wall runs along +x from its start at x = 0: on faces along the wall u is x and v the height.
    const screen = m.openings[0].parts.find((p) => p.part === 'screen')!.geometry;
    const pos = screen.getAttribute('position');
    const nor = screen.getAttribute('normal');
    const uv = screen.getAttribute('uv');
    expect(uv.count).toBe(pos.count);
    let along = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getZ(i)) < 0.99) continue;
      along++;
      expect(uv.getX(i)).toBeCloseTo(pos.getX(i), 5);
      expect(uv.getY(i)).toBeCloseTo(pos.getY(i), 5);
    }
    expect(along).toBe(2 * 2 * 6); // two panes, front and back, two triangles each
    for (const o of m.openings) for (const p of o.parts) expect(p.geometry.getAttribute('uv')).toBeDefined();
  });
});

describe('opening materials', () => {
  it('a leaf, trim or sash colour keys its own material; the shutters keep theirs', () => {
    const def = openingMaterial('leaf', 'existing');
    expect(def.color.getHexString()).toBe(DEFAULT_LEAF_COLOR.slice(1));
    expect(openingMaterial('leaf', 'existing', DEFAULT_LEAF_COLOR)).toBe(def);
    const green = openingMaterial('leaf', 'existing', '#2f4a3a');
    expect(green).not.toBe(def);
    expect(green.color.getHexString()).toBe('2f4a3a');
    expect(openingMaterial('leaf', 'existing', '#2f4a3a')).toBe(green);
    expect(openingMaterial('leaf', 'new', '#2f4a3a')).not.toBe(green);
    // The proposed look's black sashes and red trim (types.ts ProposedLook) key their own too.
    expect(openingMaterial('sash', 'existing', '#1c1c1c').color.getHexString()).toBe('1c1c1c');
    expect(openingMaterial('trim', 'existing', '#a8322d').color.getHexString()).toBe('a8322d');
    expect(openingMaterial('sash', 'existing', '#1c1c1c')).not.toBe(openingMaterial('sash', 'existing'));
    expect(openingMaterial('shutter', 'existing', '#2f4a3a')).toBe(openingMaterial('shutter', 'existing'));
    expect(openingMaterial('leaf', 'demo', '#2f4a3a').color.getHexString()).toBe('e0413a');
  });

  it('a screen is see-through and drawn without depth writes; one face of its box shows from either side', () => {
    const screen = openingMaterial('screen', 'existing');
    expect(screen).toBe(openingMaterial('screen', 'existing', '#2f4a3a'));
    expect(screen.transparent).toBe(true);
    expect(screen.depthWrite).toBe(false);
    expect(screen.opacity).toBeLessThan(1);
    expect(screen.side).toBe(FrontSide);
    // No canvas in node: the flat grey without the mesh texture.
    expect(screen.map).toBeNull();
    expect(screen.color.getHexString()).toBe('4a4d4c');
    expect(openingMaterial('screen', 'new').color.getHexString()).toBe(newWorkColor('#4a4d4c').slice(1));
    expect(openingMaterial('screen', 'demo').color.getHexString()).toBe('e0413a');
  });
});

describe('wall finish and colour', () => {
  it('defaults: exterior shingle red-brown, interior plain off-white', () => {
    const ext: Wall = { id: 'e', a: 'a', b: 'b', thickness: 6.5, kind: 'exterior', phase: 'existing' };
    const int: Wall = { ...ext, id: 'i', kind: 'interior' };
    expect(wallFinishOf(ext)).toBe('shingle');
    expect(wallColorOf(ext)).toBe(DEFAULT_EXTERIOR_COLOR);
    expect(DEFAULT_EXTERIOR_COLOR).toBe('#5a3a35');
    expect(wallFinishOf(int)).toBe('plain');
    expect(wallColorOf(int)).toBe(DEFAULT_INTERIOR_COLOR);
    expect(wallFinishOf({ ...ext, finish: 'clapboard' })).toBe('clapboard');
    expect(roofColorOf({ finish: 'metal' })).toBe('#6e6259');
    expect(roofColorOf({ finish: 'shingle' })).toBe('#4a4a4a');
    expect(roofColorOf({ finish: 'metal', color: '#112233' })).toBe('#112233');
  });

  it('updateWalls sets the finish and colour of every named wall in one undo step, and clears them', () => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    const first = store().plan.levelOrder[1];
    const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;
    store().addWall(first, { x: 0, y: 0 }, { x: 240, y: 0 }, ext);
    store().addWall(first, { x: 240, y: 0 }, { x: 240, y: 240 }, ext);
    const ids = Object.keys(store().plan.levels[first].walls);
    const before = store().plan;
    store().updateWalls(first, ids, { finish: 'clapboard', color: '#336699' });
    for (const id of ids) expect(store().plan.levels[first].walls[id]).toMatchObject({ finish: 'clapboard', color: '#336699' });
    usePlanStore.temporal.getState().undo();
    expect(store().plan).toBe(before);
    store().updateWalls(first, ids, { finish: 'board' });
    store().updateWalls(first, ids, { finish: undefined, color: undefined });
    for (const id of ids) {
      expect('finish' in store().plan.levels[first].walls[id]).toBe(false);
      expect('color' in store().plan.levels[first].walls[id]).toBe(false);
    }
  });

  it('a split wall keeps the finish and colour', () => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    const first = store().plan.levelOrder[1];
    store().addWall(first, { x: 0, y: 0 }, { x: 240, y: 0 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    const id = Object.keys(store().plan.levels[first].walls)[0];
    store().updateWalls(first, [id], { finish: 'clapboard', color: '#336699' });
    store().addWall(first, { x: 120, y: 0 }, { x: 120, y: 120 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    const walls = Object.values(store().plan.levels[first].walls).filter((w) => w.kind === 'exterior');
    expect(walls).toHaveLength(2);
    for (const w of walls) expect(w).toMatchObject({ finish: 'clapboard', color: '#336699' });
  });

  it('getLevelMeshes reports the resolved finish and colour', () => {
    const plan = createEmptyPlan();
    const first = plan.levelOrder[1];
    const l = plan.levels[first];
    l.nodes.p = { id: 'p', x: 0, y: 0 };
    l.nodes.q = { id: 'q', x: 240, y: 0 };
    l.walls.w = { id: 'w', a: 'p', b: 'q', thickness: 6.5, kind: 'exterior', phase: 'existing', finish: 'board' };
    expect(getLevelMeshes(plan, first, 'all').walls[0]).toMatchObject({ finish: 'board', color: '#5a3a35' });
  });

  it('concrete block is a finish of its own, labelled for the panel, with the colour as its flat colour', () => {
    expect(WALL_FINISHES).toContain('block');
    expect(WALL_FINISH_LABEL.block).toBe('Concrete block');
    expect(new Set(WALL_FINISHES).size).toBe(Object.keys(WALL_FINISH_LABEL).length);
    expect(wallFlatColor('existing', 'block', '#8f8a84')).toBe('#8f8a84');
    expect(wallFlatColor('new', 'block', '#8f8a84')).toBe(newWorkColor('#8f8a84'));
    const m = wallMaterial('existing', 'exterior', 'block', '#8f8a84');
    expect(m).not.toBe(wallMaterial('existing', 'exterior', 'shingle', '#8f8a84'));
    expect(m.color.getHexString()).toBe('8f8a84');
  });

  it('materials are shared per phase, finish and colour; demolished walls stay translucent red', () => {
    expect(wallMaterial('existing', 'exterior', 'clapboard', '#112233')).toBe(wallMaterial('existing', 'exterior', 'clapboard', '#112233'));
    expect(wallMaterial('existing', 'exterior', 'clapboard', '#112233')).not.toBe(wallMaterial('existing', 'exterior', 'board', '#112233'));
    const demo = wallMaterial('demo', 'exterior', 'clapboard', '#112233');
    expect(demo.transparent).toBe(true);
    expect(demo.color.getHexString()).toBe('e0413a');
    // No canvas in node: textures are skipped and the flat colour shows.
    const flat = wallMaterial('existing', 'exterior', 'shingle', '#5a3a35');
    expect(flat.map).toBeNull();
    expect(flat.color.getHexString()).toBe('5a3a35');
    const screen = wallMaterial('existing', 'exterior', 'screen', '#5a3a35');
    expect(screen.transparent).toBe(true);
    expect(screen.opacity).toBeCloseTo(0.4, 9);
  });
});

describe('migrate: optional appearance fields', () => {
  function file(wall: object, opening: object = {}, roof: object = {}): unknown {
    const plan = createEmptyPlan('Fin');
    const first = plan.levelOrder[1];
    const l = plan.levels[first];
    l.nodes.p = { id: 'p', x: 0, y: 0 };
    l.nodes.q = { id: 'q', x: 240, y: 0 };
    l.walls.w = { id: 'w', a: 'p', b: 'q', thickness: 6.5, kind: 'exterior', phase: 'existing', ...wall } as Wall;
    l.openings.o = { id: 'o', wallId: 'w', type: 'window', offset: 120, width: 36, height: 48, sill: 36, phase: 'existing', ...opening } as Opening;
    l.roofs.r = {
      id: 'r',
      shape: 'gable',
      outline: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 100 }, { x: 0, y: 100 }],
      ridgeAngle: 0,
      pitch: 8,
      overhang: 24,
      bearingOffset: 0,
      thickness: 8,
      fascia: 6,
      phase: 'existing',
      finish: 'metal',
      ...roof,
    };
    return JSON.parse(JSON.stringify(plan));
  }
  const readBack = (f: unknown) => {
    const plan = migrate(f);
    const l = plan.levels[plan.levelOrder[1]];
    return { wall: l.walls.w, opening: l.openings.o, roof: l.roofs.r };
  };

  it('accepts valid finish, colour, lites, shutters, trim and roof colour', () => {
    const f = file({ finish: 'clapboard', color: '#5a3a35' }, { lites: { cols: 3, rows: 2 }, shutters: true, trim: 5 }, { color: '#6e6259' });
    const { wall, opening, roof } = readBack(f);
    expect(wall).toMatchObject({ finish: 'clapboard', color: '#5a3a35' });
    expect(opening).toMatchObject({ lites: { cols: 3, rows: 2 }, shutters: true, trim: 5 });
    expect(roof.color).toBe('#6e6259');
    // And a file with them round-trips byte for byte.
    const text = JSON.stringify(migrate(f));
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
  });

  it('drops an unknown finish and malformed colours, lites, shutters and trim', () => {
    const { wall, opening, roof } = readBack(
      file({ finish: 'stucco', color: 'red' }, { lites: { cols: 0, rows: 2.5 }, shutters: 'yes', trim: -3 }, { color: '#12345' }),
    );
    expect('finish' in wall).toBe(false);
    expect('color' in wall).toBe(false);
    expect('lites' in opening).toBe(false);
    expect('shutters' in opening).toBe(false);
    expect('trim' in opening).toBe(false);
    expect('color' in roof).toBe(false);
  });

  it('accepts the block finish and the sash, glazing and door fields; lower-cases the leaf colour', () => {
    const { wall, opening } = readBack(file({ finish: 'block', color: '#8f8a84' }, { sashes: 3, fixedCenter: true, glazing: 'screen', halfLite: false, leafColor: '#2F4A3A' }));
    expect(wall.finish).toBe('block');
    expect(opening).toMatchObject({ sashes: 3, fixedCenter: true, glazing: 'screen', halfLite: false, leafColor: '#2f4a3a' });
    const door = readBack(file({}, { type: 'door', sill: 0, height: 80, sashes: 2, glazing: 'glass', halfLite: true })).opening;
    expect(door).toMatchObject({ sashes: 2, glazing: 'glass', halfLite: true });
    expect(readBack(file({}, { type: 'door', sill: 0, height: 80, sliding: true })).opening.sliding).toBe(true);
    for (const sashes of [1, 6]) expect(readBack(file({}, { sashes })).opening.sashes).toBe(sashes);
  });

  it('drops malformed sashes, fixed centre, glazing, half lite and leaf colour', () => {
    for (const sashes of [0, 7, 2.5, -1, '3', null, true]) expect('sashes' in readBack(file({}, { sashes })).opening).toBe(false);
    const { opening } = readBack(file({}, { fixedCenter: 'yes', glazing: 'mesh', halfLite: 1, sliding: 'yes', leafColor: 'green' }));
    for (const k of ['fixedCenter', 'glazing', 'halfLite', 'sliding', 'leafColor']) expect(k in opening).toBe(false);
    expect('glazing' in readBack(file({}, { glazing: 'Screen' })).opening).toBe(false);
    expect('leafColor' in readBack(file({}, { leafColor: '#2f4a3' })).opening).toBe(false);
    expect('finish' in readBack(file({ finish: 'cinder block' })).wall).toBe(false);
  });

  it('a file with every new field round-trips byte for byte', () => {
    const extra = { sashes: 3, fixedCenter: true, glazing: 'screen', halfLite: true, sliding: true, leafColor: '#2f4a3a', lites: { cols: 2, rows: 3 }, shutters: true, trim: 4 };
    const f = file({ finish: 'block', color: '#8f8a84' }, extra);
    const text = JSON.stringify(f, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
    // The new keys keep their place in the file's order.
    expect(Object.keys(readBack(f).opening).slice(-9)).toEqual(Object.keys(extra));
    const once = JSON.stringify(migrate(file({}, { leafColor: '#2F4A3A', sashes: 2 })));
    expect(JSON.stringify(migrate(JSON.parse(once)))).toBe(once);
  });

  it('updateOpening sets the new fields and removes them when given undefined', () => {
    const first = store().plan.levelOrder[1];
    store().addWall(first, { x: 0, y: 0 }, { x: 240, y: 0 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    const wallId = Object.keys(store().plan.levels[first].walls)[0];
    const id = store().addOpening(first, { wallId, type: 'window', offset: 120, width: 72, height: 48, sill: 36, phase: 'existing' })!;
    const keys = ['sashes', 'fixedCenter', 'glazing', 'halfLite', 'sliding', 'leafColor'] as const;
    store().updateOpening(first, id, { sashes: 3, fixedCenter: true, glazing: 'screen', halfLite: true, sliding: true, leafColor: '#2f4a3a' });
    const o = () => store().plan.levels[first].openings[id];
    expect(o()).toMatchObject({ sashes: 3, fixedCenter: true, glazing: 'screen', halfLite: true, sliding: true, leafColor: '#2f4a3a' });
    store().updateOpening(first, id, { sashes: undefined, fixedCenter: undefined, glazing: undefined, halfLite: undefined, sliding: undefined, leafColor: undefined });
    for (const k of keys) expect(k in o()).toBe(false);
    expect(o()).toMatchObject({ width: 72, height: 48, sill: 36 });
  });

  it('a file without the fields loads without them and without a version bump', () => {
    const { wall, opening, roof } = readBack(file({}));
    expect(Object.keys(wall)).not.toContain('finish');
    expect(Object.keys(opening)).not.toContain('lites');
    expect(Object.keys(roof)).not.toContain('color');
    expect(migrate(file({})).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('lower-cases a colour; normalizeHex reads #rgb and bare hex', () => {
    expect(readBack(file({ color: '#5A3A35' })).wall.color).toBe('#5a3a35');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('5a3a35')).toBe('#5a3a35');
    expect(normalizeHex('zzz')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
  });
});

describe('siding texture layout', () => {
  it('48" at 6" courses: 8 courses, 9 boundaries from 0 to 48', () => {
    const b = courseBoundaries(48, 6);
    expect(b).toHaveLength(9);
    expect(b[0]).toBe(0);
    expect(b[8]).toBe(48);
    expect(b.slice(1).map((v, i) => v - b[i])).toEqual(Array(8).fill(6));
    // 8" boards: 6 per tile. 4.8" shingle courses: 10 per tile.
    expect(courseBoundaries(48, 8)).toHaveLength(7);
    expect(courseBoundaries(48, 4.8)).toHaveLength(11);
  });

  it('shingle joints: widths of 4" to 8" that sum to the tile, staggered from course to course', () => {
    const all: number[][] = [];
    for (let c = 0; c < 10; c++) {
      const j = shingleJoints(c);
      all.push(j);
      expect(j[0]).toBeGreaterThanOrEqual(0);
      expect(j[j.length - 1]).toBeLessThan(TILE_INCHES);
      const widths = j.map((x, i) => (i + 1 < j.length ? j[i + 1] : TILE_INCHES + j[0]) - x);
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(TILE_INCHES, 9);
      for (const w of widths) {
        expect(w).toBeGreaterThanOrEqual(4 - 1e-9);
        expect(w).toBeLessThanOrEqual(8 + 1e-9);
      }
    }
    expect(new Set(all.map((j) => j.map((x) => x.toFixed(2)).join(','))).size).toBe(10);
    // Deterministic.
    expect(shingleJoints(3)).toEqual(shingleJoints(3));
  });

  it('brightness varies a few percent either way; the generator is repeatable', () => {
    const r = seeded(11);
    const vals = Array.from({ length: 50 }, () => brightness(r));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.94);
    expect(Math.max(...vals)).toBeLessThan(1.06 + 1e-9);
    expect(seeded(5)()).toBe(seeded(5)());
  });

  it('is skipped without a DOM canvas (node) and for plain walls', () => {
    expect(typeof document).toBe('undefined');
    expect(sidingTexture('clapboard', '#5a3a35')).toBeNull();
    expect(sidingTexture('plain', '#e8e4dc')).toBeNull();
    expect(sidingTextures('block', '#8f8a84')).toBeNull();
  });

  it('the tile: 512 px for 48" (a texel is 3/32"), clapboard at 8" courses, 6 per tile', () => {
    expect(TEXTURE_PX).toBe(512);
    expect(1 / PX_PER_INCH).toBeCloseTo(3 / 32, 12);
    expect(CLAPBOARD_COURSE).toBe(8);
    expect(courseBoundaries(TILE_INCHES, CLAPBOARD_COURSE)).toEqual([0, 8, 16, 24, 32, 40, 48]);
  });

  it('shingle courses: the staggered joints of each course, a few percent of brightness and warmth per shingle', () => {
    const courses = shingleCourses();
    expect(courses).toHaveLength(10);
    courses.forEach((c, k) => {
      expect(c.y1 - c.y0).toBeCloseTo(4.8, 9);
      expect(c.shingles.reduce((t, s) => t + s.x1 - s.x0, 0)).toBeCloseTo(TILE_INCHES, 9);
      for (const s of c.shingles) {
        expect(s.shade).toBeGreaterThanOrEqual(0.94);
        expect(s.shade).toBeLessThan(1.06);
        expect(Math.abs(s.warmth)).toBeLessThanOrEqual(1);
        expect(s.lift).toBeGreaterThanOrEqual(0);
      }
      if (k > 0) expect(c.shingles[0].x0).not.toBeCloseTo(courses[k - 1].shingles[0].x0, 3);
    });
    expect(shingleCourses()).toEqual(courses);
  });

  it('block: 18 blocks a tile, 15 5/8" x 7 5/8" faces in running bond', () => {
    const faces = blockFaces();
    expect(faces).toHaveLength(18);
    for (const f of faces) {
      expect(f.x1 - f.x0).toBeCloseTo(15.625, 9);
      expect(f.y1 - f.y0).toBeCloseTo(7.625, 9);
    }
    const starts = (k: number) =>
      faces
        .filter((f) => Math.abs(f.y0 - (8 * k + 0.1875)) < 1e-9)
        .map((f) => f.x0 - 0.1875)
        .sort((p, q) => p - q);
    expect(starts(0)).toEqual([0, 16, 32]);
    expect(starts(1)).toEqual([8, 24, 40]);
    expect(starts(5)).toEqual([8, 24, 40]);
  });

  it('height fields: a lap step at every clapboard course, V-grooves between boards, mortar recessed between blocks', () => {
    expect(sidingHeight('plain')).toBeNull();
    expect(sidingHeight('screen')).toBeNull();
    const clap = sidingHeight('clapboard')!;
    expect(clap).toHaveLength(TEXTURE_PX * TEXTURE_PX);
    // Up a column the height falls through each board and jumps back by the lap at each course line
    // (the row above it is a butt, the row below the thin top of the board underneath).
    const at = (f: Float32Array, row: number, col = 100) => f[((row + TEXTURE_PX) % TEXTURE_PX) * TEXTURE_PX + col];
    const laps: number[] = [];
    for (let row = 0; row < TEXTURE_PX; row++) if (at(clap, row) - at(clap, row + 1) > 0.9 * RELIEF.lap) laps.push(row);
    expect(laps).toEqual([0, 8, 16, 24, 32, 40].map((y) => TEXTURE_PX - Math.round((y + 8) * PX_PER_INCH) - 1).map((r) => (r + TEXTURE_PX) % TEXTURE_PX).sort((p, q) => p - q));
    // The same in every column: the courses run level.
    expect(at(clap, 200, 0)).toBe(at(clap, 200, 511));
    // Six grooves across a row of the board tile (a run of recessed pixels each), RELIEF.groove deep at most.
    const board = sidingHeight('board')!;
    const row = Array.from({ length: TEXTURE_PX }, (_, c) => board[c]);
    expect(row.filter((h, c) => h < 0 && !(row[(c + TEXTURE_PX - 1) % TEXTURE_PX] < 0))).toHaveLength(6);
    expect(Math.min(...row)).toBeGreaterThanOrEqual(-RELIEF.groove - 1e-6); // stored as 32-bit floats
    expect(Math.min(...row)).toBeLessThan(-RELIEF.groove / 2);
    const block = sidingHeight('block')!;
    const mortar = block.filter((h) => h === -RELIEF.mortar).length / block.length;
    expect(mortar).toBeCloseTo(1 - (18 * 15.625 * 7.625) / (48 * 48), 2);
    const shingle = sidingHeight('shingle')!;
    expect(shingle.reduce((m, h) => Math.min(m, h), 0)).toBeLessThan(0); // keyways
    expect(shingle.reduce((m, h) => Math.max(m, h), 0)).toBeGreaterThan(RELIEF.butt); // a butt standing proud
  });

  it('normal maps: on a one-step height field a step down the canvas faces down (G below 128), sampling wraps round the tile', () => {
    const size = 8;
    const h = new Float32Array(size * size);
    for (let y = 0; y < 4; y++) for (let x = 0; x < size; x++) h[y * size + x] = 1; // the upper half is raised
    const px = normalFromHeight(h, size, 2);
    const at = (x: number, y: number) => Array.from(px.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
    for (let x = 0; x < size; x++) {
      // Flat rows: straight out.
      for (const y of [1, 2, 5, 6]) expect(at(x, y)).toEqual([128, 128, 255, 255]);
      // The step: higher above, lower below, so the face looks down: G < 128 (dh/dy = -0.5, n = (0, -1, 1) / sqrt 2).
      for (const y of [3, 4]) expect(at(x, y)).toEqual([128, 37, 218, 255]);
      // The tile's seam: its bottom row is low and its top row high, so the step there faces up.
      for (const y of [7, 0]) expect(at(x, y)).toEqual([128, 218, 218, 255]);
    }
    // Across x: the left half raised, so the step faces right (R above 128).
    const v = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < 4; x++) v[y * size + x] = 1;
    const vx = normalFromHeight(v, size, 2);
    expect(vx[(2 * size + 3) * 4]).toBeGreaterThan(128);
    expect(vx[(2 * size + 3) * 4 + 1]).toBe(128);
    expect(vx[(2 * size + 0) * 4]).toBeLessThan(128);
  });

  it("clapboard's normal map: each board's face tilts up a little, each lap faces down", () => {
    const n = normalFromHeight(sidingHeight('clapboard')!, TEXTURE_PX, PX_PER_INCH);
    const g = (row: number) => n[(row * TEXTURE_PX + 50) * 4 + 1];
    const lap = TEXTURE_PX - Math.round(8 * PX_PER_INCH); // the first row under the lap at 8"
    expect(g(lap)).toBeLessThan(64);
    expect(g(lap - 1)).toBeLessThan(64);
    expect(g(lap + 40)).toBeGreaterThan(128);
    expect(g(lap + 40)).toBeLessThan(150);
  });
});

describe('new-work walls are washed green, not darkened (REVIEW-2 C4)', () => {
  it('blendPixels moves each channel halfway to the green and keeps alpha', () => {
    const px = [90, 58, 53, 255, 0, 0, 0, 128, 255, 255, 255, 0];
    blendPixels(px, hexToRgb(NEW_WORK_GREEN), 0.5);
    // #a9dcb7 is (169, 220, 183): the stain (90, 58, 53) lands halfway.
    expect(px.slice(0, 4)).toEqual([130, 139, 118, 255]);
    expect(px.slice(4, 8)).toEqual([85, 110, 92, 128]);
    expect(px.slice(8, 12)).toEqual([212, 238, 219, 0]);
    // t = 0 changes nothing, t = 1 is the green.
    const q = [10, 20, 30, 40];
    blendPixels(q, [200, 100, 0], 0);
    expect(q).toEqual([10, 20, 30, 40]);
    blendPixels(q, [200, 100, 0], 1);
    expect(q).toEqual([200, 100, 0, 40]);
    // Clamped arrays (canvas ImageData) round the same way.
    const c = new Uint8ClampedArray([90, 58, 53, 255]);
    blendPixels(c, hexToRgb(NEW_WORK_GREEN), 0.5);
    expect([...c]).toEqual([130, 139, 118, 255]);
  });

  it('the flat colour of a new textured wall is the same blend; it is lighter than the stain', () => {
    expect(newWorkColor('#5a3a35')).toBe('#828b76');
    expect(wallFlatColor('new', 'shingle', '#5a3a35')).toBe('#828b76');
    expect(wallFlatColor('existing', 'shingle', '#5a3a35')).toBe('#5a3a35');
    expect(wallFlatColor('demo', 'shingle', '#5a3a35')).toBe('#e0413a');
    const lum = (hex: string) => hexToRgb(hex).reduce((t, v) => t + v, 0);
    expect(lum(wallFlatColor('new', 'shingle', '#5a3a35'))).toBeGreaterThan(lum('#5a3a35'));
  });

  it("a new wall's material is untinted (white) over its texture, or the blended colour without one", () => {
    const m = wallMaterial('new', 'exterior', 'clapboard', '#5a3a35');
    // No canvas in node, so the flat blended colour; with a canvas the map carries the blend and the tint is white.
    expect(m.color.getHexString()).toBe('828b76');
    expect(wallMaterial('demo', 'exterior', 'clapboard', '#5a3a35').opacity).toBeCloseTo(0.35, 9);
  });
});
