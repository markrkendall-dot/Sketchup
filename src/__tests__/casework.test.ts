import type { BufferGeometry } from 'three';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { basinOutline, counterOutline, counterRuns, doorCount, fixtureBoxes, fixtureOutline, fixtureSymbol, frontSpans, hitFixture, rectilinearUnion, simplifyRing } from '../derive/casework';
import { buildCounterGeometry, buildFixtureParts, clearMeshCache, getLevelMeshes, triangleCount } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { BASIN, COUNTER_THICKNESS, FIXTURE_DEFAULTS, FIXTURE_KINDS, hasCounter, TOE_KICK } from '../model/casework';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan, defaultLevelId, fixtureProblem, migrate, MIGRATIONS, SCHEMA_VERSION } from '../model/plan';
import type { Fixture, Id } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

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

describe('fixture frame and outline', () => {
  it('stands on its back edge, facing its direction, width across', () => {
    // Back middle at the origin, front facing +y (down the plan), 36" wide, 24" deep.
    const o = fixtureOutline(fixture('base'));
    expect(o).toEqual([
      { x: 18, y: 0 },
      { x: 18, y: 24 },
      { x: -18, y: 24 },
      { x: -18, y: 0 },
    ]);
    expect(hitFixture(fixture('base'), { x: 0, y: 12 })).toBe(true);
    expect(hitFixture(fixture('base'), { x: 0, y: -1 })).toBe(false);
    expect(hitFixture(fixture('base'), { x: 0, y: -1 }, 2)).toBe(true);
    expect(hitFixture(fixture('base'), { x: 19, y: 12 })).toBe(false);
  });

  it('a counter outline grows the rectangle by the overhang: 1" at the front, an island all round', () => {
    const base = counterOutline(fixture('base'));
    expect(base.map((p) => p.y).sort((a, b) => a - b)).toEqual([0, 0, 25, 25]);
    const island = counterOutline(fixture('island'));
    expect(island.map((p) => p.x).sort((a, b) => a - b)).toEqual([-37, -37, 37, 37]);
    expect(island.map((p) => p.y).sort((a, b) => a - b)).toEqual([-1, -1, 37, 37]);
  });

  it('has a stock size for every kind, and a counter on the base, island, dishwasher and sink only', () => {
    for (const k of FIXTURE_KINDS) {
      const d = FIXTURE_DEFAULTS[k];
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
    }
    expect(FIXTURE_KINDS.filter(hasCounter)).toEqual(['base', 'island', 'sink', 'dishwasher']);
    expect(FIXTURE_DEFAULTS.wall.elevation).toBe(54);
    expect(FIXTURE_DEFAULTS.hood.elevation).toBe(66);
  });
});

