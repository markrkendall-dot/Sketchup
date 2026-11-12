import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache } from '../derive/meshes';
import { levelIn, viewPlanOf } from '../derive/optionView';
import { entitiesCoexist, isVisible, phaseIn, shownPhase } from '../derive/phase';
import { getFaces } from '../derive/rooms';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { applyPhaseIn } from '../model/optionOps';
import { createEmptyPlan, defaultLevelId, FIRST_OPTION_ID, migrate, SCHEMA_VERSION } from '../model/plan';
import type { Id, Level, Phase, Plan, ViewMode, Wall } from '../model/types';
import { clearHistory, redo, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { getViewPlan } from '../store/viewStore';
import { legacyDoc } from './legacy';
import example from '../../docs/examples/146-mick-road.json';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const lid = () => defaultLevelId(plan());
const level = (p: Plan = plan()): Level => p.levels[lid()];
const ext = { kind: 'exterior', thickness: 6, phase: 'existing' } as const;
const inner = (phase: Phase) => ({ kind: 'interior', thickness: 4, phase }) as const;
const show = (id: Id | null) => useUiStore.getState().setActiveOption(id);
const optionIds = () => plan().options.map((o) => o.id);
const box = (x0: number, y0: number, x1: number, y1: number, opts = ext) => {
  const pts = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  pts.forEach((p, i) => store().addWall(lid(), p, pts[(i + 1) % 4], opts));
};
const wallAt = (l: Level, x: number, y: number): Wall | undefined =>
  Object.values(l.walls).find((w) => {
    const a = l.nodes[w.a];
    const b = l.nodes[w.b];
    return Math.min(a.x, b.x) <= x && x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= y && y <= Math.max(a.y, b.y) && (a.x === b.x ? a.x === x : a.y === y);
  });
const cabinet = (x: number, phase: Phase) => ({ kind: 'base', origin: { x, y: 0 }, direction: 90, width: 24, depth: 24, height: 36, elevation: 0, phase }) as const;

beforeEach(() => {
  store().setPlan(createEmptyPlan('Options', 'single'));
  clearHistory();
  show(null);
  clearMeshCache();
});

describe('schema 10: design options', () => {
  it('a new plan has one option, Option A', () => {
    expect(SCHEMA_VERSION).toBe(10);
    expect(plan().options).toEqual([{ id: FIRST_OPTION_ID, name: 'Option A' }]);
  });

  it('migration 9 makes one option named Option A with nothing tagged; the plan is otherwise as it was', () => {
    box(0, 0, 240, 120);
    store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'));
    const before = plan();
    const loaded = migrate(legacyDoc(before, 9));
    expect(loaded.schemaVersion).toBe(10);
    expect(loaded.options).toEqual([{ id: FIRST_OPTION_ID, name: 'Option A' }]);
    expect(loaded.levels).toEqual(before.levels);
    expect(Object.values(level(loaded).walls).some((w) => 'optionIds' in w)).toBe(false);
    // Nothing tagged: the option's view is the plan itself.
    expect(viewPlanOf(loaded, FIRST_OPTION_ID)).toBe(loaded);
  });

  it('the v9 starter loads with one option and every entity untagged', () => {
    const doc = JSON.parse(JSON.stringify(example));
    delete doc.options;
    doc.schemaVersion = 9;
    const loaded = migrate(doc);
    expect(loaded.options).toHaveLength(1);
    expect(JSON.stringify(loaded)).not.toContain('optionIds');
    expect(viewPlanOf(loaded)).toBe(loaded);
  });

  it('validation: unknown option ids are dropped, an emptied list goes, tags on existing entities go, bad options are dropped', () => {
    box(0, 0, 240, 120);
    const doc = JSON.parse(JSON.stringify(plan()));
    doc.options = [{ id: 'a', name: 'A' }, { id: 'b', name: '  ' }, { id: 'a', name: 'dup' }, { name: 'no id' }, 'junk'];
    const l = doc.levels[lid()];
    const [w1, w2, w3, w4] = Object.keys(l.walls);
    Object.assign(l.walls[w1], { phase: 'new', optionIds: ['a', 'zz', 'a', 7] });
    Object.assign(l.walls[w2], { phase: 'demo', optionIds: ['zz'] });
    Object.assign(l.walls[w3], { phase: 'existing', optionIds: ['a'] });
    Object.assign(l.walls[w4], { phase: 'new', optionIds: 'a' });
    l.rooms.r = { id: 'r', name: 'Kitchen', anchor: { x: 60, y: 60 }, optionFinishes: { a: { proposedFloor: { finish: 'tile', color: '#ABCDEF' }, proposedWall: { finish: 'nope' } }, zz: { proposedFloor: { finish: 'tile' } }, b: 'junk' } };
    const loaded = migrate(doc);
    expect(loaded.options).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'Option 2' },
    ]);
    const out = level(loaded);
    expect(out.walls[w1].optionIds).toEqual(['a']);
    expect('optionIds' in out.walls[w2]).toBe(false);
    expect(out.walls[w2].phase).toBe('demo');
    expect('optionIds' in out.walls[w3]).toBe(false);
    expect('optionIds' in out.walls[w4]).toBe(false);
    expect(out.rooms.r.optionFinishes).toEqual({ a: { proposedFloor: { finish: 'tile', color: '#abcdef' } } });
    // A file with no options at all gets the default one.
    delete doc.options;
    expect(migrate(doc).options).toEqual([{ id: FIRST_OPTION_ID, name: 'Option A' }]);
    // And a current file round-trips byte for byte.
    const text = JSON.stringify(loaded, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
  });
});

