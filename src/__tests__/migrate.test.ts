import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan, defaultLevelId, DEFAULT_SETTINGS, migrate, MIGRATIONS, normalizeLevel, SCHEMA_VERSION } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();

/**
 * A hand-written file in the hypothetical pre-release format (schemaVersion 0): the entity
 * collections of a level are arrays, settings has orthoLock (an editor preference now), and there are fields this version
 * does not know (they must not leak into the plan).
 */
const V0_FILE = {
  schemaVersion: 0,
  id: 'old-plan',
  name: 'Cottage',
  levelOrder: ['ground'],
  levels: {
    ground: {
      id: 'ground',
      name: 'Ground',
      wallHeight: 96,
      floorThickness: 12,
      color: '#ffcc00',
      nodes: [
        { id: 'n1', x: 0, y: 0 },
        { id: 'n2', x: 240, y: 0 },
        { id: 'n3', x: 240, y: 180 },
        { id: 'n4', x: 0, y: 180, label: 'SW corner' },
      ],
      walls: [
        { id: 'w1', a: 'n1', b: 'n2', thickness: 6.5, kind: 'exterior', phase: 'existing', material: 'brick' },
        { id: 'w2', a: 'n2', b: 'n3', thickness: 6.5, kind: 'exterior', phase: 'existing' },
        { id: 'w3', a: 'n3', b: 'n4', thickness: 6.5 },
        { id: 'w4', a: 'n4', b: 'n1', thickness: 4.5, phase: 'bogus' },
      ],
      openings: [
        { id: 'o1', wallId: 'w1', type: 'door', offset: 60, width: 36, height: 80, sill: 0, phase: 'existing' },
        { id: 'o2', wallId: 'w2', type: 'window', offset: 90, width: 30 },
        { id: 'o3', wallId: 'gone', type: 'window', offset: 90, width: 30 },
      ],
      rooms: [{ id: 'r1', name: 'Living', anchor: { x: 120, y: 90 }, mood: 'cozy' }],
      stairs: [],
    },
  },
  baseFloorElevation: 0,
  settings: { snapGrid: 1, displayGrid: 12, precisionDenominator: 16, orthoLock: true, theme: 'dark' },
  modifiedAt: '2024-01-01T00:00:00.000Z',
  author: 'someone',
};

/** A file as saved by the v1 editor (before roofs and the site): it must keep loading. */
const V1_FILE = {
  schemaVersion: 1,
  id: 'v1-plan',
  name: 'Saved in v1',
  levelOrder: ['b', 'f'],
  levels: {
    b: { id: 'b', name: 'Basement', wallHeight: 96, floorThickness: 4, nodes: {}, walls: {}, openings: {}, rooms: {}, stairs: {} },
    f: {
      id: 'f',
      name: 'First Floor',
      wallHeight: 96,
      floorThickness: 12,
      nodes: { n1: { id: 'n1', x: 0, y: 0 }, n2: { id: 'n2', x: 240, y: 0 } },
      walls: { w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 6.5, kind: 'exterior', phase: 'existing' } },
      openings: {},
      rooms: {},
      stairs: {},
    },
  },
  baseFloorElevation: -100,
  settings: { snapGrid: 1, displayGrid: 12, precisionDenominator: 16, defaultExteriorThickness: 6.5, defaultInteriorThickness: 4.5 },
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('migrate from schemaVersion 1', () => {
  it('adds empty roofs to every level and the default site, keeping everything else', () => {
    const plan = migrate(structuredClone(V1_FILE));
    expect(plan.schemaVersion).toBe(2);
    expect(plan.levels.b.roofs).toEqual({});
    expect(plan.levels.f.roofs).toEqual({});
    expect(plan.site).toEqual({ northAngle: 0, gradePoints: {}, columns: {} });
    expect(plan.levels.f.walls.w1).toEqual(V1_FILE.levels.f.walls.w1);
    expect(plan.settings).toEqual(V1_FILE.settings);
    // The upgraded plan round-trips byte for byte from then on.
    const text = JSON.stringify(plan);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
  });
});

