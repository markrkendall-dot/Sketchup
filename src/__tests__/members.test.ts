import type { BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { beamHeights, joistDepth, joistsAt, joistTop, memberAxis, memberBoxes, timberTop, type AxisPoint } from '../derive/members';
import { getMemberMeshes, logBetween, MEMBER_INSET } from '../derive/meshes';
import { FLUE_SIDES } from '../derive/site';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { hitTest } from '../editor2d/tools/selectTool';
import { buildExportScene } from '../io/export3d';
import { structureIssues } from '../derive/structureChecks';
import { createEmptyPlan, migrate } from '../model/plan';
import { logEndColor, MEMBER_COLOR, memberProblem } from '../model/structure';
import type { Beam, Id, Post } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
const plan = () => store().plan;
const ptr = (x: number, y: number, over: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false, ...over });
const click = (x: number, y: number) => {
  dispatchPointer('down', ptr(x, y));
  dispatchPointer('up', ptr(x, y));
};
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const beamOf = (over: Partial<Beam> = {}) => ({ kind: 'beam' as const, a: { x: 0, y: 100 }, b: { x: 200, y: 100 }, width: 3.5, depth: 11.875, mount: 'flush' as const, phase: 'new' as const, ...over });
const postOf = (over: Partial<Post> = {}) => ({ kind: 'post' as const, at: { x: 100, y: 100 }, width: 5.5, depth: 5.5, rotation: 0, phase: 'new' as const, ...over });

let b: Id;
let f: Id;
let s: Id;
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  [b, f, s] = plan().levelOrder;
  ui().setActiveLevel(f);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  ui().setSelection(EMPTY_SELECTION);
  ui().resetDraft();
  if (ui().showStructure) ui().toggleStructure();
  switchTool('select');
});

describe('member heights', () => {
  it('takes the joist depth from the floor above, the framing, or the attic default', () => {
    // First Floor: 96" walls under a 12" Second Floor, less the 3/4" subfloor.
    expect(joistDepth(plan(), f)).toBe(11.25);
    expect(joistTop(plan(), f)).toBe(107.25);
    expect(joistDepth(plan(), s)).toBe(5.5);
    store().setLevelFraming(f, { joists: 90, depth: 9.25 });
    expect(joistDepth(plan(), f)).toBe(9.25);
  });

  it('puts a flush beam in the joists, a dropped one under the ceiling, and a post up to the beam over it', () => {
    expect(beamHeights(plan(), f, { mount: 'flush', depth: 11.875 })).toEqual({ bottom: 107.25 - 11.875, top: 107.25 });
    expect(beamHeights(plan(), f, { mount: 'dropped', depth: 11.875 })).toEqual({ bottom: 96 - 11.875, top: 96 });
    store().addMember(f, { ...beamOf({ mount: 'dropped' }), id: 'bm' });
    store().addMember(f, { ...postOf(), id: 'under' });
    store().addMember(f, { ...postOf({ at: { x: 100, y: 200 } }), id: 'free' });
    const lvl = plan().levels[f];
    expect(memberBoxes(plan(), f, lvl.members.under).body).toMatchObject({ bottom: 0, top: 96 - 11.875 });
    expect(memberBoxes(plan(), f, lvl.members.free).body.top).toBe(96);
    store().addMember(b, { ...postOf(), id: 'footed', footing: { width: 24, thickness: 12 } });
    // The basement slab is 4" thick: the footing's top is under it.
    expect(memberBoxes(plan(), b, plan().levels[b].members.footed).footing).toMatchObject({ bottom: -16, top: -4 });
  });

  it('reads the joists at a point: the last zone shown there, else the framing', () => {
    expect(joistsAt(plan(), f, { x: 50, y: 50 }, 'all')).toBeNull();
    store().setLevelFraming(f, { joists: 90 });
    store().addJoistZone(f, { outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], joists: 0, phase: 'new' });
    expect(joistsAt(plan(), f, { x: 50, y: 50 }, 'all')?.joists).toBe(0);
    expect(joistsAt(plan(), f, { x: 50, y: 50 }, 'existing')?.joists).toBe(90);
    expect(joistsAt(plan(), f, { x: 150, y: 50 }, 'all')?.joists).toBe(90);
  });
});

