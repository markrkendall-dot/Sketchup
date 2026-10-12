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
import { getPlan, usePlanStore, type NewFixture, type NewStairs } from '../src/store/planStore';

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
/** Poured concrete of the retaining wall (photos 02 and 23). */
const CONCRETE_COLOR = '#b3b0a8';
/** The retaining wall's centerline: about 10' south of the main block, from past its west face (photo 23). */
const RETAIN = { y: ft(26) + 3 + ft(10), west: -120 };
/** The house door's dark green (photo 08). */
const DOOR_GREEN = '#2f4a3a';
/** The Bath's flush stained door (photo 22) and the grey Kitchen to Utility door (photos 13 and 14). */
const STAINED_DOOR = '#8a5a34';
const UTILITY_DOOR_GREY = '#7f8b8f';
/** Inside, from photos 13 to 22: knotty pine casework, a light laminate counter, white appliances and fixtures, a black stove. */
const PINE = '#c4884e';
const LAMINATE = '#e2dccb';
const WHITE = '#f1efe8';
const STOVE_BLACK = '#26241f';
/** The front room's cream paint (photos 19 and 20) and the Utility's blue mini fridge (MK). */
const CREAM = '#ddd6b4';
const FRIDGE_BLUE = '#3a5fa0';
/**
 * Centre of the Kitchen's east window and the sink under it: the sink base comes right after the
 * corner cabinet (photos 13 and 15), and the window's 40" stays clear of the wing's north wall (its
 * face at y 188). Re-measure.
 */
const KITCHEN_WINDOW_Y = 160;
const PHASE: Phase = 'existing';
const NEW: Phase = 'new';
/**
 * The proposed powder room's partitions (centerlines): its west wall x 129.5 (faces 127..132, just
 * west of the hall passage's west jamb at x 132, so the existing passage keeps its place) and its
 * north wall y 45.5 (faces 43..48, along the south edge of the new stair).
 */
const POWDER = { west: 129.5, north: 45.5 };
/** The Kitchen/Living partition's centerline and the stair strip's south line (no wall there today). */
const PART_KL = 170.5;
const STAIR_SOUTH = 137.5;

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
function drawWalls(levelId: Id, pts: Vec2[], thickness: number, close = false, phase: Phase = PHASE): Id[] {
  const out: Id[] = [];
  const n = close ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const res = store().addWall(levelId, pts[i], pts[(i + 1) % pts.length], { kind: 'exterior', thickness, phase });
    if (!res) throw new Error(`wall ${i} of ${JSON.stringify(pts)} was rejected`);
    out.push(...res.wallIds);
  }
  return out;
}