describe('the filter (derive/phase.ts phaseIn): phase x tag x view', () => {
  const views: ViewMode[] = ['existing', 'proposed', 'all'];
  /** What each view shows: null hidden, else the phase it is drawn in. */
  const seen = (phase: Phase, tags: Id[] | undefined, option: Id) =>
    views.map((v) => {
      const p = phaseIn({ phase, optionIds: tags }, option);
      return p !== null && isVisible(p, v) ? shownPhase(p, v) : null;
    });
  it.each([
    // phase, tags, shown in A: [existing, proposed, all]
    ['existing', undefined, ['existing', 'existing', 'existing']],
    ['existing', ['A'], ['existing', 'existing', 'existing']],
    ['existing', ['B'], ['existing', 'existing', 'existing']],
    ['demo', undefined, ['existing', null, 'demo']],
    ['demo', ['A'], ['existing', null, 'demo']],
    ['demo', ['B'], ['existing', 'existing', 'existing']],
    ['new', undefined, [null, 'existing', 'new']],
    ['new', ['A'], [null, 'existing', 'new']],
    ['new', ['B'], [null, null, null]],
  ] as [Phase, Id[] | undefined, (Phase | null)[]][])('%s tagged %j, seen from option A', (phase, tags, expected) => {
    expect(seen(phase, tags, 'A')).toEqual(expected);
  });

  it('the Existing view is the same in every option', () => {
    for (const phase of ['existing', 'demo', 'new'] as Phase[]) for (const tags of [undefined, ['A'], ['B']]) expect(seen(phase, tags, 'A')[0]).toBe(seen(phase, tags, 'B')[0]);
  });

  it('entities of different options only never coexist; untagged pairs follow phasesCoexist', () => {
    expect(entitiesCoexist({ phase: 'new', optionIds: ['A'] }, { phase: 'new', optionIds: ['B'] })).toBe(false);
    expect(entitiesCoexist({ phase: 'new', optionIds: ['A'] }, { phase: 'new', optionIds: ['A', 'B'] })).toBe(true);
    expect(entitiesCoexist({ phase: 'new' }, { phase: 'demo' })).toBe(false);
    // Demolished in B only, it stands in A, with A's new work.
    expect(entitiesCoexist({ phase: 'new', optionIds: ['A'] }, { phase: 'demo', optionIds: ['B'] })).toBe(true);
  });

  it('viewPlanOf leaves out another option\'s new work and stands its demolition up as existing', () => {
    box(0, 0, 240, 120);
    const b = store().addOption('Option B');
    const a = FIRST_OPTION_ID;
    const north = wallAt(level(), 60, 0)!;
    const t = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, { ...inner('new'), optionIds: [b] })!;
    store().setPhase(lid(), { walls: [north.id], openings: [] }, 'demo');
    // One option at the start of the edit? No: two now, so the demolition is the active one's (A).
    expect(level().walls[north.id]).toMatchObject({ phase: 'demo', optionIds: [a] });
    const inA = level(viewPlanOf(plan(), a));
    const inB = level(viewPlanOf(plan(), b));
    expect(inA.walls[t.wallIds[0]]).toBeUndefined();
    expect(inB.walls[t.wallIds[0]].phase).toBe('new');
    expect(inA.walls[north.id].phase).toBe('demo');
    expect(inB.walls[north.id].phase).toBe('existing');
    expect('optionIds' in inB.walls[north.id]).toBe(false);
    // A has no new wall; B's partition stands on the corners its T junctions put in the existing walls.
    expect(Object.values(inA.walls).some((w) => w.phase === 'new')).toBe(false);
    expect(Object.keys(inB.nodes)).toEqual(Object.keys(inA.nodes));
  });
});

