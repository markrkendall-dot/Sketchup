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

export interface Wall {
  id: Id;
  a: Id; // start node
  b: Id; // end node; a->b direction defines the wall's "left" (+normal) side
  thickness: Inches; // 4.5 interior, 6.5 exterior typical
  kind: WallKind;
  phase: Phase;
  heightOverride?: Inches; // defaults to level.wallHeight
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
  underlay?: Underlay;
}

export type MeasureTo = 'center' | 'inside' | 'outside';

export interface PlanSettings {
  snapGrid: Inches; // 1
  displayGrid: Inches; // 12
  precisionDenominator: 1 | 2 | 4 | 8 | 16;
  defaultExteriorThickness: Inches;
  defaultInteriorThickness: Inches;
  orthoLock: boolean;
  measureTo: MeasureTo; // what a typed wall length refers to
}

export interface Plan {
  schemaVersion: 1;
  id: Id;
  name: string;
  levelOrder: Id[]; // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings;
  modifiedAt: string;
}