describe('fixtureBoxes', () => {
  it('a base cabinet: carcass, toe kick, two doors with a drawer front over each', () => {
    const boxes = fixtureBoxes(fixture('base'));
    expect(doorCount(36)).toBe(2);
    const kick = boxes.filter((b) => b.part === 'kick');
    expect(kick).toHaveLength(1);
    expect(kick[0].y1).toBe(TOE_KICK.height);
    expect(kick[0].d0).toBe(TOE_KICK.setback);
    const carcass = boxes.filter((b) => b.part === 'carcass');
    expect(carcass).toHaveLength(1);
    expect(carcass[0].y0).toBe(TOE_KICK.height);
    expect(carcass[0].y1).toBe(34.5);
    expect(carcass[0].d1).toBe(24 - 0.75);
    const fronts = boxes.filter((b) => b.part === 'front');
    expect(fronts).toHaveLength(4); // 2 doors + 2 drawer fronts, slab style
    for (const f of fronts) expect(f.d1).toBe(24);
    const drawers = fronts.filter((f) => f.y1 - f.y0 === 6);
    expect(drawers).toHaveLength(2);
    // Reveals: fronts never touch each other or the carcass edge.
    const [l, r] = frontSpans(36, 2);
    expect(l[0]).toBeCloseTo(-18 + 0.125);
    expect(r[1]).toBeCloseTo(18 - 0.125);
    expect(r[0] - l[1]).toBeCloseTo(0.125);
  });

  it('panel fronts are a frame round a recessed panel; a wall cabinet has no kick and full-height doors', () => {
    const boxes = fixtureBoxes(fixture('wall', { frontStyle: 'panel' }));
    expect(boxes.some((b) => b.part === 'kick')).toBe(false);
    const fronts = boxes.filter((b) => b.part === 'front');
    expect(fronts).toHaveLength(2 * 5); // two doors, five boxes each
    const recessed = fronts.filter((b) => b.d1 < 12);
    expect(recessed).toHaveLength(2);
    expect(recessed[0].d1).toBeCloseTo(12 - 0.375);
    for (const b of boxes) {
      expect(b.y0).toBeGreaterThanOrEqual(54);
      expect(b.y1).toBeLessThanOrEqual(84);
    }
  });

  it('a sink cabinet adds an open basin whose top is the counter top; a range has a cooktop and a backguard', () => {
    const sink = fixtureBoxes(fixture('sink'));
    const basin = sink.filter((b) => b.part === 'basin');
    expect(basin).toHaveLength(5); // bottom and four walls
    const top = 34.5 + COUNTER_THICKNESS;
    for (const b of basin.slice(1)) expect(b.y1).toBe(top);
    expect(basin[0].y0).toBe(top - BASIN.deep);
    expect(basinOutline(fixture('sink')).map((p) => p.x).sort((a, b) => a - b)).toEqual([-16.5, -16.5, 16.5, 16.5]);
    const range = fixtureBoxes(fixture('range'));
    expect(range.map((b) => b.part)).toEqual(['appliance', 'kick', 'appliance']);
    expect(range[2].y0).toBe(36);
    expect(range[2].d1).toBe(2);
  });

  it('a hood hangs at 66" with a flue; a box is one carcass; nothing is ever below the fixture bottom', () => {
    const hood = fixtureBoxes(fixture('hood'));
    expect(hood).toHaveLength(2);
    expect(hood[0].y0).toBe(66);
    expect(hood[1].y1).toBe(78);
    const box = fixtureBoxes(fixture('box', { elevation: 10 }));
    expect(box).toEqual([{ part: 'carcass', s0: -12, s1: 12, d0: 0, d1: 24, y0: 10, y1: 34 }]);
    for (const k of FIXTURE_KINDS) for (const b of fixtureBoxes(fixture(k))) expect(b.y0).toBeGreaterThanOrEqual(FIXTURE_DEFAULTS[k].elevation);
  });
});

describe('rectilinearUnion', () => {
  it('two abutting rectangles become one; a hole stays a hole; collinear corners are merged', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 36, y: 0 },
      { x: 36, y: 25 },
      { x: 0, y: 25 },
    ];
    const b = [
      { x: 36, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 25 },
      { x: 36, y: 25 },
    ];
    const rings = rectilinearUnion([a, b]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(polygonSignedArea(rings[0])).toBeCloseTo(72 * 25);
    const hole = [
      { x: 10, y: 5 },
      { x: 30, y: 5 },
      { x: 30, y: 20 },
      { x: 10, y: 20 },
    ];
    const withHole = rectilinearUnion([a, b], [hole]);
    expect(withHole).toHaveLength(2);
    const sorted = [...withHole].sort((p, q) => Math.abs(polygonSignedArea(q)) - Math.abs(polygonSignedArea(p)));
    expect(polygonSignedArea(sorted[0])).toBeCloseTo(72 * 25);
    expect(polygonSignedArea(sorted[1])).toBeCloseTo(-20 * 15);
    expect(simplifyRing([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toHaveLength(4);
  });

  it('an L of two runs is one six-cornered ring', () => {
    const along = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 25 },
      { x: 0, y: 25 },
    ];
    const down = [
      { x: 0, y: 25 },
      { x: 25, y: 25 },
      { x: 25, y: 100 },
      { x: 0, y: 100 },
    ];
    const rings = rectilinearUnion([along, down]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(6);
    expect(polygonSignedArea(rings[0])).toBeCloseTo(100 * 25 + 25 * 75);
  });
});