describe('new work and demolition take the active option', () => {
  it('with one option nothing is tagged', () => {
    box(0, 0, 240, 120);
    store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'));
    const id = store().addFixture(lid(), cabinet(30, 'new'))!;
    const north = wallAt(level(), 60, 0)!;
    store().setPhase(lid(), { walls: [north.id], openings: [] }, 'demo');
    expect(JSON.stringify(level())).not.toContain('optionIds');
    expect(level().fixtures[id].phase).toBe('new');
  });

  it('with several, drawn new work and Mark demolish are the shown option\'s; work from before stays in every option', () => {
    box(0, 0, 240, 120);
    const before = store().addFixture(lid(), cabinet(30, 'new'))!;
    const b = store().addOption();
    expect(plan().options.map((o) => o.name)).toEqual(['Option A', 'Option B']);
    show(b);
    const isl = store().addFixture(lid(), { ...cabinet(120, 'new'), kind: 'island' })!;
    const old = store().addFixture(lid(), cabinet(200, 'existing'))!;
    const w = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 60 }, inner('new'))!;
    expect(level().fixtures[before].optionIds).toBeUndefined();
    expect(level().fixtures[isl].optionIds).toEqual([b]);
    expect(level().fixtures[old].optionIds).toBeUndefined();
    expect(level().walls[w.wallIds[0]].optionIds).toEqual([b]);
    // Mark demolish in B, then in A too: one demolition in both.
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [old] }, 'demo');
    expect(level().fixtures[old]).toMatchObject({ phase: 'demo', optionIds: [b] });
    show(FIRST_OPTION_ID);
    expect(level(getViewPlan()).fixtures[old].phase).toBe('existing');
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [old] }, 'demo');
    expect(level().fixtures[old].optionIds).toEqual([b, FIRST_OPTION_ID]);
    // Keep it in A: B's demolition stays.
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [old] }, 'existing');
    expect(level().fixtures[old]).toMatchObject({ phase: 'demo', optionIds: [b] });
    // An all-options demolition kept in A stays demolished in the others.
    const shared = store().addFixture(lid(), cabinet(60, 'existing'))!;
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [shared] }, 'demo');
    store().setEntityOption(lid(), { nodes: [], walls: [], fixtures: [shared] }, undefined);
    expect(level().fixtures[shared].optionIds).toBeUndefined();
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [shared] }, 'existing');
    expect(level().fixtures[shared]).toMatchObject({ phase: 'demo', optionIds: [b] });
  });

  it('applyPhaseIn without a work option sets the phase and drops tags on existing', () => {
    const e = { id: 'x', phase: 'demo' as Phase, optionIds: ['A'] };
    expect(applyPhaseIn(e, 'existing', undefined, ['A'])).toBe(true);
    expect(e).toEqual({ id: 'x', phase: 'existing' });
  });

  it('setEntityOption moves a new wall and its new openings to another option or every option', () => {
    box(0, 0, 240, 120);
    const b = store().addOption();
    const w = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'))!.wallIds[0];
    const door = store().addOpening(lid(), { wallId: w, type: 'door', offset: 60, width: 30, height: 80, sill: 0, phase: 'new' })!;
    expect(level().walls[w].optionIds).toEqual([FIRST_OPTION_ID]);
    store().setEntityOption(lid(), { nodes: [], walls: [w] }, [b]);
    expect(level().walls[w].optionIds).toEqual([b]);
    expect(level().openings[door].optionIds).toEqual([b]);
    store().setEntityOption(lid(), { nodes: [], walls: [w] }, undefined);
    expect(level().walls[w].optionIds).toBeUndefined();
    expect(level().openings[door].optionIds).toBeUndefined();
  });
});

/** A 20' x 12' room with an existing base run on its north wall; Option B added (nothing in it yet). */
function kitchen(): { run: Id[]; north: Id; b: Id } {
  box(0, 0, 240, 144);
  const run = [30, 54, 78].map((x) => store().addFixture(lid(), cabinet(x, 'existing'))!);
  const north = wallAt(level(), 60, 0)!.id;
  const b = store().addOption();
  return { run, north, b };
}

