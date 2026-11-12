import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { backsplashPieces } from '../derive/backsplash';
import { cornerOutline, counterRects, counterRuns, fixtureBoxes, fixtureSymbol, type CaseBox } from '../derive/casework';
import { getFootprints } from '../derive/footprint';
import { buildCounterGeometry, buildFixtureParts, clearMeshCache, getLevelMeshes, triangleCount } from '../derive/meshes';
import { abutLinesOf, cornerSnap, type FaceHit } from '../editor2d/tools/fixtureTool';
import { BUTCHER_BLOCK_COLOR, COUNTER_THICKNESS, counterSpecOf, DEFAULT_COUNTER_COLOR, FIXTURE_DEFAULTS, HANDLE } from '../model/casework';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, fixtureProblem, migrate } from '../model/plan';
import type { Fixture, Id } from '../model/types';
import { stonePixels, subwayPixels, woodPixels } from '../view3d/proceduralTextures';
import { clearHistory, usePlanStore } from '../store/planStore';

// The kitchen's corner units, backsplashes, counter materials, pulls, drawer banks and open shelves
// (DESIGN.md "Casework").

const store = () => usePlanStore.getState();

const fixture = (kind: Fixture['kind'], over: Partial<Fixture> = {}): Fixture => ({
  id: over.id ?? `f-${kind}`,
  kind,
  origin: { x: 0, y: 0 },
  direction: 90,
  ...FIXTURE_DEFAULTS[kind],
  phase: 'existing',
  ...over,
});

const area = (ring: { x: number; y: number }[]) => Math.abs(polygonSignedArea(ring));
const of = (boxes: CaseBox[], part: CaseBox['part']) => boxes.filter((b) => b.part === part);

// A room 240 x 180 on centrelines, walls 4.5" thick: the north wall's inside face is y 2.25, the
// west wall's x 2.25. An L-shaped kitchen in its north-west corner: a corner base in the corner, a
// 36" base east of it on the north wall, a 36" base south of it on the west wall.
const F = 2.25;
const NORTH = 90; // fronts face +y
const WEST = 0; // fronts face +x
const cornerUnit = (over: Partial<Fixture> = {}) => fixture('cornerBase', { id: 'a-corner', origin: { x: F + 18, y: F }, direction: NORTH, corner: 'right', ...over });
const northBase = (over: Partial<Fixture> = {}) => fixture('base', { id: 'b-north', origin: { x: F + 36 + 18, y: F }, direction: NORTH, ...over });
const westBase = (over: Partial<Fixture> = {}) => fixture('base', { id: 'c-west', origin: { x: F, y: F + 36 + 18 }, direction: WEST, ...over });