describe('counterRuns', () => {
  it('three abutting base cabinets along a wall share one slab with a 1" front overhang, over the sink basin', () => {
    const run = [
      fixture('base', { id: 'a', origin: { x: 18, y: 0 } }),
      fixture('sink', { id: 'b', origin: { x: 54, y: 0 } }),
      fixture('base', { id: 'c', origin: { x: 90, y: 0 } }),
      fixture('wall', { id: 'w', origin: { x: 54, y: 0 } }), // no counter
    ];
    const runs = counterRuns(run);
    expect(runs).toHaveLength(1);
    expect(runs[0].fixtureIds).toEqual(['a', 'b', 'c']);
    expect(runs[0].outline).toHaveLength(4);
    expect(polygonSignedArea(runs[0].outline)).toBeCloseTo(108 * 25);
    expect(runs[0].holes).toHaveLength(1);
    expect(Math.abs(polygonSignedArea(runs[0].holes[0]))).toBeCloseTo(33 * 22);
    expect(runs[0].y0).toBe(34.5);
    expect(runs[0].y1).toBe(36);
  });

  it('an L corner is mitred into one ring; a turned island keeps its own slab; a gap splits runs', () => {
    const l = counterRuns([
      fixture('base', { id: 'a', origin: { x: 18, y: 0 } }), // facing +y along the top wall
      fixture('base', { id: 'b', origin: { x: 0, y: 36 }, direction: 0 }), // facing +x down the left wall
      fixture('island', { id: 'i', origin: { x: 200, y: 200 }, direction: 45 }),
      fixture('base', { id: 'z', origin: { x: 400, y: 0 } }),
    ]);
    expect(l).toHaveLength(3);
    const corner = l.find((r) => r.fixtureIds.includes('a'))!;
    expect(corner.fixtureIds).toEqual(['a', 'b']);
    expect(corner.outline.length).toBe(6);
    const island = l.find((r) => r.fixtureIds.includes('i'))!;
    expect(island.outline).toHaveLength(4);
    expect(l.find((r) => r.fixtureIds.includes('z'))!.fixtureIds).toEqual(['z']);
  });
});

describe('fixtureSymbol', () => {
  it('cabinets get door ticks on the front edge, overhead kinds are dashed, appliances get a word, a range burners, a sink its basin', () => {
    const base = fixtureSymbol(fixture('base'));
    expect(base.ticks).toHaveLength(1);
    expect(base.dashed).toBe(false);
    expect(base.label).toBeNull();
    expect(base.front).toEqual([
      { x: 18, y: 24 },
      { x: -18, y: 24 },
    ]);
    expect(fixtureSymbol(fixture('wall')).dashed).toBe(true);
    expect(fixtureSymbol(fixture('fridge')).label).toBe('REF');
    expect(fixtureSymbol(fixture('box')).label).toBe('BOX');
    expect(fixtureSymbol(fixture('box', { label: 'Pantry' })).label).toBe('Pantry');
    expect(fixtureSymbol(fixture('range')).burners).toHaveLength(4);
    expect(fixtureSymbol(fixture('sink')).basin).toHaveLength(4);
    expect(fixtureSymbol(fixture('island')).ticks).toHaveLength(0);
  });
});

describe('fixture store actions', () => {
  let lid: Id;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    lid = defaultLevelId(store().plan);
  });

  it('adds with the kind defaults, rejects bad sizes, normalizes the direction, clears optional fields with undefined', () => {
    const id = store().addFixture(lid, fixture('base', { direction: 450 }))!;
    expect(id).toBeTruthy();
    const f = () => store().plan.levels[lid].fixtures[id];
    expect(f().direction).toBe(90);
    expect(store().addFixture(lid, fixture('base', { width: 0 }))).toBeNull();
    expect(store().addFixture(lid, fixture('base', { elevation: -1 }))).toBeNull();
    expect(store().addFixture(lid, { ...fixture('base'), kind: 'sofa' as Fixture['kind'] })).toBeNull();
    const before = store().plan;
    store().updateFixture(lid, id, { width: -5 });
    expect(store().plan).toBe(before);
    store().updateFixture(lid, id, { frontColor: '#ABCDEF', label: 'Pots' });
    expect(f().frontColor).toBe('#abcdef');
    expect(f().label).toBe('Pots');
    store().updateFixture(lid, id, { frontColor: undefined, label: undefined });
    expect('frontColor' in f()).toBe(false);
    expect('label' in f()).toBe(false);
    const same = store().plan;
    store().updateFixture(lid, id, { width: 36 });
    expect(store().plan).toBe(same);
  });

  it('moves, duplicates, changes phase and deletes through the shared actions', () => {
    const a = store().addFixture(lid, fixture('base', { id: undefined, origin: { x: 18, y: 0 } }))!;
    store().moveFixtures(lid, { [a]: { x: 30, y: 5 } });
    expect(store().plan.levels[lid].fixtures[a].origin).toEqual({ x: 30, y: 5 });
    const copies = store().duplicateFixtures(lid, [a], { x: 36, y: 0 });
    expect(copies).toHaveLength(1);
    expect(store().plan.levels[lid].fixtures[copies[0]].origin).toEqual({ x: 66, y: 5 });
    store().setPhase(lid, { walls: [], openings: [], fixtures: [a] }, 'demo');
    expect(store().plan.levels[lid].fixtures[a].phase).toBe('demo');
    store().deleteEntities(lid, { nodes: [], walls: [], fixtures: [a, copies[0]] });
    expect(Object.keys(store().plan.levels[lid].fixtures)).toHaveLength(0);
  });

  it('level casework defaults are set and cleared field by field', () => {
    store().updateFinishes(lid, { cabinetColor: '#112233', frontStyle: 'panel' });
    expect(store().plan.levels[lid].finishes).toEqual({ cabinetColor: '#112233', frontStyle: 'panel' });
    store().updateFinishes(lid, { cabinetColor: undefined });
    expect(store().plan.levels[lid].finishes).toEqual({ frontStyle: 'panel' });
    store().updateFinishes(lid, { frontStyle: undefined });
    expect(store().plan.levels[lid].finishes).toBeUndefined();
  });

  it('splits a wall at a distance from its start, keeping the openings on the right piece; refuses an end or an opening', () => {
    const r = store().addWall(lid, { x: 0, y: 0 }, { x: 300, y: 0 }, { kind: 'interior', thickness: 4.5, phase: 'existing' })!;
    const wallId = r.wallIds[0];
    const door = store().addOpening(lid, { wallId, type: 'door', offset: 150, width: 36, height: 80, sill: 0, phase: 'existing' })!;
    expect(store().splitWall(lid, wallId, 160)).toMatch(/inside an opening/);
    expect(store().splitWall(lid, wallId, 0)).toMatch(/not at an end/);
    expect(store().splitWall(lid, wallId, 100)).toBeNull();
    const level = store().plan.levels[lid];
    expect(Object.keys(level.walls)).toHaveLength(2);
    const o = level.openings[door];
    const host = level.walls[o.wallId];
    const len = Math.abs(level.nodes[host.b].x - level.nodes[host.a].x);
    expect(len).toBe(200);
    expect(o.offset).toBe(host.a === r.a ? 150 : 50);
  });
});