describe('member meshes', () => {
  const ys = (g: BufferGeometry) => {
    const p = g.getAttribute('position');
    const out = new Set<number>();
    for (let i = 0; i < p.count; i++) out.add(Math.round(p.getY(i) * 1e4) / 1e4);
    return [...out].sort((x, y) => x - y);
  };

  it('draws a flush beam only where it hangs below the ceiling, and nothing on a slab face', () => {
    store().addMember(f, { ...beamOf(), id: 'deep' });
    store().addMember(f, { ...beamOf({ a: { x: 0, y: 200 }, b: { x: 200, y: 200 }, depth: 9.25 }), id: 'shallow' });
    store().addMember(b, { ...postOf(), id: 'p', footing: { width: 24, thickness: 12 } });
    const [deep, shallow] = getMemberMeshes(plan(), f, 'all');
    expect(ys(deep.body!)).toEqual([107.25 - 11.875, 96 - MEMBER_INSET]);
    expect(shallow.body).toBeNull();
    const [post] = getMemberMeshes(plan(), b, 'all');
    expect(ys(post.body!)).toEqual([0, 96 - MEMBER_INSET]);
    expect(ys(post.footing!)).toEqual([-16, -4 - MEMBER_INSET]);
    // Same plan, same array; a demolished member is hidden in the Proposed view.
    expect(getMemberMeshes(plan(), f, 'all')).toBe(getMemberMeshes(plan(), f, 'all'));
    store().setPhase(f, { walls: [], openings: [], members: ['deep'] }, 'demo');
    expect(getMemberMeshes(plan(), f, 'proposed').map((m) => m.id)).toEqual(['shallow']);
  });

  it('exports Beam, Post and Footing meshes with member_<part>_<phase> materials', () => {
    store().addMember(f, { ...beamOf(), id: 'bm' });
    store().addMember(b, { ...postOf(), id: 'p', footing: { width: 24, thickness: 12 } });
    const root = buildExportScene(plan(), 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: f });
    const parts = (level: string) => ((root.children.find((c) => c.name === level) as Group).children as Mesh[]).map((m) => `${m.name}:${(m.material as MeshStandardMaterial).name}`);
    expect(parts('First Floor')).toContain('Beam:member_beam_new');
    expect(parts('Basement')).toEqual(expect.arrayContaining(['Post:member_post_new', 'Footing:member_footing_new']));
  });
});

describe('structure tools', () => {
  it('the beam tool takes two clicks; Esc drops the first end', () => {
    switchTool('beam');
    click(12, 100);
    press('Escape');
    expect(ui().draft.measure).toBeNull();
    click(12, 100);
    click(204, 100);
    const beams = Object.values(plan().levels[f].members);
    expect(beams).toHaveLength(1);
    expect(beams[0]).toMatchObject({ kind: 'beam', a: { x: 12, y: 100 }, b: { x: 204, y: 100 }, mount: 'flush', label: '(2) 1 3/4 x 11 7/8 LVL', phase: 'existing' });
    expect(ui().selection.members).toEqual([beams[0].id]);
  });

  it('the post tool snaps to a beam end above and gives a footing on the lowest level only', () => {
    store().addMember(f, beamOf());
    ui().setActiveLevel(b);
    switchTool('post');
    click(204, 103);
    const [post] = Object.values(plan().levels[b].members) as Post[];
    expect(post.at).toEqual({ x: 200, y: 100 });
    expect(post.footing).toEqual({ width: 24, thickness: 12 });
    ui().setActiveLevel(s);
    click(300, 300);
    expect((Object.values(plan().levels[s].members) as Post[])[0].footing).toBeUndefined();
  });

  it('the joist zone tool starts its joists square to the level', () => {
    store().setLevelFraming(f, { joists: 90 });
    switchTool('joistZone');
    for (const [x, y] of [[0, 0], [120, 0], [120, 120], [0, 120]]) click(x, y);
    press('Enter');
    const [zone] = Object.values(plan().levels[f].joistZones);
    expect(zone.joists).toBe(0);
    expect(ui().selection.joistZones).toEqual([zone.id]);
  });
});