describe('corner units', () => {
  it('an L-shaped base corner: 36" each way, legs 24" deep, its carcass and doors inside the L', () => {
    const f = cornerUnit();
    expect(FIXTURE_DEFAULTS.cornerBase).toMatchObject({ width: 36, depth: 36 });
    expect(FIXTURE_DEFAULTS.cornerWall).toMatchObject({ width: 24, depth: 24, elevation: 54 });
    const ring = cornerOutline(f);
    expect(ring).toHaveLength(6);
    expect(area(ring)).toBeCloseTo(36 * 36 - 12 * 12, 6);
    // In its own frame every box lies in the L: the back leg (d <= 24) or the side leg (the corner end's 24").
    const boxes = fixtureBoxes(fixture('cornerBase'));
    for (const b of boxes) {
      const inBack = b.d1 <= 24 + 1e-9;
      const inSide = b.s1 <= -18 + 24 + 1e-9;
      expect(inBack || inSide).toBe(true);
      expect(b.s0).toBeGreaterThanOrEqual(-18 - 1e-9);
      expect(b.s1).toBeLessThanOrEqual(18 + 1e-9);
      expect(b.d1).toBeLessThanOrEqual(36 + 1e-9);
    }
    // Two doors (one on each inner face), a toe kick under each leg.
    expect(of(boxes, 'front')).toHaveLength(2);
    expect(of(boxes, 'kick')).toHaveLength(2);
    // A right-hand one is the mirror image.
    const right = fixtureBoxes(fixture('cornerBase', { corner: 'right' }));
    expect(right.map((b) => -b.s1).sort()).toEqual(boxes.map((b) => b.s0).sort());
  });

  it('draws an L with its two inner faces as fronts, the wall corner dashed', () => {
    const sym = fixtureSymbol(cornerUnit());
    expect(sym.outline).toHaveLength(6);
    expect(sym.fronts).toHaveLength(2);
    expect(sym.dashed).toBe(false);
    expect(fixtureSymbol(fixture('cornerWall')).dashed).toBe(true);
  });

  it('the counter runs through the corner unit as one top, with no double or missing piece', () => {
    const runs = counterRuns([cornerUnit(), northBase(), westBase()]);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.fixtureIds).toEqual(['a-corner', 'b-north', 'c-west']);
    expect(run.holes).toEqual([]);
    expect(run.outline).toHaveLength(6);
    // 72" along each wall, 25" deep (1" front overhang): 72 x 25 + 25 x 47.
    expect(area(run.outline)).toBeCloseTo(72 * 25 + 25 * 47, 6);
    // The corner unit's two legs meet and do not overlap: their areas add up to its counter's.
    const [back, side] = counterRects(cornerUnit());
    expect(area(back) + area(side)).toBeCloseTo(36 * 25 + 25 * 11, 6);
    // Alone it is one L-shaped top too.
    const alone = counterRuns([cornerUnit()]);
    expect(alone).toHaveLength(1);
    expect(alone[0].outline).toHaveLength(6);
    expect(run.y1 - run.y0).toBe(COUNTER_THICKNESS);
  });

  it('the run on the other wall abuts its front end, and the tool pushes it into a corner', () => {
    const lines = abutLinesOf(cornerUnit());
    expect(lines).toHaveLength(2);
    // Its end on the west wall: facing +x, 36" long, centred 18" down the wall from the corner.
    expect(lines[1].direction).toBeCloseTo(WEST, 6);
    expect(lines[1].width).toBe(36);
    expect(lines[1].origin.x).toBeCloseTo(F, 6);
    expect(lines[1].origin.y).toBeCloseTo(F + 18, 6);
    expect(abutLinesOf(northBase())).toHaveLength(1);
    // The north wall's inside face from the west wall's face eastward.
    const face: FaceHit = { wallId: 'w', point: { x: F + 20, y: F }, direction: NORTH, tangent: { x: 1, y: 0 }, faceStart: { x: F, y: F }, faceLength: 235.5 };
    const snapped = cornerSnap(face, { x: F + 20, y: F }, 36)!;
    expect(snapped.point.x).toBeCloseTo(F + 18, 6);
    expect(snapped.corner).toBe('right');
    expect(cornerSnap(face, { x: 120, y: F }, 36)).toBeNull();
    const far = cornerSnap(face, { x: F + 230, y: F }, 36)!;
    expect(far.corner).toBe('left');
    expect(far.point.x).toBeCloseTo(F + 235.5 - 18, 6);
  });
});

