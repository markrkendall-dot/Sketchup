export type Id = string;
export type Inches = number;
export type Degrees = number;
export interface Vec2 {
  x: Inches;
  y: Inches;
}

export type Phase = 'existing' | 'demo' | 'new';
export type ViewMode = 'existing' | 'proposed' | 'all';
// existing view shows {existing, demo}; proposed shows {existing, new}; all shows everything, styled.

export interface Node {
  id: Id;
  x: Inches;
  y: Inches;
}

export type WallKind = 'exterior' | 'interior';
/** How a wall's face is dressed in 3D (DESIGN.md "Exterior appearance"). */
export type WallFinish = 'clapboard' | 'shingle' | 'shake' | 'board' | 'block' | 'plain' | 'screen';
/** How a room dresses the faces of the walls round it (DESIGN.md "Interior finishes"). */
export type RoomWallFinish = 'paint' | 'boards' | 'pine' | 'check';
/** How a room's floor is dressed: a flat colour, painted boards, square tiles or parquet. */
export type FloorFinish = 'plain' | 'boards' | 'tile' | 'parquet';
/** A lower band of a room's walls in another finish, up to `height` above the floor top. */
export interface Wainscot {
  height: Inches;
  finish: RoomWallFinish;
  /** Absent: the finish's default colour. */
  color?: string;
}
/** What fills a window's sashes or a door's lites: glass, or insect screen. */
export type Glazing = 'glass' | 'screen';

export interface Wall {
  id: Id;
  a: Id; // start node
  b: Id; // end node; a->b direction defines the wall's "left" (+normal) side
  thickness: Inches; // 4.5 interior, 6.5 exterior typical
  kind: WallKind;
  phase: Phase;
  heightOverride?: Inches; // defaults to level.wallHeight
  /** Absent: shingle for exterior walls, plain for interior ones (model/finish.ts). */
  finish?: WallFinish;
  /** Hex colour `#rrggbb`. Absent: the house's red-brown for exterior walls, off-white for interior ones. */
  color?: string;
}

export interface Opening {
  id: Id;
  wallId: Id;
  type: 'door' | 'window' | 'passage';
  offset: Inches; // from wall.a along the centerline to the opening CENTER
  width: Inches;
  height: Inches; // rough height of the hole
  sill: Inches; // bottom of hole above floor top; 0 for doors
  phase: Phase;
  swing?: { hinge: 'a' | 'b'; side: 'left' | 'right' };
  /** Divided lites of a window sash (default 2 x 3) or a glazed door (default 1 x 1: a solid panel). */
  lites?: { cols: number; rows: number };
  /** Green board shutters flanking a window. */
  shutters?: boolean;
  /** Width of the trim round the opening on the outside face (default 4"). */
  trim?: Inches;
  /**
   * Windows: sashes side by side (1 to 6, default 1), divided by 2" mullions; the lite grid applies
   * to each sash. Doors: leaves, 1 or 2 (a double door).
   */
  sashes?: number;
  /** A window of 3 sashes: the middle one is one fixed pane, the side sashes at most 24" wide. */
  fixedCenter?: boolean;
  /** Glass (default) or insect screen; a door with a screen is a screen door. */
  glazing?: Glazing;
  /** Doors: the lite grid glazes the upper 55% of the leaf, with two panels below. */
  halfLite?: boolean;
  /**
   * Doors: a sliding (patio) door, two glazed panels framed like window sashes, in two tracks and
   * overlapping at the middle. It has no swing (the swing is kept, not drawn); `sashes` and
   * `halfLite` do not apply, and the lite grid is per panel.
   */
  sliding?: boolean;
  /** Doors: hex colour `#rrggbb` of the leaf. Absent: the dark green of the house door. */
  leafColor?: string;
}

export interface Room {
  id: Id;
  name: string;
  anchor: Vec2;
  ceilingOverride?: Inches;
  /**
   * Absent: existing. The label shows only in the views that show its phase (derive/phase.ts
   * isVisible): a new room's name is hidden in the existing view, a demolished room's in the proposed one.
   */
  phase?: Phase;
  /**
   * Interior finishes (DESIGN.md "Interior finishes"): the faces of the walls on this room's side and
   * its floor. Absent: the walls keep their own finish and the floor its slab. A colour without a
   * finish is paint (walls) or a plain floor; `wallColor` of a check is the check's colour on white.
   */
  wallFinish?: RoomWallFinish;
  wallColor?: string;
  wainscot?: Wainscot;
  floorFinish?: FloorFinish;
  floorColor?: string;
}

