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
// face flush with the main block's (photos 01, 03, 09; the owner's sketch puts it there too). Interior
// measured 11'6" x 9'5", so outside x 318..463, y 188..315 (its west side is the main block's east wall).
const UTILITY = { w: ft(11.5), d: ft(9) + 5 };
const WING = { x0: MAIN.x1, x1: MAIN.x1 + UTILITY.w + T, y0: MAIN.y1 - UTILITY.d - 2 * T, y1: MAIN.y1 };
// Entry porch: one structure on the west face at its north end, flush with the north face (photo 08,
// taken facing east; photos 06 and 07 show the same porch from the road). Estimated 8' along the wall
// by 5'6" out (photos 06 and 07 read 7' to 9' out; the starter keeps 5'6" until it is measured).
// Shingled knee walls with screens above them in all four bays, a screen door in line with the house
// door, and its own gable facing west.
const PORCH = { x0: -66, x1: MAIN.x0, y0: MAIN.y0, y1: ft(8) };
/** The house door and the porch entry share this line (photo 08). */
const ENTRY_Y = ft(4);

/** The house's dark red-brown stain: siding, rake boards, rafter tails, the chimney (photos 01, 06, 07, 08). */
const FINISH_COLOR = '#5a3a35';
/** The grey concrete block of the foundation (photos 01 and 02). */
const BLOCK_COLOR = '#8f8a84';
/** Weathered galvanized corrugated steel (the main and porch roofs, photos 06 and 07) and the wing's darker, browner sheet (photo 03). */
const ROOF_GALVANIZED = '#8a8378';
const ROOF_WING = '#6e4b3c';
/** The house door's dark green (photo 08). */
const DOOR_GREEN = '#2f4a3a';
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
  /** Per sash of a window, per leaf of a door. */
  lites?: { cols: number; rows: number };
  shutters?: boolean;
  /** Trim width on the outside face (default 4"). */
  trim?: number;
  /** Windows: sashes side by side; doors: leaves (2 is a double door). */
  sashes?: number;
  fixedCenter?: boolean;
  glazing?: Opening['glazing'];
  halfLite?: boolean;
  leafColor?: string;
  swing?: NonNullable<Opening['swing']>;
  /** Doors: the direction the leaf swings toward (picks the swing side from the wall's direction). */
  into?: Vec2;
}

/** Add an opening centred at p (on a wall's centerline); throws when it does not fit the wall where it is. */
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
  const at = Math.round(offset * 1000) / 1000;
  const id = store().addOpening(levelId, {
    wallId,
    type: o.type,
    offset: at,
    width: o.width,
    height: o.height,
    sill: o.sill ?? (o.type === 'door' ? 0 : 30),
    phase: PHASE,
    ...(o.type === 'door' ? { swing: swing ?? { hinge: 'a' as const, side: 'left' as const } } : {}),
    ...(o.lites ? { lites: o.lites } : {}),
    ...(o.shutters ? { shutters: true } : {}),
    ...(o.trim !== undefined ? { trim: o.trim } : {}),
    ...(o.sashes !== undefined ? { sashes: o.sashes } : {}),
    ...(o.fixedCenter ? { fixedCenter: true } : {}),
    ...(o.glazing ? { glazing: o.glazing } : {}),
    ...(o.halfLite ? { halfLite: true } : {}),
    ...(o.leafColor ? { leafColor: o.leafColor } : {}),
  });
  if (!id) throw new Error(`opening at ${JSON.stringify(p)} on ${level(levelId).name} was rejected`);
  // addOpening slides an opening that reaches past a corner or a partition's face back onto the
  // wall; here that would be a wrong number, so it is an error.
  const placed = level(levelId).openings[id].offset;
  if (Math.abs(placed - at) > 1e-6) throw new Error(`opening at ${JSON.stringify(p)} on ${level(levelId).name} does not fit: moved from ${at} to ${placed}`);
  return id;
}

const win = (levelId: Id, p: Vec2, width: number, height: number, cols: number, rows: number, extra: Partial<OpeningSpec> = {}) =>
  addOpeningAt(levelId, p, { type: 'window', width, height, lites: { cols, rows }, ...extra });

/**
 * A roof of the house: corrugated metal, a 2.5" slab (sheet on purlins), open eaves with the rafter
 * tails showing (5.5" deep every 24", photos 01, 02 and 07) and 7" rake boards, all in the stain
 * (photos 03 and 08). `color` and `weathering` (rust) per roof.
 */
