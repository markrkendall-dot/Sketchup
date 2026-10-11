// The 146 Mick Road starter plan (docs/examples/146-mick-road.json), built through the plan store's
// own actions so every wall, opening and roof goes through normalizeLevel, clamping and validation.
// Pure apart from the store: no file access (scripts/build-example.ts writes the JSON; the example
// test builds it again and compares).
//
// Coordinates: inches, plan x east, y south (down the screen), north is the road side. Everything is
// laid out from the OUTSIDE faces of the walls, the way the owner's tape reads, and the centerlines
// are set 3.25" (half of 6.5") inside them, which is what "Lengths to: outside face" does by hand.
import { columnDefaults, groundAt } from '../src/derive/site';
import { getLevelElevations } from '../src/derive/levels';
import { dist } from '../src/model/geometry';
import { createEmptyPlan } from '../src/model/plan';
import type { Id, Opening, Phase, Plan, Roof, Vec2 } from '../src/model/types';
import { getPlan, usePlanStore } from '../src/store/planStore';

const ft = (feet: number): number => feet * 12;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Exterior wall thickness; the basement's block walls are thicker. */
const T = 6.5;
const TB = 8;
const HALF = T / 2;

// Main block: outside faces x 0..318 (26.5'), y 0..306 (25.5'); centerlines HALF inside.
const MAIN = { x0: 0, x1: ft(26.5), y0: 0, y1: ft(25.5) };
const CL = { x0: MAIN.x0 + HALF, x1: MAIN.x1 - HALF, y0: MAIN.y0 + HALF, y1: MAIN.y1 - HALF };

// East wing (estimated 12' x 10'), one storey with its own gable, on the east wall at the south end,
// its south face flush with the main block's (photos 1, 3, 9; the owner's sketch puts it there too).
const WING = { x0: MAIN.x1, x1: MAIN.x1 + ft(12), y0: MAIN.y1 - ft(10), y1: MAIN.y1 };
// Screened porch on the west face at its north end (estimated 8' deep, 8' long), reaching 4' north
// of the main block's north face as in photos 6 and 7.
const SCREEN = { x0: -ft(8), x1: MAIN.x0, y0: -ft(4), y1: ft(4) };
// Entry porch: open, 8' along the west face by 6' out, south of the screened porch.
const ENTRY = { x0: -ft(6), x1: MAIN.x0, y0: ft(4) + 8, y1: ft(4) + 8 + ft(8) };

const FINISH_COLOR = '#5a3a35';
const BLOCK_COLOR = '#8a8580';
const ROOF_COLOR = '#6e6259';
const PHASE: Phase = 'existing';

type Rect = { x0: number; x1: number; y0: number; y1: number };
const outline = (r: Rect): Vec2[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];
/** Centerline rectangle of walls whose outside faces are `r`, grown/shrunk by half the thickness. */
const centerline = (r: Rect, half: number): Rect => ({ x0: r.x0 + half, x1: r.x1 - half, y0: r.y0 + half, y1: r.y1 - half });

const store = () => usePlanStore.getState();
const level = (id: Id) => getPlan().levels[id];

/** Draw a chain of exterior walls through the points (closed when `close`). Returns the wall ids. */
function drawWalls(levelId: Id, pts: Vec2[], thickness: number, close = false): Id[] {
  const out: Id[] = [];
  const n = close ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const res = store().addWall(levelId, pts[i], pts[(i + 1) % pts.length], { kind: 'exterior', thickness, phase: PHASE });
    if (!res) throw new Error(`wall ${i} of ${JSON.stringify(pts)} was rejected`);
    out.push(...res.wallIds);
  }
  return out;
}

/** The wall whose centerline passes through p (the opening's centre), and p's distance from its start. */
function wallAt(levelId: Id, p: Vec2): { wallId: Id; offset: number } {
  const lvl = level(levelId);
  let best: { wallId: Id; offset: number; d: number } | null = null;
  for (const w of Object.values(lvl.walls)) {
    const a = lvl.nodes[w.a];
    const b = lvl.nodes[w.b];
    const len = dist(a, b);
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
    if (t < 0 || t > 1) continue;
    const d = dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (d < 0.6 && (!best || d < best.d)) best = { wallId: w.id, offset: t * len, d };
  }
  if (!best) throw new Error(`no wall at ${JSON.stringify(p)} on ${lvl.name}`);
  return best;
}