export interface Stairs {
  id: Id;
  origin: Vec2; // middle of the bottom edge of the flight
  direction: Degrees; // plan angle of travel going up: 0 = +x, 90 = +y (down the screen)
  width: Inches;
  run: Inches; // horizontal length; the flight climbs to the next level's floor top
  phase: Phase;
  cutsFloorAbove: boolean;
  /**
   * Clear height kept between the treads and the floor above (default 80", STAIRS_HEADROOM): the
   * floor opening starts where the flight has climbed to floor-to-floor minus this.
   */
  headroom?: Inches;
  /** Where the floor opening starts, along the run from the bottom; overrides the headroom rule. */
  holeStart?: Inches;
  /**
   * Height of the bottom of the flight above the floor top (default 0): a flight that starts on a
   * landing. On the lowest level it may be negative: outdoor steps that go on down a slope.
   */
  base?: Inches;
  /** Height the flight climbs (default floor-to-floor minus base): a short flight up to a landing. */
  rise?: Inches;
  /** Number of risers (default round(rise / 7.5), at least 1): a landing is one riser with one deep tread. */
  risers?: number;
  /** Open stairs (outdoor steps): treads on two stringers, nothing under them. Absent: solid down to the floor. */
  open?: boolean;
  /**
   * Railings on the open sides, left and right as you climb (DESIGN.md "Stair railings"): a 36"
   * handrail over the nosings with newels and balusters. Absent (or no side true): none.
   */
  railings?: { left?: boolean; right?: boolean };
}

export type RoofShape = 'gable' | 'shed' | 'hip' | 'flat';
/** Corrugated metal, asphalt shingle, or standing-seam metal. */
export type RoofFinish = 'metal' | 'shingle' | 'seam';
/** How a roof's eaves are finished: a fascia board, or open with the rafter tails showing. */
export type RoofEave = 'fascia' | 'open';

/**
 * A roof over a plan outline (DESIGN.md "Roofs"). The underside passes through the bearing height
 * (the level's ceiling + bearingOffset) along the outline's eave edges and rises at `pitch` from
 * there; the overhang extends the outline on every side.
 */
export interface Roof {
  id: Id;
  shape: RoofShape;
  /** Plan polygon of the bearing walls' outside faces (snaps to walls). */
  outline: Vec2[];
  /** 0 = ridge runs along +x, 90 = along +y; for a shed: the direction the roof slopes down. */
  ridgeAngle: Degrees;
  /** Rise per 12 of run (8 for 8:12); hip and gable share one pitch. */
  pitch: number;
  /** Eave and rake overhang beyond the outline. */
  overhang: Inches;
  /** Bearing height above the level's ceiling (usually 0). */
  bearingOffset: Inches;
  /** Roof slab thickness, measured vertically. */
  thickness: Inches;
  /** Fascia (and rake) board depth. */
  fascia: Inches;
  phase: Phase;
  finish: RoofFinish;
  /** Hex colour `#rrggbb` of the roof surface. Absent: by finish (model/finish.ts). */
  color?: string;
  /**
   * Eaves: a fascia board (absent, as before) or open, with rafter tails under the overhang and no
   * board where the roof descends toward its edge (rake boards stay).
   */
  eave?: RoofEave;
  /** Open eaves: the rafter tails' depth and spacing on centre. Absent: 5.5" x 24". */
  rafter?: { depth: Inches; spacing: Inches };
  /** Hex colour `#rrggbb` of the fascia and rake boards and the rafter tails. Absent: tan trim. */
  boardColor?: string;
  /** Rust and streaking of a metal roof, 0 (none) to 1. Absent: 0.35. */
  weathering?: number;
}

/**
 * Kitchen casework and fixtures (DESIGN.md "Casework"): cabinets, the island, appliances, the sink
 * and a labelled generic box. Each is a plan rectangle standing on the level's floor (or at an
 * `elevation` above it for wall cabinets, the hood and the microwave).
 */
export type FixtureKind = 'base' | 'wall' | 'tall' | 'island' | 'range' | 'fridge' | 'dishwasher' | 'wallOven' | 'hood' | 'microwave' | 'sink' | 'box';
/** Cabinet door and drawer fronts: flat slabs, or a frame round a recessed panel. */
export type FrontStyle = 'slab' | 'panel';

export interface Fixture {
  id: Id;
  kind: FixtureKind;
  /** Middle of the BACK edge (the edge against the wall). */
  origin: Vec2;
  /** Plan angle the front faces: 0 = +x, 90 = +y (down the screen). */
  direction: Degrees;
  /** Along the back edge. */
  width: Inches;
  /** From the back to the front. */
  depth: Inches;
  height: Inches;
  /** Bottom above the level's floor top: 0 on the floor, 54 for a wall cabinet, 66 for a hood. */
  elevation: Inches;
  phase: Phase;
  /** Shown on the plan for a box (and on an appliance when set). */
  label?: string;
  /** Absent: the level's casework default, else slab. */
  frontStyle?: FrontStyle;
  /** Hex colour `#rrggbb` of the fronts. Absent: the level's cabinet colour, else off-white. */
  frontColor?: string;
  /**
   * Counter overhang past the carcass on each side (kinds with a counter: base, island, dishwasher,
   * sink). Absent: 1" at the front; an island 1" all round.
   */
  counterOverhang?: { front: Inches; back: Inches; left: Inches; right: Inches };
}

/** Per-level defaults for casework (DESIGN.md "Casework"); every field optional. */
export interface LevelFinishes {
  cabinetColor?: string;
  counterColor?: string;
  frontStyle?: FrontStyle;
}

