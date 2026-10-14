import type { Mesh, MeshStandardMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDeckLayouts, compassName, DECK, deckStairOpenings, deckSupportedEdges, edgeOutward, getDeckLayout, scanSegments } from '../derive/decks';
import { clearMeshCache, getDeckMeshes, triangleCount } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { levelDrawingBounds, planSvg } from '../io/exportPlan';
import { DECK_COLOR } from '../model/finish';
import { polygonSignedArea } from '../model/geometry';
import { createEmptyPlan } from '../model/plan';
import type { Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// The First Floor's top is at -100 + 96 + 12 = 8. A 6" exterior wall along y 0 (outside face y 3)
// and a 12' x 8' deck south of it, its top 6" below the floor (absolute 2): north, east, south, west.
let b = '';
let f = '';
let deckId = '';
const OUTLINE = rect(0, 3, 144, 99);
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  clearDeckLayouts();
  [b, f] = plan().levelOrder;
  store().addWall(f, { x: -50, y: 0 }, { x: 200, y: 0 }, { kind: 'exterior', thickness: 6, phase: 'existing' });
  deckId = store().addDeck(f, { outline: OUTLINE, elevation: -6, railings: [false, true, true, true], phase: 'new' })!;
});
const layout = (vm: 'all' | 'proposed' | 'existing' = 'proposed') => getDeckLayout(plan(), f, deckId, vm)!;

/** A flight on the Basement up to the deck's south edge at x 108..144, its top `rise` above the basement floor (-100). */
const stairToDeck = (rise: number, phase: 'existing' | 'new' | 'demo' = 'new') =>
  store().addStairs(b, { origin: { x: 126, y: 219 }, direction: 270, width: 36, run: 120, rise, risers: 13, phase, cutsFloorAbove: false })!;

describe('deck geometry helpers', () => {
  it('names edges and finds their outward normals whatever the winding', () => {
    expect(OUTLINE.map((_, i) => compassName(edgeOutward(OUTLINE, i)))).toEqual(['north', 'east', 'south', 'west']);
    const reversed = [...OUTLINE].reverse();
    expect(polygonSignedArea(reversed)).toBeLessThan(0);
    // Reversed, the first edge runs along the south side.
    expect(reversed.map((_, i) => compassName(edgeOutward(reversed, i)))).toEqual(['south', 'east', 'north', 'west']);
    // A plan turned 90 degrees: plan up is east.
    expect(compassName({ x: 0, y: -1 }, 90)).toBe('west');
  });

  it('scans a concave outline into one segment per stretch inside it', () => {
    const ell = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const lines = scanSegments(ell, { x: 1, y: 0 }, 6);
    expect(lines).toHaveLength(17);
    for (const [p, q] of lines) expect(Math.abs(q.x - p.x)).toBeCloseTo(p.y < 50 ? 100 : 50, 9);
    expect(scanSegments(rect(0, 0, 144, 96), { x: 1, y: 0 }, 6)).toHaveLength(16);
  });
});