describe('duplicateOption', () => {
  it('copies the option\'s new work under new ids, keeping references between the copies, and shares its demolitions', () => {
    const { run, b } = kitchen();
    const a = FIRST_OPTION_ID;
    show(a);
    store().setPhase(lid(), { walls: [], openings: [], fixtures: run }, 'demo');
    // A: a new partition (from the north wall into the room, then east) and a door in it; a new
    // window in the existing south wall; a new cabinet.
    store().addWall(lid(), { x: 160, y: 0 }, { x: 160, y: 80 }, inner('new'));
    store().addWall(lid(), { x: 160, y: 80 }, { x: 240, y: 80 }, inner('new'));
    const part = wallAt(level(), 160, 40)!.id;
    const door = store().addOpening(lid(), { wallId: part, type: 'door', offset: 40, width: 30, height: 80, sill: 0, phase: 'new' })!;
    const south = wallAt(level(), 60, 144)!.id;
    const win = store().addOpening(lid(), { wallId: south, type: 'window', offset: 60, width: 30, height: 40, sill: 36, phase: 'new' })!;
    const cab = store().addFixture(lid(), cabinet(100, 'new'))!;
    const before = JSON.parse(JSON.stringify(level()));
    const c = store().duplicateOption(a, 'Option C')!;
    expect(optionIds()).toEqual([a, b, c]);
    const l = level();
    // A is untouched apart from its demolitions now naming C too.
    for (const id of run) expect(l.fixtures[id]).toMatchObject({ phase: 'demo', optionIds: [a, c] });
    expect(l.walls[part]).toEqual(before.walls[part]);
    expect(l.fixtures[cab]).toEqual(before.fixtures[cab]);
    // C has its own copies.
    const cWalls = Object.values(l.walls).filter((w) => w.optionIds?.includes(c));
    expect(cWalls).toHaveLength(2);
    expect(cWalls.every((w) => !before.walls[w.id] && w.optionIds!.length === 1)).toBe(true);
    const cOpenings = Object.values(l.openings).filter((o) => o.optionIds?.includes(c));
    expect(cOpenings).toHaveLength(2);
    const cDoor = cOpenings.find((o) => o.type === 'door')!;
    const cWin = cOpenings.find((o) => o.type === 'window')!;
    // The door is in C's copy of the partition; the window stays in the existing south wall.
    expect(cWalls.map((w) => w.id)).toContain(cDoor.wallId);
    expect(cDoor.offset).toBe(l.openings[door].offset);
    expect(cWin.wallId).toBe(south);
    expect(l.openings[win].wallId).toBe(south);
    // Corners: the partition's end on the existing north wall is shared; its own corners are C's own.
    const aPart = l.walls[part];
    const cPart = cWalls.find((w) => w.id === cDoor.wallId)!;
    const onNorth = (w: Wall) => [w.a, w.b].find((n) => l.nodes[n].y === 0)!;
    expect(onNorth(cPart)).toBe(onNorth(aPart));
    const corner = (w: Wall) => [w.a, w.b].find((n) => l.nodes[n].y !== 0)!;
    expect(corner(cPart)).not.toBe(corner(aPart));
    expect(l.nodes[corner(cPart)]).toMatchObject({ x: l.nodes[corner(aPart)].x, y: l.nodes[corner(aPart)].y });
    // Every reference resolves.
    for (const w of Object.values(l.walls)) expect(l.nodes[w.a] && l.nodes[w.b]).toBeTruthy();
    for (const o of Object.values(l.openings)) expect(l.walls[o.wallId]).toBeTruthy();
    // Changing C's cabinet leaves A's alone; moving C's corner leaves A's partition.
    const cCab = Object.values(l.fixtures).find((f) => f.optionIds?.includes(c))!;
    store().updateFixture(lid(), cCab.id, { width: 36 });
    expect(level().fixtures[cab].width).toBe(24);
    store().moveNode(lid(), corner(cPart), { x: 160, y: 100 });
    expect(level().nodes[corner(aPart)]).toMatchObject({ x: 160, y: 80 });
    // C's view and A's view each have one partition, B's none.
    const count = (opt: Id) => Object.values(level(viewPlanOf(plan(), opt)).walls).filter((w) => w.phase === 'new').length;
    expect([count(a), count(b), count(c)]).toEqual([2, 0, 2]);
    // One undo step takes the copy away.
    undo(); // the corner move
    undo(); // the cabinet width
    undo(); // the duplicate
    expect(optionIds()).toEqual([a, b]);
    expect(JSON.parse(JSON.stringify(level()))).toEqual(before);
    redo();
    expect(optionIds()).toEqual([a, b, c]);
  });

  it('copies a staircase made of the option\'s own new flights, and the option\'s look and room finishes', () => {
    box(0, 0, 240, 144);
    store().addOption();
    const a = FIRST_OPTION_ID;
    const st = store().addStairs(lid(), { origin: { x: 60, y: 130 }, direction: 270, width: 36, run: 100, phase: 'new', cutsFloorAbove: false })!;
    const sc = store().groupStairs(lid(), [st], { name: 'Hall stair' })!;
    store().updateOptionLook(a, { wallColor: '#112233' });
    const room = store().addRoom(lid(), { name: 'Kitchen', anchor: { x: 60, y: 60 } })!;
    store().updateRoomOptionFinishes(lid(), room, a, { proposedFloor: { finish: 'tile' } });
    const c = store().duplicateOption(a)!;
    const l = level();
    const copy = Object.values(l.stairs).find((s) => s.optionIds?.includes(c))!;
    expect(copy.staircaseId).not.toBe(sc);
    expect(l.staircases[copy.staircaseId!]).toMatchObject({ name: 'Hall stair' });
    expect(plan().options.find((o) => o.id === c)!.proposedLook).toEqual({ wallColor: '#112233' });
    expect(l.rooms[room].optionFinishes![c]).toEqual({ proposedFloor: { finish: 'tile' } });
  });
});