/** Draw one interior partition (5") between two centerline points; it T-joins what it meets. */
function partition(levelId: Id, a: Vec2, b: Vec2, phase: Phase = PHASE): void {
  if (!store().addWall(levelId, a, b, { kind: 'interior', thickness: TI, phase })) throw new Error(`partition ${JSON.stringify([a, b])} was rejected`);
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
  /** Default existing. */
  phase?: Phase;
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
    phase: o.phase ?? PHASE,
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
function roof(levelId: Id, r: Pick<Roof, 'shape' | 'outline' | 'ridgeAngle' | 'pitch' | 'overhang'>, color: string, weathering: number, phase: Phase = PHASE): Id {
  const id = store().addRoof(levelId, {
    ...r,
    bearingOffset: 0,
    thickness: 2.5,
    fascia: 7,
    phase,
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

/** Add a cabinet, appliance, sink or box (DESIGN.md "Casework"); throws when the store refuses it. */
function fixture(levelId: Id, f: NewFixture): Id {
  const id = store().addFixture(levelId, f);
  if (!id) throw new Error(`fixture ${f.kind} at ${JSON.stringify(f.origin)} on ${level(levelId).name} was rejected`);
  return id;
}

/** Name a room: a label anchored at `at`. A label of a new or demolished room shows only in the views that show its phase. */
function label(levelId: Id, name: string, at: Vec2, phase: Phase = PHASE): void {
  if (!store().addRoom(levelId, { name, anchor: at, ...(phase === 'existing' ? {} : { phase }) })) throw new Error(`room ${name} rejected`);
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
      ['c', lvl.fixtures],
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
  // There is no wall on the stair strip's south side (the y 137.5 line): the flight is open to the
  // Living, with a newel, a spindle rail and shelves under it (photos 16 and 18), so the strip is part
  // of the Living's face. PART.stairSouth only places labels and the old passages' comments.
  const PART = { kl: 170.5, line: 99.5, bathWest: 194.5, stairSouth: 137.5 };
  // The y 99.5 line is drawn in pieces, east to west, so the two that the proposed design takes out
  // (the Kitchen/Bath piece east of x 194.5 and the hall/strip piece west of x 129.5) are walls of
  // their own: the same faces and openings, one extra node at x 129.5, where the proposed powder
  // room's west wall meets the line.
  for (const [x0, x1] of [
    [CL.x1, PART.bathWest],
    [PART.bathWest, PART.kl],
    [PART.kl, POWDER.west],
    [POWDER.west, CL.x0],
  ]) {
    partition(fId, { x: x0, y: PART.line }, { x: x1, y: PART.line });
  }
  partition(fId, { x: PART.kl, y: CL.y1 }, { x: PART.kl, y: PART.line });
  partition(fId, { x: PART.bathWest, y: PART.line }, { x: PART.bathWest, y: CL.y0 });
  // The stair climbs east to x 132, 33" wide (the whole strip, y 102..135), under the Second Floor's
  // landing, and cuts the Second Floor's floor. Its bottom riser and newel stand about 2' east of the
  // west wall's inside face (photos 16 and 18), and the stringer reads about 45 degrees, so the run
  // is 101" from x 31 (an estimate: re-measure the bottom riser and the riser count).
  const STRIP_MID = 118.5;
  const STAIR_BOTTOM = CL.x0 + HALF + 24;
  const stair = store().addStairs(fId, { origin: { x: STAIR_BOTTOM, y: STRIP_MID }, direction: 0, width: 33, run: 132 - STAIR_BOTTOM, phase: PHASE, cutsFloorAbove: true });
  if (!stair) throw new Error('stairs rejected');

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

  // ---- Terrain (all estimates, see the README): the road side meets the first floor; on the lake
  // side a level terrace a few inches under the first floor runs the length of the main block,
  // held up by the concrete retaining wall about 10' out (photos 02 and 23), and only the wing's
  // basement walks out, onto the lower terrace in front of its doors.
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
  gp(MAIN.x1, MAIN.y1, -8);
  gp(WING.x1, WING.y1, -100);
  // The lawn reaches nearly to the first floor at the wing's north-east corner and drops under the
  // deck toward the lake (photo 03).
  gp(WING.x1, WING.y0, -20);
  gp(MAIN.x1 + ft(6), ft(8), -6);
  // The retaining wall (drawn on the Basement level below): the terrace at -6 just inside it, the lawn
  // just outside it falling from about -50 at its west end to the walkout's -100 at the wing. The
  // terrain is a coarse interpolated grid, so the drop is a short ramp that the wall mostly hides.
  for (const [x, outside] of [[RETAIN.west + 10, -50], [MAIN.x0, -60], [MAIN.x1 / 2, -85], [MAIN.x1 - 16, -100]]) {
    gp(x, RETAIN.y - 8, -6);
    gp(x, RETAIN.y + 8, outside);
  }
  for (const y of [MAIN.y1 + 16, RETAIN.y - 16]) {
    gp(CL.x1 - 8, y, -6);
    gp(CL.x1 + 8, y, -100);
  }
  gp((WING.x0 + WING.x1) / 2, WING.y1 + ft(10), -100);
  // The walkout's threshold: the ground at the basement floor in front of the double door's two
  // jambs (6" out from the wall), so the doors open onto the terrace instead of into a bank.
  gp((WING.x0 + WING.x1) / 2 - 36, WING.y1 + 6, -100);
  gp((WING.x0 + WING.x1) / 2 + 36, WING.y1 + 6, -100);
  gp(MAIN.x1 / 4, MAIN.y0 - ft(30), 6);
  gp((MAIN.x1 * 3) / 4, MAIN.y0 - ft(30), 6);
  // The retaining wall itself (photos 02 and 23): poured concrete, about 10" thick, its top 2" over
  // the terrace (96" from the basement floor), from past the house's west face east to the corner of
  // the main block and the wing, then north to it. Its west end is free (an open end on the plan).
  const retaining = drawWalls(bId, [{ x: RETAIN.west, y: RETAIN.y }, { x: CL.x1, y: RETAIN.y }, { x: CL.x1, y: CL.y1 }], 10);
  store().updateWalls(bId, retaining, { finish: 'plain', color: CONCRETE_COLOR, heightOverride: 96 });
  // The wooden stair along the wing's east side (photo 23): from the walkout's terrace up north to the
  // lawn at the wing's north-east corner, 36" wide, 11 risers (an estimate; railings are not drawn).
  if (!store().addStairs(bId, { origin: { x: WING.x1 + 22, y: WING.y1 - 6 }, direction: 270, width: 36, run: 110, rise: 80, risers: 11, phase: PHASE, cutsFloorAbove: false })) throw new Error('wing stair rejected');

  // ---- Openings. Every window and door of the outside is an estimate from the photos (README, "What to
  // replace with measurements"); lites are per sash of a window and per leaf of a door. addOpeningAt
  // throws when one does not fit where it is put, so the jambs clear every corner and partition face.
  const south = CL.y1;
  const north = CL.y0;
  const east = CL.x1;
  const west = CL.x0;
  const WEST = { x: -1, y: 0 };
  const EAST = { x: 1, y: 0 };
  const NORTH = { x: 0, y: -1 };
  const SOUTH = { x: 0, y: 1 };
  // South face (the lake side, photo 01; photo 02 from below its east end). First floor: two picture
  // windows, each a casement of 2 x 4 lites (photos 14, 17 and 23), a wide fixed pane and another
  // casement (side sashes 24"), about 12' (the Living) and 10' (the Kitchen) wide; their jambs clear
  // the Kitchen/Living partition's faces at x 168 and 173 (Living x 15.5..159.5, Kitchen x 183..301).
  win(fId, { x: 87.5, y: south }, 144, 60, 2, 4, { sashes: 3, fixedCenter: true });
  win(fId, { x: 242, y: south }, 118, 60, 2, 4, { sashes: 3, fixedCenter: true });
  // Second floor: four casements over the Master and three over the Guest, 2 x 3 lites each.
  win(sId, { x: 115, y: south }, 88, 46, 2, 3, { sashes: 4, sill: 34 });
  win(sId, { x: 256, y: south }, 66, 46, 2, 3, { sashes: 3, sill: 34 });
  // West face (the entry, photo 08): the house door inside the porch, dark green outside (pale
  // blue-green inside, photo 19; a leaf has one colour), one large lite over two panels, swinging into
  // the front room (its hinges show on that side, photo 19); a window set high (its head above the
  // door head) of a casement (2 x 2 lites, photo 18), a fixed pane and a casement, and upstairs two
  // casements of 2 x 2 lites; both windows have shutters.
  const houseDoor = addOpeningAt(fId, { x: west, y: ENTRY_Y }, { type: 'door', width: 36, height: 80, lites: { cols: 1, rows: 1 }, halfLite: true, leafColor: DOOR_GREEN, into: EAST });
  const livingWest = win(fId, { x: west, y: 203 }, 90, 44, 2, 2, { sashes: 3, fixedCenter: true, shutters: true, sill: 44 });
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
  // First Floor passages and doors (centres from the jambs; sizes are estimates from photos 13 to 22).
  // Kitchen/Living: 48", south jamb 6' from the lake wall's inside face (y 188..236). South of it, past
  // a short wall with the thermostat, a pass-through with a shelf ledge at about counter height, 48"
  // wide, its south jamb 8" from the lake wall's inside face (y 252..300; photos 14 and 17). Front room
  // to the stair strip (y 99.5 line): a tall cased opening, 36" at x 132..168, up to the partition's
  // west face, its head near the crown (photos 16 and 20). Bath: 30" x 80" flush stained door at the
  // south end of its west wall, its south jamb about 1' from the Bath's south wall (y 54..84; photos
  // 20 and 22 both put the casing about 9" to 13" from that corner), swinging into the Bath (hinged
  // on its north jamb). Kitchen to Utility: a grey 32" half-lite door of 3 x 3 lites at the Kitchen's
  // south end, its south jamb 28" from the lake wall's inside face (y 248..280, photos 13 and 14),
  // swinging into the Utility (no hinges show on the Kitchen side).
  addOpeningAt(fId, { x: PART.kl, y: 212 }, { type: 'passage', width: 48, height: 80, sill: 0 });
  addOpeningAt(fId, { x: PART.kl, y: 276 }, { type: 'passage', width: 48, height: 42, sill: 42 });
  const hallPassage = addOpeningAt(fId, { x: 150, y: PART.line }, { type: 'passage', width: 36, height: 88, sill: 0 });
  const bathDoor = addOpeningAt(fId, { x: PART.bathWest, y: 69 }, { type: 'door', width: 30, height: 80, leafColor: STAINED_DOOR, into: EAST });
  addOpeningAt(fId, { x: east, y: 264 }, { type: 'door', width: 32, height: 80, lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: UTILITY_DOOR_GREY, into: EAST });
  // Second Floor doors and openings (the sketch): Bunk and Master doors 28" off the landing, closet
  // opening 24", Bath door 24" swinging out into the hall, Guest door 30" into the Guest.
  addOpeningAt(sId, { x: 150, y: UP.line }, { type: 'door', width: 28, height: 80, into: NORTH });
  addOpeningAt(sId, { x: 150, y: UP.strip }, { type: 'door', width: 28, height: 80, into: SOUTH });
  addOpeningAt(sId, { x: 22, y: UP.strip }, { type: 'passage', width: 24, height: 80, sill: 0 });
  addOpeningAt(sId, { x: 196, y: UP.bathSouth }, { type: 'door', width: 24, height: 80, into: SOUTH });
  addOpeningAt(sId, { x: 196, y: UP.guestNorth }, { type: 'door', width: 30, height: 80, into: SOUTH });
  // North face (the road, photos 06 and 07): on the first floor three casements of 2 x 3 lites west of
  // the chimney (jambs x 56..136) and two single panes east of it (the Bath's, 48" over the washer and
  // dryer, its sill just above the 40" wainscot, photo 22); upstairs two casement pairs.
  win(fId, { x: ft(8), y: north }, 80, 56, 2, 3, { sashes: 3 });
  const bathWindow = win(fId, { x: ft(19.5), y: north }, 48, 44, 1, 1, { sashes: 2, sill: 42 });
  win(sId, { x: ft(6.5), y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // The east one was centred x 240, which put its west jamb across the Bath's east wall (x 220.5, face
  // 223); it sits in the Office, so it moves east to x 248 (jambs 225..271, 2" clear of that face).
  win(sId, { x: 248, y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // East face (photo 03, taken facing west): two casement pairs upstairs, the south one just north of
  // where the wing's ridge meets the wall, and one casement pair set high on the first floor north of
  // the wing, over the Kitchen sink (photos 13 and 15), as far south as the wing's north wall allows
  // (its face at y 188); 2 x 3 lites each.
  win(sId, { x: east, y: 98 }, 46, 44, 2, 3, { sashes: 2, sill: 34 });
  win(sId, { x: east, y: 222 }, 46, 44, 2, 3, { sashes: 2, sill: 34 });
  const eastWindow = win(fId, { x: east, y: KITCHEN_WINDOW_Y }, 40, 40, 2, 3, { sashes: 2, sill: 42 });
  // The wing: casement pairs in its east gable end (photo 03), 2 x 3 lites, and in its south face,
  // 2 x 2 lites (photo 23). Its north face has no window (MK).
  win(fId, { x: wing.x1, y: (WING.y0 + WING.y1) / 2 }, 48, 44, 2, 3, { sashes: 2 });
  win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, 48, 44, 2, 2, { sashes: 2, sill: 30 });
  // The walkout double door below the wing's south window (photo 02): two plain leaves in the stain,
  // set in the boards with no trim round them.
  addOpeningAt(bId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, { type: 'door', width: 72, height: 80, lites: { cols: 1, rows: 1 }, sashes: 2, leafColor: FINISH_COLOR, trim: 0 });

  // ---- Roofs: rusting corrugated metal (roof()). The main and porch roofs are weathered galvanized
  // steel with rust streaks (photos 06 and 07), the porch's the rustiest; the wing's sheet is darker
  // and browner, less streaked (photo 03).
  // Main roof about 6:12 (photos 03 and 08 both read 5.5 to 7); the wing's ridge meets the main east
  // wall just under the upstairs south window (photo 03), about 7:12.
  roof(sId, { shape: 'gable', outline: outline(MAIN), ridgeAngle: 0, pitch: 6, overhang: 24 }, ROOF_GALVANIZED, 0.6);
  const wingRoof = roof(fId, { shape: 'gable', outline: outline(WING), ridgeAngle: 0, pitch: 7, overhang: 18 }, ROOF_WING, 0.3);
  // Entry porch: a gable with its ridge east-west, so the gable faces west over the entry (photo 08;
  // about 5:12, eaves well past the knee walls). The porch's west wall rises into the gable.
  const porchRoof = roof(fId, { shape: 'gable', outline: outline(PORCH), ridgeAngle: 0, pitch: 5, overhang: 18 }, ROOF_GALVANIZED, 0.7);

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

  // ---- Fixtures as they are (photos 13 to 22; sizes are estimates). The Kitchen, inside x 173..311,
  // y 102..308: knotty pine plank fronts, a light laminate counter.
  store().updateFinishes(fId, { cabinetColor: PINE, counterColor: LAMINATE, frontStyle: 'slab' });
  const casework: Id[] = [];
  const existingFixture = (f: Omit<NewFixture, 'phase'>) => casework.push(fixture(fId, { ...f, phase: PHASE }));
  const BASE = { depth: 24, height: 34.5, elevation: 0 };
  const UPPER = { depth: 12, height: 42, elevation: 54 };
  const k = { north: 102, east: 311 };
  const SOUTHWARD = 90;
  const WESTWARD = 180;
  // The north wall, west to east (photo 15): a 30" top-freezer fridge against the west wall, a 24" base
  // (a drawer over two doors), the 30" range under its hood, a 15" bank of four drawers.
  existingFixture({ kind: 'fridge', origin: { x: 188, y: k.north }, direction: SOUTHWARD, width: 30, depth: 30, height: 66, elevation: 0 });
  existingFixture({ kind: 'base', origin: { x: 215, y: k.north }, direction: SOUTHWARD, width: 24, ...BASE });
  existingFixture({ kind: 'range', origin: { x: 242, y: k.north }, direction: SOUTHWARD, width: 30, depth: 25, height: 36, elevation: 0 });
  existingFixture({ kind: 'hood', origin: { x: 242, y: k.north }, direction: SOUTHWARD, width: 30, depth: 18, height: 6, elevation: 60 });
  existingFixture({ kind: 'base', origin: { x: 264.5, y: k.north }, direction: SOUTHWARD, width: 15, ...BASE });
  // The north-east corner: one 30" base set at 45 degrees (photos 13 and 15), its back corners on the
  // two walls' faces, so it faces south-west.
  const diag = 30 / Math.SQRT2 / 2;
  existingFixture({ kind: 'base', origin: { x: round2(k.east - diag), y: round2(k.north + diag) }, direction: 135, width: 30, ...BASE });
  // The east wall, north to south (photos 13 and 15): the sink base under the window, the dishwasher,
  // a two-drawer base, then a gap before the Utility door's casing (y 244).
  existingFixture({ kind: 'sink', origin: { x: k.east, y: KITCHEN_WINDOW_Y }, direction: WESTWARD, width: 36, ...BASE });
  existingFixture({ kind: 'dishwasher', origin: { x: k.east, y: KITCHEN_WINDOW_Y + 30 }, direction: WESTWARD, width: 24, ...BASE });
  existingFixture({ kind: 'base', origin: { x: k.east, y: KITCHEN_WINDOW_Y + 54 }, direction: WESTWARD, width: 24, ...BASE });
  // Wall cabinets to the crown (54" to 96"): over the fridge (raised), either side of the hood and a
  // short one over it, one at 45 degrees across the corner, one north of the window and two south of
  // it, ending before the door (photos 13 and 15).
  existingFixture({ kind: 'wall', origin: { x: 188, y: k.north }, direction: SOUTHWARD, width: 30, depth: 12, height: 26, elevation: 70 });
  existingFixture({ kind: 'wall', origin: { x: 215, y: k.north }, direction: SOUTHWARD, width: 24, ...UPPER });
  existingFixture({ kind: 'wall', origin: { x: 242, y: k.north }, direction: SOUTHWARD, width: 30, depth: 12, height: 30, elevation: 66 });
  existingFixture({ kind: 'wall', origin: { x: 275, y: k.north }, direction: SOUTHWARD, width: 36, ...UPPER });
  const diagUpper = 24 / Math.SQRT2 / 2;
  existingFixture({ kind: 'wall', origin: { x: round2(k.east - diagUpper), y: round2(k.north + diagUpper) }, direction: 135, width: 24, ...UPPER });
  existingFixture({ kind: 'wall', origin: { x: k.east, y: 128 }, direction: WESTWARD, width: 16, ...UPPER });
  existingFixture({ kind: 'wall', origin: { x: k.east, y: KITCHEN_WINDOW_Y + 39 }, direction: WESTWARD, width: 30, ...UPPER });
  existingFixture({ kind: 'wall', origin: { x: k.east, y: KITCHEN_WINDOW_Y + 69 }, direction: WESTWARD, width: 30, ...UPPER });
  // The Bath, inside x 197..311, y 7..97 (photos 21 and 22): a 60" tub along the east wall's north
  // end and the toilet south of it, a 36" vanity with its sink on the south wall beside the toilet, and
  // the dryer then the washer along the north wall from the west wall.
  const b = { north: 7, east: 311, south: 97 };
  existingFixture({ kind: 'box', label: 'Tub', origin: { x: b.east, y: 37 }, direction: WESTWARD, width: 60, depth: 30, height: 16, elevation: 0, frontColor: WHITE });
  existingFixture({ kind: 'box', label: 'WC', origin: { x: b.east, y: 82 }, direction: WESTWARD, width: 20, depth: 28, height: 30, elevation: 0, frontColor: WHITE });
  existingFixture({ kind: 'sink', origin: { x: 263, y: b.south }, direction: 270, width: 36, depth: 24, height: 31.5, elevation: 0 });
  existingFixture({ kind: 'box', label: 'Dryer', origin: { x: 210.5, y: b.north }, direction: SOUTHWARD, width: 27, depth: 28, height: 40, elevation: 0, frontColor: WHITE });
  existingFixture({ kind: 'box', label: 'Washer', origin: { x: 237.5, y: b.north }, direction: SOUTHWARD, width: 27, depth: 28, height: 40, elevation: 0, frontColor: WHITE });
  // The Bath's tub sits in an alcove: a pine-clad stub wall, floor to ceiling, at its south end
  // between it and the toilet (photo 21).
  existingFixture({ kind: 'box', origin: { x: b.east, y: 69 }, direction: WESTWARD, width: 4, depth: 30, height: 96, elevation: 0, frontColor: PINE });
  // The front room's north-east corner is cut off by an angled wall (photo 20, MK): its face runs
  // from the north wall's face at x 161 (by the chimney, where the stovepipe's thimble is) to the
  // Bath's west wall face at y 25, facing south-west (120 degrees), 36" long; both ends are
  // estimates from photo 20. It is a full-height box, not a wall, because a wall would split the
  // Bath's west wall at y 23.5, where the proposed closet door (y 19..43) goes.
  const angle = { mid: { x: 176.5, y: 16 }, out: { x: -0.5, y: Math.sqrt(3) / 2 } };
  const offAngle = (d: number) => ({ x: round2(angle.mid.x + angle.out.x * d), y: round2(angle.mid.y + angle.out.y * d) });
  existingFixture({ kind: 'box', origin: offAngle(-4), direction: 120, width: 36, depth: 4, height: 96, elevation: 0, frontColor: CREAM });
  // The black wood stove on its stone hearth in front of the angled wall, turned to face south-west
  // with it (photos 16 and 20), its pipe up and back into the thimble at the wall's north end.
  existingFixture({ kind: 'box', origin: offAngle(0), direction: 120, width: 34, depth: 40, height: 1, elevation: 0, frontColor: '#7d7a73' });
  existingFixture({ kind: 'box', label: 'Wood stove', origin: offAngle(8), direction: 120, width: 24, depth: 26, height: 30, elevation: 1, frontColor: STOVE_BLACK });
  // The Utility, inside x 318..456, y 195..308 (MK; no photos, so every size and place is an
  // estimate): wood panelled, old wood kitchen wall cabinets on the north wall and on the west wall
  // north of the Kitchen door (its casing at y 244.5), open shelves under the south and east
  // windows (up to their 30" sills), and a blue mini fridge on the south wall, east of the shelves.
  const u = { west: 318, east: 456, north: 195, south: 308 };
  for (const x of [351, 393, 435]) existingFixture({ kind: 'wall', origin: { x, y: u.north }, direction: SOUTHWARD, width: 42, depth: 12, height: 30, elevation: 54 });
  for (const y of [207, 231]) existingFixture({ kind: 'wall', origin: { x: u.west, y }, direction: 0, width: 24, depth: 12, height: 30, elevation: 54 });
  const shelves = { kind: 'box' as const, label: 'Open shelves', width: 48, depth: 12, height: 29, elevation: 0, frontColor: PINE };
  existingFixture({ ...shelves, origin: { x: (WING.x0 + WING.x1) / 2, y: u.south }, direction: 270 });
  existingFixture({ ...shelves, origin: { x: u.east, y: (WING.y0 + WING.y1) / 2 }, direction: WESTWARD });
  existingFixture({ kind: 'box', label: 'Mini fridge', origin: { x: 434, y: u.south }, direction: 270, width: 20, depth: 20, height: 34, elevation: 0, frontColor: FRIDGE_BLUE });

  // ---- Room labels, one per area (names say where a number is an estimate). A label is drawn at its
  // anchor (else at the middle of the room's widest part), so the anchors are where each reads best.
  const mid = { x: MAIN.x1 / 2, y: MAIN.y1 / 2 };
  label(bId, 'Basement (unpartitioned, est.)', mid);
  // The walkout bump under the wing is its own space until it is measured (README).
  label(bId, 'Utility (below)', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 });
  // First Floor: one label in each face (anchors well inside the faces).
  // MK calls the old entry hall the front room (photos 19 and 20).
  label(fId, 'Front room', { x: 100, y: 52 });
  label(fId, 'Bath', { x: (PART.bathWest + 2.5 + (CL.x1 - HALF)) / 2, y: 52 });
  label(fId, 'Kitchen (17\'2" adjusted: re-measure)', { x: (PART.kl + 2.5 + (CL.x1 - HALF)) / 2, y: (PART.line + 2.5 + (CL.y1 - HALF)) / 2 });
  label(fId, 'Living', { x: (CL.x0 + HALF + (PART.kl - 2.5)) / 2, y: (PART.stairSouth + 2.5 + (CL.y1 - HALF)) / 2 });
  // The stair strip is part of the Living (no wall on its south side), so it has no label of its own.
  label(fId, 'Utility', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 });
  label(fId, 'Entry porch (est.)', { x: (PORCH.x0 + PORCH.x1) / 2, y: ENTRY_Y });
  // Second Floor. The Office / hall is one face with the landing and the stair well.
  label(sId, 'Bunk', { x: 90, y: 52 });
  label(sId, 'Bath', { x: (UP.ew + 2.5 + (UP.bathEast - 2.5)) / 2, y: 45 });
  label(sId, 'Master closet', { x: (CL.x0 + HALF + (UP.closet - 2.5)) / 2, y: STRIP_MID });
  label(sId, 'Master', { x: 90, y: 225 });
  label(sId, 'Guest (11\'5" adjusted)', { x: 242, y: 235 });
  label(sId, 'Office / hall (11\'11" adjusted)', { x: 267, y: 110 });

  proposed({ bId, fId, stair, houseDoor, livingWest, hallPassage, eastWindow, wingRoof, porchRoof, bathDoor, bathWindow, fixtures: casework });
  return getPlan();
}

/** Ids from the existing house that the proposed design demolishes or builds on. */
interface ExistingIds {
  bId: Id;
  fId: Id;
  stair: Id;
  houseDoor: Id;
  livingWest: Id;
  hallPassage: Id;
  eastWindow: Id;
  wingRoof: Id;
  porchRoof: Id;
  /** The old bath's door (x 194.5, at the south end of the wall, y 54..84) and its north window (x 234). */
  bathDoor: Id;
  bathWindow: Id;
  /** The existing Kitchen, Bath, front room and Utility fixtures (the old layout gives way to the new one). */
  fixtures: Id[];
}

/**
 * Mark existing work demolished (the store's setPhase, as "Mark demolish" does). Walls are named
 * by a point on their centerline, rooms by name; a demolished wall takes its openings with it.
 * Throws when something named is not there.
 */
function demolish(levelId: Id, d: { walls?: Vec2[]; openings?: Id[]; stairs?: Id[]; roofs?: Id[]; fixtures?: Id[]; rooms?: string[] }): void {
  const lvl = level(levelId);
  const walls = (d.walls ?? []).map((p) => wallAt(levelId, p).wallId);
  const openings = [...(d.openings ?? []), ...Object.values(lvl.openings).filter((o) => walls.includes(o.wallId)).map((o) => o.id)];
  const rooms = (d.rooms ?? []).map((name) => {
    const r = Object.values(lvl.rooms).find((room) => room.name === name);
    if (!r) throw new Error(`no room ${name} on ${lvl.name}`);
    return r.id;
  });
  const sel = { walls, openings, stairs: d.stairs ?? [], roofs: d.roofs ?? [], fixtures: d.fixtures ?? [], rooms };
  store().setPhase(levelId, sel, 'demo');
  const after = level(levelId);
  const phases = [
    ...sel.walls.map((id) => after.walls[id]?.phase),
    ...sel.openings.map((id) => after.openings[id]?.phase),
    ...sel.stairs.map((id) => after.stairs[id]?.phase),
    ...sel.roofs.map((id) => after.roofs[id]?.phase),
    ...sel.fixtures.map((id) => after.fixtures[id]?.phase),
    ...sel.rooms.map((id) => after.rooms[id]?.phase),
  ];
  if (phases.some((p) => p !== 'demo')) throw new Error(`demolish on ${lvl.name}: something was not marked`);
}

/**
 * The proposed design (MK's brief of 12 Oct 2026; docs/history/PLAN-v4-proposed.md), drawn as new
 * and demolished work on the existing house: the east wing grown north into a master suite, the
 * kitchen into the old bath, a new stair from a front door on the west wall up to a landing in the
 * north-west corner and east along the north wall, a powder room in the old hall, and a foyer with a
 * screen porch on the west face in place of the entry porch. Everything is demolished first, so the
 * existing openings are clamped against the proposed walls only once, and none of them moves.
 */
function proposed(ids: ExistingIds): void {
  const { bId, fId } = ids;
  const wing = centerline(WING, HALF);
  const NORTH = { x: 0, y: -1 };
  const SOUTH = { x: 0, y: 1 };
  const EAST = { x: 1, y: 0 };
  const pc = centerline(PORCH, HALF);
  // First floor top (+2"): the basement floor -100" plus its 90" walls and the 12" floor.
  const FLOOR_TOP = 2;

  // ---- Demolition (First Floor). The entry porch: its three walls (their screens go with them),
  // its roof and its label. The wing's north wall, the main block's east window (it
  // would face into the new bedroom), the wing's roof. The y 99.5 piece between the Kitchen and the
  // Bath, and the one between the hall and the stair strip west of the powder room, with the hall's
  // passage (the powder room takes its place). The stair and the house door. The Living's west
  // window: its north shutter would sit inside the foyer, against the new door's trim, so a window
  // without shutters replaces it. The old bath's door (at the south end of its west wall it would
  // open from the powder room into the kitchen) and its north window (the kitchen counter runs under
  // where it was, so a shorter one is set higher). The old fixtures: the Kitchen's casework, the
  // Bath's, the Utility's, and the wood stove with the angled wall behind it (the new flight runs
  // along the north wall where they stand).
  demolish(fId, {
    walls: [
      { x: (pc.x0 + CL.x0) / 2, y: pc.y0 },
      { x: pc.x0, y: ENTRY_Y },
      { x: (pc.x0 + CL.x0) / 2, y: pc.y1 },
      { x: (WING.x0 + WING.x1) / 2, y: wing.y0 },
      { x: 250, y: 99.5 },
      { x: 60, y: 99.5 },
    ],
    openings: [ids.eastWindow, ids.hallPassage, ids.houseDoor, ids.livingWest, ids.bathDoor, ids.bathWindow],
    stairs: [ids.stair],
    roofs: [ids.wingRoof, ids.porchRoof],
    fixtures: ids.fixtures,
    rooms: ['Entry porch (est.)', 'Utility', 'Bath'],
  });

  // ---- 1. East addition: the wing grows north to the road corner at the same depth, one wing down
  // the whole east side, outside x 318..463, y 0..315. Its north wall continues the main block's,
  // its east wall the wing's; a 5" partition at y 120 divides the master bath (north) from the master
  // bedroom (the old Utility plus 6').
  const ADD = { y: 120 };
  const addition = drawWalls(fId, [{ x: CL.x1, y: CL.y0 }, { x: wing.x1, y: CL.y0 }, { x: wing.x1, y: wing.y0 }], T, false, NEW);
  store().updateWalls(fId, addition, { finish: 'shingle', color: FINISH_COLOR });
  partition(fId, { x: CL.x1, y: ADD.y }, { x: wing.x1, y: ADD.y }, NEW);
  // The foundation under it: 8" block from the main block's north-east corner to the bump's.
  const footing = drawWalls(bId, [{ x: CL.x1, y: CL.y0 }, { x: wing.x1, y: CL.y0 }, { x: wing.x1, y: wing.y0 }], TB, false, NEW);
  store().updateWalls(bId, footing, { finish: 'block', color: BLOCK_COLOR });

  // ---- 5. Foyer and screen porch on the west face, outside x -96..0. The foyer's north wall runs
  // through the post between the old porch's screen door and its south screen (y 66..69.5) and its
  // south wall stops north of the Living's west window (y 158..248), so the old porch's openings and
  // the Living window keep their places in the existing view: foyer y 64.25..158 (7'10" x 8'), the
  // screen porch y 158..315 (13'1" x 8'). The foyer's north wall crosses the old porch's west wall,
  // which normalizeLevel splits at the crossing.
  const FOYER = { x0: -96, y0: 64.25, y1: 158 };
  const fy = { west: FOYER.x0 + HALF, north: FOYER.y0 + HALF, south: FOYER.y1 - HALF };
  const foyer = drawWalls(fId, [{ x: CL.x0, y: fy.north }, { x: fy.west, y: fy.north }, { x: fy.west, y: fy.south }, { x: CL.x0, y: fy.south }], T, false, NEW);
  const porch = drawWalls(fId, [{ x: fy.west, y: fy.south }, { x: fy.west, y: CL.y1 }, { x: CL.x0, y: CL.y1 }], T, false, NEW);
  store().updateWalls(fId, [...foyer, ...porch], { finish: 'shingle', color: FINISH_COLOR });

  // ---- 4. Powder room in the old hall, south of the new flight: x 132..192, y 48..97 inside
  // (5' x 4'1"), its west wall clear of the old hall passage's jamb.
  partition(fId, { x: POWDER.west, y: 99.5 }, { x: POWDER.west, y: POWDER.north }, NEW);
  partition(fId, { x: POWDER.west, y: POWDER.north }, { x: 194.5, y: POWDER.north }, NEW);
  // The pocket between the top of the new flight and the old bath's west wall becomes a closet off
  // the kitchen: a partition at x 171.5 (faces 169..174, the top of the flight against its west
  // face, under the Bunk's east wall upstairs) closes it from the hall, x 174..192, y 7..43 inside.
  partition(fId, { x: 171.5, y: CL.y0 }, { x: 171.5, y: POWDER.north }, NEW);

  // ---- The design keeps the entry hall apart from the Living (the brief's bands: "wall y 137.5"),
  // but the photos show no wall on the stair strip's south side today, so the proposed phase builds
  // it, 5", from the west wall to the Kitchen/Living partition, with the two openings the brief keeps
  // in it: 36" at x 132..168 and 30" at x 7..37. One deletion leaves the entry open to the Living.
  partition(fId, { x: PART_KL, y: STAIR_SOUTH }, { x: CL.x0, y: STAIR_SOUTH }, NEW);

  // ---- Openings, all new. Windows 2 x 3 lites per sash, sill 30 unless given.
  const add = (p: Vec2, o: OpeningSpec) => addOpeningAt(fId, p, { ...o, phase: NEW });
  // Master suite: the bath's door in the partition, the bedroom's door from the kitchen in the main
  // block's east wall south of the kitchen's pantry run (y 102..186), beside the island's east
  // walkway, and windows north and east. The east wall is in two pieces either side of y 191.5,
  // where the old wing's north wall meets it, so the door's jambs (y 195..227) start at that old
  // wall's south face, clear of the joint.
  add({ x: 345, y: ADD.y }, { type: 'door', width: 28, height: 80, into: NORTH });
  add({ x: CL.x1, y: 211 }, { type: 'door', width: 32, height: 80, into: EAST });
  add({ x: 390, y: CL.y0 }, { type: 'window', width: 36, height: 36, sill: 48, lites: { cols: 2, rows: 3 } });
  add({ x: wing.x1, y: 62 }, { type: 'window', width: 48, height: 44, sashes: 2, lites: { cols: 2, rows: 3 } });
  add({ x: wing.x1, y: 160 }, { type: 'window', width: 48, height: 44, sashes: 2, lites: { cols: 2, rows: 3 } });
  // The house door moves to the middle of the old stair strip (y 118.5): 32", so its jambs (102.5 to
  // 134.5) clear the strip's partition faces at 102 and 135; green, nine lites over two panels.
  const halfLite = { lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: DOOR_GREEN };
  add({ x: CL.x0, y: 118.5 }, { type: 'door', width: 32, height: 80, into: EAST, ...halfLite });
  // The foyer: the 36" front door in its west wall in line with the house door, a window in its
  // north wall (x -42: x -48 would put its west jamb across the old porch wall's crossing at x -62.5).
  add({ x: fy.west, y: 118.5 }, { type: 'door', width: 36, height: 80, into: EAST, ...halfLite });
  add({ x: -42, y: fy.north }, { type: 'window', width: 36, height: 44, sill: 36, lites: { cols: 2, rows: 3 } });
  // The Living's west window again, without shutters (it looks into the screen porch), 4" south so
  // its trim clears the foyer's south wall.
  add({ x: CL.x0, y: 207 }, { type: 'window', width: 90, height: 44, sill: 44, sashes: 3, fixedCenter: true, lites: { cols: 2, rows: 2 } });
  // Screen porch: screens above 36" knee walls, two 56" bays in the west wall either side of the
  // middle post and one 44" in the south wall; screen doors from the foyer and out to the lawn.
  const screen = { type: 'window' as const, height: 44, sill: 36, glazing: 'screen' as const, trim: 0 };
  add({ x: fy.west, y: 199 }, { ...screen, width: 56 });
  add({ x: fy.west, y: 273 }, { ...screen, width: 56 });
  add({ x: -62, y: CL.y1 }, { ...screen, width: 44 });
  const screenDoor = { type: 'door' as const, width: 36, height: 80, leafColor: FINISH_COLOR, glazing: 'screen' as const, trim: 0 };
  add({ x: -48, y: fy.south }, { ...screenDoor, into: SOUTH });
  add({ x: -20, y: CL.y1 }, { ...screenDoor, into: SOUTH });
  // Powder room door from the hall.
  add({ x: POWDER.west, y: 72 }, { type: 'door', width: 28, height: 80, into: EAST });
  // The old bath's north window again, raised over the kitchen's north counter: 42 x 36, two sashes
  // of 2 x 3 lites, sill 44 (the counter top is at 36).
  add({ x: ft(19.5), y: CL.y0 }, { type: 'window', width: 42, height: 36, sill: 44, sashes: 2, lites: { cols: 2, rows: 3 } });
  // The closet (x 174..192, y 7..43): a 24" door from the kitchen (jambs y 19..43) in place of the
  // old bath's 30" one, swinging into the kitchen clear of the north counter (from x 221).
  add({ x: 194.5, y: 31 }, { type: 'door', width: 24, height: 80, into: EAST });
  // The new strip wall's two openings (above).
  add({ x: 150, y: STAIR_SOUTH }, { type: 'passage', width: 36, height: 80, sill: 0 });
  add({ x: 22, y: STAIR_SOUTH }, { type: 'passage', width: 30, height: 80, sill: 0 });

  // ---- 3. The stair, 36" wide: two risers north from the old hall up to a 14" landing in the
  // north-west corner, then the main flight east along the north wall to the Bunk's east wall face
  // upstairs (x 169). The short flight's run is 36" (two 18" treads, y 79 to 43), the shortest run
  // the store takes. The main flight is 35.5" wide, 1/2" off the north wall's inside face, so its
  // floor opening lies inside the Second Floor's slab (which ends at that face) and is cut.
  const flight = (s: Omit<NewStairs, 'phase'>) => {
    if (!store().addStairs(fId, { ...s, phase: NEW })) throw new Error(`stairs at ${JSON.stringify(s.origin)} rejected`);
  };
  flight({ origin: { x: 25, y: 79 }, direction: 270, width: 36, run: 36, rise: 14, risers: 2, cutsFloorAbove: false });
  flight({ origin: { x: 25, y: 43 }, direction: 270, width: 36, run: 36, rise: 14, risers: 1, cutsFloorAbove: false });
  flight({ origin: { x: 43, y: 25.25 }, direction: 0, width: 35.5, run: 126, base: 14, rise: 94, cutsFloorAbove: true });

  // ---- Roofs, new sheet (little rust). The wing: one gable over the whole east side, ridge
  // north-south, the wing roof's pitch and colour. The foyer: a gable facing west over the front door
  // like the old porch's; the screen porch: a shed high at the house wall (128") and down to 96" at
  // its outer wall, meeting the gable's eave line. The two overlap at y 158 (no valley). Both
  // outlines stop 18" short of the house wall (x -18): an overhang is the same on every edge, so
  // their east edges' overhang ends at the wall's outside face instead of running 18" into the
  // house (a rake board and rafter tails upstairs). The slopes are the same either way.
  const ROOF_EAST = MAIN.x0 - 18;
  roof(fId, { shape: 'gable', outline: outline({ x0: MAIN.x1, x1: WING.x1, y0: MAIN.y0, y1: MAIN.y1 }), ridgeAngle: 90, pitch: 7, overhang: 18 }, ROOF_WING, 0.1, NEW);
  roof(fId, { shape: 'gable', outline: outline({ x0: FOYER.x0, x1: ROOF_EAST, y0: FOYER.y0, y1: FOYER.y1 }), ridgeAngle: 0, pitch: 8, overhang: 18 }, ROOF_GALVANIZED, 0.1, NEW);
  roof(fId, { shape: 'shed', outline: outline({ x0: FOYER.x0, x1: ROOF_EAST, y0: FOYER.y1, y1: MAIN.y1 }), ridgeAngle: 180, pitch: 4, overhang: 18 }, ROOF_GALVANIZED, 0.1, NEW);

  // ---- The porch's posts: 8" x 8" in the stain, flush with the outside face of its west wall, at
  // its north corner, between the two screen bays and at its south-west corner, from the porch floor
  // to the roof's underside over each (columnDefaults).
  for (const y of [162, 236, 311]) {
    const at = { x: -92, y };
    const d = columnDefaults(getPlan(), 'post', at, NEW);
    if (!store().addColumn({ at, kind: 'post', phase: NEW, width: 8, depth: 8, rotation: 0, base: FLOOR_TOP, top: round2(d.top), color: FINISH_COLOR })) throw new Error(`post at y ${y} rejected`);
  }

  // ---- 2. The kitchen (docs/history/PLAN-v5-kitchen.md): the main kitchen x 173..311, y 102..308
  // inside, and the old bath's alcove x 197..311, y 7..97, open to it along y 97..102. All new;
  // cabinet and counter colours are the level's defaults. A fixture's origin is the middle of its
  // back edge and its direction the way its front faces (left and right as you face the front).
  const kitchen = (f: Omit<NewFixture, 'phase' | 'elevation'> & { elevation?: number }) => fixture(fId, { elevation: 0, ...f, phase: NEW });
  const KITCHEN_EAST = 311;
  const ALCOVE_NORTH = 7;
  const COUNTER_HEIGHT = 34.5;
  // The island, its fronts facing north (you stand north of it, facing the lake): the dishwasher and
  // the sink cabinet, x 212..272, y 212..236. The top overhangs 1" at the front, 12" at the back
  // (the seating ledge on the lake side) and 3" past each outer end (facing north, left is west), so
  // it is one top 66 x 37, x 209..275, y 211..248: 36" walkways to the Living partition (x 173) and
  // the east wall (x 311), 60" from the ledge to the lake wall.
  const ISLAND_BACK = 236;
  kitchen({ kind: 'dishwasher', origin: { x: 224, y: ISLAND_BACK }, direction: 270, width: 24, depth: 24, height: COUNTER_HEIGHT, counterOverhang: { front: 1, back: 12, left: 3, right: 0 } });
  kitchen({ kind: 'sink', origin: { x: 254, y: ISLAND_BACK }, direction: 270, width: 36, depth: 24, height: COUNTER_HEIGHT, counterOverhang: { front: 1, back: 12, left: 0, right: 3 } });
  // Two stools on the lake side of the ledge, 16" square and 30" high, centred y 258.
  for (const x of [226, 258]) kitchen({ kind: 'box', origin: { x, y: 266 }, direction: 270, width: 16, depth: 16, height: 30, label: 'Stool' });
  // The east wall, fronts facing west: a tall pantry, the refrigerator (30" deep, 6" proud of the
  // pantries), a tall pantry, y 102..186, with a wall cabinet over the refrigerator.
  const eastWall = (kind: NewFixture['kind'], y: number, width: number, depth: number, height: number, elevation = 0) =>
    kitchen({ kind, origin: { x: KITCHEN_EAST, y }, direction: 180, width, depth, height, elevation });
  eastWall('tall', 114, 24, 24, 84);
  eastWall('fridge', 144, 36, 30, 70);
  eastWall('tall', 174, 24, 24, 84);
  eastWall('wall', 144, 36, 15, 15, 70);
  // The range wall in the alcove (its east wall, the wall shared with the master bath): a base
  // cabinet, the range, a base cabinet, y 7..97; the hood over the range and wall cabinets over the
  // bases. The range carries no counter, so the bases have a counter each. The hood's flue runs up
  // to the ceiling (96" above the floor top); the second floor is overhead, so its duct goes through
  // the east wall into the master bath's ceiling and up through the wing roof (or it recirculates).
  eastWall('base', 22, 30, 24, COUNTER_HEIGHT);
  eastWall('range', 52, 30, 25, 36);
  eastWall('base', 82, 30, 24, COUNTER_HEIGHT);
  eastWall('hood', 52, 30, 18, 30, 66);
  eastWall('wall', 22, 30, 12, 30, 54);
  eastWall('wall', 82, 30, 12, 30, 54);
  // The alcove's north counter, fronts facing south, x 221..287 (36 and 30), meeting the range
  // wall's north base cabinet at the corner (one L counter), under the raised window.
  kitchen({ kind: 'base', origin: { x: 239, y: ALCOVE_NORTH }, direction: 90, width: 36, depth: 24, height: COUNTER_HEIGHT });
  kitchen({ kind: 'base', origin: { x: 272, y: ALCOVE_NORTH }, direction: 90, width: 30, depth: 24, height: COUNTER_HEIGHT });

  // ---- Labels, anchored where the room it replaces in the All view did not reach, so the two
  // never share a face there.
  label(fId, 'Master bedroom (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 155 }, NEW);
  label(fId, 'Master bath (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 62 }, NEW);
  label(fId, 'Powder room (proposed)', { x: 162, y: 72.5 }, NEW);
  label(fId, 'Closet (proposed)', { x: 183, y: 25 }, NEW);
  label(fId, 'Foyer (proposed)', { x: -48, y: 125 }, NEW);
  label(fId, 'Screen porch (proposed)', { x: -48, y: 236 }, NEW);
  label(bId, 'Crawl space (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 97 }, NEW);
}

/** The starter plan as the JSON text of docs/examples/146-mick-road.json (stable ids, fixed date). */
export function buildExampleJson(): string {
  return stableIds(buildExamplePlan());
}