/** Every directed edge of the mesh is matched by its reverse: a closed, consistently wound surface. */
function closedEdges(g: BufferGeometry): boolean {
  const pos = g.getAttribute('position');
  const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((c) => Math.round(c * 1e4)).join(',');
  const count = new Map<string, number>();
  for (let t = 0; t < pos.count; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = key(t + i);
      const b = key(t + ((i + 1) % 3));
      if (a !== b) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n) return false;
  }
  return true;
}

describe('casework meshes', () => {
  let lid: Id;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    clearMeshCache();
    lid = defaultLevelId(store().plan);
  });
  afterAll(() => clearMeshCache());

  it('every part of every kind is a closed surface, as is a counter run with a basin hole', () => {
    for (const k of FIXTURE_KINDS) {
      const parts = buildFixtureParts(fixture(k, { frontStyle: 'panel' }));
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(triangleCount(p.geometry)).toBeGreaterThan(0);
        expect(closedEdges(p.geometry)).toBe(true);
        p.geometry.dispose();
      }
    }
    const [run] = counterRuns([fixture('sink', { id: 's', origin: { x: 0, y: 0 } }), fixture('base', { id: 'b', origin: { x: 36, y: 0 } })]);
    const g = buildCounterGeometry(run);
    expect(closedEdges(g)).toBe(true);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBe(34.5);
    expect(g.boundingBox!.max.y).toBe(36);
    g.dispose();
  });

  it('getLevelMeshes lists the visible fixtures and counters, reuses geometry while a fixture is unchanged, and hides demolished ones in Proposed', () => {
    const a = store().addFixture(lid, fixture('base', { id: undefined, origin: { x: 18, y: 0 } }))!;
    const b = store().addFixture(lid, fixture('base', { id: undefined, origin: { x: 54, y: 0 }, phase: 'demo' }))!;
    store().addFixture(lid, fixture('hood', { id: undefined, origin: { x: 100, y: 0 } }));
    const all = getLevelMeshes(store().plan, lid, 'all');
    expect(all.fixtures.map((f) => f.id).sort()).toEqual([a, b, Object.keys(store().plan.levels[lid].fixtures)[2]].sort());
    expect(all.counters).toHaveLength(1);
    expect(all.counters[0].fixtureIds.sort()).toEqual([a, b].sort());
    expect(all.counters[0].phase).toBe('existing');
    const partsA = all.fixtures.find((f) => f.id === a)!.parts;
    // An unrelated edit keeps the geometry; a change to the fixture rebuilds it.
    store().updateFixture(lid, b, { width: 30 });
    const again = getLevelMeshes(store().plan, lid, 'all');
    expect(again.fixtures.find((f) => f.id === a)!.parts).toBe(partsA);
    expect(again.counters[0]).not.toBe(all.counters[0]);
    store().updateFixture(lid, a, { frontColor: '#123456' });
    expect(getLevelMeshes(store().plan, lid, 'all').fixtures.find((f) => f.id === a)!.frontColor).toBe('#123456');
    const proposed = getLevelMeshes(store().plan, lid, 'proposed');
    expect(proposed.fixtures.map((f) => f.id)).not.toContain(b);
    expect(proposed.counters[0].fixtureIds).toEqual([a]);
    // The level default front style rebuilds the parts (panel fronts have more boxes).
    const slab = getLevelMeshes(store().plan, lid, 'all').fixtures.find((f) => f.id === a)!.parts.find((p) => p.part === 'front')!;
    store().updateFinishes(lid, { frontStyle: 'panel' });
    const panel = getLevelMeshes(store().plan, lid, 'all').fixtures.find((f) => f.id === a)!.parts.find((p) => p.part === 'front')!;
    expect(triangleCount(panel.geometry)).toBeGreaterThan(triangleCount(slab.geometry));
  });

  it('exports cabinets, appliances and counters as named meshes with named materials', () => {
    store().addFixture(lid, fixture('base', { id: undefined, origin: { x: 18, y: 0 } }));
    store().addFixture(lid, fixture('range', { id: undefined, origin: { x: 60, y: 0 }, phase: 'new' }));
    store().addFixture(lid, fixture('wall', { id: undefined, origin: { x: 18, y: 0 }, frontColor: '#abcdef' }));
    const root = buildExportScene(store().plan, 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid });
    const level = root.children[0];
    const names = level.children.map((c) => c.name);
    expect(names.filter((n) => n === 'Cabinet (base)').length).toBeGreaterThanOrEqual(2); // carcass, front, kick
    expect(names).toContain('Appliance (range)');
    expect(names).toContain('Cabinet (wall)');
    expect(names.filter((n) => n === 'Counter')).toHaveLength(1);
    const mats = new Set(level.children.map((c) => ((c as { material?: { name: string } }).material as { name: string }).name));
    expect(mats).toContain('cabinet');
    expect(mats).toContain('cabinet_abcdef');
    expect(mats).toContain('kick');
    expect(mats).toContain('appliance_new');
    expect(mats).toContain('counter');
    disposeExportScene(root);
  });
});