/** A post or chimney on the site (M9 implements their behaviour). */
export interface Column {
  id: Id;
  at: Vec2;
  width: Inches;
  depth: Inches;
  rotation: Degrees;
  base: Inches;
  top: Inches;
  /** A flue is a round metal chimney pipe (a stove's): `width` is its diameter, `depth` is ignored. */
  kind: 'post' | 'chimney' | 'flue';
  phase: Phase;
  /** Hex colour `#rrggbb`. Absent: brick red for a chimney, tan for a post, stainless for a flue (model/finish.ts). */
  color?: string;
  /**
   * Chimneys: a 4" concrete cap at the top (2" proud all round) and a 12" wire spark arrestor above
   * it; flues: a rain cap, a disc twice the pipe's width a little above its top (DESIGN.md "Site and
   * terrain"). Ignored on a post.
   */
  cap?: boolean;
}

/**
 * An outdoor deck on a level (DESIGN.md "Decks"): boards over framing on posts down to the ground,
 * with a 36" railing along the edges that have one. Edges against a wall (any level's) carry no
 * posts: a ledger holds them.
 */
export interface Deck {
  id: Id;
  /** Plan polygon of the boards' outer edge (snaps to the outside wall faces). */
  outline: Vec2[];
  /** Top of the boards above the level's floor top; negative is below it (a step down). */
  elevation: Inches;
  /** One per outline edge (edge i runs from outline[i] to outline[i + 1]): a railing along it. */
  railings: boolean[];
  phase: Phase;
  /** Hex colour `#rrggbb` of the boards, framing and railing. Absent: weathered wood (model/finish.ts). */
  color?: string;
}

/**
 * A floor opening on a level (DESIGN.md "Floor openings"): a hole in the level's own floor, open to
 * the level below (a double-height hall, a stair well), with a 36" guard along the edges that have
 * one. Edges against a wall on the level need none, and the guard opens where a flight from the
 * level below arrives.
 */
export interface FloorOpening {
  id: Id;
  /** Plan polygon of the hole (snaps to the inside wall faces). */
  outline: Vec2[];
  /** One per outline edge (edge i runs from outline[i] to outline[i + 1]): a guard along it. */
  railings: boolean[];
  phase: Phase;
}

/** A spot elevation of the ground (M9). */
export interface GradePoint {
  id: Id;
  at: Vec2;
  elevation: Inches;
}

export interface Site {
  /** Degrees clockwise from the top of the plan to true north; 0 = north is up the screen. */
  northAngle: Degrees;
  gradePoints: Record<Id, GradePoint>;
  columns: Record<Id, Column>;
}

export interface Underlay {
  image: string; // data URL (JPEG, downscaled on import)
  pixelWidth: number;
  pixelHeight: number;
  origin: Vec2; // plan position of image pixel (0,0)
  scale: number; // inches per image pixel
  rotation: Degrees;
  opacity: number;
  locked: boolean;
}

export interface Level {
  id: Id;
  name: string;
  wallHeight: Inches; // floor top to underside of next floor; 96 or 108
  floorThickness: Inches; // the slab/framing under THIS level (~12 framed, 4 slab)
  nodes: Record<Id, Node>;
  walls: Record<Id, Wall>;
  openings: Record<Id, Opening>;
  rooms: Record<Id, Room>;
  stairs: Record<Id, Stairs>;
  roofs: Record<Id, Roof>;
  /** Casework and fixtures (schema version 3). */
  fixtures: Record<Id, Fixture>;
  /** Decks (schema version 4). */
  decks: Record<Id, Deck>;
  /** Floor openings, holes in this level's floor (schema version 5). */
  floorOpenings: Record<Id, FloorOpening>;
  finishes?: LevelFinishes;
  underlay?: Underlay;
}

export type MeasureTo = 'center' | 'inside' | 'outside';

export interface PlanSettings {
  snapGrid: Inches; // 1
  displayGrid: Inches; // 12
  precisionDenominator: 1 | 2 | 4 | 8 | 16;
  defaultExteriorThickness: Inches;
  defaultInteriorThickness: Inches;
}

/**
 * How the house looks after the work (DESIGN.md "The proposed look"): shown in the Proposed view
 * only, over every siding wall, roof and window, so a re-side, re-roof or new windows need no
 * redrawing. Every field optional; absent, the elements keep their own look.
 */
export interface ProposedLook {
  /** Exterior walls in a siding finish (shingle, shake, clapboard, board). */
  wallFinish?: WallFinish;
  wallColor?: string;
  roofFinish?: RoofFinish;
  roofColor?: string;
  /** Fascia, rake boards and rafter tails. */
  boardColor?: string;
  /** Window and door trim (casings and sills), and window sashes and door frames. */
  trimColor?: string;
  sashColor?: string;
  /** false takes the shutters off. */
  shutters?: boolean;
}

export interface Plan {
  schemaVersion: 5;
  id: Id;
  name: string;
  levelOrder: Id[]; // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings;
  site: Site;
  modifiedAt: string;
  proposedLook?: ProposedLook;
}