describe('deck layout', () => {
  it('finds the wall behind an edge on the same level, and on another level when it reaches the framing', () => {
    expect(layout().supported).toEqual([true, false, false, false]);
    // A retaining wall on the Basement along the west edge, its top at -4 (inside the framing, 2 to -8.75).
    const retaining = store().addWall(b, { x: -5, y: -20 }, { x: -5, y: 200 }, { kind: 'exterior', thickness: 10, phase: 'existing' })!;
    store().updateWalls(b, retaining.wallIds, { heightOverride: 96 });
    expect(layout().supported).toEqual([true, false, false, true]);
    // 16" lower it stops short of the framing.
    store().updateWalls(b, retaining.wallIds, { heightOverride: 80 });
    expect(layout().supported).toEqual([true, false, false, false]);
    // A demolished wall does not carry a new deck.
    store().updateWalls(b, retaining.wallIds, { heightOverride: 96, phase: 'demo' });
    expect(deckSupportedEdges(plan(), f, OUTLINE, -6, 'all', 'new')).toEqual([true, false, false, false]);
  });

  it('puts support posts on the free edges, at most 96" apart, from 6" in the ground to the framing', () => {
    const { posts } = layout();
    // Corners between two free edges (south-east, south-west) and the middle of the 144" south edge.
    const c = DECK.postInset + DECK.post / 2;
    expect(posts.map((p) => [p.at.x, p.at.y])).toEqual([
      [144 - c, 99 - c],
      [72, 99 - c],
      [c, 99 - c],
    ]);
    // No grade points: the ground is flat at the lowest slab's bottom (-104), 112" under the floor.
    for (const p of posts) expect([p.bottom, p.top]).toEqual([-112 - DECK.postEmbed, -6 - DECK.board - DECK.joist]);
    // Ground up at the floor: no posts.
    for (const [x, y] of [
      [-500, -500],
      [500, -500],
      [0, 500],
    ])
      store().addGradePoint({ at: { x, y }, elevation: 8 });
    expect(layout().posts).toEqual([]);
  });

  it('builds railings on the railed edges: one post per shared corner, mitred caps, balusters at most 4" apart', () => {
    const { railing, caps } = layout();
    expect(caps).toHaveLength(3);
    // The east cap's inner end is the south cap's inner start: the mitre.
    expect(caps[0][2].x).toBeCloseTo(caps[1][3].x, 9);
    expect(caps[0][2].y).toBeCloseTo(caps[1][3].y, 9);
    const top = -6;
    const posts = railing.filter((r) => r.bottom === top && r.top === top + DECK.railHeight - DECK.capThick);
    // East 2, south 2, west 3: each shared corner's post belongs to the run it starts.
    expect(posts).toHaveLength(7);
    const centres = posts.map((p) => `${(p.poly[0].x + p.poly[2].x) / 2},${(p.poly[0].y + p.poly[2].y) / 2}`);
    expect(new Set(centres).size).toBe(7);
    // Along the east edge, balusters and posts leave at most 4" clear between neighbours.
    const balusterBottom = top + DECK.bottomRailUp + DECK.bottomRailHeight;
    const east = railing
      .filter((r) => (r.bottom === balusterBottom || posts.includes(r)) && r.poly.every((p) => p.x > 144 - DECK.cap - 1e-9))
      .map((r) => [Math.min(...r.poly.map((p) => p.y)), Math.max(...r.poly.map((p) => p.y))])
      .sort((p, q) => p[0] - q[0]);
    expect(east.length).toBeGreaterThan(10);
    for (let i = 1; i < east.length; i++) expect(east[i][0] - east[i - 1][1]).toBeLessThanOrEqual(DECK.balusterGap + 1e-9);
  });

  it('opens the railing where a flight reaches the deck, within 8" below its top', () => {
    const s = stairToDeck(96);
    expect(layout().openings).toEqual([{ edge: 2, from: 0, to: 36, levelId: b, stairsId: s }]);
    // The south railing now starts past the stair.
    const south = layout().caps.find((cp) => cp.every((p) => p.y >= 99 - DECK.cap - 1e-9))!;
    expect(Math.max(...south.map((p) => p.x))).toBeCloseTo(108, 9);
    // 16" below the deck: not a way onto it.
    store().updateStairs(b, s, { rise: 90 });
    expect(layout().openings).toEqual([]);
  });

  it('ignores a demolished flight for a new deck in the All view', () => {
    stairToDeck(96, 'demo');
    expect(deckStairOpenings(plan(), f, plan().levels[f].decks[deckId], 'all')).toEqual([]);
    expect(layout('all').openings).toEqual([]);
  });

  it('is the same object while nothing it depends on changes, and a new one when something does', () => {
    const first = layout();
    expect(layout()).toBe(first);
    // An unrelated edit (a wall far away) keeps it.
    store().addWall(f, { x: 1000, y: 1000 }, { x: 1100, y: 1000 }, { kind: 'interior', thickness: 4, phase: 'existing' });
    expect(layout()).toBe(first);
    // So does the colour or the phase of the deck itself.
    store().updateDeck(f, deckId, { color: '#336699' });
    expect(layout()).toBe(first);
    // The ground under it, a flight on another level, the levels' heights, the view: new layouts.
    store().addGradePoint({ at: { x: 72, y: 60 }, elevation: -60 });
    const afterGround = layout();
    expect(afterGround).not.toBe(first);
    stairToDeck(96);
    const afterStair = layout();
    expect(afterStair).not.toBe(afterGround);
    store().updateLevel(b, { wallHeight: 90 });
    expect(layout()).not.toBe(afterStair);
    expect(layout('all')).not.toBe(layout());
  });
});

