// Shared by the 146 Mick Road plans (scripts/example-plan.ts, the house as it stands with its
// proposed renovation, and scripts/rebuild-plan.ts, the house knocked down and rebuilt on its
// foundation): the measured constants of the house and the yard, the colours, and the helpers that
// draw through the plan store's own actions, so every wall, opening and roof goes through
// normalizeLevel, clamping and validation. Pure apart from the store: no file access.
//
// Coordinates: inches, plan x east, y south (down the screen), north is the road side. The exterior is
// laid out from the OUTSIDE faces of the walls, the way the owner's tape reads, and the centerlines
// are set 3.5" (half of 7") inside them, which is what "Lengths to: outside face" does by hand.
import { dist, normalize, perpLeft, sub } from '../src/model/geometry';
import type { FabricId, FurniturePiece, Id, Opening, Phase, Plan, Roof, Room, Vec2, WoodId } from '../src/model/types';
import { furnitureDefaults, type BedSize } from '../src/model/furniture';
import { getPlan, usePlanStore, type NewDeck, type NewFixture } from '../src/store/planStore';

export const ft = (feet: number): number => feet * 12;
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Exterior wall thickness (derived from the measured interior widths); the basement's block walls are thicker. */
export const T = 7;
/** Interior partition thickness (measured). */
export const TI = 5;
export const TB = 8;
export const HALF = T / 2;

// Main block: outside faces x 0..318 (26'6") and y 0..315 (26'3"); centerlines HALF inside. Along the lake
// wall the measured interior is 11'6" + 5" + 13'5" = 25'4" between 7" walls, 26'6" outside. North-south
// the inside is 301": the upstairs west side (Bunk 90 + 5 + stair strip 33 + 5 + Master 168), which the
// First Floor shares (hall 90 + 5 + strip 33 + 5 + Living 168), so 301 + 14 = 315 outside.
export const MAIN = { x0: 0, x1: ft(26.5), y0: 0, y1: ft(26) + 3 };
export const CL = { x0: MAIN.x0 + HALF, x1: MAIN.x1 - HALF, y0: MAIN.y0 + HALF, y1: MAIN.y1 - HALF };

// East wing (the Utility), one storey with its own gable, on the east wall at the south end, its south
// face flush with the main block's (photos 01, 03, 09; the owner's sketch puts it there too). Interior
// measured 11'6" x 9'5", so outside x 318..463, y 188..315 (its west side is the main block's east wall).
export const UTILITY = { w: ft(11.5), d: ft(9) + 5 };
export const WING = { x0: MAIN.x1, x1: MAIN.x1 + UTILITY.w + T, y0: MAIN.y1 - UTILITY.d - 2 * T, y1: MAIN.y1 };
// Entry porch: one structure on the west face at its north end, flush with the north face (photo 08,
// taken facing east; photos 06 and 07 show the same porch from the road). Estimated 8' along the wall
// by 5'6" out (photos 06 and 07 read 7' to 9' out; the starter keeps 5'6" until it is measured).
// Shingled knee walls with screens above them in all four bays, a screen door in line with the house
// door, and its own gable facing west.
export const PORCH = { x0: -66, x1: MAIN.x0, y0: MAIN.y0, y1: ft(8) };
/**
 * The yard, all estimates (README, "What to replace with measurements"). Mick Road: asphalt, 18' wide,
 * its near edge 12' north of the north face (the site sketch, photo 10; a car parks between the two,
 * photo 07). The gravel pull-off: from 18' west of the west face (past the porch, photo 05) east to
 * near the north-east corner (photo 04), from the road to 2' short of the house. The porch entry's
 * concrete pad, 4' x 2'6", and two flagstones south of it on the lawn (photos 07 and 08). A gravel
 * strip a foot wide along the lake face, a foot out from it (photo 01). The fence: two rails (photo
 * 01) a foot inside the retaining wall's top, from the house down its return, along its angled and
 * straight pieces, then on west across the lawn (photos 05, 07 and 24) to about 58' west of the house.
 */