describe('deleteOption', () => {
  it('removes its own new work, undoes its own demolitions, untags shared ones, and refuses the last option', () => {
    const { run, north, b } = kitchen();
    show(b);
    const isl = store().addFixture(lid(), { ...cabinet(120, 'new'), kind: 'island' })!;
    const w = store().addWall(lid(), { x: 120, y: 144 }, { x: 120, y: 100 }, inner('new'))!.wallIds[0];
    store().addOpening(lid(), { wallId: w, type: 'passage', offset: 20, width: 24, height: 80, sill: 0, phase: 'new' });
    store().setPhase(lid(), { walls: [north], openings: [], fixtures: [run[0]] }, 'demo');
    show(FIRST_OPTION_ID);
    store().setPhase(lid(), { walls: [], openings: [], fixtures: [run[0]] }, 'demo');
    const wallsBefore = Object.keys(level().walls).length;
    expect(store().deleteOption(b)).toBe(true);
    const l = level();
    expect(optionIds()).toEqual([FIRST_OPTION_ID]);
    expect(l.fixtures[isl]).toBeUndefined();
    expect(l.walls[w]).toBeUndefined();
    expect(Object.values(l.openings)).toHaveLength(0);
    expect(Object.keys(l.walls).length).toBeLessThan(wallsBefore);
    // No corner is left that no wall uses (the T stays as a joint in the south wall, as a deleted wall leaves it).
    const used = new Set(Object.values(l.walls).flatMap((x) => [x.a, x.b]));
    expect(Object.keys(l.nodes).every((n) => used.has(n))).toBe(true);
    expect(l.walls[north].phase).toBe('existing');
    expect('optionIds' in l.walls[north]).toBe(false);
    expect(l.fixtures[run[0]]).toMatchObject({ phase: 'demo', optionIds: [FIRST_OPTION_ID] });
    expect(store().deleteOption(FIRST_OPTION_ID)).toBe(false);
    undo();
    expect(optionIds()).toEqual([FIRST_OPTION_ID, b]);
    expect(level().fixtures[isl]).toBeTruthy();
  });
});

