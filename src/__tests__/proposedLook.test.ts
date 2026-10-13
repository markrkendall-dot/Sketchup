import { beforeEach, describe, expect, it } from 'vitest';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { DEFAULT_SASH_COLOR, ROOF_COLOR, TRIM_COLOR } from '../model/finish';
import { createEmptyPlan, migrate } from '../model/plan';
import type { Id, ViewMode } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { roofHeight, SEAM_HEIGHT, SEAM_PX, SEAM_SPACING, SHAKE_COURSES, SHAKE_WIDTH, shakeCourses, seamPositions, sidingHeight, TEXTURE_PX, TILE_INCHES } from '../view3d/textures';

// The proposed look (types.ts ProposedLook): the siding, roof and windows after the work, shown in
// the Proposed view only.

const store = () => usePlanStore.getState();

beforeEach(() => {
  clearMeshCache();
  store().setPlan(createEmptyPlan());
  clearHistory();
});

const LOOK = {
  wallFinish: 'shake',
  wallColor: '#4b3a32',
  roofFinish: 'seam',
  roofColor: '#2f4a36',
  boardColor: '#4b3a32',
  trimColor: '#a8322d',
  sashColor: '#1c1c1c',
  shutters: false,
} as const;

/** A 20' x 15' box of shingled walls on the First Floor, one wall concrete block, a shuttered window, a metal roof. */
function house(): { lid: Id; block: Id } {
  const lid = store().plan.levelOrder[1];
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 180 },
    { x: 0, y: 180 },
  ];
  c.forEach((p, i) => store().addWall(lid, p, c[(i + 1) % 4], { kind: 'exterior', thickness: 7, phase: 'existing' }));
  const l = store().plan.levels[lid];
  const walls = Object.values(l.walls);
  const south = walls.find((w) => l.nodes[w.a].y === 180 && l.nodes[w.b].y === 180)!;
  const block = walls.find((w) => l.nodes[w.a].x === 0 && l.nodes[w.b].x === 0)!;
  store().updateWalls(lid, [block.id], { finish: 'block' });
  expect(store().addOpening(lid, { wallId: south.id, type: 'window', offset: 120, width: 36, height: 40, sill: 30, phase: 'existing', shutters: true })).not.toBeNull();
  const roof = {
    shape: 'gable' as const,
    outline: c.map((p) => ({ x: p.x === 0 ? -3.5 : 243.5, y: p.y === 0 ? -3.5 : 183.5 })),
    ridgeAngle: 0,
    pitch: 6,
    overhang: 12,
    bearingOffset: 0,
    thickness: 2.5,
    fascia: 7,
    phase: 'existing' as const,
    finish: 'metal' as const,
  };
  expect(store().addRoof(lid, roof)).not.toBeNull();
  return { lid, block: block.id };
}

describe('the proposed look in the model', () => {
  it('loads byte for byte, drops malformed fields one by one, and keeps a standing-seam roof', () => {
    const { lid } = house();
    store().updateProposedLook(LOOK);
    const text = JSON.stringify(store().plan);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text);
    const broken = JSON.parse(text);
    broken.proposedLook = { wallFinish: 'vinyl', roofColor: 'green', shutters: 'no', sashColor: '#1C1C1C' };
    expect(migrate(broken).proposedLook).toEqual({ sashColor: '#1c1c1c' });
    broken.proposedLook = { wallFinish: 'vinyl' };
    expect('proposedLook' in migrate(broken)).toBe(false);
    const seam = JSON.parse(text);
    for (const r of Object.values(seam.levels[lid].roofs) as { finish: string }[]) r.finish = 'seam';
    expect(Object.values(migrate(seam).levels[lid].roofs).map((r) => r.finish)).toEqual(['seam']);
  });

  it('updateProposedLook sets and clears fields, lower-cases colours, and removes an empty look', () => {
    store().updateProposedLook({ trimColor: '#A8322D', shutters: false });
    expect(store().plan.proposedLook).toEqual({ trimColor: '#a8322d', shutters: false });
    store().updateProposedLook({ trimColor: undefined });
    expect(store().plan.proposedLook).toEqual({ shutters: false });
    store().updateProposedLook({ shutters: undefined });
    expect('proposedLook' in store().plan).toBe(false);
  });
});