describe('selecting and moving members', () => {
  beforeEach(() => {
    store().addMember(f, { ...beamOf(), id: 'bm' });
    store().addMember(f, { ...postOf({ at: { x: 300, y: 300 } }), id: 'pt' });
    clearHistory();
  });

  it('a click picks a post or a beam; joist zones only with the overlay on, at an edge', () => {
    click(301, 301);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, members: ['pt'] });
    click(100, 101);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, members: ['bm'] });
    const z = store().addJoistZone(f, { outline: [{ x: 400, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 100 }, { x: 400, y: 100 }], joists: 0, phase: 'new' })!;
    expect(hitTest(plan().levels[f], { x: 450, y: 0 }, 1)).toBeNull();
    expect(hitTest(plan().levels[f], { x: 450, y: 0 }, 1, 'all', { structure: true })).toEqual({ kind: 'joistZone', id: z });
    expect(hitTest(plan().levels[f], { x: 450, y: 50 }, 1, 'all', { structure: true })).toBeNull();
  });

  it('a drag moves the selected members in one undo step; a selected beam end drags alone', () => {
    dispatchPointer('down', ptr(100, 100));
    dispatchPointer('move', ptr(110, 120));
    dispatchPointer('up', ptr(110, 120));
    expect(plan().levels[f].members.bm).toMatchObject({ a: { x: 10, y: 120 }, b: { x: 210, y: 120 } });
    undo();
    expect(plan().levels[f].members.bm).toMatchObject({ a: { x: 0, y: 100 }, b: { x: 200, y: 100 } });
    ui().setSelection({ ...EMPTY_SELECTION, members: ['bm'] });
    dispatchPointer('down', ptr(200, 100));
    dispatchPointer('move', ptr(230, 100));
    dispatchPointer('move', ptr(240, 100));
    dispatchPointer('up', ptr(240, 100));
    expect(plan().levels[f].members.bm).toMatchObject({ a: { x: 0, y: 100 }, b: { x: 240, y: 100 } });
    undo();
    expect((plan().levels[f].members.bm as Beam).b).toEqual({ x: 200, y: 100 });
  });

  it('Delete removes the selected members', () => {
    click(301, 301);
    press('Delete');
    expect(Object.keys(plan().levels[f].members)).toEqual(['bm']);
  });
});

describe('timbers at set heights', () => {
  it('slope from one end to the other, stand above the ceiling, and the checks leave them alone', () => {
    // A 45° rafter from 96" at x 0 to 196" at x 100, 5 1/2" square: 7.78" deep plumb.
    const id = store().addMember(f, { ...beamOf({ a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, width: 5.5, depth: 5.5 }), za: 96, zb: 196, color: '#5A3A35' })!;
    expect(plan().levels[f].members[id]).toMatchObject({ za: 96, zb: 196, color: '#5a3a35' });
    const [mesh] = getMemberMeshes(plan(), f, 'all');
    const p = mesh.body!.getAttribute('position');
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 0; i < p.count; i++) {
      top = Math.max(top, p.getY(i));
      bottom = Math.min(bottom, p.getY(i));
    }
    expect(top).toBeCloseTo(196, 4);
    expect(bottom).toBeCloseTo(96 - 5.5 * Math.SQRT2, 4);
    expect(mesh.color).toBe('#5a3a35');
    // It ends on nothing, and no check says so.
    expect(structureIssues(plan())).toEqual([]);
  });

  it('need both heights, a base under a post top; clearing them makes a beam again', () => {
    expect(store().addMember(f, { ...beamOf(), za: 96 })).toBeNull();
    expect(store().addMember(f, { ...postOf(), base: 50, top: 40 })).toBeNull();
    const pid = store().addMember(f, { ...postOf(), base: 90, top: 120 })!;
    expect(memberBoxes(plan(), f, plan().levels[f].members[pid]).body).toMatchObject({ bottom: 90, top: 120 });
    const bid = store().addMember(f, { ...beamOf(), za: 100, zb: 120 })!;
    store().updateMember(f, bid, { za: undefined, zb: undefined });
    expect(plan().levels[f].members[bid]).not.toHaveProperty('za');
    expect(memberBoxes(plan(), f, plan().levels[f].members[bid]).slope).toBeUndefined();
  });
});

