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
export type WallFinish = 'clapboard' | 'shingle' | 'board' | 'block' | 'plain' | 'screen';
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
  /** Doors: hex colour `#rrggbb` of the leaf. Absent: the dark green of the house door. */
  leafColor?: string;
}

export interface Room {
  id: Id;
  name: string;
  anchor: Vec2;
  ceilingOverride?: Inches;
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
}

export type RoofShape = 'gable' | 'shed' | 'hip' | 'flat';
export type RoofFinish = 'metal' | 'shingle';
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

/** A post or chimney on the site (M9 implements their behaviour). */
export interface Column {
  id: Id;
  at: Vec2;
  width: Inches;
  depth: Inches;
  rotation: Degrees;
  base: Inches;
  top: Inches;
  kind: 'post' | 'chimney';
  phase: Phase;
  /** Hex colour `#rrggbb`. Absent: brick red for a chimney, tan for a post (model/finish.ts). */
  color?: string;
  /**
   * Chimneys: a 4" concrete cap at the top (2" proud all round) and a 12" wire spark arrestor above
   * it (DESIGN.md "Site and terrain"). Ignored on a post.
   */
  cap?: boolean;
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

export interface Plan {
  schemaVersion: 2;
  id: Id;
  name: string;
  levelOrder: Id[]; // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings;
  site: Site;
  modifiedAt: string;
}