interface OpeningSpec {
  type: Opening['type'];
  width: number;
  height: number;
  sill?: number;
  lites?: { cols: number; rows: number };
  shutters?: boolean;
}

function addOpeningAt(levelId: Id, p: Vec2, o: OpeningSpec): Id {
  const { wallId, offset } = wallAt(levelId, p);
  const id = store().addOpening(levelId, {
    wallId,
    type: o.type,
    offset: Math.round(offset * 1000) / 1000,
    width: o.width,
    height: o.height,
    sill: o.sill ?? (o.type === 'door' ? 0 : 30),
    phase: PHASE,
    ...(o.type === 'door' ? { swing: { hinge: 'a' as const, side: 'left' as const } } : {}),
    ...(o.lites ? { lites: o.lites } : {}),
    ...(o.shutters ? { shutters: true } : {}),
  });
  if (!id) throw new Error(`opening at ${JSON.stringify(p)} on ${level(levelId).name} was rejected`);
  return id;
}

const win = (levelId: Id, p: Vec2, width: number, height: number, cols: number, rows: number, extra: Partial<OpeningSpec> = {}) =>
  addOpeningAt(levelId, p, { type: 'window', width, height, lites: { cols, rows }, ...extra });

function roof(levelId: Id, r: Omit<Roof, 'id' | 'bearingOffset' | 'thickness' | 'fascia' | 'phase' | 'finish' | 'color'>): Id {
  const id = store().addRoof(levelId, { ...r, bearingOffset: 0, thickness: 8, fascia: 6, phase: PHASE, finish: 'metal', color: ROOF_COLOR });
  if (!id) throw new Error('roof rejected');
  return id;
}

/** Replace every generated id with a readable, stable one so the JSON is identical from run to run. */
function stableIds(plan: Plan): string {
  const names = new Map<string, string>();
  const add = (old: string, name: string) => names.set(old, name);
  add(plan.id, 'plan-146-mick-road');
  const prefixes = ['b', 'f', 's'];
  plan.levelOrder.forEach((lid, li) => {
    const lvl = plan.levels[lid];
    const pre = prefixes[li] ?? `l${li}`;
    add(lid, `level-${pre}`);
    const kinds: [string, Record<string, unknown>][] = [
      ['n', lvl.nodes],
      ['w', lvl.walls],
      ['o', lvl.openings],
      ['r', lvl.rooms],
      ['s', lvl.stairs],
      ['k', lvl.roofs],
    ];
    for (const [k, rec] of kinds) Object.keys(rec).forEach((id, i) => add(id, `${pre}-${k}${i + 1}`));
  });
  Object.keys(plan.site.gradePoints).forEach((id, i) => add(id, `grade-${i + 1}`));
  Object.keys(plan.site.columns).forEach((id, i) => add(id, `column-${i + 1}`));
  let text = JSON.stringify({ ...plan, modifiedAt: '2026-01-01T00:00:00.000Z' }, null, 2);
  // Quoted ids only (as keys and as values); ids are 10 random characters, never a plain word.
  for (const [old, name] of names) text = text.split(`"${old}"`).join(`"${name}"`);
  return text + '\n';
}