describe('the proposed look in 3D', () => {
  const meshesIn = (lid: Id, vm: ViewMode) => getLevelMeshes(store().plan, lid, vm);

  it('re-sides, re-roofs and re-trims in the Proposed view only', () => {
    const { lid, block } = house();
    store().updateProposedLook(LOOK);
    const proposed = meshesIn(lid, 'proposed');
    // Siding walls take the shakes; the block wall keeps its block.
    for (const w of proposed.walls) expect([w.finish, w.color]).toEqual(w.id === block ? ['block', '#5a3a35'] : ['shake', '#4b3a32']);
    expect(proposed.roofs.map((r) => [r.finish, r.color, r.boardColor, r.weathering])).toEqual([['seam', '#2f4a36', '#4b3a32', 0]]);
    const win = proposed.openings[0];
    expect([win.trimColor, win.sashColor]).toEqual(['#a8322d', '#1c1c1c']);
    expect(win.parts.some((p) => p.part === 'shutter')).toBe(false);
    // Existing and All keep today's look, shutters on.
    for (const vm of ['existing', 'all'] as const) {
      const m = meshesIn(lid, vm);
      expect(m.walls.filter((w) => w.id !== block).every((w) => w.finish === 'shingle')).toBe(true);
      expect(m.roofs.map((r) => [r.finish, r.color])).toEqual([['metal', ROOF_COLOR.metal]]);
      expect([m.openings[0].trimColor, m.openings[0].sashColor]).toEqual([TRIM_COLOR, DEFAULT_SASH_COLOR]);
      expect(m.openings[0].parts.some((p) => p.part === 'shutter')).toBe(true);
    }
  });

  it('follows an edit of the look (the level cache is keyed on it)', () => {
    const { lid } = house();
    store().updateProposedLook({ roofColor: '#2f4a36' });
    expect(meshesIn(lid, 'proposed').roofs[0].color).toBe('#2f4a36');
    store().updateProposedLook({ roofColor: '#112233' });
    expect(meshesIn(lid, 'proposed').roofs[0].color).toBe('#112233');
    // A colour alone keeps the roof's finish.
    expect(meshesIn(lid, 'proposed').roofs[0].finish).toBe('metal');
  });

  it('exports the proposed trim and sash under their own material names', () => {
    const { lid } = house();
    store().updateProposedLook(LOOK);
    const root = buildExportScene(store().plan, 'proposed', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid });
    const names = new Set<string>();
    root.traverse((o) => {
      const m = (o as { material?: { name: string } }).material;
      if (m) names.add(m.name);
    });
    expect(names.has('trim_a8322d')).toBe(true);
    expect(names.has('sash_1c1c1c')).toBe(true);
    expect([...names].some((n) => n.startsWith('roof_seam_'))).toBe(true);
    disposeExportScene(root);
  });
});

describe('the new finishes', () => {
  it('lays painted shakes in 7 courses of 6" to 12" shakes that fill the tile', () => {
    const courses = shakeCourses();
    expect(courses.length).toBe(SHAKE_COURSES);
    for (const c of courses) {
      const widths = c.shingles.map((s) => s.x1 - s.x0);
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(TILE_INCHES, 9);
      for (const w of widths) {
        expect(w).toBeGreaterThanOrEqual(SHAKE_WIDTH.min - 1e-9);
        expect(w).toBeLessThanOrEqual(SHAKE_WIDTH.max + 1e-9);
      }
    }
    expect(sidingHeight('shake')).not.toBeNull();
  });

  it('raises a standing seam every 16" across the slope', () => {
    expect(seamPositions()).toEqual([0, SEAM_SPACING, 2 * SEAM_SPACING]);
    const h = roofHeight('seam');
    const at = (x: number) => h[Math.min(TEXTURE_PX - 1, Math.floor(x * SEAM_PX))];
    for (const x of seamPositions()) expect(at(x + 0.1)).toBe(SEAM_HEIGHT);
    expect(at(SEAM_SPACING / 2)).toBe(0);
  });
});