function roof(levelId: Id, r: Pick<Roof, 'shape' | 'outline' | 'ridgeAngle' | 'pitch' | 'overhang'>, color: string, weathering: number): Id {
  const id = store().addRoof(levelId, {
    ...r,
    bearingOffset: 0,
    thickness: 2.5,
    fascia: 7,
    phase: PHASE,
    finish: 'metal',
    color,
    eave: 'open',
    rafter: { depth: 5.5, spacing: 24 },
    boardColor: FINISH_COLOR,
    weathering,
  });
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

  // ---- Basement: the block, with the walkout bump under the wing (8" walls of grey concrete block,
  // photos 01 and 02). The bump's south wall, round the walkout double door, is vertical boards in the
  // stain (photo 02).
  drawWalls(bId, ring(CL), TB, true);
  drawWalls(bId, [{ x: CL.x1, y: wing.y0 }, { x: wing.x1, y: wing.y0 }, { x: wing.x1, y: wing.y1 }, { x: CL.x1, y: wing.y1 }], TB);
  store().updateWalls(bId, Object.keys(level(bId).walls), { finish: 'block', color: BLOCK_COLOR });
  const bl = level(bId);
  const bumpSouth = Object.keys(bl.walls).filter((id) => {
    const a = bl.nodes[bl.walls[id].a];
    const b = bl.nodes[bl.walls[id].b];
    return a.y === wing.y1 && b.y === wing.y1 && Math.min(a.x, b.x) >= CL.x1;
  });
  if (bumpSouth.length !== 1) throw new Error('the basement bump has no south wall');
  store().updateWalls(bId, bumpSouth, { finish: 'board', color: FINISH_COLOR });

  // ---- First Floor: the block, the east wing and the entry porch on the west face. The porch's north
  // wall continues the house's north wall in a straight line.
  drawWalls(fId, ring(CL), T, true);
  const wingWalls = drawWalls(fId, [{ x: CL.x1, y: wing.y0 }, { x: wing.x1, y: wing.y0 }, { x: wing.x1, y: wing.y1 }, { x: CL.x1, y: wing.y1 }], T);
  const pc = centerline(PORCH, HALF);
  drawWalls(fId, [{ x: CL.x0, y: CL.y0 }, { x: pc.x0, y: pc.y0 }, { x: pc.x0, y: pc.y1 }, { x: CL.x0, y: pc.y1 }], T);
  store().updateWalls(fId, Object.keys(level(fId).walls), { finish: 'shingle', color: FINISH_COLOR });
  // The wing's east gable end is clapboard (photo 03).
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
  // west ones (photos 01, 03, 06, 08).
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
  // The porch's floor is about at grade (photos 07 and 08): the ground is at +1, an inch under its
  // floor top (+2), at its two outer corners, the middle of its front and its two corners against the
  // house (the north one is also the main block's north-west corner), so its slab edge hardly shows.
  gp(MAIN.x0, MAIN.y0, 1);
  gp(MAIN.x1, MAIN.y0, -4);
  gp(PORCH.x0, PORCH.y0, 1);
  gp(PORCH.x0, PORCH.y1, 1);
  gp(PORCH.x0, (PORCH.y0 + PORCH.y1) / 2, 1);
  gp(PORCH.x1, PORCH.y1, 1);
  gp(MAIN.x1 / 2, MAIN.y0, -4);
  gp(MAIN.x0, MAIN.y1 / 2, -8);
  gp(MAIN.x0, MAIN.y1, -14);
  gp(MAIN.x1, MAIN.y1, -88);
  gp(WING.x1, WING.y1, -100);
  // The lawn reaches nearly to the first floor at the wing's north-east corner and drops under the
  // deck toward the lake (photo 03).
  gp(WING.x1, WING.y0, -20);
  gp(MAIN.x1 + ft(6), ft(8), -6);
  gp(MAIN.x1 / 2, MAIN.y1 + ft(10), -100);
  gp((WING.x0 + WING.x1) / 2, WING.y1 + ft(10), -100);
  // The walkout's threshold: the ground at the basement floor in front of the double door's two
  // jambs (6" out from the wall), so the doors open onto the terrace instead of into a bank.
  gp((WING.x0 + WING.x1) / 2 - 36, WING.y1 + 6, -100);
  gp((WING.x0 + WING.x1) / 2 + 36, WING.y1 + 6, -100);
  gp(MAIN.x1 / 4, MAIN.y0 - ft(30), 6);
  gp((MAIN.x1 * 3) / 4, MAIN.y0 - ft(30), 6);

  // ---- Openings. Every window and door of the outside is an estimate from the photos (README, "What to
  // replace with measurements"); lites are per sash of a window and per leaf of a door. addOpeningAt
  // throws when one does not fit where it is put, so the jambs clear every corner and partition face.
  const south = CL.y1;
  const north = CL.y0;
  const east = CL.x1;
  const west = CL.x0;
  const WEST = { x: -1, y: 0 };
  const NORTH = { x: 0, y: -1 };
  const SOUTH = { x: 0, y: 1 };
  // South face (the lake side, photo 01; photo 02 from below its east end). First floor: two picture
  // windows, each a casement of 2 x 3 lites, a wide fixed pane and another casement (side sashes 24"),
  // about 12' (the Living) and 10' (the Kitchen) wide; their jambs clear the Kitchen/Living
  // partition's faces at x 168 and 173 (Living x 15.5..159.5, Kitchen x 183..301).
  win(fId, { x: 87.5, y: south }, 144, 60, 2, 3, { sashes: 3, fixedCenter: true });
  win(fId, { x: 242, y: south }, 118, 60, 2, 3, { sashes: 3, fixedCenter: true });
  // Second floor: four casements over the Master and three over the Guest, 2 x 3 lites each.
  win(sId, { x: 115, y: south }, 88, 46, 2, 3, { sashes: 4, sill: 34 });
  win(sId, { x: 256, y: south }, 66, 46, 2, 3, { sashes: 3, sill: 34 });
  // West face (the entry, photo 08): the house door inside the porch, dark green with nine lites over
  // two panels; a window set high (its head above the door head) of a casement (2 x 3 lites), a fixed
  // pane and a casement, and upstairs two casements of 2 x 2 lites; both windows have shutters.
  addOpeningAt(fId, { x: west, y: ENTRY_Y }, { type: 'door', width: 36, height: 80, lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: DOOR_GREEN });
  win(fId, { x: west, y: 203 }, 90, 44, 2, 3, { sashes: 3, fixedCenter: true, shutters: true, sill: 44 });
  win(sId, { x: west, y: 200 }, 48, 32, 2, 2, { sashes: 2, shutters: true, sill: 48 });
  // The porch (photos 07 and 08): screens above 36" knee walls in all four bays (the two narrow front
  // ones either side of the entry; the south side shows only as light through the porch in photo 07:
  // estimate), and a screen door in line with the house door, swinging out. No trim: the posts
  // between the front openings are only 3.5" wide, and the photos show the porch's framing stained
  // like its walls.
  const knee = 36;
  const screened = { glazing: 'screen' as const, trim: 0 };
  addOpeningAt(fId, { x: (PORCH.x0 + T) / 2, y: pc.y0 }, { type: 'window', width: 44, height: 44, sill: knee, ...screened });
  addOpeningAt(fId, { x: pc.x0, y: 17.5 }, { type: 'window', width: 18, height: 44, sill: knee, ...screened });
  addOpeningAt(fId, { x: pc.x0, y: ENTRY_Y }, { type: 'door', width: 36, height: 80, into: WEST, leafColor: FINISH_COLOR, ...screened });
  addOpeningAt(fId, { x: pc.x0, y: 78.5 }, { type: 'window', width: 18, height: 44, sill: knee, ...screened });
  addOpeningAt(fId, { x: (PORCH.x0 + T) / 2, y: pc.y1 }, { type: 'window', width: 44, height: 44, sill: knee, ...screened });
  // First Floor passages and the Bath door (centres from the jambs). Kitchen/Living: 48", south jamb 6' from
  // the lake wall's inside face (y 188..236). Hall to Stair strip (y 99.5 line) and Stair strip to Living
  // (y 137.5 wall): 36" each at x 132..168, up to the partition's west face. The stair's bottom opens to
  // Living by a 30" opening at x 7..37. Bath: 30" x 80" door, north jamb 6" from the north wall's inside
  // face (y 13..43, an estimate), swinging into the hall.
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
  // North face (the road, photos 06 and 07): on the first floor three casements of 2 x 3 lites west of
  // the chimney (jambs x 56..136) and two single panes east of it; upstairs two casement pairs.
  win(fId, { x: ft(8), y: north }, 80, 56, 2, 3, { sashes: 3 });
  win(fId, { x: ft(19.5), y: north }, 42, 44, 1, 1, { sashes: 2, sill: 34 });
  win(sId, { x: ft(6.5), y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // The east one was centred x 240, which put its west jamb across the Bath's east wall (x 220.5, face
  // 223); it sits in the Office, so it moves east to x 248 (jambs 225..271, 2" clear of that face).
  win(sId, { x: 248, y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // East face (photo 03, taken facing west): two casement pairs upstairs, the south one just north of
  // where the wing's ridge meets the wall, and one casement set high on the first floor north of the
  // wing; 2 x 3 lites each.
  win(sId, { x: east, y: 98 }, 46, 44, 2, 3, { sashes: 2, sill: 34 });
  win(sId, { x: east, y: 222 }, 46, 44, 2, 3, { sashes: 2, sill: 34 });
  win(fId, { x: east, y: 152 }, 36, 40, 2, 3, { sill: 42 });
  // The wing: casement pairs of 2 x 3 lites in its east gable end (photo 03), its north face and its
  // south face (photos 01 and 02).
  win(fId, { x: wing.x1, y: (WING.y0 + WING.y1) / 2 }, 48, 44, 2, 3, { sashes: 2 });
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y0 }, 48, 40, 2, 3, { sashes: 2 });
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, 48, 44, 2, 3, { sashes: 2, sill: 30 });
  // The walkout double door below the wing's south window (photo 02): two plain leaves in the stain,
  // set in the boards with no trim round them.
  addOpeningAt(bId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, { type: 'door', width: 72, height: 80, lites: { cols: 1, rows: 1 }, sashes: 2, leafColor: FINISH_COLOR, trim: 0 });

  // ---- Roofs: rusting corrugated metal (roof()). The main and porch roofs are weathered galvanized
  // steel with rust streaks (photos 06 and 07), the porch's the rustiest; the wing's sheet is darker
  // and browner, less streaked (photo 03).
  // Main roof about 6:12 (photos 03 and 08 both read 5.5 to 7); the wing's ridge meets the main east
  // wall just under the upstairs south window (photo 03), about 7:12.
  roof(sId, { shape: 'gable', outline: outline(MAIN), ridgeAngle: 0, pitch: 6, overhang: 24 }, ROOF_GALVANIZED, 0.6);
  roof(fId, { shape: 'gable', outline: outline(WING), ridgeAngle: 0, pitch: 7, overhang: 18 }, ROOF_WING, 0.3);
  // Entry porch: a gable with its ridge east-west, so the gable faces west over the entry (photo 08;
  // about 5:12, eaves well past the knee walls). The porch's west wall rises into the gable.
  roof(fId, { shape: 'gable', outline: outline(PORCH), ridgeAngle: 0, pitch: 5, overhang: 18 }, ROOF_GALVANIZED, 0.7);

  // ---- Chimney against the middle of the north wall (photo 06; photo 08 shows it at the same spot in
  // perspective): about 24" along the wall and 20" out from it (photos 06 and 07), stained like the
  // house, with a concrete cap and a wire spark arrestor on top (photo 07). The porch posts are the
  // wall pieces between its openings, so no separate posts.
  const chimneyAt = { x: MAIN.x1 / 2, y: MAIN.y0 - 10 };
  const chimneyHeights = () => {
    const d = columnDefaults(getPlan(), 'chimney', chimneyAt);
    return { ...d, base: round2(d.base), top: round2(d.top) };
  };
  // The depth after the defaults (a new chimney is 40" deep).
  if (!store().addColumn({ at: chimneyAt, kind: 'chimney', phase: PHASE, ...chimneyHeights(), depth: 20, color: FINISH_COLOR, cap: true })) throw new Error('chimney rejected');

  // ---- Room labels, one per area (names say where a number is an estimate). A label is drawn at its
  // anchor (else at the middle of the room's widest part), so the anchors are where each reads best.
  const label = (levelId: Id, name: string, at: Vec2) => {
    if (!store().addRoom(levelId, { name, anchor: at })) throw new Error(`room ${name} rejected`);
  };
  const mid = { x: MAIN.x1 / 2, y: MAIN.y1 / 2 };
  label(bId, 'Basement (unpartitioned, est.)', mid);
  // The walkout bump under the wing is its own space until it is measured (README).
  label(bId, 'Utility (below)', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 });
  // First Floor: one label in each face (anchors well inside the faces).
  label(fId, 'Entry hall', { x: 100, y: 52 });
  label(fId, 'Bath', { x: (PART.bathWest + 2.5 + (CL.x1 - HALF)) / 2, y: 52 });
  label(fId, 'Kitchen (17\'2" adjusted: re-measure)', { x: (PART.kl + 2.5 + (CL.x1 - HALF)) / 2, y: (PART.line + 2.5 + (CL.y1 - HALF)) / 2 });
  label(fId, 'Living', { x: (CL.x0 + HALF + (PART.kl - 2.5)) / 2, y: (PART.stairSouth + 2.5 + (CL.y1 - HALF)) / 2 });
  // On the treads below the UP arrow: the half above it has the UP mark and the hall wall's dimension.
  label(fId, 'Stair', { x: 70, y: STRIP_MID + 9 });
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