/** Build the starter plan in the store and return it (the store is left holding it). */
export function buildExamplePlan(): Plan {
  store().setPlan(createEmptyPlan('146 Mick Road (starter, estimates flagged)'));
  const [bId, fId, sId] = getPlan().levelOrder;
  store().updateLevel(bId, { name: 'Basement', wallHeight: 90, floorThickness: 4 });
  store().updateLevel(fId, { name: 'First Floor', wallHeight: 96, floorThickness: 12 });
  store().updateLevel(sId, { name: 'Second Floor', wallHeight: 96, floorThickness: 12 });
  store().setBaseFloorElevation(-100);
  store().setNorthAngle(0);

  const ring = (r: Rect) => [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
  const wing = centerline(WING, HALF);

  // ---- Basement: the block, with the walkout bump under the wing (8" block walls, plain grey).
  drawWalls(bId, ring(CL), TB, true);
  drawWalls(bId, [{ x: CL.x1, y: wing.y0 }, { x: wing.x1, y: wing.y0 }, { x: wing.x1, y: wing.y1 }, { x: CL.x1, y: wing.y1 }], TB);
  store().updateWalls(bId, Object.keys(level(bId).walls), { finish: 'plain', color: BLOCK_COLOR });

  // ---- First Floor: the block, the east wing and the screened porch on the west face.
  drawWalls(fId, ring(CL), T, true);
  const wingWalls = drawWalls(fId, [{ x: CL.x1, y: wing.y0 }, { x: wing.x1, y: wing.y0 }, { x: wing.x1, y: wing.y1 }, { x: CL.x1, y: wing.y1 }], T);
  const sc = centerline(SCREEN, HALF);
  const screenWalls = drawWalls(fId, [{ x: CL.x0, y: CL.y0 }, { x: CL.x0, y: sc.y0 }, { x: sc.x0, y: sc.y0 }, { x: sc.x0, y: sc.y1 }, { x: CL.x0, y: sc.y1 }], T);
  store().updateWalls(fId, Object.keys(level(fId).walls), { finish: 'shingle', color: FINISH_COLOR });
  // The wing's east gable end is clapboard (photo 3).
  const fl = level(fId);
  store().updateWalls(fId, wingWalls.filter((id) => fl.nodes[fl.walls[id].a].x === wing.x1 && fl.nodes[fl.walls[id].b].x === wing.x1), { finish: 'clapboard' });
  store().updateWalls(fId, screenWalls, { finish: 'screen' });

  // ---- Second Floor: the block. Clapboard on the south and east faces, shingle on the north and
  // west ones (photos 1, 3, 6, 8).
  const secondWalls = drawWalls(sId, ring(CL), T, true);
  store().updateWalls(sId, secondWalls, { finish: 'clapboard', color: FINISH_COLOR });
  const second = level(sId);
  const shingled = secondWalls.filter((id) => {
    const a = second.nodes[second.walls[id].a];
    const b = second.nodes[second.walls[id].b];
    return (a.y === CL.y0 && b.y === CL.y0) || (a.x === CL.x0 && b.x === CL.x0);
  });
  store().updateWalls(sId, shingled, { finish: 'shingle' });

  // ---- Terrain (all estimates, see the README): the road side meets the first floor, the west end of
  // the south face is nearly at grade, and the ground falls away to the basement floor at the east
  // end, where the walkout doors are, and on the terrace in front of them.
  const gp = (x: number, y: number, elevation: number) => {
    if (!store().addGradePoint({ at: { x, y }, elevation })) throw new Error('grade point rejected');
  };
  gp(MAIN.x0, MAIN.y0, -4);
  gp(MAIN.x1, MAIN.y0, -4);
  gp(SCREEN.x0, SCREEN.y0, -4);
  gp(MAIN.x1 / 2, MAIN.y0, -4);
  gp(MAIN.x0, MAIN.y1 / 2, -8);
  gp(MAIN.x0, MAIN.y1, -14);
  gp(MAIN.x1, MAIN.y1, -88);
  gp(WING.x1, WING.y1, -100);
  gp(WING.x1, WING.y0, -70);
  gp(MAIN.x1 / 2, MAIN.y1 + ft(10), -100);
  gp((WING.x0 + WING.x1) / 2, WING.y1 + ft(10), -100);
  gp(MAIN.x1 / 4, MAIN.y0 - ft(30), 6);
  gp((MAIN.x1 * 3) / 4, MAIN.y0 - ft(30), 6);

  // ---- Openings.
  const south = CL.y1;
  const north = CL.y0;
  const east = CL.x1;
  const west = CL.x0;
  // South face (the lake side).
  win(fId, { x: 105, y: south }, 140, 60, 6, 2);
  win(fId, { x: 260, y: south }, 96, 60, 6, 2);
  win(sId, { x: 115, y: south }, 88, 48, 6, 3);
  win(sId, { x: 256, y: south }, 64, 48, 6, 3);
  // West face (the entry): the door in the porch, the shuttered windows.
  addOpeningAt(fId, { x: west, y: (ENTRY.y0 + ENTRY.y1) / 2 }, { type: 'door', width: 36, height: 80, lites: { cols: 1, rows: 1 } });
  win(fId, { x: west, y: ft(17) }, 96, 48, 6, 3, { shutters: true });
  win(sId, { x: west, y: ft(17) }, 48, 36, 4, 3, { shutters: true, sill: 36 });
  // North face (the road): first floor either side of the chimney, second floor two windows.
  win(fId, { x: ft(8), y: north }, 72, 48, 6, 3);
  win(fId, { x: ft(19.5), y: north }, 48, 36, 2, 1);
  win(sId, { x: ft(6.5), y: north }, 48, 40, 4, 3);
  win(sId, { x: ft(20), y: north }, 48, 40, 4, 3);
  // East face: two upstairs, a small one on the first floor north of the wing.
  win(sId, { x: east, y: ft(8) }, 48, 40, 4, 3);
  win(sId, { x: east, y: ft(18) }, 48, 40, 4, 3);
  win(fId, { x: east, y: ft(12.5) }, 36, 40, 4, 3);
  // The wing: its east gable end, north and south faces.
  win(fId, { x: wing.x1, y: (WING.y0 + WING.y1) / 2 }, 60, 48, 4, 3);
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y0 }, 48, 40, 4, 3);
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, 36, 36, 2, 2);
  // The walkout double door below the wing's south window.
  addOpeningAt(bId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, { type: 'door', width: 60, height: 80, lites: { cols: 1, rows: 1 } });

  // ---- Roofs.
  roof(sId, { shape: 'gable', outline: outline(MAIN), ridgeAngle: 0, pitch: 8, overhang: 24 });
  roof(fId, { shape: 'gable', outline: outline(WING), ridgeAngle: 0, pitch: 8, overhang: 18 });
  // Screened porch: a shed sloping down to the north (ridgeAngle is the downhill direction).
  roof(fId, { shape: 'shed', outline: outline(SCREEN), ridgeAngle: 270, pitch: 3, overhang: 12 });
  roof(fId, { shape: 'gable', outline: outline(ENTRY), ridgeAngle: 0, pitch: 6, overhang: 12 });

  // ---- Chimney against the north wall, and the entry porch posts (6 x 6, grade to 96 above the first floor).
  const chimneyAt = { x: MAIN.x1 / 2, y: MAIN.y0 - 20 };
  const chimneyHeights = () => {
    const d = columnDefaults(getPlan(), 'chimney', chimneyAt);
    return { ...d, base: round2(d.base), top: round2(d.top) };
  };
  if (!store().addColumn({ at: chimneyAt, kind: 'chimney', phase: PHASE, ...chimneyHeights() })) throw new Error('chimney rejected');
  const firstTop = getLevelElevations(getPlan())[fId].floorTop;
  for (const at of [
    { x: ENTRY.x0 + 3, y: ENTRY.y0 + 3 },
    { x: ENTRY.x0 + 3, y: ENTRY.y1 - 3 },
  ]) {
    if (!store().addColumn({ at, width: 6, depth: 6, rotation: 0, base: round2(groundAt(getPlan(), at)), top: firstTop + 96, kind: 'post', phase: PHASE })) throw new Error('post rejected');
  }

  // ---- Room labels, one per area (names say where a number is an estimate).
  const label = (levelId: Id, name: string, at: Vec2) => {
    if (!store().addRoom(levelId, { name, anchor: at })) throw new Error(`room ${name} rejected`);
  };
  const mid = { x: MAIN.x1 / 2, y: MAIN.y1 / 2 };
  label(bId, 'Basement (unpartitioned, est.)', mid);
  label(fId, 'First floor (interior not measured)', mid);
  label(fId, 'East wing (est.)', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 });
  label(fId, 'Screened porch (est.)', { x: (SCREEN.x0 + SCREEN.x1) / 2, y: (SCREEN.y0 + SCREEN.y1) / 2 });
  label(sId, 'Second floor (interior not measured)', mid);

  return getPlan();
}

/** The starter plan as the JSON text of docs/examples/146-mick-road.json (stable ids, fixed date). */
export function buildExampleJson(): string {
  return stableIds(buildExamplePlan());
}
