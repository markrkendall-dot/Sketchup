// The 146 Mick Road starter plan (docs/examples/146-mick-road.json), built through the plan store's
// own actions so every wall, opening and roof goes through normalizeLevel, clamping and validation.
// Pure apart from the store: no file access (scripts/build-example.ts writes the JSON; the example
// test builds it again and compares).
//
// Coordinates: inches, plan x east, y south (down the screen), north is the road side. The exterior is
// laid out from the OUTSIDE faces of the walls, the way the owner's tape reads, and the centerlines
// are set 3.5" (half of 7") inside them, which is what "Lengths to: outside face" does by hand. The
// First Floor interior is the owner's tape measurements (face to face), set out from the inside faces.
import { getLevelElevations } from '../src/derive/levels';
import { roofBearing, roofHeightAt } from '../src/derive/roofs';
import { columnDefaults, groundAt } from '../src/derive/site';
import { getStaircaseLayout, heightAt } from '../src/derive/staircase';
import { COLUMN_COLOR } from '../src/model/finish';
import { dist, normalize, perpLeft, sub } from '../src/model/geometry';
import { createEmptyPlan } from '../src/model/plan';
import { MEMBER_DEFAULTS } from '../src/model/structure';
import type { Id, Opening, Phase, Plan, Roof, Room, Vec2 } from '../src/model/types';
import { getPlan, usePlanStore, type NewDeck, type NewFixture, type NewStairs } from '../src/store/planStore';

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
/**
 * The retaining wall's centerline, after the site sketch (photo 10; MK): a return from the main
 * block's south-east corner 10' south (y 435), a 22' piece angled west and 4'6" further south, and
 * 37' straight west to its free end, about 32' past the main block's west face. The design carries it
 * on (new) about 20' angled and 27' straight to the west property line (3' west of the planned
 * garage, 55' west of the house: x -984). All estimates (the sketch is not to scale).
 */
const RETAIN = { y: ft(26) + 3 + ft(10), bend: { x: 56, y: 489 }, west: -388 };
const RETAIN_NEW = [{ x: -660, y: 519 }, { x: -984, y: 519 }];
/** The retaining wall's centerline y at plan x (the existing wall and the new one). */
const retainY = (x: number): number => {
  if (x >= RETAIN.bend.x) return RETAIN.y + ((CL.x1 - x) / (CL.x1 - RETAIN.bend.x)) * (RETAIN.bend.y - RETAIN.y);
  if (x >= RETAIN.west) return RETAIN.bend.y;
  if (x >= RETAIN_NEW[0].x) return RETAIN.bend.y + ((RETAIN.west - x) / (RETAIN.west - RETAIN_NEW[0].x)) * (RETAIN_NEW[0].y - RETAIN.bend.y);
  return RETAIN_NEW[0].y;
};
/**
 * The bank south of the walkout (photos 24 to 27, estimates): the ground stays at the walkout's -100
 * about 4' out from the wing's south face, then falls 8' (MK) to the lower lawn at -196, which is
 * level from about 12'6" out (today's lower flight of 12 or 13 steps runs down it).
 */
const BANK = { top: ft(26) + 3 + ft(4), bottom: ft(26) + 3 + 150, lawn: -196 };
/** The ground on the bank at y (in front of the walkout). */
const bankAt = (y: number): number => (y <= BANK.top ? -100 : y >= BANK.bottom ? BANK.lawn : round2(-100 + ((BANK.lawn + 100) * (y - BANK.top)) / (BANK.bottom - BANK.top)));
/** A riser of today's lower flight: 13 to the 96" from the walkout's level down to the lower lawn. */
const OUTDOOR_RISER = 96 / 13;
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
/** The front room's and the Living's cream paint (photos 16 to 20) and the Utility's blue mini fridge (MK). */
const CREAM = '#ddd6b4';
/** The Kitchen's blue check wallpaper and beige vinyl tile (photos 13 to 15). */
const CHECK_BLUE = '#2e3f6b';
const VINYL_BEIGE = '#cbbd9c';
/** The dark red-brown paint of the Living's and front room's board floors (photos 16 to 20). */
const FLOOR_RED_BROWN = '#5e2a22';
/** The Bath's green paint over the pine wainscot (photos 21 and 22). */
const BATH_GREEN = '#2f7a68';
/** The Utility's unpainted wood floor (MK). */
const WOOD_FLOOR = '#a87a4c';
/**
 * Placeholder finishes for the rooms with no photos (the Second Floor) and the proposed rooms (MK:
 * neutral placeholders until he chooses): walls painted the default off-white, wood board floors,
 * tile in the baths and the foyer. Not from photos; change them in each room's panel.
 */
const PLACEHOLDER_ROOM = { wallFinish: 'paint', floorFinish: 'boards', floorColor: WOOD_FLOOR } as const;
const PLACEHOLDER_WET = { wallFinish: 'paint', floorFinish: 'tile' } as const;
/** The proposed shakes' brown (and the roof boards'): the dark chocolate of MK's garage. */
const SHAKE_BROWN = '#4b3a32';
/**
 * The Adirondack entry and screen porch (docs/history/PLAN-v10-adirondack.md): dark stained logs
 * and twigs (their end grain amber, the tool's mix toward cut wood, model/structure.ts logEndColor),
 * a dry-stacked river-stone knee wall in the stones' own colours and grey-brown fieldstone.
 */
const DARK_LOG = '#3f2c1f';
const FIELDSTONE = '#8e8579';
const FRIDGE_BLUE = '#3a5fa0';
/**
 * Centre of the Kitchen's east window and the sink under it: the sink base comes right after the
 * corner cabinet (photos 13 and 15), and the window's 40" stays clear of the wing's north wall (its
 * face at y 188). Re-measure.
 */
const KITCHEN_WINDOW_Y = 160;
const PHASE: Phase = 'existing';
const NEW: Phase = 'new';
/** The Kitchen/Living partition's centerline. */
const PART_KL = 170.5;
/** The First Floor's y 99.5 line: the Kitchen's north wall and the front room's south wall. */
const FRONT_LINE = 99.5;
/**
 * The proposed upstairs bath: its west face (the old bath's, x 174), the old bath's east wall line
 * (x 220.5) and the new south wall east of it (y 72.5, faces 70..75).
 */
const UP_BATH = { west: 174, east: 220.5, south: 72.5 };

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
  /** Doors: a sliding door (two glazed panels, no swing). */
  sliding?: boolean;
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
    ...(o.sliding ? { sliding: true } : {}),
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

/** Add a deck (DESIGN.md "Decks"); throws when the store refuses it. */
function deck(levelId: Id, d: NewDeck): Id {
  const id = store().addDeck(levelId, d);
  if (!id) throw new Error(`deck ${JSON.stringify(d.outline)} on ${level(levelId).name} was rejected`);
  return id;
}

/** Add a cabinet, appliance, sink or box (DESIGN.md "Casework"); throws when the store refuses it. */
function fixture(levelId: Id, f: NewFixture): Id {
  const id = store().addFixture(levelId, f);
  if (!id) throw new Error(`fixture ${f.kind} at ${JSON.stringify(f.origin)} on ${level(levelId).name} was rejected`);
  return id;
}

/**
 * Name a room: a label anchored at `at`. A label of a new or demolished room shows only in the views
 * that show its phase. `finishes`: the room's interior finishes (DESIGN.md "Interior finishes").
 */