describe('counter materials', () => {
  it('a run takes each setting from the first fixture that sets one, else the level, else laminate 1 1/2"', () => {
    expect(counterSpecOf([fixture('base')])).toEqual({ material: 'laminate', color: DEFAULT_COUNTER_COLOR, thickness: 1.5 });
    expect(counterSpecOf([fixture('base')], { counterMaterial: 'stoneVeined', counterThickness: 1.25 })).toEqual({ material: 'stoneVeined', color: DEFAULT_COUNTER_COLOR, thickness: 1.25 });
    expect(counterSpecOf([fixture('base'), fixture('sink', { counterMaterial: 'butcherBlock' })], { counterMaterial: 'stoneSpeckled' }).material).toBe('butcherBlock');
    // A butcher block without any colour is maple, with the level's counter colour that colour.
    expect(counterSpecOf([fixture('base', { counterMaterial: 'butcherBlock' })]).color).toBe(BUTCHER_BLOCK_COLOR);
    expect(counterSpecOf([fixture('base', { counterMaterial: 'butcherBlock' })], { counterColor: '#123456' }).color).toBe('#123456');
    const runs = counterRuns([northBase({ counterThickness: 2 }), fixture('base', { id: 'z', origin: { x: F + 90, y: F } })], { counterMaterial: 'stoneSpeckled' });
    expect(runs).toHaveLength(1);
    expect(runs[0].spec).toEqual({ material: 'stoneSpeckled', color: DEFAULT_COUNTER_COLOR, thickness: 2 });
    expect(runs[0].y1 - runs[0].y0).toBe(2);
  });

  it('a sink basin and a vanity follow the counter thickness; only textured tops carry UVs', () => {
    const top = (f: Fixture, finishes?: Parameters<typeof fixtureBoxes>[1]) => Math.max(...of(fixtureBoxes(f, finishes), 'basin').map((b) => b.y1));
    expect(top(fixture('sink'))).toBe(34.5 + 1.5);
    expect(top(fixture('sink'), { counterThickness: 3 })).toBe(34.5 + 3);
    const [laminate] = counterRuns([northBase()]);
    expect(buildCounterGeometry(laminate).getAttribute('uv')).toBeUndefined();
    const [stone] = counterRuns([northBase({ counterMaterial: 'stoneVeined' })]);
    expect(buildCounterGeometry(stone).getAttribute('uv')).toBeDefined();
  });

  it('the textures are pure and seamless: stone, butcher block strips and subway tile', () => {
    for (const px of [stonePixels('speckled', '#6b6760'), stonePixels('veined', '#e8e4dc'), woodPixels('hickory', BUTCHER_BLOCK_COLOR, 'block'), subwayPixels('#eeebe4')]) {
      expect(px.rgba.length).toBe(512 * 512 * 4);
      expect(px.rgba.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
    }
    // Speckled stone has dark grains in it; subway tile has its grout lines (recessed).
    const sp = stonePixels('speckled', '#808080').rgba;
    let dark = 0;
    for (let i = 0; i < sp.length; i += 4) if (sp[i] < 80) dark++;
    expect(dark).toBeGreaterThan(1000);
    expect(subwayPixels('#eeebe4').height!.some((h) => h < 0)).toBe(true);
  });
});

describe('pulls and drawer banks', () => {
  const pulls = (f: Fixture, finishes?: Parameters<typeof fixtureBoxes>[1]) => of(fixtureBoxes(f, finishes), 'handle');
  it('none by default; a knob per door and drawer, a bar pull is a bar on two posts', () => {
    expect(pulls(fixture('base'))).toHaveLength(0);
    // A 36" base: two doors under two drawers.
    expect(pulls(fixture('base', { handles: 'knob' }))).toHaveLength(4);
    expect(pulls(fixture('base'), { handles: 'bar' })).toHaveLength(12);
    // A 30" wall cabinet: two doors, knobs near their bottoms; a tall cabinet's near 40".
    const wall = pulls(fixture('wall', { handles: 'knob' }));
    expect(wall).toHaveLength(2);
    for (const k of wall) expect(k.y0).toBeLessThan(54 + 5);
    const tall = pulls(fixture('tall', { width: 18, handles: 'knob' }));
    expect(tall).toHaveLength(1);
    expect((tall[0].y0 + tall[0].y1) / 2).toBeCloseTo(40, 6);
    // A corner unit: one, on the back leg's door by the inside corner.
    expect(pulls(fixture('cornerBase', { handles: 'knob' }))).toHaveLength(1);
    // Appliances get none.
    expect(pulls(fixture('dishwasher', { handles: 'knob' } as Partial<Fixture>))).toHaveLength(0);
  });

  it('sits on the front face: touching it, never floating off or buried in it', () => {
    const f = fixture('base', { handles: 'bar' });
    const hs = pulls(f);
    for (const b of hs) expect(b.d0).toBeGreaterThanOrEqual(f.depth - 1e-9);
    expect(hs.filter((b) => Math.abs(b.d0 - f.depth) < 1e-9)).toHaveLength(8); // the posts
    expect(Math.max(...hs.map((b) => b.d1))).toBeCloseTo(f.depth + HANDLE.barProud, 9);
    // Each pull lies inside one front's span.
    const fronts = of(fixtureBoxes(f), 'front');
    for (const b of hs) expect(fronts.some((fr) => b.s0 >= fr.s0 - 1e-9 && b.s1 <= fr.s1 + 1e-9 && b.y0 >= fr.y0 - 1e-9 && b.y1 <= fr.y1 + 1e-9)).toBe(true);
  });

  it('a drawer bank replaces the doors: a front and a pull per drawer', () => {
    const f = fixture('base', { width: 15, drawers: 4, handles: 'knob' });
    const boxes = fixtureBoxes(f);
    expect(of(boxes, 'front')).toHaveLength(4);
    expect(of(boxes, 'handle')).toHaveLength(4);
    const tops = of(boxes, 'front').map((b) => b.y1 - b.y0).sort((a, b) => a - b);
    expect(tops[0]).toBeCloseTo(6, 6); // the top drawer
    expect(of(fixtureBoxes(fixture('base', { width: 24, drawers: 2 })), 'front')).toHaveLength(2);
  });

  it('glass doors on a wall cabinet: frames round a pane of glass', () => {
    const boxes = fixtureBoxes(fixture('wall', { glassFront: true }));
    expect(of(boxes, 'glass')).toHaveLength(2);
    expect(of(boxes, 'front')).toHaveLength(8);
    expect(of(fixtureBoxes(fixture('cornerWall', { glassFront: true })), 'glass')).toHaveLength(2);
  });
});

describe('open shelves', () => {
  it('hung: boards spaced evenly on brackets, inside the footprint and the height', () => {
    const f = fixture('shelf');
    const boxes = fixtureBoxes(f);
    const boards = of(boxes, 'carcass');
    expect(boards).toHaveLength(2);
    expect(boards.map((b) => b.y0)).toEqual([58, 70]);
    expect(of(boxes, 'kick')).toHaveLength(4);
    for (const b of boxes) {
      expect(b.y0).toBeGreaterThanOrEqual(f.elevation - 1e-9);
      expect(b.y1).toBeLessThanOrEqual(f.elevation + f.height + 1e-9);
      expect(b.d1).toBeLessThanOrEqual(f.depth + 1e-9);
    }
    const four = of(fixtureBoxes(fixture('shelf', { shelves: 4, shelfThickness: 1, height: 40 })), 'carcass');
    expect(four).toHaveLength(4);
    expect(four.every((b) => b.y1 - b.y0 === 1)).toBe(true);
    expect(four[3].y1).toBeCloseTo(54 + 40, 9);
  });

  it('standing: two end panels and the boards; meshes for the boards and brackets; a SHELF word on the plan', () => {
    const standing = fixtureBoxes(fixture('shelf', { elevation: 0, height: 29, shelves: 3 }));
    expect(of(standing, 'carcass')).toHaveLength(5);
    expect(of(standing, 'kick')).toHaveLength(0);
    const parts = buildFixtureParts(fixture('shelf'));
    expect(parts.map((p) => p.part).sort()).toEqual(['carcass', 'kick']);
    for (const p of parts) expect(triangleCount(p.geometry)).toBeGreaterThan(0);
    expect(fixtureSymbol(fixture('shelf')).label).toBe('SHELF');
    expect(fixtureSymbol(fixture('shelf')).dashed).toBe(true);
    expect(fixtureSymbol(fixture('shelf', { elevation: 0 })).dashed).toBe(false);
  });
});

describe('backsplashes', () => {
  let lid: Id;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    clearMeshCache();
    lid = defaultLevelId(store().plan);
    const pts = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 180 },
      { x: 0, y: 180 },
    ];
    store().addWalls(
      lid,
      pts.map((a, i) => ({ a, b: pts[(i + 1) % 4] })),
      { kind: 'interior', thickness: 4.5, phase: 'existing' },
    );
  });
  afterAll(() => clearMeshCache());

  const level = () => store().plan.levels[lid];
  const pieces = () => backsplashPieces(level(), getFootprints(level(), 'all'), 'all', () => true);
  /** Each piece's extent along its face and its heights. */
  const spans = () =>
    pieces().map((p) => ({
      id: p.fixtureId,
      len: p.boxes.reduce((n, b) => Math.max(n, b.s1) , -Infinity) - p.boxes.reduce((n, b) => Math.min(n, b.s0), Infinity),
      y0: Math.min(...p.boxes.map((b) => b.y0)),
      y1: Math.max(...p.boxes.map((b) => b.y1)),
      boxes: p.boxes,
    }));
  const add = (f: Fixture) => store().addFixture(lid, { ...f, id: f.id })!;

  it('none unless set: an old plan gets no backsplash meshes', () => {
    for (const f of [cornerUnit(), northBase(), westBase()]) add(f);
    expect(pieces()).toEqual([]);
    expect(getLevelMeshes(store().plan, lid, 'all').backsplashes).toBeUndefined();
  });

  it('behind the base run on both walls of an L, up to the wall cabinets, once at the inside corner', () => {
    for (const f of [cornerUnit(), northBase(), westBase()]) add(f);
    store().updateFinishes(lid, { backsplash: 'toWall' });
    const s = spans();
    // The corner unit's back (north wall) and its end (west wall), and each base's back.
    expect(s.map((p) => p.id).sort()).toEqual(['a-corner', 'a-corner', 'b-north', 'c-west']);
    for (const p of s) {
      expect(p.y0).toBe(36);
      expect(p.y1).toBe(54);
      for (const b of p.boxes) expect(b.d1 - b.d0).toBe(0.375);
    }
    const corner = s.filter((p) => p.id === 'a-corner').map((p) => p.len).sort((a, b) => a - b);
    // The end on the west wall stops at the back's piece on the north wall (3/8" proud of it).
    expect(corner[0]).toBeCloseTo(36 - 0.375, 6);
    expect(corner[1]).toBeCloseTo(36, 6);
    const meshes = getLevelMeshes(store().plan, lid, 'all');
    expect(meshes.backsplashes).toHaveLength(4);
    for (const b of meshes.backsplashes!) expect(triangleCount(b.geometry)).toBeGreaterThan(0);
  });

  it('a 4" upstand, the ceiling, a slab in the counter colour; per-run overrides; never on an island', () => {
    add(northBase());
    add(fixture('island', { id: 'island', origin: { x: 120, y: 90 }, direction: NORTH }));
    store().updateFinishes(lid, { backsplash: 'upstand' });
    expect(spans().map((p) => [p.id, p.y1 - p.y0])).toEqual([['b-north', 4]]);
    store().updateFinishes(lid, { backsplash: 'full', backsplashFinish: 'slab', counterColor: '#334455' });
    const [full] = pieces();
    expect(Math.max(...full.boxes.map((b) => b.y1))).toBe(level().wallHeight);
    expect(full.color).toBe('#334455');
    expect(full.boxes[0].d1).toBe(0.75);
    store().updateFixture(lid, 'b-north', { backsplash: 'none' });
    expect(pieces()).toEqual([]);
    expect(fixtureProblem(fixture('island', { backsplash: 'toWall' }))).toMatch(/island has no backsplash/);
  });

  it('cut round a window: under its sill only, full height beside it', () => {
    add(northBase());
    const wallId = Object.values(level().walls).find((w) => {
      const a = level().nodes[w.a];
      const b = level().nodes[w.b];
      return a.y === 0 && b.y === 0;
    })!.id;
    store().addOpening(lid, { wallId, type: 'window', offset: 56.25, width: 24, height: 36, sill: 42, phase: 'existing' });
    store().updateFinishes(lid, { backsplash: 'toWall' });
    const [p] = pieces();
    const boxes = [...p.boxes].sort((a, b) => a.s0 - b.s0 || a.y0 - b.y0);
    expect(boxes).toHaveLength(3);
    const heights = boxes.map((b) => [Math.round((b.s1 - b.s0) * 100) / 100, b.y0, b.y1]);
    expect(heights).toContainEqual([6, 36, 54]);
    expect(heights).toContainEqual([24, 36, 42]);
    expect(heights.filter((h) => h[0] === 6)).toHaveLength(2);
  });

  it('behind a range between base runs, taking its neighbours\' setting', () => {
    // Clear of the corner (a base whose end is on the west wall gets an end piece there too).
    add(northBase({ id: 'b1', origin: { x: F + 10 + 18, y: F } }));
    add(fixture('range', { id: 'r', origin: { x: F + 10 + 36 + 15, y: F }, direction: NORTH }));
    add(northBase({ id: 'b2', origin: { x: F + 10 + 66 + 18, y: F }, backsplash: 'toWall' }));
    store().updateFixture(lid, 'b1', { backsplash: 'toWall' });
    const s = spans();
    expect(s.map((p) => p.id).sort()).toEqual(['b1', 'b2', 'r']);
    const range = s.find((p) => p.id === 'r')!;
    expect(range.y0).toBe(36);
    expect(range.len).toBeCloseTo(30, 6);
  });
});