describe('fixtures in files', () => {
  it('schema 3 adds fixtures to every level; a v2 file gains empty records', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(createEmptyPlan().schemaVersion).toBe(3);
    const v2 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 2 }));
    for (const l of Object.values(v2.levels) as Record<string, unknown>[]) delete l.fixtures;
    const up = MIGRATIONS[2](v2);
    expect(up.schemaVersion).toBe(3);
    for (const l of Object.values(up.levels as Record<string, Record<string, unknown>>)) expect(l.fixtures).toEqual({});
    const plan = migrate(v2);
    for (const id of plan.levelOrder) expect(plan.levels[id].fixtures).toEqual({});
  });

  it('keeps valid fixtures and finishes, drops a fixture with an unknown kind or a bad size, and bad optional fields', () => {
    const base = createEmptyPlan();
    const lid = base.levelOrder[1];
    const doc = JSON.parse(JSON.stringify(base));
    doc.levels[lid].fixtures = {
      ok: { ...fixture('base'), id: 'ok', frontColor: '#ABCDEF', label: '  ', frontStyle: 'glass', counterOverhang: { front: 1 } },
      sofa: { ...fixture('base'), id: 'sofa', kind: 'sofa' },
      flat: { ...fixture('base'), id: 'flat', height: 0 },
    };
    doc.levels[lid].finishes = { cabinetColor: '#AABBCC', counterColor: 'grey', frontStyle: 'panel' };
    const plan = migrate(doc);
    const fx = plan.levels[lid].fixtures;
    expect(Object.keys(fx)).toEqual(['ok']);
    expect(fx.ok.frontColor).toBe('#abcdef');
    expect('label' in fx.ok).toBe(false);
    expect('frontStyle' in fx.ok).toBe(false);
    expect('counterOverhang' in fx.ok).toBe(false);
    expect(plan.levels[lid].finishes).toEqual({ cabinetColor: '#aabbcc', frontStyle: 'panel' });
    expect(fixtureProblem({ ...fixture('base'), counterOverhang: { front: 1, back: 0, left: 0, right: -1 } })).toMatch(/overhang/);
  });
});