export const YARD = {
  road: { x0: -ft(100), x1: ft(75), y0: -ft(30), y1: -ft(12) },
  pullOff: { x0: -ft(18), x1: ft(25), y0: -ft(12), y1: -ft(2) },
  pad: { x0: -96, x1: -66, y0: 24, y1: 72 },
  stones: [
    { x0: -98, x1: -78, y0: 96, y1: 112 },
    { x0: -104, x1: -84, y0: 126, y1: 142 },
  ],
  dripStrip: { x0: 6, x1: 300, y0: ft(26) + 3 + 12, y1: ft(26) + 3 + 24 },
  fence: [
    { x: 302, y: ft(26) + 3 + 8 },
    { x: 302, y: 423 },
    { x: 56, y: 477 },
    { x: -388, y: 477 },
    { x: -ft(58), y: 477 },
  ],
};
/** The house door and the porch entry share this line (photo 08). */
export const ENTRY_Y = ft(4);

/** The house's dark red-brown stain: siding, rake boards, rafter tails, the chimney (photos 01, 06, 07, 08). */
export const FINISH_COLOR = '#5a3a35';
/** The grey concrete block of the foundation (photos 01 and 02). */
export const BLOCK_COLOR = '#8f8a84';
/** Weathered galvanized corrugated steel (the main and porch roofs, photos 06 and 07) and the wing's darker, browner sheet (photo 03). */
export const ROOF_GALVANIZED = '#8a8378';
export const ROOF_WING = '#6e4b3c';
/** Poured concrete of the retaining wall (photos 02 and 23). */
export const CONCRETE_COLOR = '#b3b0a8';
/**
 * The retaining wall's centerline, after the site sketch (photo 10; MK): a return from the main
 * block's south-east corner 10' south (y 435), a 22' piece angled west and 4'6" further south, and
 * 37' straight west to its free end, about 32' past the main block's west face. The design carries it
 * on (new) about 20' angled and 27' straight to the west property line (3' west of the planned
 * garage, 55' west of the house: x -984). All estimates (the sketch is not to scale).
 */
export const RETAIN = { y: ft(26) + 3 + ft(10), bend: { x: 56, y: 489 }, west: -388 };
export const RETAIN_NEW = [{ x: -660, y: 519 }, { x: -984, y: 519 }];
/**
 * The planned garage (README, "Still open"; MK, after the site sketch, photo 10), outside faces, in
 * site coordinates: 24' east-west by 26' north-south, 55' west of the house (its east face at x
 * -660) and 3' off the west property line (x -984, the retaining wall's new west end), so its west
 * face is at x -948; the two agree. Its south side is set by the retaining wall carried west: 5'
 * north of the new straight piece's north face (centerline y 519, 10" thick), so y 454, and its
 * north face 26' further north at y 142. The README's "20' from the road" (the road's near edge at
 * y -144) would put it 46" further north; the sketch is not to scale, and the wall setting its
 * south side is what the README says decides it. Its floor is a slab at the lawn's -6 there. Wall
 * height, roof and doors are not given anywhere: the garage preset's 84" storey, no roof, no door.
 */
