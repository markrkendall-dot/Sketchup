import { beforeEach, describe, expect, it } from 'vitest';
import { bathSolids, bathSymbol, showerBase, type BathSolid } from '../derive/bath';
import { counterRuns, fixtureSymbol } from '../derive/casework';
import { solidExtent } from '../derive/furniture';
import { buildCeilingGeometry, buildFixtureParts, CEILING_DROP, clearMeshCache, getLevelMeshes, triangleCount } from '../derive/meshes';
import { dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { BATH_KINDS, CERAMIC_WHITE, isBath, VARIANTS } from '../model/bath';
import { CASEWORK_KINDS, FIXTURE_DEFAULTS, FIXTURE_KINDS } from '../model/casework';
import { CEILING_COLOR, ceilingLookOf } from '../model/finish';
import { createEmptyPlan, fixtureProblem, migrate } from '../model/plan';
import { firstStructure } from '../model/structures';
import type { Fixture, FixtureKind, Id, Plan, Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import example from '../../docs/examples/146-mick-road.json';
import rebuild from '../../docs/examples/146-mick-road-rebuild.json';
import { bathMaterial, fixturePartMaterial } from '../view3d/materials';

// Bath and laundry fixtures (DESIGN.md "Bath and laundry") and ceilings (DESIGN.md "Ceilings").

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();

const fixture = (kind: FixtureKind, over: Partial<Fixture> = {}): Fixture => ({
  id: over.id ?? `f-${kind}`,
  kind,
  origin: { x: 0, y: 0 },
  direction: 90,
  ...FIXTURE_DEFAULTS[kind],
  phase: 'existing',
  ...over,
});

const partsOf = (f: Fixture) => new Set(buildFixtureParts(f).map((p) => p.part));
const solidsOf = (f: Fixture, type: BathSolid['type']) => bathSolids(f).filter((s) => s.type === type);

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('bath and laundry kinds', () => {
  it('are fixture kinds the Cabinet tool offers, after the kitchen and before the box', () => {
    expect(BATH_KINDS).toEqual(['bathtub', 'shower', 'showerGlass', 'toilet', 'vanity', 'basin', 'washer', 'dryer', 'waterHeater']);
    for (const k of BATH_KINDS) {
      expect(FIXTURE_KINDS).toContain(k);
      expect(CASEWORK_KINDS).toContain(k);
    }
    expect(CASEWORK_KINDS.indexOf('bathtub')).toBeGreaterThan(CASEWORK_KINDS.indexOf('microwave'));
    expect(CASEWORK_KINDS.indexOf('waterHeater')).toBeLessThan(CASEWORK_KINDS.indexOf('box'));
  });

  it('every kind at its stock size is built of solids inside its footprint, standing on the floor', () => {
    for (const k of BATH_KINDS) {
      const f = fixture(k);
      const solids = bathSolids(f);
      expect(solids.length, k).toBeGreaterThan(0);
      for (const sol of solids) {
        const e = solidExtent(sol);
        expect(e.s0, k).toBeGreaterThanOrEqual(-f.width / 2 - 1e-6);
        expect(e.s1, k).toBeLessThanOrEqual(f.width / 2 + 1e-6);
        expect(e.d0, k).toBeGreaterThanOrEqual(-1e-6);
        expect(e.d1, k).toBeLessThanOrEqual(f.depth + 1e-6);
        expect(e.y0, k).toBeGreaterThanOrEqual(-1e-6);
      }
      const parts = buildFixtureParts(f);
      expect(parts.length, k).toBeGreaterThan(0);
      for (const p of parts) expect(triangleCount(p.geometry), `${k} ${p.part}`).toBeGreaterThan(0);
    }
    // Nothing else is a bath fixture.
    expect(bathSolids(fixture('base'))).toEqual([]);
    expect(bathSolids(fixture('box'))).toEqual([]);
  });

  it('a bathtub is a basin in a rim with a drain and taps; freestanding it is an oval', () => {
    const alcove = fixture('bathtub');
    expect(partsOf(alcove)).toEqual(new Set(['body', 'chrome']));
    const [rim] = solidsOf(alcove, 'prism') as Extract<BathSolid, { type: 'prism' }>[];
    expect(rim.holes).toHaveLength(1); // the basin, open at the top
    expect(rim.y1).toBe(20);
    // The taps on the end wall stand over the rim.
    expect(Math.max(...solidsOf(alcove, 'log').map((s) => solidExtent(s).y1))).toBeGreaterThan(30);
    const oval = fixture('bathtub', { variant: 'freestanding' });
    const rims = solidsOf(oval, 'prism') as Extract<BathSolid, { type: 'prism' }>[];
    const top = rims.find((r) => r.holes.length === 1)!;
    // An ellipse 60" x 30": its points at the ends of its axes and none outside them.
    expect(Math.max(...top.ring.map((p) => p.s))).toBeCloseTo(30, 6);
    expect(Math.max(...top.ring.map((p) => p.d))).toBeCloseTo(30, 6);
    expect(top.ring.length).toBeGreaterThan(20);
  });

  it('a shower is a tray (3") or a curbless floor (1/2"), a head and valve on the back wall, glass where set', () => {
    expect(showerBase(fixture('shower'))).toBe(3);
    expect(showerBase(fixture('shower', { variant: 'curbless' }))).toBe(0.5);
    const bare = fixture('shower');
    expect(partsOf(bare)).toEqual(new Set(['body', 'chrome']));
    const glassBoxes = (f: Fixture) => bathSolids(f).filter((s) => s.part === 'glass');
    // A front is a fixed panel and a door; each end one panel; the glass from the channel up to the height.
    expect(glassBoxes(fixture('shower', { glass: { front: true } }))).toHaveLength(2);
    expect(glassBoxes(fixture('shower', { glass: { front: true, left: true, right: true } }))).toHaveLength(4);
    for (const g of glassBoxes(fixture('shower', { glass: { left: true } }))) {
      const e = solidExtent(g);
      expect(e.y1).toBe(78);
      expect(e.y0).toBeCloseTo(3.75, 6);
      expect(e.s0).toBe(-18);
    }
    // The head is at 80" over the floor, over the middle of the back.
    const head = solidsOf(bare, 'log').map(solidExtent).find((e) => e.y1 === 80 && e.s1 - e.s0 > 5)!;
    expect(head).toBeDefined();
    // A glass panel is glass over a chrome channel.
    expect(partsOf(fixture('showerGlass'))).toEqual(new Set(['chrome', 'glass']));
  });

  it('a toilet has a tank against the wall and an open oval bowl with a seat', () => {
    const f = fixture('toilet');
    const prisms = solidsOf(f, 'prism') as Extract<BathSolid, { type: 'prism' }>[];
    expect(prisms.filter((p) => p.holes.length === 1)).toHaveLength(2); // the bowl and the seat
    const tank = solidsOf(f, 'box').map(solidExtent).find((e) => e.d0 === 0)!;
    expect(tank.y1).toBe(30);
    expect(tank.d1).toBeLessThanOrEqual(9);
  });

  it('a vanity is a cabinet under a counter with a basin hole and a basin and tap under each; two from 60" wide', () => {
    const single = fixture('vanity');
    expect(partsOf(single)).toEqual(new Set(['carcass', 'kick', 'front', 'body', 'chrome']));
    const [run] = counterRuns([single]);
    expect(run.holes).toHaveLength(1);
    expect(run.y1).toBe(34);
    const double = fixture('vanity', { width: 72 });
    expect(counterRuns([double])[0].holes).toHaveLength(2);
    // The basins are china, white whatever the fronts' colour.
    const mesh = getLevelMeshesFor([{ ...single, frontColor: '#335577' }]).fixtures[0];
    expect(mesh.bodyColor).toBe(CERAMIC_WHITE);
    expect(mesh.frontColor).toBe('#335577');
  });

  it('a basin stands on a pedestal or hangs on the wall over a trap', () => {
    const ped = fixture('basin');
    const hung = fixture('basin', { variant: 'wallHung' });
    const lowest = (f: Fixture) => Math.min(...bathSolids(f).filter((s) => s.part === 'body').map((s) => solidExtent(s).y0));
    expect(lowest(ped)).toBe(0);
    expect(lowest(hung)).toBeGreaterThan(20);
    expect(solidsOf(hung, 'log').some((s) => s.type === 'log' && s.a.d === 0)).toBe(true);
  });

  it('a washer and a dryer are front-loaders: a cabinet, a round door, a control strip; the washer has a drawer', () => {
    for (const k of ['washer', 'dryer'] as const) {
      const f = fixture(k);
      expect(partsOf(f), k).toEqual(new Set(['body', 'chrome', 'dark']));
      const door = solidsOf(f, 'log').find((s) => s.type === 'log' && s.part === 'dark' && s.b.d === f.depth)!;
      expect(door, k).toBeDefined();
    }
    expect(bathSolids(fixture('washer')).filter((s) => s.part === 'body')).toHaveLength(2);
    expect(bathSolids(fixture('dryer')).filter((s) => s.part === 'body')).toHaveLength(2);
    // A stacked dryer stands on the washer: its bottom at the washer's height.
    const stacked = fixture('dryer', { elevation: 38 });
    expect(Math.min(...bathSolids(stacked).map((s) => solidExtent(s).y0))).toBe(38);
  });

  it('the water heater is a round tank with pipes at the top', () => {
    const f = fixture('waterHeater');
    const tank = solidsOf(f, 'log').find((s) => s.type === 'log' && s.part === 'body')!;
    expect(tank.type === 'log' && tank.diameter).toBeCloseTo(21.5, 6);
  });

  it('materials: glossy body in its colour (white by default), chrome, clear glass drawn like glass', () => {
    const tub = getLevelMeshesFor([fixture('bathtub', { frontColor: '#a0c0b0' })]).fixtures[0];
    expect(tub.bodyColor).toBe('#a0c0b0');
    expect(getLevelMeshesFor([fixture('toilet')]).fixtures[0].bodyColor).toBe(CERAMIC_WHITE);
    const body = fixturePartMaterial(tub, 'body');
    expect(`#${body.color.getHexString()}`).toBe('#a0c0b0');
    expect(body.roughness).toBeLessThan(0.5);
    const glass = bathMaterial('glass', 'existing');
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(0.5);
    expect(bathMaterial('chrome', 'existing').metalness).toBeGreaterThan(0.5);
    expect(bathMaterial('body', 'demo').opacity).toBe(0.35);
  });

  it('shows by phase like casework, never on the furniture layer', () => {
    const lid = firstStructure(store().plan).levelOrder[1];
    const id = store().addFixture(lid, { ...fixture('toilet'), id: undefined, phase: 'new' })!;
    expect(getLevelMeshes(store().plan, lid, 'proposed').fixtures.map((m) => m.id)).toEqual([id]);
    expect(getLevelMeshes(store().plan, lid, 'existing').fixtures).toEqual([]);
    expect(getLevelMeshes(store().plan, lid, 'proposed').fixtures[0].furniture).toBeUndefined();
    const root = buildExportScene(store().plan, 'proposed', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid, showFurniture: false });
    const names: string[] = [];
    root.traverse((o) => names.push(o.name));
    expect(names).toContain('Bath (toilet)');
    disposeExportScene(root);
  });
});

/** The level meshes of a First Floor holding these fixtures only. */
function getLevelMeshesFor(fixtures: Fixture[]) {
  const plan = createEmptyPlan();
  const lid = firstStructure(plan).levelOrder[1];
  plan.levels[lid].fixtures = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  return getLevelMeshes(plan, lid, 'all');
}

describe('bath fixtures on the plan', () => {
  it('draw what they are: a tub basin, a shower cross, a tank and bowl, basins, the laundry words', () => {
    for (const k of BATH_KINDS.filter((x) => x !== 'showerGlass')) {
      const d = bathSymbol(fixture(k));
      expect(d.lines.length + d.rects.length + d.circles.length, k).toBeGreaterThan(0);
    }
    expect(bathSymbol(fixture('shower')).lines).toHaveLength(2);
    expect(bathSymbol(fixture('shower', { glass: { front: true, left: true } })).rects).toHaveLength(2);
    expect(bathSymbol(fixture('toilet')).rects).toHaveLength(3);
    expect(bathSymbol(fixture('vanity', { width: 72 })).rects).toHaveLength(2);
    expect(bathSymbol(fixture('waterHeater')).circles).toHaveLength(1);
    expect(fixtureSymbol(fixture('washer')).label).toBe('W');
    expect(fixtureSymbol(fixture('dryer')).label).toBe('D');
    expect(fixtureSymbol(fixture('waterHeater')).label).toBe('WH');
    expect(fixtureSymbol(fixture('toilet')).label).toBeNull();
    expect(fixtureSymbol(fixture('bathtub', { label: 'Tub' })).label).toBe('Tub');
    // A vanity is a cabinet: door ticks along its front.
    expect(fixtureSymbol(fixture('vanity')).ticks).toHaveLength(1);
    expect(bathSymbol(fixture('base'))).toEqual({ lines: [], rects: [], circles: [] });
  });

  it('the Cabinet tool places them against the wall, a shower with a glass front', () => {
    const lid = firstStructure(store().plan).levelOrder[1];
    ui().setActiveLevel(lid);
    ui().setViewMode('all');
    ui().setViewport({ tx: 0, ty: 0, k: 1 });
    store().addWall(lid, { x: 0, y: 0 }, { x: 400, y: 0 }, { kind: 'exterior', thickness: 6, phase: 'existing' });
    const ptr = (x: number, y: number): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false });
    switchTool('fixture');
    useUiStore.getState().patchDraft({ fixtureKind: 'shower' });
    dispatchPointer('move', ptr(100, 8));
    expect(ui().draft.fixturePreview).toMatchObject({ kind: 'shower', glass: { front: true }, origin: { x: 100, y: 3 }, direction: 90 });
    dispatchPointer('down', ptr(100, 8));
    dispatchPointer('up', ptr(100, 8));
    const placed = Object.values(store().plan.levels[lid].fixtures);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ kind: 'shower', glass: { front: true }, width: 36, depth: 36, height: 78 });
    // Turned into a bathtub, it loses the glass (only a shower has glass) and takes a form.
    store().updateFixture(lid, placed[0].id, { kind: 'bathtub' });
    expect(store().plan.levels[lid].fixtures[placed[0].id].glass).toBeUndefined();
    store().updateFixture(lid, placed[0].id, { variant: 'freestanding' });
    expect(store().plan.levels[lid].fixtures[placed[0].id].variant).toBe('freestanding');
    expect(store().updateFixture(lid, placed[0].id, { variant: 'tray' })).toBeUndefined();
    expect(store().plan.levels[lid].fixtures[placed[0].id].variant).toBe('freestanding');
    switchTool('select');
  });
});

