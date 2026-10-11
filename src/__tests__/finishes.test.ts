import { produce } from 'immer';
import type { BufferGeometry } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeFootprints } from '../derive/footprint';
import { buildWallGeometry, clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { muntinCounts, openingFill, type FillInput } from '../derive/openings3d';
import { DEFAULT_EXTERIOR_COLOR, DEFAULT_INTERIOR_COLOR, normalizeHex, roofColorOf, wallColorOf, wallFinishOf } from '../model/finish';
import { createEmptyPlan, createLevel, migrate } from '../model/plan';
import type { Level, Opening, Plan, Wall } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { brightness, courseBoundaries, seeded, shingleJoints, sidingTexture, TILE_INCHES } from '../view3d/textures';
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

  it('shutters add two boards, each a third of the window width, flanking the trim', () => {
    const plain = openingFill(base);
    const shut = openingFill({ ...base, shutters: true });
    expect(shut.length - plain.length).toBe(2);
    const boards = shut.filter((b) => b.part === 'shutter');
    expect(boards).toHaveLength(2);
    for (const b of boards) {
      expect(b.s1 - b.s0).toBeCloseTo(12, 9);
      expect(b.d1 - b.d0).toBeCloseTo(1, 9);
    }
    expect(boards[0].s1).toBeCloseTo(100 - 4, 9);
    expect(boards[1].s0).toBeCloseTo(136 + 4, 9);
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
    const [sz0, sz1] = range(parts.find((p) => p.part === 'shutter')!.geometry, 'position', 2);
    expect(sz1).toBeCloseTo(-3.25, 5);
    expect(sz0).toBeCloseTo(-4.25, 5);
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

  it('a file without the fields loads without them and without a version bump', () => {
    const { wall, opening, roof } = readBack(file({}));
    expect(Object.keys(wall)).not.toContain('finish');
    expect(Object.keys(opening)).not.toContain('lites');
    expect(Object.keys(roof)).not.toContain('color');
    expect(migrate(file({})).schemaVersion).toBe(2);
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
  });
});
