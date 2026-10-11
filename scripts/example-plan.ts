// The 146 Mick Road starter plan (docs/examples/146-mick-road.json), built through the plan store's
// own actions so every wall, opening and roof goes through normalizeLevel, clamping and validation.
// Pure apart from the store: no file access (scripts/build-example.ts writes the JSON; the example
// test builds it again and compares).
//
// Coordinates: inches, plan x east, y south (down the screen), north is the road side. The exterior is
// laid out from the OUTSIDE faces of the walls, the way the owner's tape reads, and the centerlines
// are set 3.5" (half of 7") inside them, which is what "Lengths to: outside face" does by hand. The
// First Floor interior is the owner's tape measurements (face to face), set out from the inside faces.
import { columnDefaults } from '../src/derive/site';
import { dist, normalize, perpLeft, sub } from '../src/model/geometry';
import { createEmptyPlan } from '../src/model/plan';
import type { Id, Opening, Phase, Plan, Roof, Vec2 } from '../src/model/types';
import { getPlan, usePlanStore } from '../src/store/planStore';

const ft = (feet: number): number => feet * 12;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Exterior wall thickness (derived from the measured interior widths); the basement's block walls are thicker. */
const T = 7;
/** Interior partition thickness (measured). */
const TI = 5;
const TB = 8;
const HALF = T / 2;

// Main block: outside faces x 0..318 (26'6") and y 0..315 (26'3"); centerlines HALF inside. Along the lake
// wall the measured interior is 11'6" + 5" + 13'5" = 25'4" between 7" walls, 26'6" outside. North-south
// the inside is 301": the upstairs west side (Bunk 90 + 5 + stair strip 33 + 5 + Master 168), which the
// First Floor shares (hall 90 + 5 + strip 33 + 5 + Living 168), so 301 + 14 = 315 outside.
const MAIN = { x0: 0, x1: ft(26.5), y0: 0, y1: ft(26) + 3 };
const CL = { x0: MAIN.x0 + HALF, x1: MAIN.x1 - HALF, y0: MAIN.y0 + HALF, y1: MAIN.y1 - HALF };

// East wing (the Utility), one storey with its own gable, on the east wall at the south end, its south
// face flush with the main block's (photos 1, 3, 9; the owner's sketch puts it there too). Interior
// measured 11'6" x 9'5", so outside x 318..463, y 188..315 (its west side is the main block's east wall).
const UTILITY = { w: ft(11.5), d: ft(9) + 5 };
const WING = { x0: MAIN.x1, x1: MAIN.x1 + UTILITY.w + T, y0: MAIN.y1 - UTILITY.d - 2 * T, y1: MAIN.y1 };
// Entry porch: one structure on the west face at its north end, flush with the north face (photo 8,
// taken facing east; photos 6 and 7 show the same porch from the road). Estimated 8' along the wall
// by 5'6" out. Shingled knee walls with a glazed panel on its north side and the front's north bay,
// open bays above the knee walls elsewhere, the entry opening in line with the house door, and its own
// gable facing west.
const PORCH = { x0: -66, x1: MAIN.x0, y0: MAIN.y0, y1: ft(8) };
/** The house door and the porch entry share this line (photo 8). */
const ENTRY_Y = ft(4);

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

/** Draw one interior partition (5", existing) between two centerline points; it T-joins what it meets. */
function partition(levelId: Id, a: Vec2, b: Vec2): void {
  if (!store().addWall(levelId, a, b, { kind: 'interior', thickness: TI, phase: PHASE })) throw new Error(`partition ${JSON.stringify([a, b])} was rejected`);
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
  swing?: NonNullable<Opening['swing']>;
  /** Doors: the direction the leaf swings toward (picks the swing side from the wall's direction). */
  into?: Vec2;
}