describe('validation and old files', () => {
  it('a form only for a kind that has it, glass only on a shower', () => {
    expect(fixtureProblem(fixture('bathtub', { variant: 'freestanding' }))).toBeNull();
    expect(fixtureProblem(fixture('bathtub', { variant: 'tray' }))).toMatch(/no form/);
    expect(fixtureProblem(fixture('base', { variant: 'alcove' }))).toMatch(/no form/);
    expect(fixtureProblem(fixture('shower', { glass: { front: true } }))).toBeNull();
    expect(fixtureProblem(fixture('bathtub', { glass: { front: true } }))).toMatch(/only a shower/);
    expect(Object.keys(VARIANTS).sort()).toEqual(['basin', 'bathtub', 'shower']);
  });

  it('loads the new fields, drops malformed ones one by one, and reads a file without them unchanged (no schema bump)', () => {
    const plan = createEmptyPlan();
    const lid = firstStructure(plan).levelOrder[1];
    const raw = JSON.parse(JSON.stringify(plan)) as Plan;
    const lvl = raw.levels[lid] as unknown as Record<string, unknown>;
    lvl.fixtures = {
      a: { ...fixture('shower', { id: 'a', glass: { front: true, left: false } }) },
      b: { ...fixture('bathtub', { id: 'b' }), variant: 'tray', glass: { front: true } },
      c: { ...fixture('basin', { id: 'c', variant: 'wallHung' }) },
    };
    lvl.finishes = { ceilingFinish: 'pine', ceilingColor: '#ABCDEF' };
    lvl.rooms = { r: { id: 'r', name: 'Bath', anchor: { x: 0, y: 0 }, ceilingFinish: 'boards', ceilingColor: 'red' }, q: { id: 'q', name: 'Hall', anchor: { x: 1, y: 1 }, ceilingFinish: 'stucco' } };
    const out = migrate(raw).levels[lid];
    expect(out.fixtures.a.glass).toEqual({ front: true });
    expect(out.fixtures.b.variant).toBeUndefined();
    expect(out.fixtures.b.glass).toBeUndefined();
    expect(out.fixtures.c.variant).toBe('wallHung');
    expect(out.finishes).toEqual({ ceilingFinish: 'pine', ceilingColor: '#abcdef' });
    expect(out.rooms.r).toMatchObject({ ceilingFinish: 'boards' });
    expect(out.rooms.r.ceilingColor).toBeUndefined();
    expect(out.rooms.q.ceilingFinish).toBeUndefined();
    // A file from before (the example as committed before this change has none of the fields; it
    // has since gone to version 10, design options): it loads as it was, the ceilings filled in by
    // default at render time.
    expect(raw.schemaVersion).toBe(10);
    const before = createEmptyPlan();
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(before))))).toBe(JSON.stringify(before));
  });
});