export const GARAGE = { x0: -948, x1: -660, y0: 142, y1: 454, floor: -6 };
/** The retaining wall's centerline y at plan x (the existing wall and the new one). */
export const retainY = (x: number): number => {
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
export const BANK = { top: ft(26) + 3 + ft(4), bottom: ft(26) + 3 + 150, lawn: -196 };
/** The ground on the bank at y (in front of the walkout). */
export const bankAt = (y: number): number => (y <= BANK.top ? -100 : y >= BANK.bottom ? BANK.lawn : round2(-100 + ((BANK.lawn + 100) * (y - BANK.top)) / (BANK.bottom - BANK.top)));
/** A riser of today's lower flight: 13 to the 96" from the walkout's level down to the lower lawn. */
export const OUTDOOR_RISER = 96 / 13;
/** The house door's dark green (photo 08). */
export const DOOR_GREEN = '#2f4a3a';
/** The Bath's flush stained door (photo 22) and the grey Kitchen to Utility door (photos 13 and 14). */
export const STAINED_DOOR = '#8a5a34';
export const UTILITY_DOOR_GREY = '#7f8b8f';
/** Inside, from photos 13 to 22: knotty pine casework, a light laminate counter, white appliances and fixtures, a black stove. */
export const PINE = '#c4884e';
export const LAMINATE = '#e2dccb';
export const WHITE = '#f1efe8';
export const STOVE_BLACK = '#26241f';
/** The front room's and the Living's cream paint (photos 16 to 20) and the Utility's blue mini fridge (MK). */
export const CREAM = '#ddd6b4';
/** The Kitchen's blue check wallpaper and beige vinyl tile (photos 13 to 15). */
export const CHECK_BLUE = '#2e3f6b';
export const VINYL_BEIGE = '#cbbd9c';
/** The dark red-brown paint of the Living's and front room's board floors (photos 16 to 20). */
export const FLOOR_RED_BROWN = '#5e2a22';
/** The Bath's green paint over the pine wainscot (photos 21 and 22). */
export const BATH_GREEN = '#2f7a68';
/** The Utility's unpainted wood floor (MK). */
export const WOOD_FLOOR = '#a87a4c';
/**
 * Placeholder finishes for the rooms with no photos (the Second Floor) and the proposed rooms (MK:
 * neutral placeholders until he chooses): walls painted the default off-white, wood board floors,
 * tile in the baths and the foyer. Not from photos; change them in each room's panel.
 */
export const PLACEHOLDER_ROOM = { wallFinish: 'paint', floorFinish: 'boards', floorColor: WOOD_FLOOR } as const;
export const PLACEHOLDER_WET = { wallFinish: 'paint', floorFinish: 'tile' } as const;
/**
 * The proposed walls (MK, 20 Oct 2026, from a photo of a lake house living room): painted wood
 * paneling, vertical V-groove boards in a warm white, through every dry room (the wet rooms stay
 * painted). Kept light (MK, 15 Oct 2026): the wood shows in the floors, the stair, the beams, the
 * cabinets and the furniture.
 */
export const PANEL_WHITE = '#ece6da';
/**
 * The proposed floors (MK, 15 Oct 2026): 6" pine, face-nailed, through the whole first floor but
 * the baths and the laundry (tile) and the upstairs hall, and on the stair's thick treads; oatmeal
 * carpet in the upstairs bedrooms. The pine must not turn yellow: Nordic natural, pale and cool as
 * under a water-white (non-ambering, water-based) finish, drawn so (view3d/proceduralTextures.ts).
 */
export const PINE_FLOOR = '#d8d0c2';
export const PROPOSED_PINE = { wallFinish: 'boards', wallColor: PANEL_WHITE, floorFinish: 'pine', floorColor: PINE_FLOOR } as const;
/** The same floors laid in a room that is kept (Room.proposedFloor). */
export const PINE_PROPOSED = { finish: 'pine', color: PINE_FLOOR } as const;
export const CARPET_PROPOSED = { finish: 'carpet' } as const;
/** The same walls in a room that is kept (Room.proposedWall). */
export const BOARDS_PROPOSED = { finish: 'boards', color: PANEL_WHITE } as const;
/** A new room carpeted like the upstairs bedrooms. */
export const PROPOSED_CARPET = { wallFinish: 'boards', wallColor: PANEL_WHITE, floorFinish: 'carpet' } as const;
/** The peeled log post's pale, barkless wood (MK). */
export const PEELED_LOG = '#c9ab7e';
/** The proposed shakes' brown (and the roof boards'): the dark chocolate of MK's garage. */
export const SHAKE_BROWN = '#4b3a32';
/**
 * The Adirondack entry and screen porch (docs/history/PLAN-v10-adirondack.md): dark stained logs
 * and twigs (their end grain amber, the tool's mix toward cut wood, model/structure.ts logEndColor),
 * a dry-stacked river-stone knee wall in the stones' own colours and grey-brown fieldstone.
 */
export const DARK_LOG = '#3f2c1f';
export const FIELDSTONE = '#8e8579';
export const FRIDGE_BLUE = '#3a5fa0';
/**
 * Centre of the Kitchen's east window and the sink under it: the sink base comes right after the
 * corner cabinet (photos 13 and 15), and the window's 40" stays clear of the wing's north wall (its
 * face at y 188). Re-measure.
 */
export const KITCHEN_WINDOW_Y = 160;
export const PHASE: Phase = 'existing';
export const NEW: Phase = 'new';
/** The Kitchen/Living partition's centerline. */
export const PART_KL = 170.5;
/** The First Floor's y 99.5 line: the Kitchen's north wall and the front room's south wall. */
export const FRONT_LINE = 99.5;
/**
 * The basement's three north-south girders under the First Floor's east-west joists (MK's markup, 15
 * Oct 2026): their centerlines, estimated from the sketch (the middle one taken under PART_KL).
 */
export const GIRDERS = [77.5, PART_KL, 259.5];
/** A placeholder size for the girders until they are measured: a built-up three 2x8s. */
export const GIRDER = { width: 4.5, depth: 7.25, label: 'existing girder (size and place to measure)' };
/**
 * The proposed upstairs bath: its west face (the old bath's, x 174), the old bath's east wall line
 * (x 220.5) and the new south wall east of it (y 72.5, faces 70..75).
 */
export const UP_BATH = { west: 174, east: 220.5, south: 72.5 };
/** The proposed master bedroom's king bed: its centre north-south, its headboard on the wing's east wall. */
export const BED_Y = 230;

export type Rect = { x0: number; x1: number; y0: number; y1: number };
export const outline = (r: Rect): Vec2[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];
/** Centerline rectangle of walls whose outside faces are `r`, grown/shrunk by half the thickness. */
export const centerline = (r: Rect, half: number): Rect => ({ x0: r.x0 + half, x1: r.x1 - half, y0: r.y0 + half, y1: r.y1 - half });

export const store = () => usePlanStore.getState();
export const level = (id: Id) => getPlan().levels[id];

/** Draw a chain of exterior walls through the points (closed when `close`). Returns the wall ids. */
export function drawWalls(levelId: Id, pts: Vec2[], thickness: number, close = false, phase: Phase = PHASE, replacesDemolished = false): Id[] {
  const out: Id[] = [];
  const n = close ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const res = store().addWall(levelId, pts[i], pts[(i + 1) % pts.length], { kind: 'exterior', thickness, phase, ...(replacesDemolished ? { replacesDemolished } : {}) });
    if (!res) throw new Error(`wall ${i} of ${JSON.stringify(pts)} was rejected`);
    out.push(...res.wallIds);
  }
  return out;
}