describe('deck meshes and export', () => {
  beforeEach(() => clearMeshCache());

  it('reuses the geometry while the layout is the same, rebuilds and disposes it when the ground moves', () => {
    const first = getDeckMeshes(plan(), f, 'proposed');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: deckId, phase: 'existing', color: DECK_COLOR });
    expect(triangleCount(first[0].boards)).toBe(12);
    expect(triangleCount(first[0].frame)).toBeGreaterThan(12);
    expect(first[0].railing).not.toBeNull();
    // An unrelated edit: the same array.
    store().addWall(f, { x: 1000, y: 1000 }, { x: 1100, y: 1000 }, { kind: 'interior', thickness: 4, phase: 'existing' });
    expect(getDeckMeshes(plan(), f, 'proposed')).toBe(first);
    // A colour: a new array on the same geometry.
    store().updateDeck(f, deckId, { color: '#336699' });
    const recoloured = getDeckMeshes(plan(), f, 'proposed');
    expect(recoloured).not.toBe(first);
    expect(recoloured[0]).toMatchObject({ color: '#336699', boards: first[0].boards, frame: first[0].frame });
    // The ground under it: new geometry, the old disposed.
    let disposed = false;
    first[0].frame.addEventListener('dispose', () => (disposed = true));
    store().addGradePoint({ at: { x: 72, y: 60 }, elevation: -60 });
    const regrounded = getDeckMeshes(plan(), f, 'proposed');
    expect(regrounded[0].frame).not.toBe(first[0].frame);
    expect(disposed).toBe(true);
    // Hidden in the Existing view (it is new); shown green in All.
    expect(getDeckMeshes(plan(), f, 'existing')).toEqual([]);
    expect(getDeckMeshes(plan(), f, 'all')[0].phase).toBe('new');
  });

  it('exports the boards, the framing and the railing', () => {
    const root = buildExportScene(plan(), 'proposed', { activeLevelId: f, only3dActiveAndBelow: false, hidden3dLevels: [] });
    const names: string[] = [];
    root.traverse((o) => names.push(o.name));
    expect(names).toEqual(expect.arrayContaining(['Deck', 'Deck framing', 'Deck railing']));
    const deckMesh = root.getObjectByName('Deck') as Mesh;
    expect((deckMesh.material as MeshStandardMaterial).name).toBe('deck_existing');
    disposeExportScene(root);
  });
});

describe('deck on the plan', () => {
  it('draws the deck with its railing and posts in the views that show it, and fits the drawing to it', () => {
    const proposed = planSvg(plan(), f, 'proposed');
    expect(proposed).toContain('class="deck phase-existing"');
    expect(proposed).toContain('class="deck-rail"');
    expect(proposed).toContain('class="deck-post"');
    expect(proposed).toContain('6&quot; below floor');
    expect(planSvg(plan(), f, 'all')).toContain('class="deck phase-new"');
    expect(planSvg(plan(), f, 'existing')).not.toContain('class="deck ');
    expect(levelDrawingBounds(plan().levels[f], 'proposed')).toMatchObject({ maxY: 99 });
  });
});