describe('round logs', () => {
  /** The centroid of a geometry's vertices that `keep` takes (three's axes). */
  const centroid = (g: BufferGeometry, keep: (x: number, y: number, z: number) => boolean) => {
    const p = g.getAttribute('position');
    let n = 0;
    const c = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < p.count; i++) {
      if (!keep(p.getX(i), p.getY(i), p.getZ(i))) continue;
      c.x += p.getX(i);
      c.y += p.getY(i);
      c.z += p.getZ(i);
      n++;
    }
    return { x: c.x / n, y: c.y / n, z: c.z / n };
  };
  /** Plan x, y and z over the floor, as three's x, z and y. */
  const three = (a: AxisPoint) => ({ x: a.x, y: a.z, z: a.y });
  const near = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => {
    expect(p.x).toBeCloseTo(q.x, 4);
    expect(p.y).toBeCloseTo(q.y, 4);
    expect(p.z).toBeCloseTo(q.z, 4);
  };

  it('logBetween: a capless body with normals straight out from its axis, and two end discs at a and b', () => {
    const a = { x: 10, y: 20, z: 30 };
    const b = { x: 110, y: 20, z: 130 };
    const { body, ends } = logBetween(a, b, 8);
    const dir = { x: 100 / Math.hypot(100, 100), y: 100 / Math.hypot(100, 100), z: 0 };
    const pos = body.getAttribute('position');
    const nor = body.getAttribute('normal');
    // FLUE_SIDES sides, two triangles each.
    expect(pos.count).toBe(FLUE_SIDES * 6);
    for (let i = 0; i < pos.count; i++) {
      const n = { x: nor.getX(i), y: nor.getY(i), z: nor.getZ(i) };
      expect(n.x * dir.x + n.y * dir.y + n.z * dir.z).toBeCloseTo(0, 5);
      // The vertex is 4" from the axis, along its normal.
      const v = { x: pos.getX(i) - a.x, y: pos.getY(i) - a.z, z: pos.getZ(i) - a.y };
      const along = v.x * dir.x + v.y * dir.y + v.z * dir.z;
      const r = { x: v.x - along * dir.x, y: v.y - along * dir.y, z: v.z - along * dir.z };
      expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(4, 4);
      expect(r.x / 4).toBeCloseTo(n.x, 4);
      expect(r.y / 4).toBeCloseTo(n.y, 4);
    }
    // The discs: one at each end, facing out along the axis.
    const endA = centroid(ends, (x, y) => (x - a.x) * dir.x + (y - a.z) * dir.y < 1);
    const endB = centroid(ends, (x, y) => (x - a.x) * dir.x + (y - a.z) * dir.y > 1);
    near(endA, three(a));
    near(endB, three(b));
    const en = ends.getAttribute('normal');
    for (let i = 0; i < en.count; i++) expect(Math.abs(en.getX(i) * dir.x + en.getY(i) * dir.y)).toBeCloseTo(1, 5);
  });

  it('a log post stands from the floor to under the ceiling, its end discs on its axis; a sloped log follows its timber', () => {
    const pid = store().addMember(f, { ...postOf({ profile: 'log', width: 10, depth: 4, rotation: 30 }) })!;
    const post = plan().levels[f].members[pid];
    expect(post).toMatchObject({ profile: 'log', width: 10, depth: 10 });
    const [pm] = getMemberMeshes(plan(), f, 'all');
    expect(pm.ends).not.toBeNull();
    const bb = (g: BufferGeometry) => {
      g.computeBoundingBox();
      return g.boundingBox!;
    };
    expect(bb(pm.body!).min.y).toBeCloseTo(0, 4);
    expect(bb(pm.body!).max.y).toBeCloseTo(96 - MEMBER_INSET, 4);
    expect(bb(pm.body!).max.x).toBeCloseTo(105, 4);
    near(centroid(pm.ends!, (_x, y) => y < 1), { x: 100, y: 0, z: 100 });
    near(centroid(pm.ends!, (_x, y) => y > 1), { x: 100, y: 96 - MEMBER_INSET, z: 100 });
    // A 45° log rafter, 8" round: its ends on its axis, half its plumb depth under its top.
    const id = store().addMember(f, { ...beamOf({ a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, width: 8, depth: 8, profile: 'log' }), za: 96, zb: 196 })!;
    const m = plan().levels[f].members[id];
    const ax = memberAxis(m, memberBoxes(plan(), f, m));
    const half = timberTop(m as Beam).vertical / 2;
    expect(ax.a).toEqual({ x: 0, y: 100, z: 96 - half });
    expect(ax.b.z).toBeCloseTo(196 - half, 9);
    const lm = getMemberMeshes(plan(), f, 'all').find((x) => x.id === id)!;
    near(centroid(lm.ends!, (x) => x < 50), three(ax.a));
    near(centroid(lm.ends!, (x) => x > 50), three(ax.b));
    // A level beam's axis runs halfway up it.
    const level = memberAxis(beamOf({ mount: 'dropped' }) as Beam, { body: { poly: [], bottom: 80, top: 96 } });
    expect(level).toEqual({ a: { x: 0, y: 100, z: 88 }, b: { x: 200, y: 100, z: 88 } });
  });

  it('the end grain is a lighter tint of the colour, a Log end mesh in the export', () => {
    expect(logEndColor()).toBe(MEMBER_COLOR.end);
    expect(logEndColor('#000000')).toBe('#666666');
    expect(logEndColor('#5a3a35')).toBe('#9c8986');
    store().addMember(f, { ...postOf({ profile: 'log' }), id: 'lg' });
    const root = buildExportScene(plan(), 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: f });
    const parts = ((root.children.find((c) => c.name === 'First Floor') as Group).children as Mesh[]).map((m) => `${m.name}:${(m.material as MeshStandardMaterial).name}`);
    expect(parts).toEqual(expect.arrayContaining(['Post:member_post_new', 'Log end:member_end_new']));
  });

  it('keeps the depth equal to the diameter, refuses another profile, and clears back to a squared member', () => {
    expect(memberProblem({ ...postOf(), profile: 'square' as 'log' }, false)).toBe('the profile is a round log or none');
    // The store keeps only a log's profile (cleanMember); migrate() drops a member with another (below).
    const sq = store().addMember(f, { ...beamOf(), profile: 'square' as 'log' })!;
    expect(plan().levels[f].members[sq]).not.toHaveProperty('profile');
    const id = store().addMember(f, { ...beamOf({ profile: 'log', width: 9 }) })!;
    expect(plan().levels[f].members[id]).toMatchObject({ width: 9, depth: 9 });
    store().updateMember(f, id, { width: 12 });
    expect(plan().levels[f].members[id]).toMatchObject({ width: 12, depth: 12 });
    store().updateMember(f, id, { profile: undefined });
    expect(plan().levels[f].members[id]).not.toHaveProperty('profile');
    expect(getMemberMeshes(plan(), f, 'all').find((m) => m.id === id)!.ends).toBeNull();
  });

  it('a log post picks inside its circle, not at the corner of its square', () => {
    store().addMember(f, { ...postOf({ at: { x: 300, y: 300 }, width: 10, profile: 'log' }), id: 'lg' });
    expect(hitTest(plan().levels[f], { x: 304, y: 302 }, 1)).toEqual({ kind: 'member', id: 'lg' });
    // 5" by 5" off the centre: in the 10" square, outside the circle (and its 2 px).
    expect(hitTest(plan().levels[f], { x: 305, y: 305 }, 1)).toBeNull();
  });

  it("loads files with and without a profile; a log's depth follows its width", () => {
    store().addMember(f, { ...postOf(), id: 'sq' });
    store().addMember(f, { ...postOf({ profile: 'log', width: 8 }), id: 'lg' });
    const json = JSON.stringify(plan());
    expect(JSON.stringify(migrate(JSON.parse(json)))).toBe(json);
    const raw = JSON.parse(json);
    raw.levels[f].members.lg.depth = 3;
    raw.levels[f].members.sq.profile = 'square';
    const loaded = migrate(raw);
    expect(loaded.levels[f].members.lg).toMatchObject({ profile: 'log', width: 8, depth: 8 });
    expect(loaded.levels[f].members.sq).toBeUndefined();
  });
});