/** Draw one interior partition (5") between two centerline points; it T-joins what it meets. */
export function partition(levelId: Id, a: Vec2, b: Vec2, phase: Phase = PHASE, replacesDemolished = false): void {
  if (!store().addWall(levelId, a, b, { kind: 'interior', thickness: TI, phase, ...(replacesDemolished ? { replacesDemolished } : {}) })) throw new Error(`partition ${JSON.stringify([a, b])} was rejected`);
}

/**
 * The wall whose centerline passes through p (the opening's centre), and p's distance from its
 * start. `standing`: only walls that are not demolished (a new wall drawn where a demolished one was).
 */
export function wallAt(levelId: Id, p: Vec2, standing = false): { wallId: Id; offset: number } {
  const lvl = level(levelId);
  let best: { wallId: Id; offset: number; d: number } | null = null;
  for (const w of Object.values(lvl.walls)) {
    if (standing && w.phase === 'demo') continue;
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

/** The opening centred at p (on its wall's centerline). */
export function openingAt(levelId: Id, p: Vec2): Id {
  const { wallId, offset } = wallAt(levelId, p);
  const o = Object.values(level(levelId).openings).find((x) => x.wallId === wallId && Math.abs(x.offset - offset) < 0.01);
  if (!o) throw new Error(`no opening at ${JSON.stringify(p)} on ${level(levelId).name}`);
  return o.id;
}

export interface OpeningSpec {
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
export function addOpeningAt(levelId: Id, p: Vec2, o: OpeningSpec): Id {
  // New work goes in a standing wall, never in the demolished one it replaces.
  const { wallId, offset } = wallAt(levelId, p, o.phase === 'new');
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

export const win = (levelId: Id, p: Vec2, width: number, height: number, cols: number, rows: number, extra: Partial<OpeningSpec> = {}) =>
  addOpeningAt(levelId, p, { type: 'window', width, height, lites: { cols, rows }, ...extra });

/**
 * A roof of the house: corrugated metal, a 2.5" slab (sheet on purlins), open eaves with the rafter
 * tails showing (5.5" deep every 24", photos 01, 02 and 07) and 7" rake boards, all in the stain
 * (photos 03 and 08). `color` and `weathering` (rust) per roof.
 */
export function roof(levelId: Id, r: Pick<Roof, 'shape' | 'outline' | 'ridgeAngle' | 'pitch' | 'overhang'>, color: string, weathering: number, phase: Phase = PHASE): Id {
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
export function deck(levelId: Id, d: NewDeck): Id {
  const id = store().addDeck(levelId, d);
  if (!id) throw new Error(`deck ${JSON.stringify(d.outline)} on ${level(levelId).name} was rejected`);
  return id;
}

/** Add a cabinet, appliance, sink or box (DESIGN.md "Casework"); throws when the store refuses it. */
export function fixture(levelId: Id, f: NewFixture): Id {
  const id = store().addFixture(levelId, f);
  if (!id) throw new Error(`fixture ${f.kind} at ${JSON.stringify(f.origin)} on ${level(levelId).name} was rejected`);
  return id;
}

/**
 * Name a room: a label anchored at `at`. A label of a new or demolished room shows only in the views
 * that show its phase. `finishes`: the room's interior finishes (DESIGN.md "Interior finishes").
 */
export function label(levelId: Id, name: string, at: Vec2, phase: Phase = PHASE, finishes: Pick<Room, 'wallFinish' | 'wallColor' | 'wainscot' | 'floorFinish' | 'floorColor' | 'proposedFloor' | 'proposedWall'> = {}): void {
  if (!store().addRoom(levelId, { name, anchor: at, ...(phase === 'existing' ? {} : { phase }), ...finishes })) throw new Error(`room ${name} rejected`);
}

/**
 * Add a proposed piece of furniture (DESIGN.md "Furniture"): `origin` the middle of its back,
 * `direction` the way it faces, its stock size unless given (a bed by its mattress size).
 */
export function furnish(
  levelId: Id,
  piece: FurniturePiece,
  origin: Vec2,
  direction: number,
  opts: { bed?: BedSize; width?: number; depth?: number; height?: number; wood?: WoodId; fabric?: FabricId; builtIn?: boolean } = {},
): Id {
  const def = furnitureDefaults(piece, opts.bed);
  return fixture(levelId, {
    kind: 'furniture',
    piece,
    origin,
    direction,
    width: opts.width ?? def.width,
    depth: opts.depth ?? def.depth,
    height: opts.height ?? def.height,
    elevation: 0,
    phase: NEW,
    ...(opts.wood ? { wood: opts.wood } : {}),
    ...(opts.fabric ? { fabric: opts.fabric } : {}),
    ...(opts.builtIn ? { builtIn: true } : {}),
  });
}

/** Replace every generated id with a readable, stable one (the plan's `planId`) so the JSON is identical from run to run. */
export function stableIds(plan: Plan, planId: string): string {
  const names = new Map<string, string>();
  const add = (old: string, name: string) => names.set(old, name);
  add(plan.id, planId);
  const prefixes = ['b', 'f', 's'];
  // The main structure is `house` with levels b, f, s; another structure i (from 2) is `structure-i`
  // with levels `s<i>l<n>`.
  plan.structureOrder.forEach((sid, si) => add(sid, si === 0 ? 'house' : `structure-${si + 1}`));
  plan.structureOrder.flatMap((sid, si) => plan.structures[sid].levelOrder.map((lid, li) => [lid, si === 0 ? (prefixes[li] ?? `l${li}`) : `s${si + 1}l${li + 1}`] as const)).forEach(([lid, pre]) => {
    const lvl = plan.levels[lid];
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
  Object.keys(plan.site.surfaces).forEach((id, i) => add(id, `surface-${i + 1}`));
  Object.keys(plan.site.fences).forEach((id, i) => add(id, `fence-${i + 1}`));
  let text = JSON.stringify({ ...plan, modifiedAt: '2026-01-01T00:00:00.000Z' }, null, 2);
  // Quoted ids only (as keys and as values); ids are 10 random characters, never a plain word.
  for (const [old, name] of names) text = text.split(`"${old}"`).join(`"${name}"`);
  return text + '\n';
}

/** Ids from the existing house that the proposed design demolishes or builds on. */
export interface ExistingIds {
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
export function demolish(levelId: Id, d: { walls?: Vec2[]; openings?: Id[]; stairs?: Id[]; roofs?: Id[]; fixtures?: Id[]; decks?: Id[]; rooms?: string[] }): void {
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