describe('ceilings', () => {
  /** A 20' x 15' room on the First Floor, and (when `above`) the same box of walls on the Second Floor over it. */
  function roomUnder(above: boolean): { lid: Id; sid: Id; room: Id } {
    const st = firstStructure(store().plan);
    const [lid, sid] = [st.levelOrder[1], st.levelOrder[2]];
    const c: Vec2[] = [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 180 },
      { x: 0, y: 180 },
    ];
    for (const id of above ? [lid, sid] : [lid]) c.forEach((p, i) => store().addWall(id, p, c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' }));
    const room = store().addRoom(lid, { name: 'Bath', anchor: { x: 120, y: 90 } })!;
    return { lid, sid, room };
  }

  it('defaults to paint under the floor of a level above and to none under a roof', () => {
    expect(ceilingLookOf({}, undefined, true)).toEqual({ finish: 'paint', color: CEILING_COLOR.paint });
    expect(ceilingLookOf({}, undefined, false)).toBeNull();
    expect(ceilingLookOf({}, { ceilingFinish: 'pine' }, false)).toEqual({ finish: 'pine', color: CEILING_COLOR.pine });
    expect(ceilingLookOf({ ceilingColor: '#ff0000' }, { ceilingFinish: 'none' }, true)).toEqual({ finish: 'paint', color: '#ff0000' });
    expect(ceilingLookOf({ ceilingFinish: 'none' }, undefined, true)).toBeNull();
    expect(ceilingLookOf({ ceilingFinish: 'boards' }, { ceilingColor: '#123456' }, true)).toEqual({ finish: 'boards', color: CEILING_COLOR.boards });

    const { lid, room } = roomUnder(true);
    const m = getLevelMeshes(store().plan, lid, 'all');
    expect(m.ceilings.map((c) => [c.roomId, c.finish, c.color])).toEqual([[room, 'paint', CEILING_COLOR.paint]]);
    clearMeshCache();
    store().setPlan(createEmptyPlan());
    const under = roomUnder(false);
    expect(getLevelMeshes(store().plan, under.lid, 'all').ceilings).toEqual([]);
    store().updateRoom(under.lid, under.room, { ceilingColor: '#E0D8C0' });
    expect(getLevelMeshes(store().plan, under.lid, 'all').ceilings.map((c) => [c.finish, c.color])).toEqual([['paint', '#e0d8c0']]);
  });

  it('is one surface facing down at the ceiling height, less the holes through the floor above', () => {
    const { lid, room } = roomUnder(true);
    store().updateRoom(lid, room, { ceilingFinish: 'pine' });
    const [c] = getLevelMeshes(store().plan, lid, 'all').ceilings;
    expect(c.finish).toBe('pine');
    const pos = c.geometry.getAttribute('position');
    const nor = c.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(96 - CEILING_DROP, 6);
      expect(nor.getY(i)).toBe(-1);
    }
    // Wound to face down: every triangle's normal points to -Y.
    for (let t = 0; t < pos.count; t += 3) {
      const ax = pos.getX(t + 1) - pos.getX(t);
      const az = pos.getZ(t + 1) - pos.getZ(t);
      const bx = pos.getX(t + 2) - pos.getX(t);
      const bz = pos.getZ(t + 2) - pos.getZ(t);
      expect(az * bx - ax * bz).toBeLessThan(0);
    }
    // A lower ceiling; under a floor it is never higher than the wall height.
    store().updateRoom(lid, room, { ceilingOverride: 90 });
    expect(getLevelMeshes(store().plan, lid, 'all').ceilings[0].geometry.getAttribute('position').getY(0)).toBeCloseTo(90 - CEILING_DROP, 6);
    store().updateRoom(lid, room, { ceilingOverride: 120 });
    expect(getLevelMeshes(store().plan, lid, 'all').ceilings[0].geometry.getAttribute('position').getY(0)).toBeCloseTo(96 - CEILING_DROP, 6);
    // A hole: the area drops by the hole's.
    const area = (g: NonNullable<ReturnType<typeof buildCeilingGeometry>>) => {
      const p = g.getAttribute('position');
      let a = 0;
      for (let t = 0; t < p.count; t += 3) a += Math.abs((p.getX(t + 1) - p.getX(t)) * (p.getZ(t + 2) - p.getZ(t)) - (p.getX(t + 2) - p.getX(t)) * (p.getZ(t + 1) - p.getZ(t))) / 2;
      return a;
    };
    const net = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const hole = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ];
    expect(area(buildCeilingGeometry(net, [], 96)!)).toBeCloseTo(5000, 6);
    expect(area(buildCeilingGeometry(net, [hole], 96)!)).toBeCloseTo(5000 - 600, 6);
  });

  it('none takes it away; the export carries it with the roofs on and leaves it out with them off', () => {
    const { lid, room } = roomUnder(true);
    const exportNames = (roofs: boolean | undefined) => {
      const root = buildExportScene(store().plan, 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid, ...(roofs === undefined ? {} : { show3dRoofs: roofs }) });
      const names: string[] = [];
      root.traverse((o) => names.push(o.name));
      disposeExportScene(root);
      return names;
    };
    expect(exportNames(undefined)).toContain('Ceiling (Bath)');
    expect(exportNames(true)).toContain('Ceiling (Bath)');
    expect(exportNames(false)).not.toContain('Ceiling (Bath)');
    store().updateRoom(lid, room, { ceilingFinish: 'none' });
    expect(getLevelMeshes(store().plan, lid, 'all').ceilings).toEqual([]);
    expect(exportNames(true)).not.toContain('Ceiling (Bath)');
  });
});

describe('the example plans', () => {
  const BATH_WORDS = /\b(tub|wc|toilet|shower|glass|vanity|basin|washer|dryer|water heater)\b/i;
  for (const [file, json] of [
    ['146-mick-road.json', example],
    ['146-mick-road-rebuild.json', rebuild],
  ] as const) {
    it(`${file}: has its bath and laundry items as bath fixtures, none as a labelled box`, () => {
      const plan = migrate(JSON.parse(JSON.stringify(json)));
      const all = Object.values(plan.levels).flatMap((l) => Object.values(l.fixtures));
      // The dryer's vent is a duct, not the dryer.
      const boxes = all.filter((f) => f.kind === 'box' && BATH_WORDS.test(f.label ?? '') && !/vent/i.test(f.label ?? ''));
      expect(boxes.map((f) => f.label)).toEqual([]);
      const kinds = new Set(all.filter((f) => isBath(f.kind)).map((f) => f.kind));
      for (const k of ['bathtub', 'toilet', 'shower', 'showerGlass', 'washer', 'dryer'] as const) expect(kinds, k).toContain(k);
    });
  }
});