describe('downstream follows the active option', () => {
  /** A box split in two by an existing partition; A takes it out, B keeps it and adds a new one the other way. */
  function twoLayouts(): { b: Id; partition: Id } {
    box(0, 0, 240, 120);
    const partition = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('existing'))!.wallIds[0];
    const b = store().addOption();
    show(FIRST_OPTION_ID);
    store().setPhase(lid(), { walls: [partition], openings: [] }, 'demo');
    show(b);
    store().addWall(lid(), { x: 0, y: 60 }, { x: 120, y: 60 }, inner('new'));
    return { b, partition };
  }

  it('rooms are found per option', () => {
    const { b } = twoLayouts();
    const faces = (opt: Id, v: ViewMode) => getFaces(level(viewPlanOf(plan(), opt)), v).faces.length;
    expect(faces(FIRST_OPTION_ID, 'proposed')).toBe(1);
    expect(faces(b, 'proposed')).toBe(3);
    // The Existing view is the house as it stands in both.
    expect(faces(FIRST_OPTION_ID, 'existing')).toBe(2);
    expect(faces(b, 'existing')).toBe(2);
  });

  it('the 3D export differs between options', () => {
    const { b } = twoLayouts();
    const walls = (opt: Id) => {
      const root = buildExportScene(viewPlanOf(plan(), opt), 'proposed', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid() });
      const names = root.children.flatMap((g) => g.children.map((c) => c.name)).filter((n) => n.startsWith('Wall '));
      disposeExportScene(root);
      return names;
    };
    const inA = walls(FIRST_OPTION_ID);
    const inB = walls(b);
    expect(inA.some((n) => n.includes('interior'))).toBe(false);
    expect(inB.filter((n) => n.includes('interior')).length).toBeGreaterThanOrEqual(2);
  });

  it('caches: switching option gives that option\'s results, and switching back the first ones again', () => {
    const { b } = twoLayouts();
    show(FIRST_OPTION_ID);
    const vA = getViewPlan();
    const fA = getFaces(level(vA), 'proposed');
    show(b);
    const vB = getViewPlan();
    expect(vB).not.toBe(vA);
    const fB = getFaces(level(vB), 'proposed');
    expect(fB.faces.length).not.toBe(fA.faces.length);
    show(FIRST_OPTION_ID);
    expect(getViewPlan()).toBe(vA);
    expect(getFaces(level(getViewPlan()), 'proposed')).toBe(fA);
    // An option id the plan no longer has (after an undo) shows the first option.
    show('gone');
    expect(getViewPlan()).toBe(vA);
    // A level nothing option-specific touches is the same object in every option.
    const other = Object.values(plan().levels).find((l) => l.id !== lid());
    if (other) expect(levelIn(other, b)).toBe(other);
  });

  it('the option\'s proposed look and room finishes replace the shared ones, field by field', () => {
    const { b } = twoLayouts();
    store().updateProposedLook({ wallFinish: 'shake', wallColor: '#111111' });
    store().updateOptionLook(b, { wallColor: '#222222' });
    expect(viewPlanOf(plan(), FIRST_OPTION_ID).proposedLook).toEqual({ wallFinish: 'shake', wallColor: '#111111' });
    expect(viewPlanOf(plan(), b).proposedLook).toEqual({ wallFinish: 'shake', wallColor: '#222222' });
    const room = store().addRoom(lid(), { name: 'Hall', anchor: { x: 60, y: 30 } })!;
    store().updateRoom(lid(), room, { proposedFloor: { finish: 'boards' } });
    store().updateRoomOptionFinishes(lid(), room, b, { proposedFloor: { finish: 'tile' } });
    expect(level(viewPlanOf(plan(), FIRST_OPTION_ID)).rooms[room].proposedFloor).toEqual({ finish: 'boards' });
    expect(level(viewPlanOf(plan(), b)).rooms[room].proposedFloor).toEqual({ finish: 'tile' });
    // Switching option is not an undo step; the look edits are.
    show(FIRST_OPTION_ID);
    undo();
    expect(level().rooms[room].optionFinishes).toBeUndefined();
    expect(useUiStore.getState().activeOptionId).toBe(FIRST_OPTION_ID);
  });

  it('two options\' walls between the same corners both stay (normalize keeps each option\'s own)', () => {
    box(0, 0, 240, 120);
    const b = store().addOption();
    store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'));
    show(b);
    const r = store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'));
    expect(r).not.toBeNull();
    const news = Object.values(level().walls).filter((w) => w.phase === 'new');
    expect(news.map((w) => w.optionIds)).toEqual([[FIRST_OPTION_ID], [b]]);
    store().normalize(lid());
    expect(Object.values(level().walls).filter((w) => w.phase === 'new')).toHaveLength(2);
    // Drawing on top of the option's own wall is still refused.
    expect(store().addWall(lid(), { x: 120, y: 0 }, { x: 120, y: 120 }, inner('new'))).toBeNull();
  });
});
