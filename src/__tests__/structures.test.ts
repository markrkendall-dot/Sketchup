// Several structures on one site (schema 9, DESIGN.md "Structures"): the migration from one stack,
// validation, the store's structure actions and undo, per-structure elevations and level edits, and
// the composed scene (bounds, terrain, export) with a second building moved and turned.
import { Box3, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { getLevelElevations } from '../derive/levels';
import { getLevelMeshes } from '../derive/meshes';
import { groundAt, groundAtLevel, siteBounds, siteGhostLevelIds, terrainCut } from '../derive/site';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { createEmptyPlan, floorTops, migrate, MIGRATIONS, MIGRATED_STRUCTURE_ID, SCHEMA_VERSION, structureProblem } from '../model/plan';
import { clearOrigin, STRUCTURE_GAP, structureSiteBounds } from '../model/structureOps';
import { allLevelIds, between, firstStructure, isLowestLevel, levelAboveId, levelBelowId, stackOf, structureOf, svgTransform, toLocal, toSite } from '../model/structures';
import type { Id } from '../model/types';
import { clearHistory, undo, redo, usePlanStore } from '../store/planStore';
import { activeStructureId } from '../store/uiStore';
import { planBox } from '../view3d/bounds';
import { visible3dLevels } from '../view3d/visibility';
import { legacyDoc } from './legacy';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const ext = { kind: 'exterior', thickness: 6, phase: 'existing' } as const;

/** A 20' x 10' room on the house's first floor (centerlines x 0..240, y 0..120). */
function houseBox(): Id {
  const first = firstStructure(plan()).levelOrder[1];
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 120 },
    { x: 0, y: 120 },
  ];
  for (let i = 0; i < 4; i++) store().addWall(first, c[i], c[(i + 1) % 4], ext);
  return first;
}

/** Add a structure and return it as the plan now holds it. */
const added = (input: Parameters<ReturnType<typeof store>['addStructure']>[0]) => {
  const id = store().addStructure(input);
  return plan().structures[id];
};

beforeEach(() => {
  store().setPlan(createEmptyPlan('Site'));
  clearHistory();
});