function label(levelId: Id, name: string, at: Vec2, phase: Phase = PHASE, finishes: Pick<Room, 'wallFinish' | 'wallColor' | 'wainscot' | 'floorFinish' | 'floorColor'> = {}): void {
  if (!store().addRoom(levelId, { name, anchor: at, ...(phase === 'existing' ? {} : { phase }), ...finishes })) throw new Error(`room ${name} rejected`);
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
      ['d', lvl.decks],
      ['h', lvl.floorOpenings],
      ['x', lvl.staircases],
      ['z', lvl.joistZones],
      ['m', lvl.members],
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
  // The y 99.5 line is drawn in pieces, east to west, where the Bath's west wall and the
  // Kitchen/Living partition meet it.
  for (const [x0, x1] of [
    [CL.x1, PART.bathWest],
    [PART.bathWest, PART.kl],
    [PART.kl, CL.x0],
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
  // side a level terrace at -6, a few inches under the first floor, fills the space between the main
  // block and the concrete retaining wall about 10' out (photos 01, 02 and 23), from the wall's free
  // west end, where it meets the west lawn at the same level (MK), east to the wing; only the wing's
  // basement walks out, onto the lower terrace in front of its doors. The ground is the triangulated
  // surface through these points (derive/site.ts), so points at one height make it level.
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
  // The terrace along the main block's south face, the house's corners included, and its west end
  // beside the retaining wall's free end, with the lawn just west of that end at the same level.
  gp(MAIN.x0, MAIN.y1, -6);
  gp(MAIN.x1 / 2, MAIN.y1, -6);
  gp(MAIN.x1, MAIN.y1, -6);
  gp(MAIN.x0 - 120, MAIN.y1, -6);
  gp(WING.x1, WING.y1, -100);
  // The lawn reaches nearly to the first floor at the wing's north-east corner and drops under the
  // deck toward the lake (photo 03).
  gp(WING.x1, WING.y0, -20);
  gp(MAIN.x1 + ft(6), ft(8), -6);
  // The retaining wall (drawn on the Basement level below): the terrace at -6 just inside it, out to
  // the new wall's west end at the property line (the lawn west of the house, where the garage is to
  // go, at the terrace's level), and the ground just outside it falling from about -40 at the west
  // to the walkout's -100 at the wing (estimates). The terrain is sampled on a 24" grid, so the drop
  // is a short ramp that the wall mostly hides.
  for (const [x, outside] of [[-950, -40], [RETAIN_NEW[0].x, -45], [RETAIN.west, -50], [MAIN.x0 - 110, -50], [MAIN.x0, -60], [RETAIN.bend.x, -65], [MAIN.x1 / 2, -85], [MAIN.x1 - 16, -100]]) {
    gp(x, retainY(x) - 8, -6);
    gp(x, retainY(x) + 8, outside);
  }
  gp(-960, 300, -6);
  for (const y of [MAIN.y1 + 16, RETAIN.y - 16]) {
    gp(CL.x1 - 8, y, -6);
    gp(CL.x1 + 8, y, bankAt(y));
  }
  // The bank south of the walkout and the lower lawn below it (BANK; photos 24 to 27): its top 4' out
  // at -100, its foot 12'6" out at -196, and the lawn level out to about 40'.
  for (const x of [(WING.x0 + WING.x1) / 2, WING.x1 + ft(4)]) gp(x, BANK.top, -100);
  for (const x of [360, 445, 540]) gp(x, BANK.bottom, BANK.lawn);
  for (const x of [360, 445, 560]) gp(x, WING.y1 + ft(40), BANK.lawn);
  // The walkout's threshold: the ground at the basement floor in front of the double door's two
  // jambs (6" out from the wall), so the doors open onto the terrace instead of into a bank.
  gp((WING.x0 + WING.x1) / 2 - 36, WING.y1 + 6, -100);
  gp((WING.x0 + WING.x1) / 2 + 36, WING.y1 + 6, -100);
  gp(MAIN.x1 / 4, MAIN.y0 - ft(30), 6);
  gp((MAIN.x1 * 3) / 4, MAIN.y0 - ft(30), 6);
  // The retaining wall itself (photos 02 and 23, its line from the site sketch): poured concrete,
  // about 10" thick, its top 2" over the terrace (96" from the basement floor), from its free west end
  // east, then angled, to the corner of the main block and the wing, then north to it. Its west end
  // is free (an open end on the plan).
  const retaining = drawWalls(bId, [{ x: RETAIN.west, y: RETAIN.bend.y }, RETAIN.bend, { x: CL.x1, y: RETAIN.y }, { x: CL.x1, y: CL.y1 }], 10);
  store().updateWalls(bId, retaining, { finish: 'plain', color: CONCRETE_COLOR, heightOverride: 96 });
  // The wooden stair along the wing's east side (photos 23 and 25): open treads on stringers, from a
  // landing at the walkout's level beside the wing's south-east corner up north to the lawn at the
  // wing's north-east corner, 36" wide, 11 risers; from the same landing a lower flight goes on south
  // down the bank to the lower lawn, 13 risers with the landing's edge (photos 24 to 27). All
  // estimates; its railings are not drawn, the landing's east one is. The proposed design keeps it
  // (MK): the master bedroom's deck has no stair of its own.
  if (!store().addStairs(bId, { origin: { x: WING.x1 + 22, y: WING.y1 - 6 }, direction: 270, width: 36, run: 110, rise: 80, risers: 11, phase: PHASE, cutsFloorAbove: false, open: true })) throw new Error('wing stair rejected');
  const LANDING = { x0: WING.x1 + 4, x1: WING.x1 + 40, y0: WING.y1 - 6, y1: WING.y1 + 30 };
  deck(bId, { outline: outline(LANDING), elevation: 0, railings: [false, true, false, false], phase: PHASE });
  if (!store().addStairs(bId, { origin: { x: WING.x1 + 22, y: LANDING.y1 + 120 }, direction: 270, width: 36, run: 120, base: -96, rise: 12 * OUTDOOR_RISER, risers: 12, phase: PHASE, cutsFloorAbove: false, open: true })) throw new Error('wing lower flight rejected');

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
  // Second floor: three casements over the Master (about 78", photo 01) and three over the Guest,
  // 2 x 3 lites each.
  win(sId, { x: 115, y: south }, 78, 46, 2, 3, { sashes: 3, sill: 34 });
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
  addOpeningAt(fId, { x: 150, y: PART.line }, { type: 'passage', width: 36, height: 88, sill: 0 });
  addOpeningAt(fId, { x: PART.bathWest, y: 69 }, { type: 'door', width: 30, height: 80, leafColor: STAINED_DOOR, into: EAST });
  addOpeningAt(fId, { x: east, y: 264 }, { type: 'door', width: 32, height: 80, lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: UTILITY_DOOR_GREY, into: EAST });
  // Second Floor doors and openings (the sketch): Bunk and Master doors 28" off the landing, closet
  // opening 24", Bath door 24" swinging out into the hall, Guest door 30" into the Guest.
  // The leaves are stained like the First Floor's Bath door (photo 22): an estimate, no photos.
  addOpeningAt(sId, { x: 150, y: UP.line }, { type: 'door', width: 28, height: 80, into: NORTH, leafColor: STAINED_DOOR });
  addOpeningAt(sId, { x: 150, y: UP.strip }, { type: 'door', width: 28, height: 80, into: SOUTH, leafColor: STAINED_DOOR });
  addOpeningAt(sId, { x: 22, y: UP.strip }, { type: 'passage', width: 24, height: 80, sill: 0 });
  addOpeningAt(sId, { x: 196, y: UP.bathSouth }, { type: 'door', width: 24, height: 80, into: SOUTH, leafColor: STAINED_DOOR });
  addOpeningAt(sId, { x: 196, y: UP.guestNorth }, { type: 'door', width: 30, height: 80, into: SOUTH, leafColor: STAINED_DOOR });
  // North face (the road, photos 06 and 07): on the first floor three casements of 2 x 3 lites west of
  // the chimney (jambs x 56..136) and two single panes east of it (the Bath's, 48" over the washer and
  // dryer, its sill just above the 40" wainscot, photo 22); upstairs two casement pairs.
  const frontWindow = win(fId, { x: ft(8), y: north }, 80, 56, 2, 3, { sashes: 3 });
  const bathWindow = win(fId, { x: ft(19.5), y: north }, 48, 44, 1, 1, { sashes: 2, sill: 42 });
  win(sId, { x: ft(6.5), y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // The east one was centred x 240, which put its west jamb across the Bath's east wall (x 220.5, face
  // 223); it sits in the Office, so it moves east to x 248 (jambs 225..271, 2" clear of that face).
  win(sId, { x: 248, y: north }, 46, 44, 2, 3, { sashes: 2, sill: 36 });
  // East face (photo 03, taken facing west): two casement pairs upstairs, the south one just north of
  // where the wing's ridge meets the wall, and one casement pair set high on the first floor north of
  // the wing, over the Kitchen sink (photos 13 and 15), as far south as the wing's north wall allows
  // (its face at y 188); 2 x 3 lites each.
  const eastUpstairs = [win(sId, { x: east, y: 98 }, 46, 44, 2, 3, { sashes: 2, sill: 34 }), win(sId, { x: east, y: 222 }, 46, 44, 2, 3, { sashes: 2, sill: 34 })];
  const eastWindow = win(fId, { x: east, y: KITCHEN_WINDOW_Y }, 40, 40, 2, 3, { sashes: 2, sill: 42 });
  // The wing: casement pairs in its east gable end (photo 03), 2 x 3 lites, and in its south face,
  // 2 x 2 lites (photo 23). Its north face has no window (MK).
  win(fId, { x: wing.x1, y: (WING.y0 + WING.y1) / 2 }, 48, 44, 2, 3, { sashes: 2 });
  const wingSouth = win(fId, { x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, 48, 44, 2, 2, { sashes: 2, sill: 30 });
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
  const chimney = store().addColumn({ at: chimneyAt, kind: 'chimney', phase: PHASE, ...chimneyHeights(), depth: 20, color: FINISH_COLOR, cap: true });
  if (!chimney) throw new Error('chimney rejected');

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
  existingFixture({ kind: 'box', label: 'Wall', origin: { x: b.east, y: 69 }, direction: WESTWARD, width: 4, depth: 30, height: 96, elevation: 0, frontColor: PINE });
  // The front room's north-east corner is cut off at 45 degrees (photo 20, MK): a chase that hides
  // the pipes of the Bath upstairs (x 174..218, y 7..81), its face from the north wall's face at
  // x 168 (by the chimney, where the stovepipe's thimble is) to the Bath's west wall face at y 31,
  // 2' each way (photo 20 reads 1'6" to 2'7": an estimate). It is a full-height box, not a wall,
  // so it splits neither the north wall nor the Bath's west wall.
  const CHASE = 24;
  const angle = { mid: { x: 192 - CHASE / 2, y: 7 + CHASE / 2 }, out: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } };
  const offAngle = (d: number) => ({ x: round2(angle.mid.x + angle.out.x * d), y: round2(angle.mid.y + angle.out.y * d) });
  existingFixture({ kind: 'box', label: 'Chase', origin: offAngle(-4), direction: 135, width: round2(CHASE * Math.SQRT2), depth: 4, height: 96, elevation: 0, frontColor: CREAM });
  // The black wood stove on its stone hearth in front of the angled wall, turned to face south-west
  // with it (photos 16 and 20), its pipe up and back into the thimble at the wall's north end.
  existingFixture({ kind: 'box', origin: offAngle(0), direction: 135, width: 32, depth: 40, height: 1, elevation: 0, frontColor: '#7d7a73' });
  existingFixture({ kind: 'box', label: 'Wood stove', origin: offAngle(8), direction: 135, width: 24, depth: 26, height: 30, elevation: 1, frontColor: STOVE_BLACK });
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
  // First Floor: one label in each face (anchors well inside the faces), each with its interior
  // finishes from photos 13 to 22 (the Utility's from MK): the Kitchen's blue check wallpaper and
  // beige vinyl tile; the Living's cream-painted vertical boards and the front room's smooth cream
  // paint over the same dark red-brown painted board floor; the Bath's green paint over a knotty
  // pine wainscot about 40" high and its parquet; the Utility's pine paneling and wood floor. The
  // ceilings (pine in the Kitchen and the Bath) are not drawn.
  // MK calls the old entry hall the front room (photos 19 and 20).
  label(fId, 'Front room', { x: 100, y: 52 }, PHASE, { wallFinish: 'paint', wallColor: CREAM, floorFinish: 'boards', floorColor: FLOOR_RED_BROWN });
  label(fId, 'Bath', { x: (PART.bathWest + 2.5 + (CL.x1 - HALF)) / 2, y: 70 }, PHASE, { wallFinish: 'paint', wallColor: BATH_GREEN, wainscot: { height: 40, finish: 'pine' }, floorFinish: 'parquet' });
  label(fId, 'Kitchen (17\'2" adjusted: re-measure)', { x: (PART.kl + 2.5 + (CL.x1 - HALF)) / 2, y: (PART.line + 2.5 + (CL.y1 - HALF)) / 2 }, PHASE, {
    wallFinish: 'check',
    wallColor: CHECK_BLUE,
    floorFinish: 'tile',
    floorColor: VINYL_BEIGE,
  });
  label(fId, 'Living', { x: (CL.x0 + HALF + (PART.kl - 2.5)) / 2, y: (PART.stairSouth + 2.5 + (CL.y1 - HALF)) / 2 }, PHASE, { wallFinish: 'boards', wallColor: CREAM, floorFinish: 'boards', floorColor: FLOOR_RED_BROWN });
  // The stair strip is part of the Living (no wall on its south side), so it has no label of its own.
  label(fId, 'Utility', { x: (WING.x0 + WING.x1) / 2, y: (WING.y0 + WING.y1) / 2 }, PHASE, { wallFinish: 'pine', floorFinish: 'boards', floorColor: WOOD_FLOOR });
  label(fId, 'Entry porch (est.)', { x: (PORCH.x0 + PORCH.x1) / 2, y: ENTRY_Y });
  // Second Floor. The Office / hall is one face with the landing and the stair well.
  // Placeholder finishes (no photos of the Second Floor).
  label(sId, 'Bunk', { x: 90, y: 52 }, PHASE, PLACEHOLDER_ROOM);
  label(sId, 'Bath', { x: (UP.ew + 2.5 + (UP.bathEast - 2.5)) / 2, y: 45 }, PHASE, PLACEHOLDER_WET);
  label(sId, 'Master closet', { x: (CL.x0 + HALF + (UP.closet - 2.5)) / 2, y: STRIP_MID }, PHASE, PLACEHOLDER_ROOM);
  label(sId, 'Master', { x: 90, y: 225 }, PHASE, PLACEHOLDER_ROOM);
  label(sId, 'Guest (11\'5" adjusted)', { x: 242, y: 235 }, PHASE, PLACEHOLDER_ROOM);
  label(sId, 'Office / hall (11\'11" adjusted)', { x: 267, y: 110 }, PHASE, PLACEHOLDER_ROOM);

  proposed({ bId, fId, sId, stair, houseDoor, livingWest, frontWindow, eastWindow, eastUpstairs, wingSouth, wingRoof, porchRoof, bathWindow, chimney, fixtures: casework });
  return getPlan();
}

/** Ids from the existing house that the proposed design demolishes or builds on. */
interface ExistingIds {
  bId: Id;
  fId: Id;
  sId: Id;
  stair: Id;
  houseDoor: Id;
  livingWest: Id;
  /** The front room's 80" north window (x 56..136): the new stair climbs in front of it. */
  frontWindow: Id;
  eastWindow: Id;
  /** The Second Floor's two east windows (the Office / hall's at y 98, the Guest's at y 222). */
  eastUpstairs: Id[];
  /** The wing's south window (the Utility's, over the walkout doors). */
  wingSouth: Id;
  wingRoof: Id;
  porchRoof: Id;
  /** The old bath's north window (x 234, jambs 210..258). */
  bathWindow: Id;
  /** The masonry chimney on the north wall (a site column). */
  chimney: Id;
  /** The existing Kitchen, Bath, front room and Utility fixtures (the old layout gives way to the new one). */
  fixtures: Id[];
}

/**
 * Mark existing work demolished (the store's setPhase, as "Mark demolish" does). Walls are named
 * by a point on their centerline, rooms by name; a demolished wall takes its openings with it.
 * Throws when something named is not there.
 */
function demolish(levelId: Id, d: { walls?: Vec2[]; openings?: Id[]; stairs?: Id[]; roofs?: Id[]; fixtures?: Id[]; decks?: Id[]; rooms?: string[] }): void {
  const lvl = level(levelId);
  const walls = (d.walls ?? []).map((p) => wallAt(levelId, p).wallId);
  const openings = [...(d.openings ?? []), ...Object.values(lvl.openings).filter((o) => walls.includes(o.wallId)).map((o) => o.id)];
  const rooms = (d.rooms ?? []).map((name) => {
    const r = Object.values(lvl.rooms).find((room) => room.name === name);
    if (!r) throw new Error(`no room ${name} on ${lvl.name}`);
    return r.id;
  });
  const sel = { walls, openings, stairs: d.stairs ?? [], roofs: d.roofs ?? [], fixtures: d.fixtures ?? [], decks: d.decks ?? [], rooms };
  store().setPhase(levelId, sel, 'demo');
  const after = level(levelId);
  const phases = [
    ...sel.walls.map((id) => after.walls[id]?.phase),
    ...sel.openings.map((id) => after.openings[id]?.phase),
    ...sel.stairs.map((id) => after.stairs[id]?.phase),
    ...sel.roofs.map((id) => after.roofs[id]?.phase),
    ...sel.fixtures.map((id) => after.fixtures[id]?.phase),
    ...sel.decks.map((id) => after.decks[id]?.phase),
    ...sel.rooms.map((id) => after.rooms[id]?.phase),
  ];
  if (phases.some((p) => p !== 'demo')) throw new Error(`demolish on ${lvl.name}: something was not marked`);
}

/**
 * The proposed design (MK's briefs of 12 and 14 Oct 2026; docs/history/PLAN-v4-proposed.md and
 * PLAN-v6-layout.md), drawn as new and demolished work on the existing house: the east wing grown
 * north into a master suite under a shed roof (transoms upstairs over it in place of the east
 * windows) with a laundry closet in its bath; the old front room and the Bunk over it one stair
 * hall open through both floors, with a wrap-around stair up to a balcony; a powder room and a
 * walk-in pantry in a band along the north wall, north of the kitchen; a wood stove in the Living's
 * south-west corner on a stainless flue (the masonry chimney goes); a full bath across the second
 * floor's north-east; and a foyer with a screen porch on the west face in place of the entry porch.
 * Everything is demolished first, so the existing openings are clamped against the proposed walls
 * only once, and none of them moves: a new wall never meets an existing one inside an opening.
 */
function proposed(ids: ExistingIds): void {
  const { bId, fId, sId } = ids;
  const wing = centerline(WING, HALF);
  const NORTH = { x: 0, y: -1 };
  const SOUTH = { x: 0, y: 1 };
  const EAST = { x: 1, y: 0 };
  const pc = centerline(PORCH, HALF);
  // First floor top (+2"): the basement floor -100" plus its 90" walls and the 12" floor.
  const FLOOR_TOP = 2;

  // ---- Demolition (First Floor). The entry porch: its three walls (their screens go with them),
  // its roof and its label. The wing's north wall, the main block's east window (it would face into
  // the new bedroom), the wing's roof and its south window (a sliding door takes its place). The
  // front room's walls: the y 99.5 line from the east wall to the west wall (with the hall's cased
  // opening) and the old bath's west wall with its door, so the old front room, the stair strip
  // and the old bath are one floor for the stair hall, the north band and the kitchen. The stair,
  // the house door and the front room's north window (the new stair climbs in front of it). The
  // Living's west window: its north shutter would sit inside the foyer, against the new door's
  // trim, so a window without shutters replaces it. The old bath's north window (a smaller one for
  // the powder room replaces it). The old fixtures: the Kitchen's casework, the Bath's, the
  // Utility's, and the wood stove with the pipe chase behind it.
  demolish(fId, {
    walls: [
      { x: (pc.x0 + CL.x0) / 2, y: pc.y0 },
      { x: pc.x0, y: ENTRY_Y },
      { x: (pc.x0 + CL.x0) / 2, y: pc.y1 },
      { x: (WING.x0 + WING.x1) / 2, y: wing.y0 },
      { x: 250, y: 99.5 },
      { x: 182, y: 99.5 },
      { x: 60, y: 99.5 },
      { x: 194.5, y: 30 },
    ],
    openings: [ids.eastWindow, ids.wingSouth, ids.houseDoor, ids.livingWest, ids.frontWindow, ids.bathWindow],
    stairs: [ids.stair],
    roofs: [ids.wingRoof, ids.porchRoof],
    fixtures: ids.fixtures,
    rooms: ['Entry porch (est.)', 'Utility', 'Bath', 'Front room'],
  });
  // Second Floor: the two east windows (the wing's new shed rises past their sills, so high
  // transoms replace them, below); the Bunk's south wall with its door (the Bunk is the upper half
  // of the stair hall) and the stub of its east wall south of the old bath (y 83.5..99.5), so the
  // top of the stair opens straight into the upstairs hall. The old bath's east wall goes once the
  // new bath's wall has met it (section 9).
  demolish(sId, {
    walls: [
      { x: 100, y: 99.5 },
      { x: 171.5, y: 92 },
    ],
    openings: ids.eastUpstairs,
    rooms: ['Bunk'],
  });
  // The site: the masonry chimney on the north wall (MK: a stainless flue serves the new stove).
  store().setPhase(fId, { walls: [], openings: [], columns: [ids.chimney] }, 'demo');
  if (getPlan().site.columns[ids.chimney].phase !== 'demo') throw new Error('the chimney was not marked');

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
  // The foyer is a closed, heated room: 8" under its three walls, like the east addition's (a crawl
  // space), faced in fieldstone (the Adirondack stone base; about 1" to 10" of it shows above the
  // ground, more on the south). The screen porch stands on its log posts and their stone piers
  // (below; the porch's floor is not drawn). Its west and south walls are river-stone knee walls,
  // a 36" band up to the screens' sills (the stones' own colours, no tint), with the shakes above.
  const foyerFooting = drawWalls(bId, [{ x: CL.x0, y: fy.north }, { x: fy.west, y: fy.north }, { x: fy.west, y: fy.south }, { x: CL.x0, y: fy.south }], TB, false, NEW);
  store().updateWalls(bId, foyerFooting, { finish: 'stone', color: FIELDSTONE });
  store().updateWalls(fId, porch, { band: { finish: 'riverstone', height: 36 } });

  // ---- 4. The north band (MK, 14 Oct 2026: the kitchen stops short of the north wall): a powder
  // room and, in the north-east corner, a walk-in pantry, x 173..311, y 7..55 inside (4', as MK
  // asked). Its south wall is at y 57.5 (faces 55..60). It crosses the old bath's west wall across
  // the old bath door (y 54..84), which keeps its place: a new wall does not split a demolished one
  // (plan.ts normalizeLevel). The hall's east wall continues the Kitchen/Living partition's line
  // (x 170.5) up to the north wall, behind the stair's landing; the powder room / pantry wall is at
  // x 261.5 (faces 259..264), just east of the old bath's north window (jambs 210..258), which stays in
  // its place in the existing view the same way.
  const BAND = { south: 57.5, divide: 261.5 };
  partition(fId, { x: PART_KL, y: CL.y0 }, { x: PART_KL, y: FRONT_LINE }, NEW);
  partition(fId, { x: PART_KL, y: BAND.south }, { x: CL.x1, y: BAND.south }, NEW);
  partition(fId, { x: BAND.divide, y: CL.y0 }, { x: BAND.divide, y: BAND.south }, NEW);

  // ---- The stair hall is open to the Living (MK, 14 Oct 2026): the brief's wall at y 137.5 is not
  // built (there is none today, photo 16), so the house door opens on the hall, the stair and the
  // Living together.

  // ---- 7. The laundry (MK): a closet in the master bath's south-west corner, x 318..350, y 54..117.5
  // inside, its north wall at y 51.5 and its front at x 352.5, open 56" for bifold doors (drawn as a
  // cased opening), with the washer and dryer side by side.
  const LAUNDRY = { north: 51.5, front: 352.5 };
  partition(fId, { x: CL.x1, y: LAUNDRY.north }, { x: LAUNDRY.front, y: LAUNDRY.north }, NEW);
  partition(fId, { x: LAUNDRY.front, y: LAUNDRY.north }, { x: LAUNDRY.front, y: ADD.y }, NEW);

  // ---- Openings, all new. Windows 2 x 3 lites per sash, sill 30 unless given.
  const add = (p: Vec2, o: OpeningSpec) => addOpeningAt(fId, p, { ...o, phase: NEW });
  // Master suite: the bath's door in the partition (east of the laundry closet), a transom north and
  // windows east. The bedroom is reached from the kitchen through today's grey Kitchen to Utility
  // door (y 248..280), which stays (MK chose it over a new 32" door at y 195..227). Interior leaves
  // are stained like the old Bath door.
  add({ x: 389, y: ADD.y }, { type: 'door', width: 28, height: 80, into: NORTH, leafColor: STAINED_DOOR });
  add({ x: LAUNDRY.front, y: (LAUNDRY.north + 2.5 + ADD.y - 2.5) / 2 }, { type: 'passage', width: 56, height: 80, sill: 0 });
  // The bath's north window is a transom, high for privacy from the road: 46 x 18, two sashes of
  // 2 x 1 lites, sill 70 (head 88).
  add({ x: 390, y: CL.y0 }, { type: 'window', width: 46, height: 18, sill: 70, sashes: 2, lites: { cols: 2, rows: 1 } });
  add({ x: wing.x1, y: 62 }, { type: 'window', width: 48, height: 44, sashes: 2, lites: { cols: 2, rows: 3 } });
  add({ x: wing.x1, y: 160 }, { type: 'window', width: 48, height: 44, sashes: 2, lites: { cols: 2, rows: 3 } });
  // The bedroom's south window becomes a 72 x 80 sliding door on the same centre, over the walkout's
  // 72" double door below, two panels of 2 x 4 lites. No transom over it: under the 96" ceiling it
  // could be 12" at most with its head at the ceiling (no room for a header or a casing).
  add({ x: (WING.x0 + WING.x1) / 2, y: wing.y1 }, { type: 'door', width: 72, height: 80, sliding: true, lites: { cols: 2, rows: 4 } });
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
  // The north band: the powder room's 28" door from the kitchen's north-west corner (x 200..228,
  // east of where the band's wall crosses the old bath wall's line, x 194.5; it swings out), the
  // pantry's 24" door at its west end (it swings in, clear of the shelves), and a small window in
  // the powder room's north wall (24 x 30, sill 48, 2 x 2 lites, between the old bath wall's line and
  // the band's divider).
  add({ x: 214, y: BAND.south }, { type: 'door', width: 28, height: 80, into: SOUTH, leafColor: STAINED_DOOR });
  add({ x: 276, y: BAND.south }, { type: 'door', width: 24, height: 80, into: NORTH, leafColor: STAINED_DOOR });
  add({ x: 214, y: CL.y0 }, { type: 'window', width: 24, height: 30, sill: 48, lites: { cols: 2, rows: 2 } });
  // The hall to the kitchen: a 32" cased opening in the Kitchen/Living partition at the stair
  // strip's east end, on the line of the house door (y 118.5).
  add({ x: PART_KL, y: 118.5 }, { type: 'passage', width: 32, height: 80, sill: 0 });
  // The stair hall: a 24" window over the stair's bottom platform in the north wall (x 13..37, sill
  // 36, 2 x 3 lites); safety glass, being this near the steps.
  add({ x: 25, y: CL.y0 }, { type: 'window', width: 24, height: 48, sill: 36, lites: { cols: 2, rows: 3 } });
  // Upstairs, the transoms in place of the two east windows: 46 x 24, two sashes of 2 x 2 lites,
  // sill 60, so the head is at 84. The wing's shed (below) meets the wall with its top 50.9" above
  // the Second Floor, so each sill is 9.1" over the roof and its trim 5.1". The Guest's stays on its
  // window's centre (y 222); the Office's moves to y 110, clear of the new bath's south wall.
  for (const y of [110, 222]) {
    addOpeningAt(sId, { x: CL.x1, y }, { type: 'window', width: 46, height: 24, sill: 60, sashes: 2, lites: { cols: 2, rows: 2 }, phase: NEW });
  }
  // Light for the stair hall's upper half: a second casement pair in the north wall over the stair's
  // landing (x 140, like the Bunk's at x 78), and one in the west wall over the bottom of the stair,
  // north of the foyer's roof (y 36, 30 x 44, sill 36).
  addOpeningAt(sId, { x: 140, y: CL.y0 }, { type: 'window', width: 46, height: 44, sill: 36, sashes: 2, lites: { cols: 2, rows: 3 }, phase: NEW });
  addOpeningAt(sId, { x: CL.x0, y: 36 }, { type: 'window', width: 30, height: 44, sill: 36, lites: { cols: 2, rows: 3 }, phase: NEW });

  // ---- 3. The grand stair (MK, 14 Oct 2026): the old front room and the Bunk over it are one stair
  // hall, x 7..168, y 7..135, open through both floors north of y 91. 108" floor to floor in 15
  // risers of 7.2" on 10.5" treads (2R + T = 24.9"), all 42" wide but the top flight (41"), solid
  // under, wrapping the hall's north-west, north and east sides round an open court:
  //   - a one-riser platform in the north-west corner (x 7..43, y 7..49, top 7.2"): you step up onto
  //     it heading north from the entry, two steps from the house door, and turn east;
  //   - flight 1 east along the north wall, x 43..127, 8 risers to 64.8", its south side railed;
  //   - a landing in the north-east corner, x 127..168, y 7..49, at 72";
  //   - flight 2 south along the hall's east wall, y 49..91, 4 risers to 100.8", its west side
  //     railed; the Second Floor's edge at y 91 is the 15th riser.
  // The floor opening (Second Floor) cuts the slab over the whole hall north of y 91, x 7..169, so
  // the flights cut nothing themselves; its guard runs along y 91 west of the stair's arrival (and
  // the 5" of its east edge south of the old bath's corner, y 86..91, where the Bunk's wall is gone)
  // and the balcony, y 91..135, leads to the bedroom door (x 150) and east into the upstairs hall.
  const R = 108 / 15;
  const TREAD = 10.5;
  const flight = (s: Omit<NewStairs, 'phase' | 'cutsFloorAbove'>): Id => {
    const id = store().addStairs(fId, { ...s, phase: NEW, cutsFloorAbove: false });
    if (!id) throw new Error(`stairs at ${JSON.stringify(s.origin)} rejected`);
    return id;
  };
  const STAIR = { platformEast: 43, landingWest: 127, east: 168, south: 49, top: 91 };
  const pieces = [
    flight({ origin: { x: (CL.x0 + HALF + STAIR.platformEast) / 2, y: STAIR.south }, direction: 270, width: STAIR.platformEast - (CL.x0 + HALF), run: STAIR.south - (CL.y0 + HALF), rise: R, risers: 1 }),
    flight({ origin: { x: STAIR.platformEast, y: (CL.y0 + HALF + STAIR.south) / 2 }, direction: 0, width: 42, run: 8 * TREAD, base: R, rise: 8 * R, risers: 8, railings: { right: true } }),
    flight({ origin: { x: STAIR.landingWest, y: (CL.y0 + HALF + STAIR.south) / 2 }, direction: 0, width: 42, run: STAIR.east - STAIR.landingWest, base: 9 * R, rise: R, risers: 1 }),
    flight({ origin: { x: (STAIR.landingWest + STAIR.east) / 2, y: STAIR.south }, direction: 90, width: STAIR.east - STAIR.landingWest, run: 4 * TREAD, base: 10 * R, rise: 4 * R, risers: 4, railings: { right: true } }),
  ];
  // The four pieces are one staircase (Level.staircases), selected, moved and styled together: oak
  // treads with a 1" nosing over white risers, closed stringers, box newels and a round 36" rail
  // (the defaults, model/stairStyle.ts), framed underneath so the space under the landing and the
  // top flight is a room, and a bullnose round the starting newel on the platform.
  const grand = store().groupStairs(fId, pieces, { name: 'Grand stair', underside: 'framed', startStep: 'bullnose' });
  if (!grand) throw new Error('staircase rejected');
  const well = { x0: CL.x0 + HALF, x1: 169, y0: CL.y0 + HALF, y1: STAIR.top, bathCorner: 86 };
  const wellOutline = [
    { x: well.x0, y: well.y0 },
    { x: well.x1, y: well.y0 },
    { x: well.x1, y: well.bathCorner },
    { x: well.x1, y: well.y1 },
    { x: well.x0, y: well.y1 },
  ];
  if (!store().addFloorOpening(sId, { outline: wellOutline, railings: [false, false, true, true, false], phase: NEW })) throw new Error('floor opening rejected');

  // ---- The coat closet under the stair (MK, 14 Oct 2026: the design had none). The framed
  // underside leaves a room under the landing (61 3/4" clear) and the top flight (its soffit rising
  // to about 7'8" at its top). The closet's west wall cannot stand under the landing's edge (x 129.5):
  // it would meet the north wall inside the old front room's 80" window (jambs 56..136), which keeps
  // its place in the existing view only if that wall is not split there. So the wall is at x 138.5
  // (faces 136..141), its face at the old window's east jamb, and the closet is 2'3" x 6'7" inside
  // (x 141..168, y 7..86). Its front wall, under the top flight at y 88.5 (faces 86..91), takes a 24"
  // door swinging out into the hall. Each wall stands to the stair's underside over it (the west one
  // to the landing's; the stair's panels close the slope above it, derive/staircase.ts).
  const CLOSET = { west: 138.5, front: 88.5 };
  partition(fId, { x: CLOSET.west, y: CL.y0 }, { x: CLOSET.west, y: CLOSET.front }, NEW);
  partition(fId, { x: CLOSET.west, y: CLOSET.front }, { x: PART_KL, y: CLOSET.front }, NEW);
  const under = getStaircaseLayout(getPlan(), fId, grand, 'proposed')!.undersides;
  const quarter = (v: number) => Math.floor(v * 4) / 4;
  const landingUnder = quarter(heightAt(under[pieces[2]]!, { x: 150, y: 28 }));
  const frontUnder = quarter(heightAt(under[pieces[3]]!, { x: 150, y: CLOSET.front - TI / 2 }));
  store().updateWalls(fId, [wallAt(fId, { x: CLOSET.west, y: 30 }).wallId], { heightOverride: landingUnder });
  store().updateWalls(fId, [wallAt(fId, { x: 150, y: CLOSET.front }).wallId], { heightOverride: frontUnder });
  add({ x: (CLOSET.west + TI / 2 + PART_KL - TI / 2) / 2, y: CLOSET.front }, { type: 'door', width: 24, height: 80, into: SOUTH, leafColor: STAINED_DOOR });

  // ---- Roofs, new sheet (little rust). The wing: one shed over the whole east side, 5:12 in the
  // wing roof's colour, high at the main block's east wall and down to 96" at the wing's east wall:
  // its underside is 156.4" above the first floor at the main wall (96 + 145 x 5/12), its top 158.9",
  // 50.9" above the Second Floor, under the transoms. The foyer: a gable facing west over the front
  // door like the old porch's; the screen porch: a shed high at the house wall (128") and down to 96"
  // at its outer wall, meeting the gable's eave line. The two overlap at y 158 (no valley). The
  // outlines stop 18" short of the house wall (x -18, and x 336 for the wing): an overhang is the
  // same on every edge, so the overhang on the house side ends at the wall's outside face instead of
  // running 18" into the house (a board and the roof's high edge upstairs). The slopes are the same
  // either way.
  const ROOF_EAST = MAIN.x0 - 18;
  roof(fId, { shape: 'shed', outline: outline({ x0: MAIN.x1 + 18, x1: WING.x1, y0: MAIN.y0, y1: MAIN.y1 }), ridgeAngle: 0, pitch: 5, overhang: 18 }, ROOF_WING, 0.1, NEW);
  // The foyer's gable runs on 60" west of the foyer (CANOPY_X0) as an open log canopy over the front
  // door (below). Its heights depend only on y, so the foyer's gable wall and its door stay as they are.
  const CANOPY_X0 = FOYER.x0 - 60;
  roof(fId, { shape: 'gable', outline: outline({ x0: CANOPY_X0, x1: ROOF_EAST, y0: FOYER.y0, y1: FOYER.y1 }), ridgeAngle: 0, pitch: 8, overhang: 18 }, ROOF_GALVANIZED, 0.1, NEW);
  // Coats in the foyer (MK, 14 Oct 2026; the closet under the stair is narrow): a 48" bench 16" deep
  // and 18" high under the north window (sill 36), clear of the front door's swing, and a 24" rail
  // of hooks at 60" either side of the window. Stained like the trim.
  const foyerNorth = FOYER.y0 + T;
  fixture(fId, { kind: 'box', label: 'Bench', origin: { x: -44, y: foyerNorth }, direction: 90, width: 48, depth: 16, height: 18, elevation: 0, frontColor: FINISH_COLOR, phase: NEW });
  for (const x of [FOYER.x0 + T + 12, -12]) fixture(fId, { kind: 'box', label: 'Hooks', origin: { x, y: foyerNorth }, direction: 90, width: 24, depth: 2, height: 4, elevation: 60, frontColor: FINISH_COLOR, phase: NEW });
  roof(fId, { shape: 'shed', outline: outline({ x0: FOYER.x0, x1: ROOF_EAST, y0: FOYER.y1, y1: MAIN.y1 }), ridgeAngle: 180, pitch: 4, overhang: 18 }, ROOF_GALVANIZED, 0.1, NEW);

  // ---- The Adirondack entry and screen porch (MK; docs/history/PLAN-v10-adirondack.md; sizes are
  // estimates for MK, the engineer and the builder). Dark stained logs and twigs, drawn as round timbers
  // at set heights (the structure checks do not follow them), on fieldstone piers that keep them off
  // the ground. Heights below are over the First Floor (its floor top is +2); the piers' are absolute.
  // `logBetween` takes a log's centreline from p to q (z over the floor) and sets its tops (za, zb)
  // half its plumb depth above it.
  type AxisPt = { x: number; y: number; z: number };
  const logBetween = (p: AxisPt, q: AxisPt, d: number, label: string) => {
    const run = Math.hypot(q.x - p.x, q.y - p.y);
    const half = (d * Math.hypot(run, q.z - p.z)) / run / 2;
    const a = { x: round2(p.x), y: round2(p.y) };
    const b = { x: round2(q.x), y: round2(q.y) };
    if (!store().addMember(fId, { kind: 'beam', a, b, width: d, depth: d, mount: 'dropped', za: round2(p.z + half), zb: round2(q.z + half), color: DARK_LOG, profile: 'log', label, phase: NEW })) throw new Error(`${label} rejected`);
  };
  const logPost = (at: Vec2, base: number, top: number, d: number, label: string) => {
    if (!store().addMember(fId, { kind: 'post', at, width: d, depth: d, rotation: 0, base: round2(base), top: round2(top), color: DARK_LOG, profile: 'log', label, phase: NEW })) throw new Error(`${label} rejected`);
  };
  /**
   * A fieldstone pier (or a stoop) centred at `at`, `w` x `d`, up to `top` (absolute), from 2" under
   * the ground at its lowest corner (groundAt), so it never stands clear of a sloping ground.
   */
  const pier = (at: Vec2, w: number, d: number, top: number) => {
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => groundAt(getPlan(), { x: at.x + (sx * w) / 2, y: at.y + (sy * d) / 2 })));
    const base = Math.floor(Math.min(...corners)) - 2;
    if (!(base < top)) throw new Error(`pier at ${JSON.stringify(at)} would be buried`);
    if (!store().addColumn({ at, kind: 'pier', phase: NEW, width: w, depth: d, rotation: 0, base, top, color: FIELDSTONE })) throw new Error(`pier at ${JSON.stringify(at)} rejected`);
  };
  /** A log's centre this far under a plane sloping `k` in 1 (its radius plus a gap, square to it). */
  const offsetUnder = (k: number, perp: number) => perp * Math.hypot(1, k);
  const CLEAR = 0.25;

  // The open log canopy over the front door: a log truss on the canopy's outer end (x -150, 6" in
  // from the outline; the rake is at x -174) and logs under the roof whose ends show past the rake.
  //   - Two fieldstone piers, 18" square, from the ground to +20, at the gable's eave lines.
  //   - A 10" log post on each, its outer face on the eave line, up to a 10" log tie across them that
  //     runs 8" past each post's outer face, so its round ends show under the eaves. The tie is as
  //     high as its ends allow, 1/4" or more under the overhang (the eaves' rafter tails, every 24",
  //     miss it).
  //   - 6" log knee braces at 45 degrees from each post to the tie, 24" each way.
  //   - A 10" ridge log and two 8" purlins (one midway up each slope), 1/4" under the roof, square
  //     to it, from the foyer's gable wall west to x -182, 8" past the rake, through the rake boards.
  //   - Two 8" principal rafter logs under the purlins (touching them), from the tie over the posts
  //     up to the ridge log, which sits in their crotch, and an 8" king post from the tie to the
  //     ridge log.
  //   - Twig work in the gable over the tie: a sunburst of 3" branches from the tie's centre to the
  //     rafters, three a side.
  //   - A fieldstone stoop under it, 60" x 72" (x -156..-96, centred on the door), its top at +1.5,
  //     1/2" under the threshold (the exterior landing rule is to be checked against the 2025 RCNYS).
  //     The south pier stands on its corner.
  const gable = Object.values(level(fId).roofs).find((r) => r.phase === NEW && r.shape === 'gable')!;
  const CX = CANOPY_X0 + 6;
  const gableUnder = (y: number) => roofHeightAt(gable, roofBearing(level(fId).wallHeight, gable), { x: CX, y })!;
  const K = gable.pitch / 12;
  const ridgeY = (FOYER.y0 + FOYER.y1) / 2;
  const LOG = 10;
  const LOG8 = 8;
  const BRACE = 6;
  const canopyPosts = [FOYER.y0 + LOG / 2, FOYER.y1 - LOG / 2];
  const tieEnds = [canopyPosts[0] - LOG / 2 - 8, canopyPosts[1] + LOG / 2 + 8];
  const TIE = Math.floor(Math.min(...tieEnds.map(gableUnder)) - CLEAR - LOG / 2);
  for (const y of canopyPosts) pier({ x: CX, y }, 18, 18, 20);
  for (const y of canopyPosts) logPost({ x: CX, y }, 20 - FLOOR_TOP, TIE, LOG, '10" log post');
  logBetween({ x: CX, y: tieEnds[0], z: TIE }, { x: CX, y: tieEnds[1], z: TIE }, LOG, '10" log tie');
  for (const [i, y] of canopyPosts.entries()) {
    const inward = i === 0 ? 1 : -1;
    logBetween({ x: CX, y, z: TIE - 24 }, { x: CX, y: y + inward * 24, z: TIE }, BRACE, '6" log brace');
  }
  const RAKE_PAST = CANOPY_X0 - gable.overhang - 8;
  const WALL_IN = FOYER.x0 + 2;
  const RIDGE = gableUnder(ridgeY) - offsetUnder(K, LOG / 2 + CLEAR);
  logBetween({ x: WALL_IN, y: ridgeY, z: RIDGE }, { x: RAKE_PAST, y: ridgeY, z: RIDGE }, LOG, '10" ridge log');
  for (const y of [(FOYER.y0 + ridgeY) / 2, (ridgeY + FOYER.y1) / 2]) {
    const z = gableUnder(y) - offsetUnder(K, LOG8 / 2 + CLEAR);
    logBetween({ x: WALL_IN, y, z }, { x: RAKE_PAST, y, z }, LOG8, '8" log purlin');
  }
  // The rafters' centrelines: under the purlins (their radius, the purlins' diameter and the gap).
  const RAFTER_OFF = offsetUnder(K, LOG8 + LOG8 / 2 + CLEAR);
  const apex = { x: CX, y: ridgeY, z: gableUnder(ridgeY) - RAFTER_OFF };
  for (const [i, eave] of [FOYER.y0, FOYER.y1].entries()) {
    const inward = i === 0 ? 1 : -1;
    const heel = { x: CX, y: eave + (inward * (TIE + RAFTER_OFF - gableUnder(eave))) / K, z: TIE };
    logBetween(heel, apex, LOG8, '8" log rafter');
    for (const t of [0.3, 0.55, 0.8]) {
      logBetween({ x: CX, y: ridgeY, z: TIE }, { x: CX, y: heel.y + (apex.y - heel.y) * t, z: heel.z + (apex.z - heel.z) * t }, 3, '3" twig');
    }
  }
  logPost({ x: CX, y: ridgeY }, TIE, RIDGE, LOG8, '8" log king post');
  pier({ x: (CANOPY_X0 + FOYER.x0) / 2, y: 118.5 }, FOYER.x0 - CANOPY_X0, 72, 1.5);

  // The screen porch: three 10" log posts on the line of its west wall's outside face (x -97, 6"
  // proud of it, the rest in the wall), at its north end (y 164, between the foyer and the north
  // screen), between the two screen bays (y 236) and at its south-west corner (y 310, flush with the
  // south face), each on a 16" fieldstone pier from the ground to +12. A 10" log plate along the eave
  // line rests on the middle and south posts, as high as the shed's rafter tails allow (they bear on
  // it), from the foyer gable's south eave (y 177; the gable's overhang comes down lower than the
  // plate north of that) to 12" past the porch's south corner, so its end shows under the shed's
  // rake. The north post stops under the gable's eave, its top inside the roof's thickness. 6" log
  // knee braces at 45 degrees from the posts to the plate, 18" each way (the north post's, 21",
  // passes under the gable's eave).
  const shed = Object.values(level(fId).roofs).find((r) => r.phase === NEW && r.shape === 'shed' && r.ridgeAngle === 180)!;
  const PX = FOYER.x0 - 1;
  const porchPosts = [164, 236, 310];
  const tailBottom = roofHeightAt(shed, roofBearing(level(fId).wallHeight, shed), { x: PX, y: 236 })! - shed.rafter!.depth;
  const PLATE = Math.floor((tailBottom - offsetUnder(shed.pitch / 12, LOG / 2)) * 4) / 4;
  const plateNorth = FOYER.y1 + gable.overhang + 1;
  for (const y of porchPosts) pier({ x: PX, y }, 16, 16, 12);
  const northTop = Math.floor(roofHeightAt(gable, roofBearing(level(fId).wallHeight, gable), { x: PX, y: porchPosts[0] + LOG / 2 })! + gable.thickness - CLEAR);
  for (const [i, y] of porchPosts.entries()) logPost({ x: PX, y }, 12 - FLOOR_TOP, i === 0 ? northTop : PLATE, LOG, '10" log post');
  logBetween({ x: PX, y: plateNorth, z: PLATE }, { x: PX, y: CL.y1 + HALF + 12, z: PLATE }, LOG, '10" log plate');
  logBetween({ x: PX, y: porchPosts[0], z: PLATE - 21 }, { x: PX, y: porchPosts[0] + 21, z: PLATE }, BRACE, '6" log brace');
  for (const [y, dir] of [[porchPosts[1], -1], [porchPosts[1], 1], [porchPosts[2], -1]]) {
    logBetween({ x: PX, y, z: PLATE - 18 }, { x: PX, y: y + dir * 18, z: PLATE }, BRACE, '6" log brace');
  }

  // ---- The retaining wall carried on west to the property line (MK, after the site sketch, photo
  // 10): from today's free end about 20' angled and 27' straight, the same poured concrete, its top at
  // the terrace's level plus 2", 5' south of where the garage is to go (not drawn).
  const retainingNew = drawWalls(bId, [{ x: RETAIN.west, y: RETAIN.bend.y }, ...RETAIN_NEW], 10, false, NEW);
  store().updateWalls(bId, retainingNew, { finish: 'plain', color: CONCRETE_COLOR, heightOverride: 96 });

  // ---- 6. The deck off the master bedroom's sliding door (MK, 14 Oct 2026): about 8' deep, the
  // wing's width from the retaining wall's east face (x 319.5) to the wing's east face (x 463). Its
  // top is 6" below the bedroom floor (absolute -4), flush with the retaining wall's top, so the
  // lake-side terrace (-6) behind the wall steps straight onto it (photos 02, 23 and 24). The wall
  // and the house carry its west and north edges (no posts there, no railing); railings the full
  // length of the east and south edges. It has no stair of its own (MK): today's wooden stair, 4"
  // east of its east edge, stays and still runs from the lawn down past it to the walkout and the
  // lower lawn.
  deck(fId, { outline: outline({ x0: CL.x1 + 5, x1: WING.x1, y0: WING.y1, y1: WING.y1 + ft(8) }), elevation: -6, railings: [false, true, true, false], phase: NEW });

  // ---- 2. The kitchen, x 173..311, y 54..308 inside (the old bath and most of the old front room's
  // east end, south of the north band). All new; cabinet and counter colours are the level's
  // defaults. A fixture's origin is the middle of its back edge and its direction the way its front
  // faces (left and right as you face the front). Its north-west corner (x 173..~240, y 54..135) is
  // the way in from the hall's cased opening, with the powder room's and the pantry's doors.
  const kitchen = (f: Omit<NewFixture, 'phase' | 'elevation'> & { elevation?: number }) => fixture(fId, { elevation: 0, ...f, phase: NEW });
  const KITCHEN_EAST = 311;
  const COUNTER_HEIGHT = 34.5;
  // The island (docs/history/PLAN-v5-kitchen.md), its fronts facing north (you stand north of it,
  // facing the lake): the dishwasher and the sink cabinet, x 212..272, y 212..236. The top overhangs
  // 1" at the front, 12" at the back (the seating ledge on the lake side) and 3" past each outer end
  // (facing north, left is west), so it is one top 66 x 37, x 209..275, y 211..248: 36" walkways to
  // the Living partition (x 173) and the east wall (x 311), 60" from the ledge to the lake wall.
  const ISLAND_BACK = 236;
  kitchen({ kind: 'dishwasher', origin: { x: 224, y: ISLAND_BACK }, direction: 270, width: 24, depth: 24, height: COUNTER_HEIGHT, counterOverhang: { front: 1, back: 12, left: 3, right: 0 } });
  kitchen({ kind: 'sink', origin: { x: 254, y: ISLAND_BACK }, direction: 270, width: 36, depth: 24, height: COUNTER_HEIGHT, counterOverhang: { front: 1, back: 12, left: 0, right: 3 } });
  // Two stools on the lake side of the ledge, 16" square and 30" high, centred y 250: tucked 6" under
  // the 12" ledge, as they stand when no one sits.
  for (const x of [226, 258]) kitchen({ kind: 'box', origin: { x, y: 258 }, direction: 270, width: 16, depth: 16, height: 30, label: 'Stool' });
  // The east wall (the wall shared with the master suite), fronts facing west, north to south from
  // the band's wall (y 60) and ending at y 204, north of the island's east walkway: a 24" base by
  // the pantry, the refrigerator (30" deep, 36" wide, a wall cabinet over it), a 24" base, the
  // 30" range with its hood (its duct goes through the east wall into the wing's ceiling and up
  // through the wing roof, or it recirculates) and a 30" base; wall cabinets over the bases. The
  // pantry holds what the old tall pantry cabinets did. The range carries no counter, so the bases
  // either side have their own. Work triangle, centre to centre: refrigerator to sink about 10'9",
  // sink to range about 6'7", range to refrigerator 4'9", about 22' in all.
  const RANGE_Y = 159;
  const eastWall = (kind: NewFixture['kind'], y: number, width: number, depth: number, height: number, elevation = 0) =>
    kitchen({ kind, origin: { x: KITCHEN_EAST, y }, direction: 180, width, depth, height, elevation });
  eastWall('base', 72, 24, 24, COUNTER_HEIGHT);
  eastWall('fridge', 102, 36, 30, 70);
  eastWall('wall', 102, 36, 15, 15, 70);
  eastWall('base', 132, 24, 24, COUNTER_HEIGHT);
  eastWall('range', RANGE_Y, 30, 25, 36);
  eastWall('hood', RANGE_Y, 30, 18, 30, 66);
  eastWall('base', 189, 30, 24, COUNTER_HEIGHT);
  eastWall('wall', 72, 24, 12, 30, 54);
  eastWall('wall', 132, 24, 12, 30, 54);
  eastWall('wall', 189, 30, 12, 30, 54);

  // ---- The north band's fittings. The walk-in pantry (x 264..311, y 7..55): shelves 12" deep on
  // its north wall and 12" on its east wall, 84" high, clear of its door's swing. The powder room
  // (x 173..259, y 7..55, door at x 200..228 swinging out): a 30" vanity on its west wall (y 13..43)
  // and the WC against its east wall (y 18..38), both placeholders (MK: standard sizes until the
  // layouts are chosen).
  const SHELVES = { kind: 'box' as const, label: 'Shelves', height: 84, frontColor: PINE };
  kitchen({ ...SHELVES, origin: { x: (BAND.divide + 2.5 + KITCHEN_EAST) / 2, y: CL.y0 + HALF }, direction: 90, width: KITCHEN_EAST - (BAND.divide + 2.5), depth: 12 });
  kitchen({ ...SHELVES, origin: { x: KITCHEN_EAST, y: (CL.y0 + HALF + 12 + BAND.south - 2.5) / 2 }, direction: 180, width: BAND.south - 2.5 - (CL.y0 + HALF + 12), depth: 12 });
  const WC = { kind: 'box' as const, label: 'WC', width: 20, depth: 28, height: 30, frontColor: WHITE };
  kitchen({ kind: 'sink', origin: { x: PART_KL + 2.5, y: 28 }, direction: 0, width: 30, depth: 21, height: 31.5 });
  kitchen({ ...WC, origin: { x: BAND.divide - 2.5, y: 28 }, direction: 180 });

  // ---- The master bath's placeholders (x 318..456, y 7..117.5, door at x 375..403 swinging in from
  // the partition): a 36" shower in the north-west corner, a 48" vanity on the north wall under the
  // transom (sill 70), the WC against the east wall south of the east window (y 38..86), and in the
  // laundry closet the washer and the dryer, 27" each, side by side facing east, 4" off the back
  // wall for the dryer's vent, their fronts at the closet's opening (x 350).
  kitchen({ kind: 'box', label: 'Shower', origin: { x: 336, y: 7 }, direction: 90, width: 36, depth: 36, height: 78, frontColor: WHITE });
  kitchen({ kind: 'sink', origin: { x: 424, y: 7 }, direction: 90, width: 48, depth: 21, height: 34.5 });
  kitchen({ ...WC, origin: { x: 456, y: 100 }, direction: 180 });
  kitchen({ kind: 'box', label: 'Washer', origin: { x: 322, y: 71.5 }, direction: 0, width: 27, depth: 28, height: 38, frontColor: WHITE });
  kitchen({ kind: 'box', label: 'Dryer', origin: { x: 322, y: 99.5 }, direction: 0, width: 27, depth: 28, height: 38, frontColor: WHITE });

  // ---- Vents through walls, not the roof (MK, 14 Oct 2026). The dryer's: a 4" rigid metal duct
  // rising behind the dryer (x 318..322) to 86" and running north under the ceiling, over the
  // shower, out through the master bath's north wall at x 320 to a vent hood with a damper: about
  // 13' of duct and two 90-degree bends, well inside the 35' less 5' per bend the code allows
  // (M1502.4.5.1; verify against the 2025 RCNYS and the dryer's instructions). The range hood's: an
  // 8" duct from the hood's back east through the kitchen's east wall and along the master bedroom's
  // ceiling (boxed in a soffit, 86..94", as the wing's east wall tops out at 96") to a wall cap
  // above the bedroom's east window: about 13'. Drawn as boxes (they pass through the walls).
  const METAL = COLUMN_COLOR.flue;
  kitchen({ kind: 'box', label: 'Dryer vent', origin: { x: 318, y: 99.5 }, direction: 0, width: 4, depth: 4, elevation: 30, height: 60, frontColor: METAL });
  kitchen({ kind: 'box', label: 'Dryer vent', origin: { x: 318, y: (101.5 + -1) / 2 }, direction: 0, width: 102.5, depth: 4, elevation: 86, height: 4, frontColor: METAL });
  kitchen({ kind: 'box', label: 'Vent hood', origin: { x: 320, y: 0 }, direction: 270, width: 8, depth: 5, elevation: 84, height: 8, frontColor: METAL });
  kitchen({ kind: 'box', label: 'Hood duct', origin: { x: KITCHEN_EAST, y: RANGE_Y }, direction: 0, width: 8, depth: 464 - KITCHEN_EAST, elevation: 86, height: 8, frontColor: METAL });
  kitchen({ kind: 'box', label: 'Duct cap', origin: { x: 463, y: RANGE_Y }, direction: 0, width: 12, depth: 5, elevation: 84, height: 12, frontColor: METAL });

  // ---- Alarms (the wood stove brings carbon monoxide alarms; R314, R315: verify against the 2025
  // RCNYS): a smoke alarm in each bedroom and in the basement, and a combination smoke and CO alarm
  // outside the sleeping areas on each floor (by the master bedroom's door in the kitchen, and on the
  // upstairs balcony hall) and in the Living with the stove. 6" discs drawn as boxes under the ceiling.
  const alarm = (lid: Id, at: Vec2, label: string) =>
    fixture(lid, { kind: 'box', label, origin: { x: at.x, y: at.y - 3 }, direction: 90, width: 6, depth: 6, height: 2, elevation: level(lid).wallHeight - 2, frontColor: WHITE, phase: NEW });
  alarm(fId, { x: 390, y: 215 }, 'Smoke');
  alarm(fId, { x: 290, y: 288 }, 'Smoke/CO');
  alarm(fId, { x: 100, y: 200 }, 'Smoke/CO');
  alarm(sId, { x: 90, y: 225 }, 'Smoke');
  alarm(sId, { x: 242, y: 235 }, 'Smoke');
  alarm(sId, { x: 100, y: 120 }, 'Smoke/CO');
  alarm(bId, { x: MAIN.x1 / 2, y: MAIN.y1 / 2 + 24 }, 'Smoke');

  // ---- 8. The wood stove (MK, 14 Oct 2026), in the Living's south-west corner with its back to the
  // west wall, facing east into the room, centred y 280: a stone hearth 50" out from the wall and
  // 40" wide (y 260..300, 18" in front of the stove, 8" each side), a 3" stone surround on the wall
  // behind it (46" wide, to 60" up), and the stove 24" wide, 26" deep, 30" high, 6" off the surround.
  // It is clear of the west window's trim (y 162..252) and beside the lake window's west end (that
  // window starts 8 1/2" from the corner). Its stove's listed clearances decide the final spacing.
  const STOVE = { y: 280 };
  const STONE = '#7d7a73';
  kitchen({ kind: 'box', label: 'Hearth', origin: { x: CL.x0 + HALF, y: STOVE.y }, direction: 0, width: 40, depth: 50, height: 1, frontColor: STONE });
  kitchen({ kind: 'box', label: 'Stone', origin: { x: CL.x0 + HALF, y: STOVE.y }, direction: 0, width: 46, depth: 3, height: 59, elevation: 1, frontColor: STONE });
  kitchen({ kind: 'box', label: 'Wood stove', origin: { x: CL.x0 + HALF + 6, y: STOVE.y }, direction: 0, width: 24, depth: 26, height: 30, elevation: 1, frontColor: STOVE_BLACK });
  // Its flue runs outside the house (MK, 14 Oct 2026), to the 2025 Residential Code of New York State
  // (docs/history/PLAN-v7-exterior-flue.md). Inside, a 6" double-wall black connector, 8" outside,
  // rises from the stove's collar (x 19, 6" in from its back) to an elbow and turns west into a listed
  // wall thimble over the stone (centre 66" up): it passes through no floor or ceiling, and the
  // bedroom upstairs needs no chase. Outside, an insulated 6" chimney (UL 103 HT, 8" outside) starts
  // at a tee with a cleanout below the thimble, 2" clear of the siding (x -10..-2), and rises
  // straight (no offsets) in the screen porch's south-east corner, through the porch's shed roof by
  // the house wall, up the gable wall and through the main roof's 24" rake overhang, with a rain cap.
  // Its top follows the 3-2-10 rule: 3' over where it leaves the roof, and 2' over any roof within
  // 10' (the roof 10' up the slope); that leaves 7' over the rake, braced to the roof.
  const THIMBLE = 66;
  const COLLAR = { x: CL.x0 + HALF + 12, y: STOVE.y };
  const FLUE = { x: MAIN.x0 - 2 - 4, y: STOVE.y };
  if (!store().addColumn({ at: COLLAR, kind: 'flue', phase: NEW, width: 8, depth: 8, rotation: 0, base: FLOOR_TOP + 31, top: FLOOR_TOP + THIMBLE + 4, color: STOVE_BLACK })) throw new Error('connector rejected');
  kitchen({ kind: 'box', label: 'Stovepipe', origin: { x: CL.x0 + HALF, y: STOVE.y }, direction: 0, width: 8, depth: COLLAR.x - (CL.x0 + HALF), height: 8, elevation: THIMBLE - 4, frontColor: STOVE_BLACK });
  kitchen({ kind: 'box', label: 'Tee', origin: { x: MAIN.x0, y: STOVE.y }, direction: 180, width: 8, depth: MAIN.x0 - FLUE.x, height: 8, elevation: THIMBLE - 4, frontColor: COLUMN_COLOR.flue });
  const mainRoof = Object.values(level(sId).roofs)[0];
  const secondTop = getLevelElevations(getPlan())[sId].floorTop;
  const roofTop = (p: Vec2) => {
    const under = roofHeightAt(mainRoof, roofBearing(level(sId).wallHeight, mainRoof), p);
    if (under === null) throw new Error(`no roof over ${JSON.stringify(p)}`);
    return secondTop + under + mainRoof.thickness;
  };
  const flueTop = round2(Math.max(roofTop(FLUE) + 36, roofTop({ x: FLUE.x, y: FLUE.y - ft(10) }) + 24));
  if (!store().addColumn({ at: FLUE, kind: 'flue', phase: NEW, width: 8, depth: 8, rotation: 0, base: FLOOR_TOP + THIMBLE - 10, top: flueTop, cap: true })) throw new Error('flue rejected');

  // ---- 9. The second floor's full bath (MK, 14 Oct 2026), across the north-east: the old bath
  // (x 174..218, y 7..81) opened east across the old Office's north end, x 174..311, y 7..70 inside
  // (11'5" x 5'3", 6'2" at the old bath's end). Its new south wall runs at y 72.5 (faces 70..75)
  // from the old bath's east wall line to the east wall, south of where it meets the old east window
  // (y 75..121) so that window keeps its place in the existing view; a stub of the old east wall
  // stays between y 72.5 and the old bath's south wall. The old 24" door (x 184..208, swinging out
  // into the hall) stays. Placeholders: a 48" vanity on the west wall, the WC on the north wall
  // under the window (x 225..271), a 36 x 48 stall shower in the north-east corner (x 275..311, y
  // 7..55). The Office keeps x 223..311, y 75..150 (7'4" x 6'3") with its transom.
  partition(sId, { x: UP_BATH.east, y: UP_BATH.south }, { x: CL.x1, y: UP_BATH.south }, NEW);
  demolish(sId, { walls: [{ x: UP_BATH.east, y: 40 }] });
  const upstairs = (f: Omit<NewFixture, 'phase' | 'elevation'> & { elevation?: number }) => fixture(sId, { elevation: 0, ...f, phase: NEW });
  upstairs({ kind: 'sink', origin: { x: UP_BATH.west, y: 34 }, direction: 0, width: 48, depth: 21, height: 34.5 });
  upstairs({ ...WC, origin: { x: 248, y: CL.y0 + HALF }, direction: 90 });
  upstairs({ kind: 'box', label: 'Shower', origin: { x: KITCHEN_EAST, y: 31 }, direction: 180, width: 48, depth: 36, height: 78, frontColor: WHITE });

  // ---- Structure (docs/history/PLAN-v8-stair-structure.md; estimates for MK and the engineer).
  // MK, 14 Oct 2026: the house was built in stages and its joists run north-south generally, so
  // every level's framing is north-south. The one known exception is the wing's ceiling: its shed
  // roof slopes east-west, so its rafters and ceiling joists run that way, over the utility today
  // and over the whole east side under the new shed (two zones: existing, and new north of the
  // utility). Its floor over the crawl space is left north-south (unknown). The proposed design takes
  // out the First Floor's y 99.5 wall, the only full-width east-west partition and so likely bearing
  // for north-south joists, and opens the hall north of y 91 through the Second Floor. Two flush
  // beams in the Second Floor's framing pick that up (placeholders for the engineer to size): the
  // balcony header along the floor opening's edge, centred y 92.75 (faces 91..94.5) so it clears the
  // top tread, from the west wall to the x 170.5 partition; and the kitchen beam on the old wall's
  // line, from that partition to the east wall. Both land on the partition, so a post under the
  // landing points carries them down through the basement to a 24" x 12" footing: two 6x6s side
  // by side (5 1/2" x 11"), centred between the two ends (y 96.125), so each end is over it. The new
  // y 137.5 wall (the stair hall's south side) is not bearing.
  for (const lid of [bId, fId, sId]) store().setLevelFraming(lid, { joists: 90 });
  const wingZones: [Rect, Phase][] = [
    [{ x0: WING.x0, x1: WING.x1, y0: WING.y0, y1: WING.y1 }, 'existing'],
    [{ x0: WING.x0, x1: WING.x1, y0: MAIN.y0, y1: WING.y0 }, NEW],
  ];
  for (const [r, phase] of wingZones) if (!store().addJoistZone(fId, { outline: outline(r), joists: 0, phase })) throw new Error('joist zone rejected');
  const BEAM = MEMBER_DEFAULTS.beam;
  const beam = (a: Vec2, b: Vec2) => {
    if (!store().addMember(fId, { kind: 'beam', a, b, width: BEAM.width, depth: BEAM.depth, mount: 'flush', label: BEAM.label, phase: NEW })) throw new Error('beam rejected');
  };
  beam({ x: CL.x0, y: 92.75 }, { x: PART_KL, y: 92.75 });
  beam({ x: PART_KL, y: FRONT_LINE }, { x: CL.x1, y: FRONT_LINE });
  const POST = MEMBER_DEFAULTS.post;
  if (!store().addMember(bId, { kind: 'post', at: { x: PART_KL, y: (92.75 + FRONT_LINE) / 2 }, width: POST.width, depth: 2 * POST.width, rotation: 0, label: '(2) 6x6', phase: NEW, footing: { ...MEMBER_DEFAULTS.footing } })) throw new Error('post rejected');
  // Studs under each beam end in the partition (two 2x4s, 3 1/2" square), so each end has its own
  // path down to the basement post.
  for (const y of [92.75, FRONT_LINE]) {
    if (!store().addMember(fId, { kind: 'post', at: { x: PART_KL, y }, width: 3.5, depth: 3.5, rotation: 0, label: '(2) 2x4', phase: NEW })) throw new Error('studs rejected');
  }

  // ---- Labels, anchored where the room it replaces in the All view did not reach, so the two
  // never share a face there. Placeholder finishes (MK), which also dress the faces of the old
  // exterior walls the additions enclose; the screen porch keeps its shingle inside. The upstairs
  // Bath and Office / hall keep their labels (the hall now runs out onto the balcony round the stair
  // hall's opening).
  label(fId, 'Master bedroom (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 155 }, NEW, PLACEHOLDER_ROOM);
  label(fId, 'Master bath (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 62 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Coats (proposed)', { x: 154.5, y: 47 }, NEW, PLACEHOLDER_ROOM);
  label(fId, 'Powder room (proposed)', { x: 213, y: 28 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Pantry (proposed)', { x: 287, y: 30 }, NEW, PLACEHOLDER_ROOM);
  label(fId, 'Laundry (proposed)', { x: 334, y: 86 }, NEW, PLACEHOLDER_ROOM);
  label(fId, 'Foyer (proposed)', { x: -48, y: 125 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Screen porch (proposed)', { x: -48, y: 236 }, NEW, { floorFinish: 'boards', floorColor: WOOD_FLOOR });
  label(bId, 'Crawl space (proposed)', { x: (WING.x0 + WING.x1) / 2, y: 97 }, NEW);
  label(bId, 'Crawl space under the foyer (proposed)', { x: -48, y: 111 }, NEW);

  // ---- The house after the work (MK, after his garage across the road): re-sided in brown painted
  // engineered shakes (the garage's dark chocolate brown), a dark hunter green standing-seam roof
  // with its boards in the shake brown, black windows with red trim (the garage's red), and the
  // shutters off. Shown in the Proposed view only (types.ts ProposedLook).
  store().updateProposedLook({
    wallFinish: 'shake',
    wallColor: SHAKE_BROWN,
    roofFinish: 'seam',
    roofColor: '#2f4a36',
    boardColor: SHAKE_BROWN,
    trimColor: '#a8322d',
    sashColor: '#1c1c1c',
    shutters: false,
  });
}

/** The starter plan as the JSON text of docs/examples/146-mick-road.json (stable ids, fixed date). */
export function buildExampleJson(): string {
  return stableIds(buildExamplePlan());
}