describe('migrate from schemaVersion 0', () => {
  it('has a migration for every older version', () => {
    for (let v = 0; v < SCHEMA_VERSION; v++) expect(typeof MIGRATIONS[v]).toBe('function');
  });

  it('converts arrays to records, fills settings, and drops unknown fields', () => {
    const plan = migrate(structuredClone(V0_FILE));
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    const g = plan.levels.ground;
    expect(Object.keys(g.nodes)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(Object.keys(g.walls)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(g.nodes.n4).toEqual({ id: 'n4', x: 0, y: 180 });
    expect(g.walls.w1).toEqual({ id: 'w1', a: 'n1', b: 'n2', thickness: 6.5, kind: 'exterior', phase: 'existing' });
    // Missing kind from thickness, unknown phase to existing.
    expect(g.walls.w3.kind).toBe('exterior');
    expect(g.walls.w4).toMatchObject({ kind: 'interior', phase: 'existing' });
    // A window gets its default height and sill; an opening on a missing wall is dropped.
    expect(Object.keys(g.openings)).toEqual(['o1', 'o2']);
    expect(g.openings.o2).toMatchObject({ height: 48, sill: 36, phase: 'existing' });
    expect(g.openings.o1.swing).toEqual({ hinge: 'a', side: 'left' });
    expect(g.rooms.r1).toEqual({ id: 'r1', name: 'Living', anchor: { x: 120, y: 90 } });
    expect(g.stairs).toEqual({});
    expect(plan.settings).toEqual({ ...DEFAULT_SETTINGS, snapGrid: 1 });
    expect('color' in g).toBe(false);
    expect('author' in plan).toBe(false);
    expect('theme' in plan.settings).toBe(false);
    expect('orthoLock' in plan.settings).toBe(false);
  });

  it('accepts levels as an array without levelOrder', () => {
    const file = structuredClone(V0_FILE) as Record<string, unknown>;
    file.levels = [(V0_FILE.levels as Record<string, unknown>).ground];
    delete file.levelOrder;
    const plan = migrate(file);
    expect(plan.levelOrder).toEqual(['ground']);
    expect(Object.keys(plan.levels.ground.walls)).toHaveLength(4);
  });

  it('produces a valid plan that round-trips byte for byte and is already normalized', () => {
    const plan = migrate(structuredClone(V0_FILE));
    const text = JSON.stringify(plan);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
    const level = structuredClone(plan.levels.ground);
    normalizeLevel(level);
    expect(level).toEqual(plan.levels.ground);
    // It loads into the store and can be edited.
    store().setPlan(plan);
    expect(store().addWall('ground', 'n1', 'n3', { kind: 'interior', thickness: 4.5, phase: 'new' })).not.toBeNull();
  });

  it('rejects files from a newer version', () => {
    expect(() => migrate({ ...V0_FILE, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/unsupported schemaVersion/);
    expect(() => migrate({ ...V0_FILE, schemaVersion: 0.5 })).toThrow(/unsupported schemaVersion/);
  });
});

describe('migrate a current file', () => {
  /** A plan with every kind of entity, built through the store as the editor would. */
  function richPlan(): Plan {
    // A fresh plan each time: drawing the same walls twice is refused (they would overlap).
    store().setPlan(createEmptyPlan());
    const s = store();
    const lid = defaultLevelId(s.plan);
    const o = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;
    s.addWall(lid, { x: 0, y: 0 }, { x: 240, y: 0 }, o);
    s.addWall(lid, { x: 240, y: 0 }, { x: 240, y: 180 }, o);
    s.addWall(lid, { x: 240, y: 180 }, { x: 0, y: 180 }, o);
    const last = s.addWall(lid, { x: 0, y: 180 }, { x: 0, y: 0 }, o)!;
    s.addWall(lid, { x: 120, y: 0 }, { x: 120, y: 180 }, { kind: 'interior', thickness: 4.5, phase: 'new' });
    const w = Object.values(store().plan.levels[lid].walls)[0];
    s.addOpening(lid, { wallId: w.id, type: 'door', offset: 60, width: 36, height: 80, sill: 0, phase: 'existing', swing: { hinge: 'a', side: 'left' }, halfLite: true, leafColor: '#2f4a3a', sashes: 2 });
    s.addOpening(lid, { wallId: last.wallIds[0], type: 'window', offset: 90, width: 30, height: 48, sill: 36, phase: 'demo', sashes: 3, fixedCenter: true, glazing: 'screen' });
    s.updateWalls(lid, [w.id], { heightOverride: 100 });
    s.addRoom(lid, { name: 'Kitchen', anchor: { x: 60, y: 90 } });
    s.addStairs(lid, { origin: { x: 180, y: 170 }, direction: 270, width: 36, run: 120, phase: 'existing', cutsFloorAbove: true });
    s.setUnderlay(lid, {
      image: 'data:image/jpeg;base64,AAAA',
      pixelWidth: 100,
      pixelHeight: 80,
      origin: { x: -10, y: -10 },
      scale: 3,
      rotation: 0,
      opacity: 0.6,
      locked: true,
    });
    s.updateSettings({ defaultInteriorThickness: 5.5 });
    s.copyWallsFromLevel(lid, store().plan.levelOrder[2]);
    const top = store().plan.levelOrder[2];
    s.addRoof(top, {
      shape: 'gable',
      outline: [
        { x: -3.25, y: -3.25 },
        { x: 243.25, y: -3.25 },
        { x: 243.25, y: 183.25 },
        { x: -3.25, y: 183.25 },
      ],
      ridgeAngle: 0,
      pitch: 8,
      overhang: 24,
      bearingOffset: 0,
      thickness: 8,
      fascia: 6,
      phase: 'existing',
      finish: 'metal',
      color: '#8a8378',
      eave: 'open',
      rafter: { depth: 5.5, spacing: 24 },
      boardColor: '#5a3a35',
      weathering: 0.6,
    });
    s.addRoof(lid, {
      shape: 'shed',
      outline: [
        { x: 0, y: -100 },
        { x: 96, y: -100 },
        { x: 96, y: -3.25 },
        { x: 0, y: -3.25 },
      ],
      ridgeAngle: 270,
      pitch: 3,
      overhang: 12,
      bearingOffset: -2,
      thickness: 6,
      fascia: 4,
      phase: 'new',
      finish: 'shingle',
    });
    // The site (M9 edits it; the file already carries it).
    const plan = structuredClone(store().plan);
    plan.site = {
      northAngle: 12.5,
      gradePoints: { g1: { id: 'g1', at: { x: 0, y: 0 }, elevation: -12 } },
      columns: { c1: { id: 'c1', at: { x: 120, y: -6 }, width: 24, depth: 40, rotation: 0, base: -100, top: 400, kind: 'chimney', phase: 'existing' } },
    };
    return plan;
  }

  it('is byte-identical after JSON.stringify (a v2 file with roofs and site data)', () => {
    const plan = richPlan();
    expect(plan.schemaVersion).toBe(2);
    expect(Object.values(plan.levels).reduce((n, l) => n + Object.keys(l.roofs).length, 0)).toBe(2);
    // The optional opening fields (sashes, glazing, door leaves) are part of the round trip.
    const openings = Object.values(plan.levels[plan.levelOrder[1]].openings);
    expect(openings.find((o) => o.type === 'door')).toMatchObject({ halfLite: true, leafColor: '#2f4a3a', sashes: 2 });
    expect(openings.find((o) => o.type === 'window')).toMatchObject({ sashes: 3, fixedCenter: true, glazing: 'screen' });
    // So are the roof's eave and appearance fields.
    const gable = Object.values(plan.levels[plan.levelOrder[2]].roofs)[0];
    expect(gable).toMatchObject({ eave: 'open', rafter: { depth: 5.5, spacing: 24 }, boardColor: '#5a3a35', weathering: 0.6 });
    const text = JSON.stringify(plan, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
  });

  it('accepts and ignores orthoLock and measureTo from files saved before they left the plan', () => {
    const plan = JSON.parse(JSON.stringify(richPlan()));
    plan.settings.orthoLock = false;
    plan.settings.measureTo = 'inside';
    const loaded = migrate(plan);
    expect('orthoLock' in loaded.settings).toBe(false);
    expect('measureTo' in loaded.settings).toBe(false);
    expect(loaded.settings).toEqual(richPlan().settings);
    // Not an error, whatever the stale values were.
    plan.settings.measureTo = 'sideways';
    expect(() => migrate(plan)).not.toThrow();
  });

  it('drops unknown fields at every level of a current file', () => {
    const clean = JSON.stringify(richPlan());
    const plan = JSON.parse(clean);
    const lid = plan.levelOrder[1];
    plan.extra = 1;
    plan.settings.extra = 1;
    plan.levels[lid].extra = 1;
    for (const k of ['nodes', 'walls', 'openings', 'rooms', 'stairs', 'roofs']) {
      for (const e of Object.values(plan.levels[lid][k]) as Record<string, unknown>[]) e.extra = 1;
    }
    plan.levels[lid].underlay.extra = 1;
    plan.site.extra = 1;
    plan.site.gradePoints.g1.extra = 1;
    plan.site.columns.c1.extra = 1;
    const text = JSON.stringify(migrate(plan));
    expect(text).not.toContain('"extra"');
    expect(text).toBe(clean);
  });
});