/** A schema 8 file: one stack of levels on the plan. */
const V8_FILE = {
  schemaVersion: 8,
  id: 'v8',
  name: 'Before structures',
  levelOrder: ['b', 'f'],
  levels: {
    b: { id: 'b', name: 'Basement', wallHeight: 90, floorThickness: 4, nodes: {}, walls: {}, openings: {}, rooms: {}, stairs: {}, roofs: {}, fixtures: {}, decks: {}, floorOpenings: {}, staircases: {}, joistZones: {}, members: {} },
    f: { id: 'f', name: 'First Floor', wallHeight: 96, floorThickness: 12, nodes: {}, walls: {}, openings: {}, rooms: {}, stairs: {}, roofs: {}, fixtures: {}, decks: {}, floorOpenings: {}, staircases: {}, joistZones: {}, members: {} },
  },
  baseFloorElevation: -94,
  settings: { snapGrid: 1, displayGrid: 12, precisionDenominator: 16, defaultExteriorThickness: 6.5, defaultInteriorThickness: 4.5 },
  site: { northAngle: 10, gradePoints: {}, columns: {}, surfaces: {}, fences: {} },
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

describe('schema 9: migration from one stack', () => {
  it('MIGRATIONS[8] wraps the stack in one house at the origin, unturned', () => {
    expect(SCHEMA_VERSION).toBe(9);
    const up = MIGRATIONS[8](structuredClone(V8_FILE));
    expect(up.schemaVersion).toBe(9);
    expect('levelOrder' in up || 'baseFloorElevation' in up).toBe(false);
    const loaded = migrate(structuredClone(V8_FILE));
    const rest: Record<string, unknown> = structuredClone(V8_FILE);
    delete rest.levelOrder;
    delete rest.baseFloorElevation;
    expect(loaded).toEqual({
      ...rest,
      schemaVersion: 9,
      structures: {
        [MIGRATED_STRUCTURE_ID]: { id: MIGRATED_STRUCTURE_ID, name: 'House', kind: 'house', origin: { x: 0, y: 0 }, rotation: 0, baseFloorElevation: -94, levelOrder: ['b', 'f'] },
      },
      structureOrder: [MIGRATED_STRUCTURE_ID],
    });
    expect(structureProblem(loaded)).toBeNull();
    // The elevations are what they were.
    expect(getLevelElevations(loaded).f.floorTop).toBe(-94 + 90 + 12);
    // From then on it round-trips byte for byte.
    const text = JSON.stringify(loaded, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
  });

  it('a v8 copy of a new plan loads back to the same plan with the structure id the migration gives', () => {
    const p = createEmptyPlan('T');
    const loaded = migrate(legacyDoc(p, 8));
    const s = firstStructure(p);
    expect(loaded.structureOrder).toEqual([MIGRATED_STRUCTURE_ID]);
    expect(firstStructure(loaded)).toEqual({ ...s, id: MIGRATED_STRUCTURE_ID });
    expect(loaded.levels).toEqual(p.levels);
  });

  it('a v8 file without a base floor elevation stands at 0', () => {
    const f = structuredClone(V8_FILE) as Record<string, unknown>;
    delete f.baseFloorElevation;
    expect(firstStructure(migrate(f)).baseFloorElevation).toBe(0);
  });
});

describe('schema 9: validation', () => {
  const current = (): Record<string, unknown> & { structures: Record<string, Record<string, unknown>>; structureOrder: string[]; levels: Record<string, unknown> } => {
    store().addStructure({ kind: 'shed', name: 'Shed' });
    return JSON.parse(JSON.stringify(plan()));
  };

  it('accepts a plan with two structures and keeps their placement', () => {
    const doc = current();
    const loaded = migrate(doc);
    expect(loaded.structureOrder).toHaveLength(2);
    const shed = loaded.structures[loaded.structureOrder[1]];
    expect(shed).toMatchObject({ name: 'Shed', kind: 'shed', rotation: 0 });
    expect(structureProblem(loaded)).toBeNull();
  });

  it('refuses no structure, an empty stack, a level in two structures, a missing or unlisted structure', () => {
    let doc = current();
    doc.structureOrder = [];
    expect(() => migrate(doc)).toThrow(/structureOrder/);
    doc = current();
    doc.structures[doc.structureOrder[1]].levelOrder = [];
    expect(() => migrate(doc)).toThrow(/levelOrder must be a non-empty array/);
    doc = current();
    const houseFirst = (doc.structures[doc.structureOrder[0]].levelOrder as string[])[0];
    (doc.structures[doc.structureOrder[1]].levelOrder as string[]).push(houseFirst);
    expect(() => migrate(doc)).toThrow(/listed twice/);
    doc = current();
    doc.structureOrder.push('ghost');
    expect(() => migrate(doc)).toThrow(/structure ghost is listed in structureOrder but missing/);
    doc = current();
    doc.structureOrder.pop();
    expect(() => migrate(doc)).toThrow(/not listed in structureOrder/);
    doc = current();
    doc.structureOrder.push(doc.structureOrder[0]);
    expect(() => migrate(doc)).toThrow(/listed twice in structureOrder/);
  });

  it('fills a bad kind, name, origin and rotation, and normalizes the rotation', () => {
    const doc = current();
    const s = doc.structures[doc.structureOrder[1]];
    Object.assign(s, { kind: 'castle', name: ' ', origin: 'here', rotation: -90, extra: 1 });
    const loaded = migrate(doc).structures[doc.structureOrder[1]];
    expect(loaded).toMatchObject({ kind: 'other', name: 'Building', origin: { x: 0, y: 0 }, rotation: 270 });
    expect('extra' in loaded).toBe(false);
  });

  it('drops a level no structure lists, and structureProblem names what is wrong in memory', () => {
    const doc = current();
    (doc.levels as Record<string, unknown>).stray = (doc.levels as Record<string, unknown>)[(doc.structures[doc.structureOrder[1]].levelOrder as string[])[0]];
    expect('stray' in migrate(doc).levels).toBe(false);
    const p = structuredClone(plan());
    expect(structureProblem(p)).toBeNull();
    p.levels.stray = p.levels[allLevelIds(p)[0]];
    expect(structureProblem(p)).toMatch(/in no structure/);
    const q = structuredClone(plan());
    q.structures[q.structureOrder[1]].levelOrder.push(q.structures[q.structureOrder[0]].levelOrder[0]);
    expect(structureProblem(q)).toMatch(/two structures/);
    const r = structuredClone(plan());
    r.structures[r.structureOrder[1]].levelOrder = [];
    expect(structureProblem(r)).toMatch(/has no level/);
  });
});

describe('structure actions in the store', () => {
  it('adds a garage with its starter box beside the house, each step undoable', () => {
    houseBox();
    const before = plan();
    const id = store().addStructure({ kind: 'garage' });
    const g = plan().structures[id];
    expect(g).toMatchObject({ name: 'Garage', kind: 'garage', rotation: 0, baseFloorElevation: 0 });
    expect(plan().structureOrder).toEqual([before.structureOrder[0], id]);
    // One level on a 4" slab with lower walls (the outbuilding template).
    expect(g.levelOrder).toHaveLength(1);
    const level = plan().levels[g.levelOrder[0]];
    expect(level).toMatchObject({ name: 'Garage', wallHeight: 84, floorThickness: 4 });
    // 24' x 24' of exterior walls, a 16' opening in the front, a gable roof on the outside faces.
    expect(Object.keys(level.walls)).toHaveLength(4);
    const xs = Object.values(level.nodes).map((n) => n.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(288);
    const openings = Object.values(level.openings);
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ type: 'passage', width: 192, height: 80, sill: 0 });
    expect(Object.values(level.roofs)).toEqual([expect.objectContaining({ shape: 'gable' })]);
    // Clear of the house: STRUCTURE_GAP right of its walls' outside, level with its top.
    const house = structureSiteBounds(plan(), firstStructure(plan()))!;
    expect(g.origin.x).toBe(Math.round(house.maxX + STRUCTURE_GAP));
    expect(g.origin.y).toBe(Math.round(house.minY));
    expect(structureProblem(plan())).toBeNull();
    undo();
    expect(plan()).toBe(before);
    redo();
    expect(plan().structures[id]).toBeDefined();
  });

  it('a shed is small, other has no starter box, and names do not repeat', () => {
    const shed = added({ kind: 'shed' });
    const level = plan().levels[shed.levelOrder[0]];
    const ys = Object.values(level.nodes).map((n) => n.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(120);
    expect(Object.values(level.openings)[0]).toMatchObject({ type: 'door', width: 36 });
    const other = added({ kind: 'other', name: '  ' });
    expect(other.name).toBe('Outbuilding');
    expect(Object.keys(plan().levels[other.levelOrder[0]].walls)).toHaveLength(0);
    const second = added({ kind: 'shed', starter: false });
    expect(second.name).toBe('Shed 2');
    expect(Object.keys(plan().levels[second.levelOrder[0]].walls)).toHaveLength(0);
    // The next one goes right of all of them.
    const next = clearOrigin(plan());
    expect(next.x).toBeGreaterThan(shed.origin.x);
  });

  it('renames, moves, turns and raises a structure; refuses bad values; each is one undo step', () => {
    const id = store().addStructure({ kind: 'garage', origin: { x: 500, y: 0 } });
    clearHistory();
    store().renameStructure(id, 'Workshop');
    expect(plan().structures[id].name).toBe('Workshop');
    store().renameStructure(id, '   ');
    expect(plan().structures[id].name).toBe('Workshop');
    expect(store().updateStructure(id, { origin: { x: 600, y: -40 }, rotation: -30, kind: 'other', baseFloorElevation: -6 })).toBe(true);
    expect(plan().structures[id]).toMatchObject({ origin: { x: 600, y: -40 }, rotation: 330, kind: 'other', baseFloorElevation: -6 });
    expect(store().updateStructure(id, { origin: { x: Number.NaN, y: 0 } })).toBe(false);
    expect(store().updateStructure(id, { rotation: Infinity })).toBe(false);
    expect(store().updateStructure('nope', { rotation: 10 })).toBe(false);
    const same = plan();
    store().updateStructure(id, { rotation: 330 });
    expect(plan()).toBe(same);
    expect(usePlanStore.temporal.getState().pastStates).toHaveLength(2);
    undo();
    expect(plan().structures[id]).toMatchObject({ origin: { x: 500, y: 0 }, rotation: 0, kind: 'garage', name: 'Workshop' });
    undo();
    expect(plan().structures[id].name).toBe('Garage');
  });

  it('deletes a structure with its levels, refuses the last one, and undo brings it back', () => {
    const house = firstStructure(plan()).id;
    expect(store().deleteStructure(house)).toBe(false);
    const id = store().addStructure({ kind: 'shed' });
    const levelId = plan().structures[id].levelOrder[0];
    const before = plan();
    expect(store().deleteStructure(id)).toBe(true);
    expect(plan().structures[id]).toBeUndefined();
    expect(plan().levels[levelId]).toBeUndefined();
    expect(structureProblem(plan())).toBeNull();
    expect(store().deleteStructure(house)).toBe(false);
    undo();
    expect(plan()).toBe(before);
  });

  it('the active structure is always the active level’s', () => {
    const id = store().addStructure({ kind: 'shed' });
    const shedLevel = plan().structures[id].levelOrder[0];
    expect(activeStructureId(plan(), { activeLevelId: shedLevel })).toBe(id);
    expect(activeStructureId(plan(), { activeLevelId: firstStructure(plan()).levelOrder[0] })).toBe(firstStructure(plan()).id);
    expect(activeStructureId(plan(), { activeLevelId: 'gone' })).toBe(firstStructure(plan()).id);
  });
});

describe('levels per structure', () => {
  it('floor tops are per structure; raising one leaves the other', () => {
    const id = store().addStructure({ kind: 'garage' });
    const g = plan().structures[id];
    expect(floorTops(plan())).toEqual([-100, -100 + 96 + 12, -100 + 96 + 12 + 96 + 12]);
    expect(floorTops(plan(), id)).toEqual([0]);
    const houseTops = floorTops(plan());
    store().setBaseFloorElevation(-6, id);
    expect(floorTops(plan(), id)).toEqual([-6]);
    expect(floorTops(plan())).toEqual(houseTops);
    expect(getLevelElevations(plan())[g.levelOrder[0]]).toEqual({ floorTop: -6, ceiling: 78, slabBottom: -10 });
    // Each structure's ground floor: the house's first floor over its basement, the garage's only level.
    expect(siteGhostLevelIds(plan())).toEqual([firstStructure(plan()).levelOrder[1], g.levelOrder[0]]);
  });

  it('level lookups stay within the structure', () => {
    const id = store().addStructure({ kind: 'garage' });
    const g = plan().structures[id].levelOrder[0];
    const [b, f] = firstStructure(plan()).levelOrder;
    expect(structureOf(plan(), g)?.id).toBe(id);
    expect(stackOf(plan(), g)).toEqual([g]);
    expect(levelBelowId(plan(), g)).toBeUndefined();
    expect(levelAboveId(plan(), g)).toBeUndefined();
    expect(levelBelowId(plan(), f)).toBe(b);
    expect(isLowestLevel(plan(), g)).toBe(true);
    expect(isLowestLevel(plan(), f)).toBe(false);
    expect(allLevelIds(plan())).toEqual([...firstStructure(plan()).levelOrder, g]);
  });

  it('adds, moves and deletes levels in one structure only', () => {
    const id = store().addStructure({ kind: 'garage' });
    const g = plan().structures[id].levelOrder[0];
    const house = [...firstStructure(plan()).levelOrder];
    const loft = store().addLevel('top', 'Loft', id)!;
    expect(plan().structures[id].levelOrder).toEqual([g, loft.id]);
    expect(firstStructure(plan()).levelOrder).toEqual(house);
    // The loft sits on the garage's walls: 84" over its slab, then a framed floor.
    expect(getLevelElevations(plan())[loft.id].floorTop).toBe(84 + 12);
    // A position naming a garage level adds to the garage, whatever structure is asked for.
    expect(store().addLevel({ below: g }, undefined, firstStructure(plan()).id)).toBeNull();
    const under = store().addLevel({ below: g })!;
    expect(plan().structures[id].levelOrder).toEqual([under.id, g, loft.id]);
    // The garage's floor stays where it was; its base drops under the new level.
    expect(getLevelElevations(plan())[g].floorTop).toBe(0);
    expect(store().moveLevel(loft.id, 'up')).toBeNull();
    expect(store().moveLevel(loft.id, 'down')).not.toBeNull();
    expect(plan().structures[id].levelOrder).toEqual([under.id, loft.id, g]);
    expect(store().deleteLevel(under.id)).not.toBeNull();
    expect(store().deleteLevel(loft.id)).not.toBeNull();
    // The garage's last level is refused, though the plan has others.
    expect(store().deleteLevel(g)).toBeNull();
    expect(firstStructure(plan()).levelOrder).toEqual(house);
    // Without a structure, levels go to the main one, as before.
    const top = store().addLevel('top')!;
    expect(firstStructure(plan()).levelOrder.at(-1)).toBe(top.id);
  });
});

describe('placement', () => {
  it('toSite and toLocal are inverses; rotation is clockwise on the plan', () => {
    const s = { origin: { x: 100, y: 50 }, rotation: 90 };
    const p = toSite(s, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(60, 9);
    const q = toLocal(s, p);
    expect(q.x).toBeCloseTo(10, 9);
    expect(q.y).toBeCloseTo(0, 9);
    const t = { origin: { x: -20, y: 5 }, rotation: 30 };
    const r = between(s, t, { x: 3, y: 4 });
    const back = between(t, s, r);
    expect(back.x).toBeCloseTo(3, 9);
    expect(back.y).toBeCloseTo(4, 9);
    expect(svgTransform(s)).toBe('translate(100 50) rotate(90)');
    expect(svgTransform({ origin: { x: 0, y: 0 }, rotation: 0 })).toBeUndefined();
  });
});

describe('a second structure in the composed scene', () => {
  /** The house box plus a garage moved to (600, 200) and turned 90 degrees. */
  function site(): { garage: Id; g: Id } {
    const first = houseBox();
    // The basement under it too, so the house has a slab outline to cut the ground with.
    store().copyWallsFromLevel(first, firstStructure(plan()).levelOrder[0]);
    const garage = store().addStructure({ kind: 'garage', origin: { x: 600, y: 200 }, rotation: 90 });
    return { garage, g: plan().structures[garage].levelOrder[0] };
  }

  it('the bounds, the site bounds and the shown levels include it where it stands', () => {
    const { g } = site();
    const box = planBox(plan());
    // The garage's 288" square turned 90 degrees about (600, 200) covers x 312..600 (less the roof's
    // overhang and half the wall), y 200..488.
    const garageBox = planBox(plan(), [g]);
    // Half the 6.5" wall and the 12" overhang beyond the centerlines.
    const out = 3.25 + 12;
    expect(garageBox.max[0]).toBeCloseTo(600 + out, 6);
    expect(garageBox.min[0]).toBeCloseTo(600 - 288 - out, 6);
    expect(garageBox.min[2]).toBeCloseTo(200 - out, 6);
    expect(garageBox.max[2]).toBeCloseTo(200 + 288 + out, 6);
    expect(box.max[0]).toBe(garageBox.max[0]);
    expect(box.min[0]).toBeLessThanOrEqual(0);
    const sb = siteBounds(plan());
    // Roof outlines (not their overhang) and nodes.
    expect(sb.maxY).toBeCloseTo(200 + 288 + 3.25, 6);
    const ui = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: firstStructure(plan()).levelOrder[1] };
    expect(visible3dLevels(plan(), ui)).toContain(g);
    // "Only active level and below" keeps the other structure's levels that are not above the active floor.
    expect(visible3dLevels(plan(), { ...ui, only3dActiveAndBelow: true })).toEqual([...firstStructure(plan()).levelOrder.slice(0, 2), g]);
    expect(visible3dLevels(plan(), { ...ui, activeLevelId: firstStructure(plan()).levelOrder[0], only3dActiveAndBelow: true })).toEqual([firstStructure(plan()).levelOrder[0]]);
  });

  it('the terrain is cut under both buildings, each at its own slab', () => {
    const { g } = site();
    store().addGradePoint({ at: { x: -100, y: -100 }, elevation: 0 });
    const cut = terrainCut(plan(), 'all')!;
    const rings = cut.footprints();
    expect(rings.length).toBe(2);
    expect(cut.floorUnder).toEqual([-104 - 2, -4 - 2]);
    // The garage's ring is on the site: inside x 312..600.
    for (const p of rings[1]) {
      expect(p.x).toBeGreaterThan(300);
      expect(p.x).toBeLessThan(610);
    }
    // The ground under a garage-local point is the ground at its site point.
    expect(groundAtLevel(plan(), g, { x: 10, y: 0 })).toBe(groundAt(plan(), toSite(plan().structures[structureOf(plan(), g)!.id], { x: 10, y: 0 })));
  });

  it('the export places its level group at the origin, turned, named after the structure', () => {
    const { g } = site();
    const vis = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: g };
    const root = buildExportScene(plan(), 'all', vis);
    try {
      const group = root.children.find((c) => c.name === 'Garage: Garage')!;
      expect(group).toBeDefined();
      expect(group.position.toArray()).toEqual([600, 0, 200]);
      expect(group.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
      // In world space (inches; the root scales to metres) the garage's walls cover x 312..600, z 200..488.
      root.scale.setScalar(1);
      root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(group);
      const size = box.getSize(new Vector3());
      // Past the centerlines: half the wall, the 12" overhang and the 1.5" proud fascia.
      const out = 3.25 + 12 + 1.5;
      expect(box.max.x).toBeCloseTo(600 + out, 6);
      expect(box.min.z).toBeCloseTo(200 - out, 6);
      expect(size.x).toBeCloseTo(288 + 2 * out, 6);
      // The house's levels keep their plain names.
      expect(root.children.some((c) => c.name === 'First Floor')).toBe(true);
    } finally {
      disposeExportScene(root);
    }
    // The meshes themselves stay in the garage's own coordinates.
    const meshes = getLevelMeshes(plan(), g, 'all');
    expect(meshes.walls).toHaveLength(4);
  });
});