describe('the store and the loader', () => {
  let lid: Id;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    lid = defaultLevelId(store().plan);
  });

  it('sets a run in one step, refuses bad values and drops fields a new kind does not take', () => {
    const a = store().addFixture(lid, northBase())!;
    const b = store().addFixture(lid, westBase())!;
    store().updateFixtures(lid, [a, b], { counterMaterial: 'stoneSpeckled', counterColor: '#AABBCC' });
    expect(store().plan.levels[lid].fixtures[a]).toMatchObject({ counterMaterial: 'stoneSpeckled', counterColor: '#aabbcc' });
    expect(store().plan.levels[lid].fixtures[b].counterMaterial).toBe('stoneSpeckled');
    store().updateFixture(lid, a, { drawers: 9 });
    expect(store().plan.levels[lid].fixtures[a].drawers).toBeUndefined();
    store().updateFixture(lid, a, { drawers: 3, handles: 'bar' });
    store().updateFixture(lid, a, { kind: 'wall' });
    const f = store().plan.levels[lid].fixtures[a];
    expect(f.kind).toBe('wall');
    expect(f.drawers).toBeUndefined();
    expect(f.counterMaterial).toBeUndefined();
    expect(f.handles).toBe('bar');
    store().updateFinishes(lid, { counterMaterial: 'granite' as never, backsplash: 'toWall' });
    expect(store().plan.levels[lid].finishes).toEqual({ backsplash: 'toWall' });
  });

  it('keeps valid kitchen fields and drops bad ones alone on load', () => {
    const plan = createEmptyPlan();
    const id = defaultLevelId(plan);
    const doc = JSON.parse(JSON.stringify(plan));
    doc.levels[id].fixtures = {
      a: { ...cornerUnit({ id: 'a' }), counterMaterial: 'granite', corner: 'up', handles: 'bar', counterThickness: 2 },
      b: { ...fixture('base', { id: 'b' }), drawers: 9, backsplash: 'toWall', backsplashColor: '#ABCDEF', glassFront: true },
      c: { ...fixture('island', { id: 'c' }), backsplash: 'full', counterMaterial: 'butcherBlock' },
      d: { ...fixture('shelf', { id: 'd' }), shelves: 0, shelfThickness: 1 },
      e: { ...fixture('wall', { id: 'e' }), glassFront: true, handles: 'pull' },
    };
    doc.levels[id].finishes = { counterMaterial: 'quartz', handles: 'knob', backsplash: 'toWall', backsplashHeight: -3 };
    const level = migrate(doc).levels[id];
    const fx = level.fixtures;
    expect(fx.a).toMatchObject({ kind: 'cornerBase', handles: 'bar', counterThickness: 2 });
    expect(fx.a.counterMaterial).toBeUndefined();
    expect(fx.a.corner).toBeUndefined();
    expect(fx.b).toMatchObject({ backsplash: 'toWall', backsplashColor: '#abcdef' });
    expect(fx.b.drawers).toBeUndefined();
    expect(fx.b.glassFront).toBeUndefined();
    expect(fx.c.backsplash).toBeUndefined();
    expect(fx.c.counterMaterial).toBe('butcherBlock');
    expect(fx.d.shelves).toBeUndefined();
    expect(fx.d.shelfThickness).toBe(1);
    expect(fx.e.glassFront).toBe(true);
    expect(fx.e.handles).toBeUndefined();
    expect(level.finishes).toEqual({ handles: 'knob', backsplash: 'toWall' });
  });

  it('an old plan loads unchanged and draws as before: no pulls, no glass, a laminate top 1 1/2" thick', () => {
    const plan = createEmptyPlan();
    const id = defaultLevelId(plan);
    const doc = JSON.parse(JSON.stringify(plan));
    const old = { b: fixture('base', { id: 'b' }), w: fixture('wall', { id: 'w', origin: { x: 0, y: 0 } }) };
    doc.levels[id].fixtures = JSON.parse(JSON.stringify(old));
    doc.levels[id].finishes = { counterColor: '#e2dccb' };
    const level = migrate(doc).levels[id];
    expect(level.fixtures).toEqual(old);
    for (const f of Object.values(level.fixtures)) expect(fixtureBoxes(f, level.finishes).some((b) => b.part === 'handle' || b.part === 'glass')).toBe(false);
    const [run] = counterRuns(Object.values(level.fixtures), level.finishes);
    expect(run.spec).toEqual({ material: 'laminate', color: '#e2dccb', thickness: 1.5 });
  });
});