function addOpeningAt(levelId: Id, p: Vec2, o: OpeningSpec): Id {
  const { wallId, offset } = wallAt(levelId, p);
  let swing = o.swing;
  if (o.type === 'door' && o.into) {
    const lvl = level(levelId);
    const w = lvl.walls[wallId];
    const dir = normalize(sub(lvl.nodes[w.b], lvl.nodes[w.a]));
    // 'left' is the wall's left normal (perpLeft of its direction); pick the side facing `into`.
    const left = perpLeft(dir);
    swing = { hinge: 'a', side: left.x * o.into.x + left.y * o.into.y > 0 ? 'left' : 'right' };
  }
  const id = store().addOpening(levelId, {
    wallId,
    type: o.type,
    offset: Math.round(offset * 1000) / 1000,
    width: o.width,
    height: o.height,
    sill: o.sill ?? (o.type === 'door' ? 0 : 30),
    phase: PHASE,
    ...(o.type === 'door' ? { swing: swing ?? { hinge: 'a' as const, side: 'left' as const } } : {}),
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
  // New walls drawn in this plan default to the house's measured thicknesses.
  store().updateSettings({ defaultExteriorThickness: T, defaultInteriorThickness: 5 });

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

  // ---- First Floor: the block, the east wing and the entry porch on the west face. The porch's north
  // wall continues the house's north wall in a straight line.
  drawWalls(fId, ring(CL), T, true);
  const wingWalls = drawWalls(fId, [{ x: CL.x1, y: wing.y0 }, { x: wing.x1, y: wing.y0 }, { x: wing.x1, y: wing.y1 }, { x: CL.x1, y: wing.y1 }], T);
  const pc = centerline(PORCH, HALF);
  drawWalls(fId, [{ x: CL.x0, y: CL.y0 }, { x: pc.x0, y: pc.y0 }, { x: pc.x0, y: pc.y1 }, { x: CL.x0, y: pc.y1 }], T);
  store().updateWalls(fId, Object.keys(level(fId).walls), { finish: 'shingle', color: FINISH_COLOR });
  // The wing's east gable end is clapboard (photo 3).
  const fl = level(fId);
  store().updateWalls(fId, wingWalls.filter((id) => fl.nodes[fl.walls[id].a].x === wing.x1 && fl.nodes[fl.walls[id].b].x === wing.x1), { finish: 'clapboard' });

  // ---- First Floor interior (the owner's tape, face to face; see the README). Centerlines are half a
  // partition (2.5") off the measured faces. The north-south bands are shared with the Second Floor:
  // north band y 7..97, wall y 99.5 (97..102), stair strip y 102..135, wall y 137.5 (135..140), south
  // band y 140..308. Every partition ends on a wall or another partition, so there are no open ends.
  //   y 99.5 line (faces 97..102), east wall to west wall: the Kitchen's north wall and the hall's south wall.
  //   Kitchen/Living partition x 170.5 (faces 168..173) from the lake wall up to that line.
  //   Bath west wall x 194.5 (faces 192..197), that line up to the north wall.
  //   Stair south wall y 137.5 (faces 135..140), the west wall to the partition.
  const PART = { kl: 170.5, line: 99.5, bathWest: 194.5, stairSouth: 137.5 };
  partition(fId, { x: CL.x1, y: PART.line }, { x: CL.x0, y: PART.line });
  partition(fId, { x: PART.kl, y: CL.y1 }, { x: PART.kl, y: PART.line });
  partition(fId, { x: PART.bathWest, y: PART.line }, { x: PART.bathWest, y: CL.y0 });
  partition(fId, { x: PART.kl, y: PART.stairSouth }, { x: CL.x0, y: PART.stairSouth });
  // The stair climbs east from the west wall's inside face (x 7) to x 132, 33" wide (the whole strip,
  // y 102..135), under the Second Floor's landing, and cuts the Second Floor's floor.
  const STRIP_MID = 118.5;
  if (!store().addStairs(fId, { origin: { x: CL.x0 + HALF, y: STRIP_MID }, direction: 0, width: 33, run: 125, phase: PHASE, cutsFloorAbove: true })) throw new Error('stairs rejected');

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

  // ---- Second Floor interior (the owner's sketch; partitions 5", existing). Same bands as the First
  // Floor. East-west the west side is Bunk/Master x 7..169, wall x 171.5 (169..174), the east side
  // x 174..311. The x 171.5 line has a gap at y 102..135 where the landing opens east to the hall.
  const UP = { line: 99.5, strip: 137.5, ew: 171.5, closet: 39.5, bathEast: 220.5, bathSouth: 83.5, guestNorth: 152.5 };
  partition(sId, { x: CL.x0, y: UP.line }, { x: UP.ew, y: UP.line }); // Bunk south wall
  partition(sId, { x: UP.ew, y: CL.y0 }, { x: UP.ew, y: UP.line }); // Bunk east wall
  partition(sId, { x: CL.x0, y: UP.strip }, { x: UP.ew, y: UP.strip }); // Master north wall
  partition(sId, { x: UP.ew, y: UP.strip }, { x: UP.ew, y: CL.y1 }); // Master/Guest partition
  partition(sId, { x: UP.closet, y: UP.line }, { x: UP.closet, y: UP.strip }); // Closet east wall
  partition(sId, { x: UP.bathEast, y: CL.y0 }, { x: UP.bathEast, y: UP.bathSouth }); // Bath east wall
  partition(sId, { x: UP.ew, y: UP.bathSouth }, { x: UP.bathEast, y: UP.bathSouth }); // Bath south wall
  partition(sId, { x: UP.ew, y: UP.guestNorth }, { x: CL.x1, y: UP.guestNorth }); // Guest north wall

  // ---- Terrain (all estimates, see the README): the road side meets the first floor, the west end of
  // the south face is nearly at grade, and the ground falls away to the basement floor at the east
  // end, where the walkout doors are, and on the terrace in front of them.
  const gp = (x: number, y: number, elevation: number) => {
    if (!store().addGradePoint({ at: { x, y }, elevation })) throw new Error('grade point rejected');
  };
  gp(MAIN.x0, MAIN.y0, -4);
  gp(MAIN.x1, MAIN.y0, -4);
  gp(PORCH.x0, PORCH.y0, -4);
  gp(PORCH.x0, PORCH.y1, -8);
  gp(MAIN.x1 / 2, MAIN.y0, -4);
  gp(MAIN.x0, MAIN.y1 / 2, -8);
  gp(MAIN.x0, MAIN.y1, -14);
  gp(MAIN.x1, MAIN.y1, -88);
  gp(WING.x1, WING.y1, -100);
  // The lawn reaches nearly to the first floor at the wing's north-east corner and drops under the
  // deck toward the lake (photo 3).
  gp(WING.x1, WING.y0, -20);
  gp(MAIN.x1 + ft(6), ft(8), -6);
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
  win(fId, { x: 100, y: south }, 130, 60, 6, 2);
  win(fId, { x: 260, y: south }, 96, 60, 6, 2);
  win(sId, { x: 115, y: south }, 88, 48, 6, 3);
  win(sId, { x: 256, y: south }, 64, 48, 6, 3);
  // West face (the entry, photo 8): the door inside the porch, a three-sash window set high (its head
  // above the door head) and a 4 x 2 lite window upstairs, both with shutters.
  addOpeningAt(fId, { x: west, y: ENTRY_Y }, { type: 'door', width: 36, height: 80, lites: { cols: 1, rows: 1 } });
  win(fId, { x: west, y: 203 }, 96, 40, 3, 1, { shutters: true, sill: 47 });
  win(sId, { x: west, y: 200 }, 48, 28, 4, 2, { shutters: true, sill: 50 });
  // The porch: knee walls 36" high. Its front has a glazed north bay, the entry in line with the
  // house door and an open south bay; its north side is glazed and its south side open above the
  // knee wall (the south side is not in the photos: estimate).
  const knee = 36;
  win(fId, { x: (PORCH.x0 + T) / 2, y: pc.y0 }, 44, 40, 3, 1, { sill: knee });
  win(fId, { x: pc.x0, y: 17.5 }, 18, 40, 1, 2, { sill: knee });
  addOpeningAt(fId, { x: pc.x0, y: ENTRY_Y }, { type: 'passage', width: 36, height: 80, sill: 0 });
  addOpeningAt(fId, { x: pc.x0, y: 78.5 }, { type: 'passage', width: 18, height: 44, sill: knee });
  addOpeningAt(fId, { x: (PORCH.x0 + T) / 2, y: pc.y1 }, { type: 'passage', width: 44, height: 44, sill: knee });
  // First Floor passages and the Bath door (centres from the jambs). Kitchen/Living: 48", south jamb 6' from
  // the lake wall's inside face (y 188..236). Hall to Stair strip (y 99.5 line) and Stair strip to Living
  // (y 137.5 wall): 36" each at x 132..168, up to the partition's west face. The stair's bottom opens to
  // Living by a 30" opening at x 7..37. Bath: 30" x 80" door, north jamb 6" from the north wall's inside
  // face (y 13..43, an estimate), swinging into the hall.
  const WEST = { x: -1, y: 0 };
  const NORTH = { x: 0, y: -1 };
  const SOUTH = { x: 0, y: 1 };
  addOpeningAt(fId, { x: PART.kl, y: 212 }, { type: 'passage', width: 48, height: 80, sill: 0 });
  addOpeningAt(fId, { x: 150, y: PART.line }, { type: 'passage', width: 36, height: 80, sill: 0 });
  addOpeningAt(fId, { x: 150, y: PART.stairSouth }, { type: 'passage', width: 36, height: 80, sill: 0 });
  addOpeningAt(fId, { x: 22, y: PART.stairSouth }, { type: 'passage', width: 30, height: 80, sill: 0 });
  addOpeningAt(fId, { x: PART.bathWest, y: 28 }, { type: 'door', width: 30, height: 80, lites: { cols: 1, rows: 1 }, into: WEST });
  // Second Floor doors and openings (the sketch): Bunk and Master doors 28" off the landing, closet
  // opening 24", Bath door 24" swinging out into the hall, Guest door 30" into the Guest.
  addOpeningAt(sId, { x: 150, y: UP.line }, { type: 'door', width: 28, height: 80, into: NORTH });
  addOpeningAt(sId, { x: 150, y: UP.strip }, { type: 'door', width: 28, height: 80, into: SOUTH });
  addOpeningAt(sId, { x: 22, y: UP.strip }, { type: 'passage', width: 24, height: 80, sill: 0 });
  addOpeningAt(sId, { x: 196, y: UP.bathSouth }, { type: 'door', width: 24, height: 80, into: SOUTH });
  addOpeningAt(sId, { x: 196, y: UP.guestNorth }, { type: 'door', width: 30, height: 80, into: SOUTH });
  // North face (the road): first floor either side of the chimney, second floor two windows.
  win(fId, { x: ft(8), y: north }, 72, 48, 6, 3);
  win(fId, { x: ft(19.5), y: north }, 48, 36, 2, 1);
  win(sId, { x: ft(6.5), y: north }, 48, 40, 4, 3);
  // The east one was centred x 240, which put its west jamb across the Bath's east wall (x 220.5, face
  // 223); it sits in the Office, so it moves east to x 248 (jambs 224..272).
  win(sId, { x: 248, y: north }, 48, 40, 4, 3);
  // East face (photo 3, taken facing west): two double-sash windows upstairs, the south one just
  // north of where the wing's ridge meets the wall, and one set high on the first floor north of the
  // wing.
  win(sId, { x: east, y: 98 }, 46, 44, 4, 3, { sill: 34 });
  win(sId, { x: east, y: 222 }, 46, 44, 4, 3, { sill: 34 });
  win(fId, { x: east, y: 152 }, 40, 40, 4, 3, { sill: 42 });
  // The wing: its east gable end, north and south faces.
  win(fId, { x: wing.x1, y: (WING.y0 + WING.y1) / 2 }, 56, 44, 6, 3);
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y0 }, 48, 40, 4, 3);
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, 36, 36, 2, 2);
  // The walkout double door below the wing's south window.
  addOpeningAt(bId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, { type: 'door', width: 60, height: 80, lites: { cols: 1, rows: 1 } });

  // ---- Roofs.
  // Main roof about 6:12 (photos 3 and 8 both read 5.5 to 7); the wing's ridge meets the main east
  // wall just under the upstairs south window (photo 3), about 7:12.
  roof(sId, { shape: 'gable', outline: outline(MAIN), ridgeAngle: 0, pitch: 6, overhang: 24 });
  roof(fId, { shape: 'gable', outline: outline(WING), ridgeAngle: 0, pitch: 7, overhang: 18 });
  // Entry porch: a gable with its ridge east-west, so the gable faces west over the entry (photo 8;
  // about 5:12, eaves well past the knee walls). The porch's west wall rises into the gable.
  roof(fId, { shape: 'gable', outline: outline(PORCH), ridgeAngle: 0, pitch: 5, overhang: 18 });

  // ---- Chimney against the middle of the north wall (photo 6; photo 8 shows it at the same spot in
  // perspective). The porch posts are the wall pieces between its openings, so no separate posts.
  const chimneyAt = { x: MAIN.x1 / 2, y: MAIN.y0 - 20 };
  const chimneyHeights = () => {
    const d = columnDefaults(getPlan(), 'chimney', chimneyAt);
    return { ...d, base: round2(d.base), top: round2(d.top) };
  };
  if (!store().addColumn({ at: chimneyAt, kind: 'chimney', phase: PHASE, ...chimneyHeights() })) throw new Error('chimney rejected');

  // ---- Room labels, one per area (names say where a number is an estimate).
  const label = (levelId: Id, name: string, at: Vec2) => {
    if (!store().addRoom(levelId, { name, anchor: at })) throw new Error(`room ${name} rejected`);
  };
  const mid = { x: MAIN.x1 / 2, y: MAIN.y1 / 2 };
  label(bId, 'Basement (unpartitioned, est.)', mid);
  // First Floor: one label in each face (anchors well inside the faces).
  label(fId, 'Entry hall', { x: 100, y: 52 });
  label(fId, 'Bath', { x: (PART.bathWest + 2.5 + (CL.x1 - HALF)) / 2, y: 52 });
  label(fId, 'Kitchen (17\'2" adjusted: re-measure)', { x: (PART.kl + 2.5 + (CL.x1 - HALF)) / 2, y: (PART.line + 2.5 + (CL.y1 - HALF)) / 2 });
  label(fId, 'Living', { x: (CL.x0 + HALF + (PART.kl - 2.5)) / 2, y: (PART.stairSouth + 2.5 + (CL.y1 - HALF)) / 2 });
  label(fId, 'Stair', { x: 100, y: STRIP_MID });
  label(fId, 'Utility', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 });
  label(fId, 'Entry porch (est.)', { x: (PORCH.x0 + PORCH.x1) / 2, y: ENTRY_Y });
  // Second Floor. The Office / hall is one face with the landing and the stair well.
  label(sId, 'Bunk', { x: 90, y: 52 });
  label(sId, 'Bath', { x: (UP.ew + 2.5 + (UP.bathEast - 2.5)) / 2, y: 45 });
  label(sId, 'Master closet', { x: (CL.x0 + HALF + (UP.closet - 2.5)) / 2, y: STRIP_MID });
  label(sId, 'Master', { x: 90, y: 225 });
  label(sId, 'Guest (11\'5" adjusted)', { x: 242, y: 235 });
  label(sId, 'Office / hall (11\'11" adjusted)', { x: 267, y: 110 });

  return getPlan();
}

/** The starter plan as the JSON text of docs/examples/146-mick-road.json (stable ids, fixed date). */
export function buildExampleJson(): string {
  return stableIds(buildExamplePlan());
}
