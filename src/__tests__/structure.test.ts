import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, migrate, MIGRATIONS, SCHEMA_VERSION } from '../model/plan';
import { joistWords, memberProblem, normalizeJoists } from '../model/structure';
import type { Id } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
let b: Id;
let f: Id;
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  [b, f] = plan().levelOrder;
});

describe('structure model', () => {
  it('names joist axes and normalizes them', () => {
    expect(normalizeJoists(270)).toBe(90);
    expect(normalizeJoists(-10)).toBe(170);
    expect(joistWords(90)).toBe('north-south');
    expect(joistWords(0)).toBe('east-west');
    expect(joistWords(180)).toBe('east-west');
    expect(joistWords(30)).toBe('30°');
  });

  it('checks members', () => {
    expect(memberProblem({ kind: 'beam', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, width: 3.5, depth: 11.875, mount: 'flush' }, false)).toBeNull();
    expect(memberProblem({ kind: 'beam', a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 }, width: 3.5, depth: 11.875, mount: 'flush' }, false)).toMatch(/long/);
    expect(memberProblem({ kind: 'post', at: { x: 0, y: 0 }, width: 5.5, depth: 5.5, rotation: 0, footing: { width: 24, thickness: 12 } }, false)).toMatch(/lowest/);
    expect(memberProblem({ kind: 'post', at: { x: 0, y: 0 }, width: 5.5, depth: 5.5, rotation: 0, footing: { width: 24, thickness: 12 } }, true)).toBeNull();
  });
});

describe('structure store actions', () => {
  it('adds, updates, places, phases and deletes beams and posts, one undo step each', () => {
    const beam = store().addMember(f, { kind: 'beam', a: { x: 0, y: 50 }, b: { x: 120, y: 50 }, width: 3.5, depth: 11.875, mount: 'flush', phase: 'new', label: '  (2) LVL ' })!;
    expect(plan().levels[f].members[beam]).toMatchObject({ kind: 'beam', label: '(2) LVL', phase: 'new' });
    store().updateMember(f, beam, { mount: 'dropped', label: undefined });
    expect(plan().levels[f].members[beam]).toMatchObject({ mount: 'dropped' });
    expect('label' in plan().levels[f].members[beam]).toBe(false);
    undo();
    expect(plan().levels[f].members[beam]).toMatchObject({ mount: 'flush', label: '(2) LVL' });
    const post = store().addMember(b, { kind: 'post', at: { x: 60, y: 50 }, width: 5.5, depth: 5.5, rotation: 0, phase: 'new', footing: { width: 24, thickness: 12 } })!;
    expect(store().addMember(f, { kind: 'post', at: { x: 60, y: 50 }, width: 5.5, depth: 5.5, rotation: 0, phase: 'new', footing: { width: 24, thickness: 12 } })).toBeNull();
    store().placeMembers(f, { [beam]: { a: { x: 10, y: 50 }, b: { x: 130, y: 50 } } });
    expect(plan().levels[f].members[beam]).toMatchObject({ a: { x: 10, y: 50 }, b: { x: 130, y: 50 } });
    store().setPhase(b, { walls: [], openings: [], members: [post] }, 'demo');
    expect(plan().levels[b].members[post].phase).toBe('demo');
    store().deleteEntities(f, { nodes: [], walls: [], members: [beam] });
    expect(plan().levels[f].members).toEqual({});
  });

  it('sets the framing over a level and its joist zones', () => {
    store().setLevelFraming(f, { joists: 270 });
    expect(plan().levels[f].framing).toEqual({ joists: 90 });
    const before = plan();
    store().setLevelFraming(f, { joists: 90 });
    expect(plan()).toBe(before);
    store().setLevelFraming(f, undefined);
    expect(plan().levels[f].framing).toBeUndefined();
    const z = store().addJoistZone(f, { outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], joists: 180, phase: 'new' })!;
    expect(plan().levels[f].joistZones[z]).toMatchObject({ joists: 0 });
    store().updateJoistZone(f, z, { joists: 90 });
    expect(plan().levels[f].joistZones[z].joists).toBe(90);
    store().deleteEntities(f, { nodes: [], walls: [], joistZones: [z] });
    expect(plan().levels[f].joistZones).toEqual({});
  });

  it("keeps a wall's bearing flag; undefined clears it", () => {
    const r = store().addWall(f, { x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'interior', thickness: 5, phase: 'existing' })!;
    const id = Object.keys(plan().levels[f].walls)[0];
    expect(r).toBeTruthy();
    store().updateWalls(f, [id], { bearing: true });
    expect(plan().levels[f].walls[id].bearing).toBe(true);
    store().updateWalls(f, [id], { bearing: undefined });
    expect('bearing' in plan().levels[f].walls[id]).toBe(false);
  });
});

describe('structure in the file', () => {
  it('schema 7 adds joist zones and members to every level', () => {
    expect(SCHEMA_VERSION).toBe(7);
    const v6 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 6 }));
    for (const l of Object.values(v6.levels) as Record<string, unknown>[]) {
      delete l.joistZones;
      delete l.members;
    }
    expect(MIGRATIONS[6](v6).schemaVersion).toBe(7);
    const loaded = migrate(v6);
    for (const id of loaded.levelOrder) expect([loaded.levels[id].joistZones, loaded.levels[id].members]).toEqual([{}, {}]);
  });

  it('keeps good members, zones, framing and bearing flags, drops broken ones with a warning, and round-trips', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store().addWall(f, { x: 0, y: 0 }, { x: 100, y: 0 }, { kind: 'interior', thickness: 5, phase: 'existing' });
    const wid = Object.keys(plan().levels[f].walls)[0];
    store().updateWalls(f, [wid], { bearing: false });
    store().setLevelFraming(f, { joists: 90, depth: 9.25 });
    store().addMember(f, { id: 'bm', kind: 'beam', a: { x: 0, y: 50 }, b: { x: 120, y: 50 }, width: 3.5, depth: 11.875, mount: 'flush', phase: 'new' });
    store().addMember(b, { id: 'pt', kind: 'post', at: { x: 60, y: 50 }, width: 5.5, depth: 5.5, rotation: 0, phase: 'new', footing: { width: 24, thickness: 12 } });
    const doc = JSON.parse(JSON.stringify(plan()));
    doc.levels[f].members.bad = { kind: 'beam', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, width: 3, depth: 3, mount: 'flush' };
    doc.levels[f].members.footed = { kind: 'post', at: { x: 0, y: 0 }, width: 5, depth: 5, rotation: 0, footing: { width: 24, thickness: 12 } };
    doc.levels[f].joistZones.z = { outline: [{ x: 0, y: 0 }], joists: 90 };
    doc.levels[f].framing.joists = 'north';
    const loaded = migrate(doc);
    expect(Object.keys(loaded.levels[f].members)).toEqual(['bm']);
    expect(Object.keys(loaded.levels[b].members)).toEqual(['pt']);
    expect(loaded.levels[f].joistZones).toEqual({});
    expect(loaded.levels[f].framing).toBeUndefined();
    expect(loaded.levels[f].walls[wid].bearing).toBe(false);
    expect(warn).toHaveBeenCalled();
    const good = migrate(JSON.parse(JSON.stringify(plan())));
    expect(good.levels[f].framing).toEqual({ joists: 90, depth: 9.25 });
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(good))))).toBe(JSON.stringify(good));
    warn.mockRestore();
  });
});
