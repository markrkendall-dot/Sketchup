# HomePlan design notes

Floor-plan editor with auto-generated 3D, built for planning a house renovation and addition.
This document is the detailed design that the milestone plan refers to. Read it before touching
`src/model`, `src/derive` or `src/editor2d`.

## Stack

Vite, React 19, TypeScript, three + @react-three/fiber 9 + @react-three/drei 10, zustand 5 + immer +
zundo (undo/redo), nanoid, idb-keyval (autosave), vitest. No backend, no CSG library.

## Units and coordinates

- Every stored length is inches as a plain `number`. 1 ft = 12 in.
- Plan coordinates: x to the right, y down the screen (SVG convention).
- 3D maps plan `(x, y)` to three.js `(x, elevation, y)`, Y up. A polygon that is CCW on the
  y-down plan is CW seen from +Y, so `prism()` must normalize winding.

## Plan document (`src/model/types.ts`)

```ts
export type Id = string;
export type Inches = number;
export type Degrees = number;
export interface Vec2 { x: Inches; y: Inches }

export type Phase = 'existing' | 'demo' | 'new';
export type ViewMode = 'existing' | 'proposed' | 'all';
// existing view shows {existing, demo}; proposed shows {existing, new}; all shows everything, styled.
// Only All draws the phases (red demolished, green new): phase.ts shownPhase draws a demolished
// element as existing in the Existing view and a new one as existing in Proposed, on the plan
// (its phase-* class) and in 3D (every LevelMeshes/SiteMeshes entry carries the shown phase, so
// materials, see-through joins, shadows, room finishes and the export follow).

export interface Node { id: Id; x: Inches; y: Inches }

export interface Wall {
  id: Id;
  a: Id;                     // start node
  b: Id;                     // end node; a->b direction defines the wall's "left" (+normal) side
  thickness: Inches;         // 4.5 interior, 6.5 exterior typical
  kind: 'exterior' | 'interior';
  phase: Phase;
  heightOverride?: Inches;   // defaults to level.wallHeight
  finish?: 'clapboard' | 'shingle' | 'shake' | 'board' | 'block' | 'stone' | 'riverstone' | 'halflog' | 'plain' | 'screen'; color?: string; // see "Exterior appearance"
  bearing?: boolean;         // marked bearing or not; undefined = inferred (see "Structure")
  band?: { finish: WallFinish; color?: string; height: Inches }; // the outside face below height ("Exterior appearance")
}

export interface Opening {
  id: Id;
  wallId: Id;
  type: 'door' | 'window' | 'passage';
  offset: Inches;            // from wall.a along the centerline to the opening CENTER
  width: Inches;
  height: Inches;            // rough height of the hole
  sill: Inches;              // bottom of hole above floor top; 0 for doors
  phase: Phase;
  swing?: { hinge: 'a' | 'b'; side: 'left' | 'right' };
  lites?: { cols: number; rows: number }; shutters?: boolean; trim?: Inches; // see "Exterior appearance"
  sashes?: number;           // windows: 1..6 side by side; doors: 1 or 2 leaves
  fixedCenter?: boolean; glazing?: 'glass' | 'screen'; halfLite?: boolean; sliding?: boolean; leafColor?: string;
}

export interface Room {
  id: Id; name: string; anchor: Vec2; ceilingOverride?: Inches;
  phase?: Phase;             // default existing: the label shows only in the views that show its phase
  // Interior finishes (see "Interior finishes"); absent: the walls and slab show as they are.
  wallFinish?: 'paint' | 'boards' | 'pine' | 'check'; wallColor?: string;
  wainscot?: { height: Inches; finish: 'paint' | 'boards' | 'pine' | 'check'; color?: string };
  floorFinish?: 'plain' | 'boards' | 'tile' | 'parquet' | 'pine' | 'carpet'; floorColor?: string;
  proposedFloor?: { finish: FloorFinish; color?: string }; // an existing room's new floor, in the Proposed view
}

export interface Stairs {
  id: Id; origin: Vec2;      // middle of the bottom edge of the flight
  direction: Degrees;        // plan angle of travel going up: 0 = +x, 90 = +y (down the screen)
  width: Inches; run: Inches; // run = horizontal length; climbs to the next level's floor top
                             // (STAIRS_LIMITS: width 24" to 96", run 36" to 360", a one-riser step from 10")
  phase: Phase; cutsFloorAbove: boolean;
  headroom?: Inches;         // clear height the floor opening above keeps; default 80"
  holeStart?: Inches;        // where that opening starts along the run; overrides the headroom rule
  base?: Inches;             // bottom of the flight above the floor top; default 0 (a flight on a landing);
                             // negative only on the lowest level (outdoor steps on down a slope)
  rise?: Inches;             // height it climbs; default floorToFloor - base (a short flight to a landing)
  risers?: number;           // step count; default round(rise / 7.5"), at least 1 (a landing is 1)
  open?: boolean;            // outdoor steps: treads on two stringers, nothing under them
  railings?: { left?: boolean; right?: boolean; end?: boolean }; // as you climb; only true sides stored
                             // (see "Stair railings"); end: a landing's far edge
  staircaseId?: Id;          // the staircase it belongs to (schema 6, see "Staircases")
}

// A stairway's pieces grouped (schema 6): selected, moved and styled together. No member list (the
// pieces name it) and no phase (its pieces'). Style fields optional; defaults in model/stairStyle.ts.
export interface Staircase {
  id: Id; name?: string;
  treadColor?: string; riserColor?: string; nosing?: Inches; treadThickness?: Inches;
  stringer?: 'closed' | 'open'; underside?: 'solid' | 'framed' | 'open';
  newel?: 'box' | 'square'; handrail?: 'round' | 'board'; handrailHeight?: Inches;
  balusterGap?: Inches; startStep?: 'square' | 'bullnose';
}

export interface Underlay {
  image: string;             // data URL (JPEG, downscaled on import)
  pixelWidth: number; pixelHeight: number;
  origin: Vec2;              // plan position of image pixel (0,0)
  scale: number;             // inches per image pixel
  rotation: Degrees; opacity: number; locked: boolean;
}

export type RoofShape = 'gable' | 'shed' | 'hip' | 'flat';
export interface Roof {
  id: Id; shape: RoofShape;
  outline: Vec2[];           // plan polygon of the bearing walls' outside faces
  ridgeAngle: Degrees;       // 0 = ridge along +x, 90 = along +y; shed: the direction it slopes down
  pitch: number;             // rise per 12
  overhang: Inches;          // beyond the outline on every side (eaves and rakes)
  bearingOffset: Inches;     // bearing height above the level's ceiling (usually 0)
  thickness: Inches;         // slab thickness, measured vertically
  fascia: Inches;            // fascia and rake board depth
  phase: Phase; finish: 'metal' | 'shingle'; color?: string;
  eave?: 'fascia' | 'open';  // open: rafter tails, no eave board (see "Roofs")
  rafter?: { depth: Inches; spacing: Inches }; boardColor?: string; weathering?: number; // see "Exterior appearance"
}

// Casework (schema version 3, see "Casework"): a cabinet, appliance or sink as a plan rectangle.
export type FixtureKind = 'base' | 'wall' | 'tall' | 'island' | 'range' | 'fridge' | 'dishwasher' | 'wallOven' | 'hood' | 'microwave' | 'sink' | 'box';
export interface Fixture {
  id: Id; kind: FixtureKind;
  origin: Vec2;              // middle of the BACK edge (against the wall)
  direction: Degrees;        // the way the front faces: 0 = +x, 90 = +y
  width: Inches; depth: Inches; height: Inches;
  elevation: Inches;         // bottom above the floor top (54 wall cabinet, 66 hood)
  phase: Phase; label?: string;
  frontStyle?: 'slab' | 'panel'; frontColor?: string;            // else the level's finishes
  counterOverhang?: { front: Inches; back: Inches; left: Inches; right: Inches }; // else 1" front (island: all round)
}
export interface LevelFinishes { cabinetColor?: string; counterColor?: string; frontStyle?: 'slab' | 'panel' }

// Decks (schema version 4, see "Decks"): boards over framing on posts, a 36" railing per edge.
export interface Deck {
  id: Id;
  outline: Vec2[];           // the boards' outer edge (snaps to the outside wall faces)
  elevation: Inches;         // boards' top above the level's floor top; negative is below it
  railings: boolean[];       // one per outline edge (outline[i] -> outline[i + 1])
  phase: Phase; color?: string;
}

// Floor openings (schema version 5, see "Floor openings"): a hole in the level's own floor.
export interface FloorOpening {
  id: Id;
  outline: Vec2[];           // the hole (snaps to the wall faces)
  railings: boolean[];       // one guard flag per outline edge (outline[i] -> outline[i + 1])
  phase: Phase;
}

export interface Level {
  id: Id; name: string;
  wallHeight: Inches;        // floor top to underside of next floor; 96 or 108
  floorThickness: Inches;    // the slab/framing under THIS level (~12 framed, 4 slab)
  nodes: Record<Id, Node>; walls: Record<Id, Wall>; openings: Record<Id, Opening>;
  rooms: Record<Id, Room>; stairs: Record<Id, Stairs>; roofs: Record<Id, Roof>;
  fixtures: Record<Id, Fixture>; decks: Record<Id, Deck>; floorOpenings: Record<Id, FloorOpening>;
  staircases: Record<Id, Staircase>;
  finishes?: LevelFinishes; underlay?: Underlay;
}

// The site (see "Site and terrain"; the file carries it from schema version 2).
export interface GradePoint { id: Id; at: Vec2; elevation: Inches }   // elevation: absolute, like floor tops
export interface Column {
  id: Id; at: Vec2; width: Inches; depth: Inches; rotation: Degrees; // plan rectangle, turned clockwise
  base: Inches; top: Inches;                                         // absolute elevations
  kind: 'post' | 'chimney' | 'flue' | 'pier'; phase: Phase;   // a flue is round: width is its diameter
  color?: string; cap?: boolean;                                     // see "Site and terrain"
}
// Schema 8: flat-material patches draped on the ground, and split-rail fences standing on it.
export type SurfaceMaterial = 'gravel' | 'asphalt' | 'concrete' | 'stone';
export interface SiteSurface {
  id: Id; outline: Vec2[];                                           // >= 3 points, not crossing itself
  material: SurfaceMaterial; phase: Phase; color?: string;           // see "Site and terrain"
}
export interface Fence {
  id: Id; points: Vec2[];                                            // >= 2 points, an open polyline
  height: Inches;                                                    // posts' top above the ground (42)
  rails: number;                                                     // whole, 1..4 (2)
  postSpacing: Inches;                                               // most room between posts, >= 24 (120)
  phase: Phase; color?: string;
}
export interface Site {
  northAngle: Degrees;      // degrees clockwise from the top of the plan to true north
  gradePoints: Record<Id, GradePoint>; columns: Record<Id, Column>;
  surfaces: Record<Id, SiteSurface>; fences: Record<Id, Fence>;     // schema 8
}

export interface PlanSettings {
  snapGrid: Inches;          // 1
  displayGrid: Inches;       // 12
  precisionDenominator: 1 | 2 | 4 | 8 | 16;
  defaultExteriorThickness: Inches; defaultInteriorThickness: Inches;
}
// Ortho lock and "Lengths to" (center | inside | outside, what a typed wall length refers to) are
// editor preferences, not plan data: they live in uiStore, persist in localStorage and never enter
// undo. migrate() ignores them in older files.

export interface Plan {
  schemaVersion: 8; id: Id; name: string;
  levelOrder: Id[];          // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings; site: Site; modifiedAt: string;
  proposedLook?: ProposedLook; // the siding, roof and windows after the work (see "The proposed look")
}
```

Elevation rule: `floorTop[0] = baseFloorElevation`; `floorTop[i] = floorTop[i-1] + wallHeight[i-1] +
floorThickness[i]`. Walls on level i span `floorTop[i] .. floorTop[i] + wallHeight`. The slab of level
i spans `floorTop[i] - floorThickness[i] .. floorTop[i]`.

Records keyed by id, edited through immer, so untouched entities keep object identity. All memoization
in `derive/` depends on that.

## Walls are a graph

Walls reference shared nodes. Invariant enforced by `normalize()` after every structural edit:
the level is a planar straight-line graph, no node lies in the interior of a wall, no two nodes are
within `MERGE_EPS = 0.5"`. Steps: merge close nodes (rewrite references, drop a===b walls); for every
node and every non-incident wall, if the node projects onto the wall interior within MERGE_EPS, split
that wall at the node (new walls inherit thickness/kind/phase; openings reassigned by offset and
clamped). Two walls that cross strictly inside both (farther than MERGE_EPS from every end, not
parallel, no shared node) get a node at the crossing, which the same pass then splits both at, so
an X becomes four walls at one node. One change per pass; the pass count is bounded by the level
size, and a crossing that lands on an existing node is skipped rather than retried.
Walls that never stand together (`phasesCoexist`: a new wall and a demolished one) are the one
exception: they cross, or one ends on the other, without a node, so drawing new work across a wall
the design takes out leaves that wall, and its doors and windows, as they are in the house as it
stands (the crossing pass skips such pairs; a node splits a wall only if a wall standing with it
touches the node, or none does, as at a fresh crossing node). The Existing and Proposed views never
show both. The All view does, and `computeFaceGeometry` (derive/rooms.ts `planarCuts`) cuts such
walls where they cross (a virtual node `~demoId|newId`) or meet at a T before tracing faces, each
edge keeping its wall and whether it runs the wall's way (`Face.wallForward`, which the side
lookups use); their footprints just overlap there. Changing a wall's phase (`setPhase`,
`updateWalls`) runs `normalize()` again, so a demolished wall kept as existing is split where a new
wall meets it.
Simple graph, not multigraph: at most one wall between two nodes. When two walls end up between
the same nodes (the duplicate drop, and a split whose piece already exists), the survivor is the
`existing` one over `new`/`demo`, then the one with openings, then the one that was there first;
the other's openings move onto it.

Walls never lie on top of each other: `addWall` refuses a segment that overlaps a wall of the level
(any phase; hidden demolished walls are still there) collinearly by more than MERGE_EPS
(`collinearOverlap`: both ends of one segment within MERGE_EPS of the other's line and their
intervals overlapping; touching end to end, crossing and T joins are fine), returns null and sets
the draft message "A wall is already there. Select it and Mark demolish, or draw the new wall
beside it." `copyWallsFromLevel` skips such walls (it returns `{copied, skipped}`, the level bar
reports the skipped count), and `moveNode(s)` / `setWallLength` refuse a step that would create a
new overlap (the select tool keeps the nodes at the last accepted position and shows the message;
its drag starts the undo step on the first step that changes the plan).

## Corner joins (`derive/footprint.ts`)

For wall a->b with unit direction d and left normal n = perpLeft(d) = (d.y, -d.x) (walking a->b on
the y-down screen, left is on your left), the left offset line is `a + n*t/2 -> b + n*t/2`.
`getFootprints(level, viewMode)` only uses walls visible in the view mode (hidden walls get no
footprint and do not shape corners). At each node, sort incident walls by outgoing angle (atan2
ascending, clockwise on screen). The corner of each sector between consecutive walls is the
intersection of the first wall's right edge and the next wall's left edge; it is computed once per
node and shared, so neighbours get bit-identical points. Fallbacks: degree 1 -> square cap; an
opposite collinear pair (|cross| < 1e-6) is a "through" pair (a wall split by a T, or the thicker pair
of an X): both halves are square capped and every other wall at the node lands its corners on their
face lines; other collinear neighbours -> square cap; an outer (reflex) miter longer than
`1.5 * max(t, t_neighbour)` -> bevel at that length, with the bevel midpoint as an extra outline vertex
shared by both walls. At degree >= 3 nodes without a through pair (a Y) the cap of each wall also
runs through the node, so the hub is covered. Output per wall: `quad: [leftA, leftB, rightB, rightA]`
(where the long edges end), `poly` (the fill outline: the quad plus any bevel/hub vertices), `edge`
(stroke extents: as the quad, but trimmed where a butt wall meets the face) and the core interval
`s0 = max(0, proj(edge leftA), proj(edge rightA))`, `s1 = min(L, proj(edge leftB), proj(edge rightB))`.
Openings are clamped to `[s0 + w/2, s1 - w/2]`, using the intersection of the intervals over the
views (existing, proposed) in which the opening shows; jamb distances in the UI are measured from
s0/s1 (the inside face of the corner, what a tape measure gives).

2D stroke trick: fill the outline, stroke only the long edges plus end caps at open ends and bevels,
so a through wall split by a T shows no seam. Same-style walls are drawn as one fill path (consistent
winding) and one outline path (segments chained into polylines): separate shapes meeting edge to edge
always leave an anti-aliasing seam.

## Rooms (`derive/rooms.ts`)

Planar face enumeration: two half-edges per wall, sort outgoing half-edges by atan2 at each node,
trace faces by stepping to the next half-edge clockwise from the twin (in the y-up/math sense: the
previous one in ascending-atan2 order on the y-down plan). Bounded faces then come out clockwise on
screen with positive `polygonSignedArea`, interior on the right of each half-edge. Discard the outer
face of each component (negative signed area; pinned by a one-rectangle test in rooms.test.ts, kept
as `outerFaces` for slabs) and faces under 1 sq ft. Remove spike pairs `p, q, p` from dangling walls. A Room's anchor
is point-in-polygon tested against faces; the containing face gets the name. Rooms whose anchor is in
no face render at the anchor in a warning colour. Net area: offset each edge inward by half the
bounding wall thickness; fall back to centerline area if the offset polygon self-intersects.
Detection runs on the walls visible in the current ViewMode, and labelling on the rooms visible in
it: a room's optional `phase` (absent: existing) hides its label where `isVisible(phase, viewMode)`
is false, so a new room's name names no face and is no orphan in the Existing view, and a
demolished room's disappears in Proposed. Everything that reads the labelled faces follows (the
labels, their hit testing, the plan export, the walk start, the room panel); the room panel has a
"Phase" select and "Mark demolish" (`setPhase`) takes room labels too (existing is stored as no
phase).

**Label point** (REVIEW-2 C1): the room's anchor when it lies inside the face's net polygon (a label
dragged by hand stays where it was put), else the net polygon's pole of inaccessibility
(`derive/polylabel.ts`, the Mapbox polylabel cell search: square cells queued by the best distance
they could hold, split until no cell can beat the best centre by more than 1", at most 200 cells),
so an L-shaped room is labelled in the middle of its fatter arm, not on the concave corner. The pole
is cached per traced face, so a room edit does not search again. `faceAt` and the orphan rules are
unchanged (anchors are tested against the centerline polygon).

**Label clutter** (C2, `PlanLayers.tsx`, `editor2d/roomLabels.ts`): a wall shorter than 48" that
bounds a face under 60 sq ft net has no dimension label (a closet's partitions; any such face, since
a closet partition also bounds the room next door). A room name longer than 18 characters, or wider
on screen than its room (`nameWrapFor`), wraps onto two `<tspan>` lines (`roomNameLines`: before a
parenthesis when both parts fit, else at the last space that fits); the area stays the line below,
and the label's hit box grows by the extra line.

## Openings in 3D (`derive/meshes.ts`)

No CSG. `prism(polygon, y0, y1, holes?, opts?)` triangulates the cap with `ShapeUtils.triangulateShape`,
emits side quads, uses flat per-face normals (non-indexed); it normalizes winding itself (outer ring
positive, holes negative, each cap triangle oriented by its own area), and `opts` can drop the top,
the bottom or individual side faces. A wall is split along its direction into spans at every jamb:
start region (keeps the footprint's corner and cap points), solid gaps, under-sill and header per
opening, end region; each span's piece is the footprint `poly` clipped by half-planes perpendicular to
the wall (`clipHalfPlane`; if a cut line crosses the poly more than twice, the quad is clipped
instead). Then:

- Only faces on the outside of the union are emitted. Coincident internal faces (a wall's mitre or
  butt end at a join, the cut between two pieces) win the depth test along the seam and show as
  hairlines. A join face is internal up to the lowest same-class neighbour at that node (a
  translucent demolished wall does not hide an opaque wall's join, and vice versa); the stretch of a
  through wall's face under a butt wall is internal up to the butt walls' height.
- Every wall on a level is cut into the same horizontal bands (all visible sills and heads, all wall
  heights), and neighbours' corners that land on an outline edge are inserted as vertices, so
  adjacent faces always share vertices: no T-junctions to crack. The walls of a level together form a
  closed, consistently wound surface (tested).
- Floor slab: each outer face polygon (reversed, positive), pushed out by half of each edge's wall
  thickness to the exterior faces (`outerFaceThickness` from rooms.ts), with holes for stairs on the
  level below that have `cutsFloorAbove` (only holes that fit strictly inside). A hole is only the
  part of the flight where headroom is short (`stairsHoleOutline(stairs, floorToFloor, ceiling)`,
  `ceiling` the level's wall height: the underside of the floor above). Headroom is measured as the
  code measures it (R318.7.2), from the line of the nosings: one riser `r` over the bottom of each
  tread's run, `base + r + climb * d / run` at distance d up the run (`base` default 0, `climb` the
  flight's, `risers * r`), so the hole runs from
  `d0 = holeStart ?? run * (ceiling - headroom - base - r) / climb`, clamped to [0, run] (headroom
  default 80"), to the top of the run, none when that is under 1"; a flight whose top is itself
  `headroom` under the ceiling (two risers up to a landing, the landing) cuts nothing. (Until the
  stair checks it was measured from the treads' line to the floor top above, which left a default
  stair about 5' of headroom at the hole's edge.) The starter's old stair (108" floor to floor, 14
  risers, 101" run, 96" ceiling) opens from 7 3/4" up, so the closet over its low end keeps its
  floor; a flight from a 14" landing climbing 94" in 13 risers has its first nosing 74.8" under a
  96" ceiling and opens from its bottom. The 2D view of the level above draws the same opening
  (dashed, with an X and the treads under it), and the stair panel has "Floor opening starts"
  (blank follows the rule, shown as the placeholder) and "Headroom". Outer faces nested in
  another component are skipped. If a level has no closed outer face, draw no slab. Where the walls
  of the level below run up through the slab, the edge stops at their inside face instead (see
  "Platform framing").
- Stairs: one solid, the stepped side profile extruded across the width, per flight
  (`buildStairsGeometry(stairs, rise, risers, base, open)`): `risers` = the flight's override, else
  round(rise / 7.5"), at least 1; the first step `base` + one riser up, the last at `base + rise`
  (flush with the floor above by default). The profile is solid from the floor up (from its base
  when that is below the floor), so a flight that starts on a landing has a block under it, not a
  void, and a one-riser landing is a box. An `open` flight (outdoor steps) is treads on stringers
  instead: each tread 1.5" thick between the stringers, and two 1.5" stringers 9.25" deep (square
  to their slope) under the line from the bottom of the flight to its top, their feet cut level
  with the bottom, nothing under them; the open steps of a deck stand on the deck's landing and
  posts. In 2D a flight draws its own riser count; a landing draws its outline only (no treads, no
  UP arrow). `addStairs` / `updateStairs` refuse a base below 0 (on the lowest level down to 600"
  below the floor: outdoor steps that go on down a slope past it; `migrate` drops it elsewhere), a
  climb not above 0, a top more than 1" above the floor above, or risers that are not a whole
  number from 1 to 100; the panel has "Starts at" (negative allowed on the lowest level), "Climbs"
  and "Risers" (blank follows the defaults, shown as placeholders), "Open" and the railings.
- Stair railings (`buildStairsRailingGeometry(stairs, rise, risers, base)`, `STAIR_RAIL`): on each
  side `railings` names (left and right as you climb; `stairsRailingsOf` keeps only the true ones,
  in the store and in `migrate`), inside the flight's width and flush with its side: a 3.5" newel
  standing on the first tread and one on the last, a 3.5" x 1.5" handrail between their faces
  whose top is 36" over the line of the nosings (the steps' front edges, `base + rise + d * rise /
  tread`; level over a one-riser landing), and 1.5" balusters spaced evenly between the newels with
  at most 4" between them, each from the tread under it to the rail's underside. One geometry per
  flight, cached with the flight's own (`StairsMesh.railing`), in `railingMaterial` like a floor
  opening's guard; exported as `Stair railing`. On the plan a railed side has a heavier line half
  a newel in from it (`stairsSymbol(...).rails`).

`getLevelMeshes(plan, levelId, viewMode)` memoizes per level and view mode, reuses each wall's
geometry while its footprint object, wall, openings list, height and context (bands, neighbour
heights, split points) are unchanged, and disposes geometry that drops out of the cache.

## Roofs (`derive/roofs.ts`)

A roof is a set of planes over its plan outline, each passing through the bearing height along an
eave line and rising at `pitch / 12` per inch from it. The bearing height is level-local:
`wallHeight + bearingOffset` (the level's ceiling). The outline is meant to be the bearing walls'
outside faces (the roof tool snaps to them), so the eave line, where the underside meets the plate,
is the outside face of the eave walls and the overhang hangs lower by `overhang * pitch / 12`.

- Ridge frame: `u` = the ridgeAngle direction, `v` across it; `umin..umax`, `vmin..vmax` are the
  outline's extents in that frame.
- Gable: two planes at the bearing height on `v = vmin` and `v = vmax`, meeting at the ridge through
  the middle. Shed: one plane at the bearing height on `u = umax`, rising against `u` (it slopes down
  in the ridgeAngle direction). Hip: the gable's planes plus one on `u = umin` and one on `u = umax`,
  over the outline's bounding rectangle in the ridge frame (the panel says so). Flat, or pitch 0:
  one level plane.
- The underside at a point is the lowest of the planes there (`roofHeightAt`, null outside the
  overhang outline): for convex roofs the planes' lower envelope is the roof. Splitting the overhang
  outline by the half-planes where each plane is the lowest gives one region per plane; region
  edges inside the outline are the ridge and hip lines.
- The solid: each region from its plane up `thickness` (vertically), vertical faces round the
  overhang outline and none along ridge or hip lines, so the slab is one closed surface. Boards 1.5"
  proud of every edge, top flush with the roof's top, `fascia` deep: level stretches (eaves) are
  fascia boards that run on past a convex corner to cover it, sloped stretches are rake boards; at a
  reflex corner the incoming board stops short so boards never overlap. Each board is closed. No CSG;
  roofs that overlap (a wing roof running into the main wall) just overlap.
- Open eaves (`eave: 'open'`; absent is `fascia`, so older files look the same): a level stretch the
  roof descends toward (its plane's gradient points away from the edge) gets no board and has rafter
  tails under it instead; a shed's high edge and every edge of a flat roof keep their boards, and
  rake boards stay. Tails (`rafterTails`) are 1.5" boxes every `rafter.spacing` (default 24")
  measured along the overhang outline edge from its start, the first half a spacing in, kept when
  the centre falls in the stretch (318" of eave gives 13). Each runs square to the edge from 1" inside
  it back to the outline (none when the overhang is 1" or less), its top on the region's plane (the
  slab's underside) and its bottom `rafter.depth` (default 5.5") lower, and is clipped by the same
  half-planes as `roofRegions`, so a tail near a hip stays under its own slope. `RoofSolid.rafters`
  holds one closed solid per tail.
- Ridge cap, metal gable and hip roofs only (`ridgeCap`): in each region a 6" band (in plan) along
  every run of its ridge and hip lines, from the roof's top surface up 2.5", so it follows the slope
  on each side. Its inner edge is each line moved 6" into the region: mitred where two lines meet,
  cut along the outline where a line reaches it. The faces along the lines are left out, so the bands
  of all regions are one closed surface (`RoofSolid.ridge`). `buildRoofGeometry` (slab and boards)
  leaves the tails and the cap out; `buildRoofParts` merges the cap into the slab geometry and returns
  `{ slab, fascia, rafters }`.
- `roofs.ts` has no three.js import (it is in the 2D editor's chunk); it returns position arrays,
  triangulating with its own ear clipping, and `meshes.ts` wraps them (`buildRoofGeometry`).

Walls follow the roof (`wallRoofProfile`, used by `buildWallGeometry`): an exterior wall is covered by
a visible roof on its level when the middle of its centerline is strictly inside the roof's outline.
Its top is then `max(wall height, lowest covering roof's underside)`, sampled along the wall's
outside face (the face nearer the outline's edge): on a gable end that is constant across the wall,
on an eave wall it is the plate, so eave walls are unchanged; the high wall of a shed rises level to
the roof at its outside face. The profile is piecewise linear in the position along the wall, with
stations at the outline ends and at every bend (ridge and hip crossings, and where the roof rises
above the plate). The wall's spans are cut at the stations, each raised piece gets a part above the
wall height with a sloped top (a prism between two height fields), and the band below it loses its
top cap; faces between raised pieces, and the join face to a collinear neighbour raised by the same
roof (same thickness and class), are internal. The level's walls stay one closed surface with a roof
present (tested). Openings keep their heights and are still clamped to the wall height. Interior
walls are not raised (an attic over a flat ceiling).

Phase and view mode apply like walls: a roof hidden in the view is not drawn, not exported and does
not raise walls. `getLevelMeshes` caches each roof's geometries (slab with cap, boards, tails) per
roof object and bearing height, and disposes all three when they drop out.

2D: the outline dashed, the overhang outline lighter, ridge and hip lines thin and solid; demolished
roofs hatched red, new ones green; a selected roof shows corner handles that the select tool drags
(snapping like the roof tool, one undo step per drag). The level below's roofs show as a faint ghost.
Roof tool (K): click corners, snapping to wall outline corners (footprint fill points), then nodes,
then points on wall faces, then the usual snaps; where two exterior face lines meet just past the
end of one (the house corner under a porch whose wall continues the end wall) is a corner too.
Close on the first corner, a double-click or Enter. Defaults: gable, ridge along the longer side of
the bounding box, 8:12, 24" overhang, 8" thick, 6" fascia, metal, the toolbar's "Draw as" phase;
fascia eaves and tan boards (none of the optional fields). "Fit to walls" in the panel sets the
outline to the level's outer-face polygon when the walls close exactly one ring. The panel also has
"Eaves" (fascia board, or open with rafter tails), "Rafter depth" and "Rafter spacing" (open eaves
only; at least 3", and the default 5.5" x 24" is stored as no field), "Board colour" with a reset to
tan, and for metal "Weathering" (0 to 1). The store refuses unusable values of these fields
(`roofOptionProblem`).

## Decks (`derive/decks.ts`, `tools/deckTool.ts`)

A deck belongs to a level and is a plan outline with the boards' top `elevation` above the level's
floor top (negative: a step down) and one railing flag per edge. `derive/decks.ts` is pure (no
three): `getDeckLayout(plan, levelId, deckId, viewMode)` gives everything the plan, the 3D meshes and
the panel draw, level-local, in inches (`DECK`):

- **Supported edges** (`deckSupportedEdges`): the point 1" outside an edge's middle lies in the
  footprint of a wall on *any* level, visible in the view and able to be seen with the deck
  (`phasesCoexist`), whose height (slab bottom to its top, run-through included) overlaps the
  framing. A ledger carries the deck there: no posts and, for a new deck, no railing. So a
  retaining wall on the Basement carries a First Floor deck whose top is at the wall's top.
- **Boards** over the whole outline, 1.5" thick; on the plan, joints every 6" parallel to the
  longest edge (`scanSegments`, which handles concave outlines).
- **Framing**: a 1.5" rim, 9.25" deep, inset 1" on free edges (the boards overhang it), and 1.5"
  joists every 16" square to the boards.
- **Posts**: 5.5" square on the free edges only, at a corner between two free edges and evenly
  between so none is more than 96" from the next support, 5.75" in from the edges, from 6" into the
  ground (`groundAt`, minus the level's floor top) up to the framing; none where the ground is
  within an inch of the framing.
- **Stair openings** (`deckStairOpenings`): a flight on any level, visible and able to be seen with
  the deck, whose top is 0 to 8" below (or up to 1" above) the boards and whose two top corners lie
  within 1" of an edge, cuts the railing over its width. The deck's edge is then the flight's last
  riser.
- **Railings** on the flagged edges, less the openings (runs under 3.5" dropped): 36" high, 3.5"
  posts at the run ends and at most 72" apart (one post at a corner shared by two railed runs,
  placed by the run it starts), a 3.5" x 1.5" cap whose ends are mitred at shared corners, a 3.5" x
  1.5" bottom rail 3" up between the posts, and 1.5" balusters with at most 4" clear between any two
  parts.
- **Edge drops**: per edge, the most the boards stand over the ground 1" outside it (sampled every
  12"); the panel warns about an unsupported, unrailed edge more than 30" up.

The layout is memoized by plan identity and, on a new plan, by a signature of everything it is built
from (outline, top, railings, supports, openings, the ground under each post and outside each edge),
so an unrelated edit returns the same object, while a grade point, a wall or flight on another level,
a level height or the view mode builds a new one; phase and colour are not part of it.

The deck tool (J) is the roof tool's outline drawing (`tools/outlineTool.ts makeOutlineTool`, shared
with the roof tool): corners snap to the outside wall faces; it adds the deck at `DECK.defaultElevation`
(-6) with a railing on every edge `deckSupportedEdges` does not support, in the "Draw as" phase, and
selects it. The select tool picks a deck after fixtures and stairs and before roofs (inside the
outline or within 2 px of it), and drags a selected deck's corners like a roof's (`outline-vertex`),
refusing a step that would make the outline cross itself. The panel (`DeckProps`) has the top, one
railing checkbox per edge named by the way it faces (`compassName`, true north applied) with its length
and height over the ground (or "against a wall"), Reset railings, the colour (default weathered wood
`#9c7650`), the phase, and the outline's size, area, posts and stair openings. The store's
`addDeck`/`updateDeck` refuse what `deckProblem` refuses (under 3 points or no area, a top more than
600" from the floor, railings not one per edge, a bad colour) and fit the railings to the outline
(`normalizeRailings`: missing flags on, extra ones dropped), so moving a corner keeps them and a new
edge gets one.

On the plan (`PlanLayers.tsx DecksLayer`, over the room fills and stair holes, under the roofs) a deck
is its outline filled light wood with the board joints, the railing caps as bands (open at a stair),
the posts as small dashed squares and a "Deck" label with its top against the floor, in phase colours
like a roof. In 3D, `getDeckMeshes(plan, levelId, viewMode)` (kept apart from `getLevelMeshes`, whose
cache does not watch the site or other levels) gives per deck the boards, the framing with the posts,
and the railing, each one buffer of concatenated prisms, rebuilt only when the deck's layout object
changes and the same array while nothing changed; `deckMaterial` paints them in the deck's colour
(framing 20% darker; demolished translucent red, new pulled toward green).

## Floor openings (`derive/floorOpenings.ts`, `tools/floorOpeningTool.ts`)

A floor opening belongs to the level whose floor it cuts (a double-height hall over the level below,
a stair well drawn by hand) and is a plan outline with one guard flag per edge. It shares the deck's
code (`derive/decks.ts`): `getFloorOpeningLayout(plan, levelId, openingId, viewMode)` gives, level-local:

- **Supported edges** (`floorOpeningSupportedEdges`): the point 1" outside an edge's middle (on the
  floor side) lies in the footprint of a wall on the opening's own level, visible and able to be
  seen with it. A wall is the guard there.
- **Stair arrivals**: `deckStairOpenings` with the floor's top as the boards' top, so a flight from
  the level below whose top is up to 8" under the floor and whose top corners lie on an edge opens
  the guard over its width; the floor's edge is then its last riser.
- **The guard**: `railingParts(outline, runs, 0, -1)`, the deck's railing (36", posts at most 72"
  apart, cap, bottom rail, balusters with at most 4" clear) standing on the floor just outside the
  hole, on the flagged edges that no wall runs along, less the stair arrivals.

The hole in the slab is the outline moved in by 1/4" (`FLOOR_OPENING_HOLE_INSET`, `floorOpeningHole`),
so an opening drawn flush to the inside faces of the walls below still lies strictly inside the
slab outline (`holeFits` refuses a hole that touches it). `getLevelMeshes` passes the level's own
floor openings to `buildFloorGeometry` before the stair holes from the level below, so a stair
hole inside an opening is dropped (the opening covers it); the floor finishes subtract the same
holes, and the floor cache watches `level.floorOpenings`. `getFloorOpeningMeshes` gives the guards,
cached like the decks (they depend on the level's walls and the stairs below), painted with
`railingMaterial` (stained wood `#8a5a34`, `RAILING_COLOR`). On the plan (`FloorOpeningsLayer`,
over the room fills, under the decks) an opening is its dashed outline with an X, the usual "open to
below" mark, the guard's caps as bands and an "Open to below" label, in phase colours. The tool (H)
is the outline tool (`makeOutlineTool`) with a guard on every edge no wall runs along; the select
tool picks an opening after decks and before roofs and drags its corners like a deck's; the panel
(`FloorOpeningProps`) has one guard checkbox per edge (disabled along a wall), Reset guards, the
phase, the outline's size and the stair arrivals. The store's `addFloorOpening`/`updateFloorOpening`
refuse what `floorOpeningProblem` refuses (under 3 points or no area, railings not one per edge).
A room's area does not subtract the opening, as it does not subtract a stair hole.

## Platform framing (`derive/platform.ts`)

The exterior walls of a level run up through the floor slab of the level above, and that slab stops
at their inside face, so the siding is continuous from one storey to the next (without it a band of
bare slab edge shows between the shingles and the clapboard).

- **`wallExtensions(plan, levelId, viewMode)`**: for each visible exterior wall of the level, the
  floor thickness of the level above, when the middle of the wall's centerline lies on, or inside,
  an outer outline (`FaceSet.outerFaces`, the centerline polygon of a component) of the level above,
  within 1" (that level has a slab there for the wall to run through). A wing or porch the level above
  does not cover, interior walls, the top level and levels whose upper neighbour has no closed outer
  face get nothing. Memoized per level object and per upper `outerFaces`.
- **Walls**: in `getLevelMeshes` the wall's height is `heightOverride ?? wallHeight` plus its
  extension (`topOf`), for the bands, the join heights, the roof profile base and the built geometry.
  `wallRoofProfile` takes the extended height as its base, so a roof on the level still bears at
  `wallHeight + bearingOffset` and only the flat part of the top is raised: the profile is
  `max(extended height, roof underside)`. Openings are still clamped to the level's wall height
  (`WallContext.openingTop`, `wallSpans`' `openingTop`), and the opening fills use the unextended
  height. The top level's walls get nothing, so roofs on the top level are unaffected.
- **Slabs**: `slabInsets(plan, levelId, viewMode)` gives, per outer-face edge of the level, half the
  thickness of the extended wall below whose centerline coincides with the edge (parallel, midpoint
  within 1"), 0 where none does. `slabOutlines(faces, toWallFaces, inside)` takes it as `inside`
  (`true` insets every edge by half its own wall's thickness; an array gives the distances per face
  and edge; 0 keeps the edge on the outside face, as for a wing built on its own slab). The slab
  edge therefore meets the inside face of the wall below exactly: no overlap and no coplanar caps
  (a basement wall thicker than the wall above leaves a ledge on top, which is the point of a
  foundation). The floor cache also depends on the insets, and `levelCache` entries on the level
  above and below.

## Site and terrain (`derive/site.ts`, `editor2d/tools/siteTools.ts`)

The plan's `site` holds the ground (grade points: spot elevations), the columns (chimney, posts, flues), the
ground surfaces (gravel, asphalt, concrete, stone), the fences and the north angle. None of it belongs to a
level.

**Terrain** (`site.ts`, pure, position arrays like `roofs.ts`; `meshes.ts` wraps them). `terrainHeightAt`
is the triangulated surface through the grade points (a TIN): `delaunay` (Bowyer-Watson in a super
triangle 100 times the points' extent, a point within 1" of another left out, triangles touching the
super triangle dropped) is made once per grade-point record, the height inside a triangle is linear
between its three corners, and beyond the hull (the edges only one triangle uses) it is the hull's
height at the nearest point of its edge, so the ground runs on level outward. The ground between two
points is the straight line between them and three points at one height make a level plane, so a
terrace or a lawn set by a few points stays level however low the points beyond it are. (It was an
inverse-distance-weighted average until the starter's terrace, between the house and its retaining
wall, sagged toward the low lawn past the wall, and the ground along every face of the house sagged
between its points, showing a foot or two of foundation.) Exactly a point's elevation within 1" of
it, flat for a single point, the inverse-distance (power 2) average when the points do not span an
area (two, or all in a line), and `fallback` (the bottom of the lowest level's slab,
`fallbackElevation`) without points. `terrainGrid(site, bounds, fallback)` samples it on a 24" grid over
the plan bounds (`siteBounds`: nodes of every level, roof and deck outlines, columns, surface outlines,
fence points, grade points, so the grid covers every site element) plus 1200"
(`TERRAIN_MARGIN`, 100'), rounded outward to whole cells, so a wall moving about does not change the grid;
the step grows when that would exceed 200 cells along an axis. The result is an indexed
surface (vertex = plan x, elevation, plan y; two triangles per cell, all facing +Y) plus its `bounds`
(`terrainBounds`) and `skirtElevation`, the lowest vertex on the grid's boundary minus 12"
(`TERRAIN_SKIRT_DROP`). The house is cut out of it: `terrainGrid(site, bounds, fallback, footprints,
floorUnder)` sets the grid vertices inside the footprints (the lowest level's `slabOutlines(getFaces(lowest,
viewMode), true)`, out to its walls' outside faces) to `floorUnder` (that level's slab bottom minus 2"),
and splits the cells the outlines cross along them (convex pieces of each cell triangle inside and
outside the outline's triangles; extra vertices after the grid's), so the ground meets the outside face at
grade and drops straight down there, inside the wall. The memo `terrainFor` is keyed by the site's
`gradePoints` record (immer keeps its identity while a grade point is untouched, so a column, the north
angle or a wall inside the bounds never rebuilds anything), then by the rounded bounds, the fallback, the
`floorUnder` and the lowest level's `outerFaces` array (`terrainCut`; getFaces keeps it while that level's
nodes and walls are untouched, so an edit on another level does not rebuild the ground and a basement wall
edit does). `getTerrainGeometry(plan, viewMode)` keeps one `BufferGeometry` per grid and disposes the one
it replaces. `buildTerrainGeometry` gives the grid smooth normals and UVs in inches (u = plan x, v = plan
y), then hangs a skirt from the grid's boundary: on each side a strip of vertical quads from the boundary
vertices down to `skirtElevation`, facing out, with vertices of its own (so the boundary keeps its upward
normals) and UVs (along the side, elevation). The skirt closes the ground's edge (in the export too); in the
3D view the far ground covers it. The terrain is opaque and FrontSide, roughness 1, with the lawn texture
(`view3d/groundTexture.ts`: a 512 px seeded canvas for 96" of ground, two greens mixed by noise at three
scales, blade strokes, soil and straw specks, every mark wrapped round the tile's edges; `RepeatWrapping`,
`repeat` 1/96, anisotropy 2) under a white tint; without a canvas (node, tests) and in the export it is
the lawn's mean colour `GRASS_COLOR` (`#495427`, `userData.flatColor`). It replaces the infinite grid as
the ground, so the basement walls below grade are buried and the walkout side shows. It receives the
sun's shadows and casts none.

**Far ground** (`meshes.ts buildFarGroundGeometry`, `getFarGroundGeometry`, `SiteMeshes.tsx FarGround`): a
collar from the grid's boundary out to a square 12000" (`FAR_GROUND_HALF`, 1000') from the grid's centre, so
the horizon shows ground under the sky. Each side is a strip of quads from the boundary vertices (their
heights, and the terrain geometry's normals there, so the seam does not show) to as many points spread
along the square's side at `skirtElevation` (normal up); over 1000' the fall is imperceptible. It leaves
the grid's area open: a plane under the whole site would cross the basement, where the house is cut out of
the ground. Same lawn, UVs in inches; its material (`farGroundMaterial`, a clone of the terrain's) has a
small negative polygon offset so along the seam it wins the depth tie with the top of the skirt (seen from
outside the terrain that edge showed as a dark line). It is rebuilt whenever the terrain geometry is.

The drei grid stays as an overlay
("Grid" checkbox in the 3D bar, `uiStore.show3dGrid`, default on) 1" above the lowest ground
(`lowestGround`: the fallback elevation, or the lowest grade point when that is lower): the terrain is
above it and hides it, which is the point (no z-fighting, and it never floats over a lawn that goes
below the lowest slab). Under the lowest
level the ground sits 2" below its slab, so the basement interior is empty. The triangulated surface never
leaves the range of the grade points' elevations, so with every grade point at or below the First Floor
slab's underside (the "north pair at first floor top minus 12 inches" of the renovation scenario) the
ground never reaches that slab; a grade point above it would, and nothing clamps it.

**Columns** are boxes from `base` to `top` (absolute elevations) over a plan rectangle turned by
`rotation` (`columnOutline`, `buildColumnGeometry` = `prism` with `addBoxUVs`, see "Exterior
appearance"). Defaults (`columnDefaults`): chimney
24" x 40", base 12" below the ground at its point (`groundAt`), top 48" above the highest roof ridge
on the plan (the top surface at the ridge; above the top ceiling without roofs); post 6" x 6", base on
the ground, top at the lowest roof underside over it among roofs it can be seen with (a new post
ignores a roof being demolished; `phasesCoexist`), else the first floor's ceiling; flue 8" (its
diameter), base 30" over the first floor's top (a stove top), top 24" above the highest ridge;
pier 16" x 16", base on the ground, top at the first floor's floor top (24" high where that is not
above the ground). A **pier** is fieldstone, of any width and depth (under a post, or a low wide
stoop): a box like a post, drawn by `columnMaterial('pier', ...)` with the walls' stone texture
(`sidingTextures('stone', ...)`) on its box UVs, `#8a8378` by default; the export names it `Pier`.
A **flue** is round: `columnOutline` gives a circle of `width` (`FLUE_SIDES` corners, `depth` and
`rotation` ignored), `pointInColumn` picks inside it, `buildColumnGeometry` gives its side faces
normals straight out from the axis so it shades smooth, and `columnMaterial('flue', ...)` is
stainless (`#b9bdc1`, metalness 0.8, roughness 0.35, not flat shaded, reflecting the sky like
glass). A capped flue (`hasFlueCap`) has a rain cap (`FLUE_CAP`): a **stem** half its width from
`top` up 3" and a **hood**, a disc twice its width 1.5" thick, on it, both in the flue's metal;
`columnPeak` adds 4.5". Columns are not cut by slabs or roofs: a flue through the house stands
through them, so a stove and a chase are boxes on their levels. Optional fields:
`color` (`#rrggbb`, lower-cased; `columnColorOf` defaults to brick `#7a4a3e` for a chimney, tan
`#c9b58c` for a post and grey-brown `#8a8378` for a pier, `COLUMN_COLOR` in `model/finish.ts`) and `cap` (a chimney's cap and spark
arrestor; a post ignores it). `migrate()` keeps each when valid and drops it alone otherwise;
`columnProblem` refuses a bad one in `addColumn` and `updateColumn`, which deletes either on
`undefined`. A capped chimney (`hasChimneyCap`) has two more parts (`CHIMNEY_CAP`,
`chimneyPartBoxes` in `site.ts`, built by `meshes.ts buildColumnParts`): the **cap**, a closed box
from `top` less 4" to `top`, 2" proud of the shaft's faces all round, and the **arrestor**, a wire box
from `top` up 12", 1" in from the shaft's faces (at most a quarter of the shaft), open at the bottom
where it stands on the cap. The shaft then stops under the cap, at `top` less 4", so no two faces of
the three lie on each other facing the same way. `columnPeak` is `top` plus the arrestor's 12".
`getSiteMeshes(plan, viewMode)` returns the visible columns, memoized per view mode by the `columns`
record and per column object, disposing what drops out: `ColumnMesh` has the shaft's `geometry`, the
`color` after its default and, only on a capped chimney, `parts` (`cap`, `arrestor`). The `Terrain`
and the columns render in `view3d/SiteMeshes.tsx`: the shaft in `columnMaterial(kind, phase, color)`
(a chimney is brick in its colour, a post the flat colour, see "Exterior appearance"; demolished
translucent red, new pulled toward green), the cap in concrete `#b8b4ac` (`CHIMNEY_CAP_COLOR`) and the
arrestor in the window screens' wire mesh (`chimneyPartMaterial`). A column and its cap cast and
receive the sun's shadows; a demolished one casts none, and neither does the arrestor (see-through,
drawn after the opaque meshes like a screen).

**Ground surfaces** (`SiteSurface`, schema 8) are flat-material patches on the ground: a gravel drive, an
asphalt road, a concrete pad, flagstones. A surface has no height of its own: `site.ts drapeSurface(outline,
grid)` lays it on the terrain grid the view shows (`planTerrain`, the house cut out of it included). The
outline is triangulated (`roofs.ts triangulate`, ear clipping, after turning it to positive area); each of
its triangles is clipped against every grid triangle it overlaps, found through an index of the grid's
triangles by the cells their bounding boxes touch (`gridIndexOf`, made once per grid object), then a
convex-convex clip by the grid triangle's three inward half-planes (`clipHalfPlane`); each piece is fanned
into triangles facing up whose corners take the height of the grid triangle's plane there (barycentric,
`planeThrough`) plus `SURFACE_LIFT` (1"). So the surface lies exactly on the ground, split wherever the
ground folds, and its plan area is the outline's. `meshes.ts buildSurfaceGeometry` makes it a non-indexed
geometry with flat normals (`computeVertexNormals`) and UVs in inches (u = plan x, v = plan y).
`getSurfaceMeshes(plan, viewMode)` returns the visible ones (`SurfaceMesh`: id, shown phase, material,
`color` after the default, geometry), memoized per view mode by the `surfaces` record and the grid object
(the same array while both are), each surface's geometry kept while its object and the grid are, the
replaced or dropped ones disposed (`clearSiteCache` disposes all). Colours (`SURFACE_COLOR`,
`surfaceColorOf` in `model/finish.ts`): gravel `#8d8574`, asphalt `#3d3d3f`, concrete `#b3b0a8`, stone
`#8a8378`; `color` (`#rrggbb`, lower-cased) overrides it. `view3d/materials.ts surfaceMaterial(material,
phase, color)`: gravel and asphalt carry a canvas texture drawn in the colour under a white tint
(`groundTexture.ts surfaceTexture`: a 512 px seeded tile for 48" of ground, `repeat` 1/48; gravel is the
colour mottled by noise under 9000 small stones 1/4" to 3/4" in lighter and darker shades, each with a
shadow; asphalt is the colour with fine grain and lighter aggregate specks; every mark wrapped round the
tile's edges), stone carries the walls' fieldstone (`sidingTextures('stone', ...)`) as flagstones,
concrete is the flat colour; matte (asphalt roughness 0.85); without a canvas (node, tests, the export)
the flat colour (`userData.flatColor`). Every surface material, the demolished one too, has a polygon
offset toward the camera (factor -1, units -4) on top of the 1" lift, so far away, where depth precision
is coarser than an inch, the lawn never shows through. Demolished: translucent red; new: the colour
pulled toward green. `SiteMeshes.tsx SiteSurfaces` draws them with the ground's render order; they
receive the sun's shadows and cast none.

**Fences** (`Fence`, schema 8) are split-rail (post and rail) fences along an open polyline, laid out by
pure functions in `site.ts`. `fencePostPoints` puts a post at every point and, along each run, as few more
as keep every gap within `postSpacing`, evenly spread (`ceil(length / spacing)` gaps: a 25' run at 10'
gets two more, 8'4" apart); a fence whose last point is back on its first (within 1", four points or
more) shares that post and closes. `fenceLayout(fence, ground)` stands each post from
`FENCE_DEFAULTS.belowGrade` (6") under the ground at it to `height` over it, and runs `rails` rails
between each two consecutive posts (and from the last to the first when closed), axis to axis, at
`fenceRailFractions(rails)` of the height over the ground at either end: evenly from 30% to 85%
(`railLow`, `railHigh`), a single rail at 85% (a top rail), so the rails follow the slope.
`meshes.ts buildFenceGeometry` builds every post (6" across, `FENCE_DEFAULTS.post`) and rail (4",
`rail`) with `logBetween` (round logs with smooth normals, see "Structure") and merges their bodies into
one geometry and their end discs into another. `getFenceMeshes(plan, viewMode)` returns the visible ones
(`FenceMesh`: id, shown phase, `color`, `body`, `ends`), the ground being `terrainHeightAt` (the TIN, not
the cut grid: a post by the house stands at grade), memoized per view mode by the `fences` record, the
`gradePoints` record and the fallback elevation, a fence's geometry kept while its object and the ground
are. The colour is weathered grey wood `#8b8478` (`FENCE_COLOR`, `fenceColorOf`); `fenceMaterial('body',
phase, color)` is that colour and `fenceMaterial('end', ...)` the end grain's (`logEndColor`), both like
trim (demolished translucent red, new pulled toward green). `SiteMeshes.tsx SiteFences` draws them; they
cast and receive shadows, a demolished one casts none.

**Site mode** (`uiStore.siteMode`, the "Site" tab below the lowest level in the level bar): entering it
makes the lowest level active (so the panel and store actions have a level), clears the selection and
shows, in place of the level's layers (`PlanLayers.tsx SiteView`), the first floor (the level above the
lowest, or the lowest if alone) as a ghost, every level's roofs as faint ghosts, and the site layer, bottom
to top: ground surfaces as filled outlines in their material's colour (gravel speckled with the
`hp-gravel` pattern, the others flat, in the surface's own colour when it has one and its phase does not
colour it), fences as a line with a dot at each post (`fencePostPoints`, at least 2.5 px across), columns
as rectangles (chimney hatched like brick, post and pier solid), grade points as small triangles with
their elevation, and a north arrow in the canvas corner turned by `northAngle`. Surfaces, fences and
columns follow their phase (demolished hatched or dashed red, new green) and are hidden in the views
that hide them. Choosing any level (the lowest too) leaves site mode
(`setActiveLevel` clears the flag). In site mode only select, measure, grade point (E), column (C),
surface (A) and fence (Q) work (`SITE_TOOLS`); `switchTool` refuses the level tools and says "Choose a
level to draw walls" in the status bar (the toolbar buttons stay clickable but dimmed and
`aria-disabled`; E, A and Q do nothing outside it, and C is the cabinet tool there). In
site mode the 3D view's "Only active level and below", the export and the walk start use the level
the site view ghosts (the first floor) as the active level (`active3dLevel`), since the active level
is parked at the lowest.

**Site tools** (`siteTools.ts`): `siteSnap` snaps to the first floor's wall-face corners and faces, nodes,
midpoints and the grid. Grade point: a click stores the spot in `draft.gradePending`; the length buffer
takes the elevation in feet-inches (a minus sign is allowed); Enter places it, with nothing typed at the
first floor's floor top (the level the view shows; `defaultGradeElevation`); Esc clears the buffer, then
the spot. Column: the column follows the cursor (`draft.columnPreview`), Tab steps chimney, post, flue, pier (`nextColumnKind`),
the click places it with the defaults above in the toolbar's "Draw as" phase. Surface (A) and fence (Q)
are outline tools (`makeOutlineTool`, as the roof and deck tools, with the spec's `snap` set to
`siteSnap`): the surface tool closes its outline on the first corner, a double-click or Enter, and Tab
(the spec's `onKey`) steps `draft.surfaceMaterial` through gravel, asphalt, concrete, stone
(`nextSurfaceMaterial`) before it closes; the fence tool is `open`: at least 2 points, finished by Enter
or a double-click, a click on the first point adds it again (a closed run), no self-crossing check, no
closing edge in the draft (`Overlay.tsx OutlineDraft`). Both: Backspace removes the last point, Esc
cancels, the new element is selected in the "Draw as" phase, and a fence takes `FENCE_DEFAULTS` (42"
high, 2 rails, posts at most 120" apart). The site select tool (`getTool('select')` returns it in site
mode) picks with `hitSite`: grade points (10 px), then columns (visible ones, with a 4 px slack, the
latest on top), then fences (the nearest within 5 px of its line, `FENCE_PICK_PX`), then surfaces (the
point inside the outline; the smallest area on top, so a pad on a drive can be picked); shift-click and
box-select add (a surface or fence when all its points are in the box), a drag moves the whole
selection with `moveSiteItems` (one set; the first changing step is tracked and the rest folded in, one
undo step; a surface's outline and a fence's points move as a whole), Delete removes through
`deleteEntities`. Store actions: `addGradePoint`, `updateGradePoint`, `deleteGradePoints`,
`clearGradePoints`, `addColumn`, `updateColumn`, `deleteColumns` (`columnProblem` rejects a non-positive
size or a top at or below the base), `addSurface`, `updateSurface`, `deleteSurfaces` (`surfaceProblem`
rejects an outline of fewer than 3 points, crossing itself or enclosing no area, an unknown material, a
colour not `#rrggbb`), `addFence`, `updateFence`, `deleteFences` (`fenceProblem` rejects fewer than 2
points or two on top of each other, a height not above 0, rails not a whole number 1 to 4
(`MAX_FENCE_RAILS`), a post spacing under 24" (`MIN_FENCE_SPACING`), a bad colour; `color` takes
undefined to clear it), `moveSiteItems(points, columns, { surfaces, fences })` (new outlines and point
lists, kept only with the same count of points), `setNorthAngle` (normalized to [0, 360)); each is one
undo step and a no-op leaves the plan object alone. `setPhase` and `deleteEntities` take `columns`,
`surfaces` and `fences` (and `deleteEntities` `gradePoints`). `Selection` gains `gradePoints`, `columns`,
`surfaces` and `fences`. The panel has Grade point (elevation, position, against the first floor), Column
(kind, size, rotation, base, top, "Colour" with a reset to the default, "Cap and spark arrestor" for a
chimney, phase, "Reset heights"), Surface (material, "Colour" with a reset, phase, area, corners), Fence
(height, rails, post spacing, "Colour" with a reset, phase, length, posts, "Reset to defaults") and, with
nothing selected in site mode, Site (north angle, "Road is north", counts, "Clear grade points" with a
confirm). The status bar counts the visible columns, surfaces and fences in site mode.

**North and light**: `sunPosition(northAngle)` is the sun's direction (the light, the sky's sun and the
shadow camera follow it, see "3D"), the south-west offset (-700, 1100) in plan turned clockwise by the angle
and 1600" up (about 51 degrees above the horizon), so the sun comes from the south-west once north is
applied.

**Phases** apply to roofs, columns, surfaces and fences exactly like walls: `isVisible(phase, viewMode)` in
`RoofShape`, `ColumnShape`, `SurfaceShape` and `FenceShape` (2D), `hitTest` / `hitSite` (picking),
`pruneSelection`, `getLevelMeshes` (roofs, and walls they raise), `getSiteMeshes`, `getSurfaceMeshes`,
`getFenceMeshes`, the export, and the status bar counts; "Mark demolish" (panel, `setPhase`)
and the toolbar's "Draw as" cover them.

**Export**: after the level groups a `Site` group (elevation 0, absolute heights) holds `Terrain` (material
`terrain`, the flat lawn colour, no texture; with its skirt; only when the site has grade points: flat ground
would only be a plane at the slab) and the visible columns as `Chimney` / `Flue` / `Post` (materials
`column_<kind>_<phase>`, plus `_<hex>` in a colour other than the kind's default unless demolished; a
chimney's brick is its flat colour). A capped chimney's cap and arrestor follow its shaft as two more
`Chimney` meshes, materials `chimney_cap_<phase>` and `chimney_arrestor_<phase>`. Then each visible ground
surface is a `Surface` mesh (material `surface_<material>_<phase>`, plus `_<hex>` in a colour other than the
material's default unless demolished; the flat colour, no texture), draped on the ground even without
grade points (then on the flat ground at the slab, which is not exported), and each fence two `Fence`
meshes, its logs (`fence_<phase>`) and their ends (`fence_end_<phase>`), plus `_<hex>` in a colour other
than the weathered grey unless demolished. The far ground is not exported.

**Fit 3D** (`bounds.ts planBox`) takes in the walls that close a room (`houseNodes`: the walls of
the All view's faces; a level whose walls close nothing gives all its nodes), so a free-standing
wall such as the starter's retaining wall, carried 80' west to the property line, neither shrinks
the house in Fit 3D and the elevations nor coarsens the sun's shadow map; it includes the columns (a capped chimney's cap, 2" proud, and its arrestor,
12" above its top) and the terrain's height over the house area (a 6 x 6 sampling of the plan box), never
the 100' margin.

## Casework (`model/casework.ts`, `derive/casework.ts`, `editor2d/tools/fixtureTool.ts`)

Kitchen cabinets, counters, appliances and sinks (M12), so a kitchen can be laid out on the plan
and seen in 3D with the same phases as everything else. A `Fixture` is a plan rectangle in its own
frame: `origin` is the middle of its back edge, `direction` the way its front faces, `width` along
the back, `depth` back to front, `height`, and `elevation` of its bottom above the floor top (0 on
the floor; 54 for a wall cabinet, 66 for a hood). Kinds: `base`, `wall`, `tall`, `island`, `sink`
(a base cabinet with a basin), `range`, `fridge`, `dishwasher`, `wallOven`, `hood`, `microwave` and a
labelled `box`. `FIXTURE_DEFAULTS` holds the stock size of each (base 36 x 24 x 34.5, wall 30 x 12
x 30 at 54, range 30 x 25 x 36, fridge 36 x 30 x 70, ...). The level's `finishes` carry the defaults
a fixture without its own takes: cabinet colour (off-white `#e9e4d8`), counter colour (dark stone
`#6b6760`) and front style (`slab` or `panel`). Fixtures live in `level.fixtures` (schema 3).

**Frame** (`fixtureFrame`, like `stairsFrame`): `u` the unit front direction, `v` lateral to its
right; local coordinates `(s, d, y)` are lateral from the back's middle, from the back toward the
front, and above the floor. `fixtureOutline` (back-left, front-left, front-right, back-right),
`hitFixture`, `counterOutline` (the outline grown by the counter overhang: 1" at the front, an
island 1" all round, `counterOverhang` otherwise) and `basinOutline` (33 x 22, centred in the
cabinet) come from it.

**Boxes** (`fixtureBoxes`, pure): a fixture as axis-aligned boxes in its frame, one material part
each (`carcass`, `front`, `kick`, `appliance`, `basin`). Cabinets: a carcass to 3/4" short of the
front, a toe kick 4" high set back 3" under floor-standing ones, `round(width / 18)` fronts with
1/8" reveals (base, island and sink cabinets get a 6" drawer front over each door; `panel` style is
2" stiles and rails round a panel recessed 3/8"). A range is a steel box with a 1" dark cooktop and
an 8" backguard, a fridge has a door reveal at 70% of its height, a dishwasher a steel front under
the counter, a wall oven two steel panels between cabinet doors, a hood a 6" canopy with a flue, a
sink the base cabinet plus an open basin 8" deep whose top is the counter top. `meshes.ts
buildFixtureParts` turns each box into a `prism` in plan space and merges them per part, so every
part is a closed surface (a reveal shows the carcass behind it, which is the point).

**Counters** (`counterRuns`): one slab per run of touching counter-bearing fixtures (base, island,
dishwasher, sink), not one per cabinet, so there is no seam every 24" and the top runs over the
dishwasher. The rectangles (each fixture's counter outline) are grouped by touching bounding boxes
(union-find, 1/2" slack); a group whose members are all turned by a multiple of 90 degrees is
united by coordinate compression (`rectilinearUnion`: the covered cells of the grid of all rectangle
and basin edges, their uncovered-neighbour sides chained into rings clockwise on screen, collinear
vertices dropped), the largest ring the outline and the rest the basin holes, mitred at an L; any
other group gives one slab per fixture. The slab runs from the top of the run's highest cabinet up
`COUNTER_THICKNESS` (1.5"). Its phase is demolished when every cabinet under it is, new when any is.

**2D** (`fixtureSymbol`, `PlanLayers.tsx FixtureGlyph`, between the stairs and the walls): the
outline with a heavier front edge and a tick where two doors meet, dashed for what hangs above the
counter (wall cabinets, the hood, the microwave), an appliance's word (REF, RANGE, DW, OVEN, HOOD,
MW; a box its label or BOX), a range's four burners, a sink's basin; demolished hatched red and
dashed, new green, like the rest. `CounterLayer` draws each run's outline (with its holes) once,
under the cabinets. Hit testing (`selectTool.hitTest`) picks fixtures after room labels and before
stairs; the select tool drags every selected fixture together (`moveFixtures`, grid-rounded, one
undo step) and Delete removes them. `levelDrawingBounds` includes them.

**Tool** (C, `fixtureTool.ts`; in site mode C is still the column tool, `keymap.ts`): the kind the
panel's picker chose (`draft.fixtureKind`) follows the cursor. `nearestFace` finds the visible wall
face within 12 px: the back's middle lands on it and the front faces away from the wall
(`FixturePreview.wallId`). `abutOnLine` then slides it along the face so an end that comes within
12 px of the end of a fixture already on that line (same facing, back on the line) abuts it
(`abuts`), which is how a run of cabinets is placed by clicking along a wall. Shift held, or no face
near: free placement at the usual snap, the cursor being the fixture's middle, in `draft.fixtureDirection`
(Tab turns it by 90). Digits go to the length buffer as the width (`typed`); click or Enter places
it with the kind's stock depth, height and elevation in the toolbar's "Draw as" phase and selects it;
Esc clears the buffer. The overlay's `FixtureGhost` draws the symbol with a pill naming the kind and
width (green when typed). `PlanCanvas` drops the ghost when the pointer leaves.

**Store**: `addFixture` / `updateFixture` (undefined clears `label`, `frontStyle`, `frontColor`,
`counterOverhang`; the direction is normalized; `fixtureProblem` rejects an unknown kind, a
non-positive size, a bottom below the floor or a malformed optional field), `deleteFixtures`,
`moveFixtures`, `duplicateFixtures` (copies offset by a vector, one undo step), `updateFinishes`
(the level's casework defaults, undefined clears a field, an empty record is dropped), and
`setPhase` / `deleteEntities` take `fixtures`. **`splitWall(levelId, wallId, at)`** inserts a node
`at` inches from the wall's a end and normalizes the level, so the wall becomes two pieces that can
be marked demolished or moved on their own (refused at an end or inside an opening); the select
tool's right-click menu offers "Split wall here" on a wall.

**3D** (`getLevelMeshes` returns `fixtures: FixtureMesh[]` and `counters: CounterMesh[]`): a
fixture's parts are rebuilt when its object or the resolved front style changes (keyed per fixture
object and style), the counter slabs when the list of visible counter fixtures does; dropped
geometry is disposed. `materials.ts caseworkMaterial(part, phase, color)`: carcass and fronts in
the fixture's front colour (`frontColorOf`), the kick near-black, appliances and basins brushed
steel (metalness 0.6, roughness 0.35); `counterMaterial(phase, color)` the level's counter colour
with a slight sheen; demolished translucent red, new pulled toward green. Everything casts and
receives shadows except demolished work. The panel has `FixtureProps` (kind, which brings the new
kind's stock size unless the size was edited; width, depth, height, bottom; facing; phase; label;
fronts and front colour with a reset to the level defaults; the counter top and the four overhangs
for counter kinds), `FixtureToolProps` (the kind picker while the tool is active) and, in the Level
panel, the casework defaults.

**Export**: meshes `Cabinet (base)`, `Cabinet (wall)`, `Cabinet (tall)`, `Cabinet (island)`,
`Sink`, `Box`, `Appliance (range)` and so on (one per material part), and `Counter`; materials
`cabinet` (`cabinet_<hex>` in another colour), `kick`, `appliance`, `basin`, `counter`
(`counter_<hex>`), each plus `_new` / `_demo` for other phases.

Not done: cabinet door swings in plan, backsplashes, open shelves, corner cabinets (an L corner is
two cabinets whose counter is mitred), appliance details beyond a few boxes, copy and mirror of a run
(M14). Interior wall and floor finishes (M13) are in "Interior finishes".

## Exterior appearance (`model/finish.ts`, `view3d/textures.ts`, `derive/openings3d.ts`)

All of it is optional data on existing elements (no schema bump: `migrate()` reads the fields when they are
valid and drops them otherwise): `Wall.finish` (`clapboard | shingle | shake | board | block | stone | riverstone | halflog |
plain | screen`; an unknown value is dropped), `Wall.color` (`#rrggbb`, lower-cased on load) and `Wall.band` (see "Lower
band" below), `Opening.lites {cols, rows}` (whole numbers 1 to
12), `Opening.shutters`, `Opening.trim` (0 to 24"), `Opening.sashes` (whole number 1 to 6), `Opening.fixedCenter`,
`Opening.glazing` (`glass | screen`), `Opening.halfLite`, `Opening.sliding`, `Opening.leafColor` (`#rrggbb`, lower-cased), `Roof.color`,
`Roof.eave` (`fascia | open`), `Roof.rafter` (finite `depth` and `spacing` above 0, rebuilt as `{ depth, spacing }`),
`Roof.boardColor` (`#rrggbb`, lower-cased), `Roof.weathering` (0 to 1), `Column.color` (`#rrggbb`, lower-cased) and
`Column.cap` (true or false; see "Site and terrain").
Defaults when absent (`wallFinishOf`, `wallColorOf`, `roofColorOf`, `sashesOf`, `glazingOf`, `leafColorOf`,
`roofEaveOf`, `rafterOf`, `boardColorOf`, `weatheringOf`, `columnColorOf`):
exterior walls shingle in the house's stain `#5a3a35`, interior walls plain `#e8e4dc`, a metal roof `#6e6259`, a
shingle roof `#4a4a4a`, one sash, glass, a dark green door leaf `#2f3a33`, fascia eaves, rafters 5.5" x 24"
(`DEFAULT_RAFTER`), weathering 0.35 (`DEFAULT_WEATHERING`), a chimney brick red `#7a4a3e` and a post tan `#c9b58c`
(`COLUMN_COLOR`), no cap; the fascia, rake boards and rafter tails take the roof's board colour, tan `#d9c9a3` by
default, like the window trim. The Level panel's
"Exterior finish" and "Exterior colour" set every exterior wall of the level with one `updateWalls` (one undo step);
the Wall, Opening and Roof panels edit one element. The colour picker commits once when it closes (native
`change`), the hex field on Enter or blur. `updateWalls`, `updateOpening` and `updateRoof` take `undefined` to clear
an optional field.

**Siding textures** (`textures.ts`): `sidingTextures(finish, color)` draws a 512 x 512 canvas that stands for 48" x
48" of wall (a texel is 3/32"), once per finish and colour, cached with its normal map, `RepeatWrapping`, `repeat`
1/48, so wall UVs are in inches (`sidingTexture` is the colour map alone). Clapboard: 8" courses (6 per tile), each
lap shading the top of the board below (darkest for 3 px, fading over 6), 6% brightness either way per board, faint
horizontal grain. Shingle: 4.8" courses (10 per tile; 5" does not divide 48" and the tile must repeat), vertical
joints every 4" to 8" that sum to exactly 48" per course and stagger from course to course (`shingleJoints`,
`shingleCourses`), a dark keyway at each joint, each course's butts shading the top of the course below, per-shingle
brightness and a slight warm or cool shift, fine vertical grain. Board: 8" vertical boards (6 per tile) with a
V-groove at each joint. Block: 8" x 16" concrete block in running bond (`blockFaces`), 3/8" mortar lighter than the
faces, per-block brightness and speckle, the top of each bed joint in the shadow of the block above. Stone
(fieldstone): 6 courses of 8" cells 6" to 14" long that fill the tile and stagger (`stoneFaces`, reusing
`shingleJoints`), each stone inset by at least 3/8" of mortar and up to 1 1/4" more top and bottom so the courses
wander, its outline a superellipse (exponent 2.2 to 3.5, `stoneDistance`), its colour the wall's colour mixed 35% toward
one of four tones (grey, blue-grey, tan, brown, `STONE_TONES`) at 0.8 to 1.15 brightness, darker toward its rim,
painted pixel by pixel through the same outline as its relief; mortar lighter than the stone, speckled. River stone
(a dry stack): rough courses 3" to 6" high that sum to the tile, each cut into stones 4" to 10" long (both by
`shingleJoints`, so they stagger and wrap; `riverstoneFaces`), each stone inset by at least 3/16" (a 3/8" joint) and up
to 1/4" more on every side so the gaps vary, a rounded box (exponent 2.6 to 3.6) so the stones sit close, its colour one of four natural
tones (grey, tan, blue-grey, rust, `RIVERSTONE_TONES`) with only 15% of the wall's colour mixed in (`RIVERSTONE_TINT`),
at 0.78 to 1.18 brightness, lit from above and darker toward its rim; the gaps near black (`RIVERSTONE_GAP`). Half-log:
bark-on half logs in 8" courses (`halflogFaces`), each course a few percent lighter or darker, shaded toward its
top and bottom (the round of the log), heavy bark streaks and speckle, a dark 3/4" chink line between logs in the
shadow of the log above. Plain: no
texture, a flat colour. Screen: 1 px wires every 2 px (3/16") over a translucent dark grey (alpha 0.55), a fine mesh
up close and an even grey veil further off (as a wall finish: material `transparent`, opacity 0.4, no depth write,
`DoubleSide`).

**Relief**: every finish but plain and screen has a height field in inches (`sidingHeight`): clapboard tapers from
its butt to nothing under the next board (a 0.6" step at each lap), shingles taper from a 0.4" butt, each a little
proud or shy of its neighbours, with 0.3" deep keyways, boards have 0.2" V-grooves, block mortar is raked 0.25",
each fieldstone is a dome 0.6" high (`RELIEF.stone * sqrt(1 - d^4)`) in mortar raked 0.25", each river stone a round
dome 1" high (`RELIEF.river`, `sqrt(1 - d^2)`) falling into gaps 0.6" deep (`RELIEF.gap`), each half log a round
crown 1.2" high (`RELIEF.log`) with its chink line raked 0.25".
`normalFromHeight` makes a tangent-space normal map of it with Sobel derivatives sampled modulo the tile (no seam
line) at the true slope (strength `PX_PER_INCH`). Canvas y grows downward and the texture's v upward (flipY), so
R = 0.5 - 0.5 k dh/dx and G = 0.5 + 0.5 k dh/dy (then normalized): a lap's butt, higher above than below, faces down.
The normal texture is one per finish whatever the colour, `NoColorSpace`, with the colour map's wrap, repeat and
anisotropy; `wallMaterial` attaches it as `normalMap` with `normalScale` 0.6 (no tangent attribute: three derives the
frame from screen-space derivatives, flat shading included). The layouts, height fields and the normal-map rule are
pure and tested; drawing needs `document`, and `sidingTextures` returns null without it (node, tests), where
materials fall back to the flat colour.
`wallMaterial(phase, kind, finish, color)` keys its shared materials by phase, finish and colour: existing walls
use the texture with a white tint, new ones use the texture's `new` variant (REVIEW-2 C4: the drawn canvas
blended 50% toward `#a9dcb7` per pixel, `blendPixels`, alpha kept) also with a white tint, so new siding reads
as the finish washed with light green rather than the stain multiplied into near-black; their flat colour
(`wallFlatColor`, export and no-canvas fallback) is the same blend (`newWorkColor`), kept on a textured material as
`userData.flatColor`. Demolished walls stay
translucent red with no texture, plain walls are the colour itself (pulled toward green when new). The wall mesh is one merged
geometry with one material, so it cannot tell the faces of a wall apart: **both faces of an exterior wall show the
siding** (the inside of a window reveal shows shingle too); interior walls are plain unless given a finish. The one
exception is a face on the side of a room that sets interior finishes: it is split off and dressed by the room (see
"Interior finishes").

**Lower band** (`Wall.band { finish, color?, height }`, `wallBandOf`): the wall's outside face below `height` in its
own finish and colour (absent: the wall's colour), an exterior wainscot such as a stone base or a river-stone or half-log knee wall.
Any finish but screen (`BAND_FINISHES`); `migrate` drops a band without a usable finish and a height above 0 (a bad
colour alone is dropped) and keeps it as `{ finish, color?, height }`; `updateWalls` copies it per wall with the colour
lower-cased, clears it with `undefined` and refuses a height not above 0. The Wall panel's "Lower band" sets the
finish (36" or half the wall's height for a new band), the band's height and colour, and "Clear band" removes it. In
3D (`getLevelMeshes`) a band below the wall's top adds its height to the level-wide band heights, so every wall of
the level is cut there alike, and `splitWallFaces` (cut `{ band }`) takes the triangles of the outside face below it
(the side `outwardSide` gives, the one the trim goes on) into `WallMesh.band`, drawn and exported (`Wall n lower
band`, material `wall_<phase>_<kind>_<finish>_<hex>`) with `wallMaterial` in the band's finish; the rest of that face
stays in the wall's mesh. A room that dresses the outside face wins over the band; a demolished or screen wall has
none. Walls without a band are built exactly as before.

## Interior finishes (`model/finish.ts`, `derive/meshes.ts`, `view3d/textures.ts`)

A room (its label) may set how the walls round it and its floor are dressed, all optional data on `Room` (no schema
bump; `migrateRooms` keeps valid values and drops each malformed one): `wallFinish` (`paint | boards | pine | check`)
and `wallColor` (a colour alone is paint; a check's colour is the check's, on the pale ground `CHECK_GROUND`), a
`wainscot` (`{ height, finish, color? }`, a lower band in another finish up to `height`, dropped at or above the
ceiling) and `floorFinish` (`plain | boards | tile | parquet | pine | carpet`) with `floorColor`. Each finish has a
default colour (`ROOM_WALL_COLOR`, `FLOOR_COLOR`: wide pine whitewashed `#d8d0c2`, carpet oatmeal `#b9ae9b`);
`roomWallLookOf`, `wainscotOf` and `floorLookOf` resolve them, null when unset. An existing room may also carry a
`proposedFloor` (`{ finish, color? }`): a new floor laid in a room the proposed design keeps. `floorLookIn(room,
viewMode)` gives it in the Proposed view for a room whose phase is existing, else `floorLookOf`, so the Existing and
All views keep today's floor; a new or demolished room ignores it. The room panel has Walls, Wall colour, Wainscot
(finish, height, colour), Floor and Floor colour, each with "Default", and for an existing room Proposed floor ("Keep
today's floor") and its colour; `updateRoom` sets and clears them (colours lower-case) as one undo step.

**Walls.** The rooms labelled in the view mode (`getFaces`) give each wall the face on each side (`wallSideFaces`,
one pass, the same rule as `facesBesideWall`). A side facing a room with a wall finish or a wainscot is split off the
wall's geometry after it is built (`splitWallFaces`): a triangle whose three vertices lie on the long face (at
+thickness/2 along the normal for the left, -thickness/2 for the right, within 1e-3") and that faces that way goes to
that side; the rest (jambs, sills, heads, ends, tops, a side with no room or one that sets nothing) stays in the core
with the wall's own finish. So an exterior wall shows its siding outside and the room's finish inside, a partition
each room's finish on its own side, and a window reveal still the wall's finish. The face runs up the wall's whole
height, so it also covers the strip through the slab above (hidden) and a gable's inside under the roof. A wainscot's
height joins the level's shared band heights (with the sills and heads), so every wall is cut there and neighbours stay
watertight; a split triangle goes to the wainscot when its centroid is under the cut. Demolished and screen walls
are never split. The split is cached on the wall's entry by its cuts, so changing a colour or a finish rebuilds nothing
(the material changes); changing a wainscot height rebuilds the walls. `WallMesh.faces` lists the parts, each with its
room, side, band (`upper` or `wainscot`), finish and colour; `geometry` is then the core. A face with a wainscot but no
wall finish above it is painted the default interior colour.

**Floors.** A room with a floor finish gets a surface over its net polygon (inside the wall faces), 1/16" over the
slab top (`FLOOR_FINISH_LIFT`), facing up, with the stair holes through the slab cut out (each triangle less each
convex hole, `subtractConvex`, so a hole against a wall face works). UVs are in inches along the room's longer side,
so boards and parquet run the long way. The live material also has a polygon offset, which keeps it in front of the
slab from far away. A room's floor follows its label: in the Proposed view a room that grows (the starter's Kitchen
into the old bath) dresses the new walls and the larger floor too, and a demolished room's label, hidden there,
dresses nothing.

**Textures** (512 px for 48", like the siding): `check` 1" gingham (`checkTone`: the ground, a stripe at half
strength, the full colour where two cross); `boards` the siding's 8" V-groove boards; `pine` 6" boards with grain,
knots and grooves; floor `boards` 3" rows of 16" to 48" boards with staggered joints (`floorBoards`); `tile` 12"
squares with 1/8" grout (`tileGrid`); `parquet` 6" basket-weave blocks of four slats (`parquetSlats`); floor `pine`
6" rows (`WIDE_PINE_BOARD`), mostly one board the tile's length, else two (`widePineBoards`), with fine grain, a few
small grey knots, dark joints and the square heads of old cut nails, two across each board at every 16" joist line
(`JOIST_SPACING`) and at each end, 1" in (`widePineNails`); `carpet` the colour with a soft mottle and a dense
speckle of loop tips, no relief. Boards, pine, floor boards, tile, parquet and wide pine have normal maps
(`interiorHeight`). `roomWallMaterial` and `floorFinishMaterial` key by
surface, phase, finish and colour; new work uses the green-washed variant; the flat colour (`interiorFlatColor`, a
check's blended a little toward its ground) is kept for the export and node.

**Export**: the dressed faces are their own meshes, `Wall <n> finish (<room>)` and `Wall <n> finish (<room>,
wainscot)`, and each floor `Floor finish (<room>)` (OBJ ignores geometry groups, so separate meshes keep their
materials); materials `interior_<finish>_<hex>` and `floor_<finish>_<hex>`, plus `_new`.

Not done: ceilings (the underside of the slab above, or the roof, shows), crown, baseboards and other trim, finishes on
window reveals, and a default interior finish for the inside faces of rooms that set none (they still show the siding).

**The proposed look** (`Plan.proposedLook`, types.ts `ProposedLook`): how the house looks after the work, without
redrawing it. Optional fields: `wallFinish` and `wallColor` for every exterior wall in a siding finish
(`SIDING_FINISHES`: shingle, shake, clapboard, board; block, stone, river stone, half-log, plain and screen walls, room-dressed
inside faces and a wall's lower band keep theirs, so a banded wall is re-sided above its band only), `roofFinish`, `roofColor` and `boardColor` for every roof (a re-roofed roof has no weathering),
`trimColor` and `sashColor` for every window and door (trim: casings and sills; sash: sashes, muntins and door
frames; `OpeningMesh.trimColor`/`sashColor`, `openingMaterial` keys by them), and `shutters: false` to build the
fills without shutters. `getLevelMeshes` applies it in the Proposed view only (the level cache is keyed on it);
Existing and All keep today's look. `migrate` keeps valid fields and drops the rest (no schema bump);
`updateProposedLook` sets and clears them as one undo step; the Level panel's "Proposed ..." fields edit it. The
export follows (`trim_<hex>`, `sash_<hex>`). **Painted shakes** (`shake`, `shakeCourses`): 7 courses to the 48"
tile, shakes 6" to 12" wide, painted (within 2% of the colour, no warmth, faint embossed grain), keyways and butt
shadows like shingle, the same relief rule. **Standing seam** (roof finish `seam`): flat pans with two faint pencil
ribs each and a seam 1" tall every 16" running down the slope (`seamHeight`, `drawSeam`); its texture is 48"
square, so it repeats every two of the roof's 24" UV tiles across (repeat 0.5); it has the metal sheen and the
ridge cap but no rust.

**Brick** (a chimney, `textures.ts brickTextures(color)`): the siding's tile (512 px for 48", `repeat` 1/48) of
modular brick, 2 2/3" courses (three to 8") of 8" bricks in running bond (`brickFaces`: 18 courses of 6 a tile, the
same `runningBond` layout as the block's), each brick a few percent lighter or darker and a little warmer or cooler,
with a few pores; the mortar is the colour lifted 18% toward a pale grey (a stained chimney is near one colour; the
block's is 45%), each bed joint shaded under the brick above. Its relief (`brickHeight`) is flat faces and 0.25" raked
joints, one normal map for every colour. `columnMaterial(kind, phase, color)` puts it on a chimney's shaft under a white
tint with `normalScale` 0.6, keyed by kind, phase and colour (new work is drawn in the colour pulled toward green), and
records the flat colour in `userData.flatColor`; a post is the flat colour; without a canvas (node) a chimney is too.

**UVs**: `buildWallGeometry` ends with `addWallUVs`, which gives every triangle UVs in inches by its flat normal:
faces along the wall (long faces, jambs of a gable triangle, the part above the plate) take u = distance along the
centerline from the wall's start, v = height above the level's floor top; faces across the wall (jambs, free ends)
take u = distance across the wall; top and bottom faces (also the sloped tops under a roof) u along, v across. A
wall's courses therefore run level and continuous across its pieces, openings and the gable triangle, restart at each
level's floor top, and need not line up across a corner (the horizontal courses do; the vertical joints do not).
Columns and their parts get `addBoxUVs`, also in inches per triangle: faces turned up or down take (x, plan y); a
vertical face with normal (nx, 0, nz) takes u = x t.x + z t.z along its tangent t = (-nz, 0, nx) and v = Y, so a
chimney's courses run level round all four faces and its bond is not stretched across any of them.

**Opening fills** (`openings3d.ts openingFill`, pure): a window or door becomes boxes in the wall's own frame (s along
the centerline, d from the mid plane toward the outside, y above the floor top); `meshes.ts buildOpeningFill` turns
each into a `prism`, merges them per material part and gives each part UVs in inches (`addWallUVs`, so the screen
mesh has the siding's scale). Window: trim (head and two jambs, `trim` wide, 4" default, 1" proud of the outside
face), a 1.5" sill projecting 1" past the trim, and `sashes` side by side (`sashSpans`) with 2" mullions between them
(part `sash`, the full hole height, 1.75" deep); with `fixedCenter` and 3 sashes the side sashes are
min(24", (w - 4") / 4) wide and the centre one takes the rest (24 / 92 / 24 at 144"). Each sash has its own frame of
four 1.5" boards 1.75" deep round its own pane: `(cols - 1)` vertical and `(rows - 1)` horizontal 0.75" muntins
(default 2 x 3 lites per sash, never wider than half a lite) over one 0.25" glass pane at mid-wall, a single pane in
a fixed centre, or with `glazing: 'screen'` a 1" frame round a screen (part `screen`) and no muntins. `shutters` add a
1" board each side flanking the trim, one sash wide (w / sashes, clamped to 10" to 18"), with two 3" battens across it
at a quarter and three quarters of its height, 0.75" proud (kind `batten`). Door: the same trim, one frame of 1.5"
boards, and one 1.75" leaf, or two meeting at the centre when `sashes` is 2 or more (a double door). A leaf has two
stiles (5") and two rails (5" top, 8" bottom) round a 0.75" recessed panel; lites larger than 1 x 1 (the default)
glaze the panel with glass and muntins instead; `halfLite` glazes the upper 55% of the panel area with the lite grid,
with a rail under the glass and two recessed panels either side of a 5" centre stile below it. A door's muntins are
part `leaf` (its colour). A screen door (`glazing: 'screen'`) has a leaf of 1.5" stiles and rails, a 4" mid rail
(kind `midRail`) centred 36" up and a screen above and below it, no panel. A sliding door (`sliding`, on a door
only: `isSlidingDoor`) has the same trim and frame and two panels in place of leaves, framed like window sashes
(part `sash`, so the sash colour): each from its jamb to 1" past the middle (`SLIDING_LAP`, 2" of overlap), the start
one in the outside half of the leaf's 1.75" and the other in the inside half, with 2.5" stiles and top rail and a 4"
bottom rail round a pane with the lite grid per panel (1 x 1 by default, one pane) or a screen; `sashes` and
`halfLite` do not apply. On the plan (`openingSymbol`) it is two lines, one per panel, a third of the wall's
thickness out from the centerline either side, with no leaf and no swing arc; its swing is kept but not drawn, and
the dimension labels and Fit ignore it. Passages stay open.
The outside is found by `outwardSide`: the side of the wall with no closed room beside it when the other has one
(`facesBesideWall`), else the side facing away from the level's node centroid. `getLevelMeshes` returns
`openings: OpeningMesh[]` (id, type, phase, `leafColor` after its default, and one geometry per part: `trim`, `sash`,
`glass`, `screen`, `leaf`, `shutter`), cached per opening object, wall object, footprint, wall height and outside
side, and disposed like the rest. Materials (`openingMaterial(part, phase, leafColor)`): trim tan, sash and window
muntins white `#f4f1ea`, glass a `MeshPhysicalMaterial` in dark blue-grey `#243139` at opacity 0.75 reflecting the
sky environment map (see "3D"; transparent, no depth write, drawn after the opaque meshes), the screen with the screen texture (transparent, opacity 0.85 over the texture's alpha, no depth write,
drawn after the opaque meshes; `FrontSide`, since the pane is a closed box and both faces at once would double its
darkness), leaf `#2f3a33` or its `leafColor` (materials shared per part, phase and colour), shutters `#3f6f5f`; a
demolished opening is translucent red, a new one pulled toward green. Fills follow `isOpeningVisible` like the hole
they sit in. The Opening panel has "Sashes" (1 to 6; "Leaves", 1 or 2, for a door), "Fixed centre pane" at 3 sashes,
"Glazing", the lite grid per sash, leaf or panel, and for a door "Sliding" (which hides the hinge, the swing, the
leaves, "Half lite" and "Leaf colour"), "Half lite" and "Leaf colour" with a reset.

**Roofs** are three geometries per roof (`buildRoofParts`): the slab with the ridge cap (the roof's material), the fascia
and rake boards (`fasciaMaterial(phase, boardColor)`), and the rafter tails (`rafterMaterial(phase, boardColor)`, the same
colour); `RoofMesh` carries `boardColor` and `weathering` after their defaults. The slab has UVs in tiles, not inches
(`addRoofUVs`, per triangle by flat normal like `addWallUVs`): a roof tile is 24" across the slope by 48" down it
(`ROOF_TILE`). On faces turned up or down, `down` is the plan direction the face slopes toward (the ridge frame's v on a
level face) and `along` is square to it; u = dot(p, along) / 24 and v = dot(p, down) x sqrt(1 + k^2) / 48 with k the
slope, so corrugations run down the slope, repeat every 24" / 9 = 2.67" along the eave and courses are measured along the
slope, not squeezed by it. Vertical faces (the slab's edges, the cap's sides) take u along the face / 24 and v = Y / 48.
The roof textures therefore use `repeat` (1, 1), not the siding's 1/48.

**Roof textures** (`textures.ts roofTexture(finish, color, weathering)`): a 512 px tile for 24" x 48" (up the canvas is
down the slope), cached with its normal map per finish, colour and weathering to the nearest 0.05 (`quantizeWeathering`),
so a slider does not make a texture per step. Metal: corrugated, 9 ribs a tile (`ribHeight`, 1/2" deep), crests light and
troughs dark, rust streaks that fade downhill (`rustStreaks`: from fasteners, along the ribs, a few broad stains; a seeded
layout whose opacity is the weathering times its base, none at 0); its normal map is the rib profile (`normalFromHeight`,
`strengthY` for the non-square texels). Shingle: 10 courses of 4.8" (5" does not divide the tile), 12" tabs with 1/4"
slots staggered half a tab, a shadow under each butt; its normal map has the butts and slots. `roofMaterial(finish, phase,
color, weathering)` keys by finish, phase, colour and quantized weathering (shingle ignores it): the texture under a white
tint, the normal map at 0.6, the flat colour in `userData.flatColor`; metal has metalness 0.35, roughness 0.55. New work is
the colour pulled toward green with no rust, demolished is translucent red, and without a canvas (node) the flat colour
shows. A chimney is brick in its own colour (above).

**Export** is colours only. Every exported material is a clone of the live one with `map` and `normalMap` dropped and,
for a textured one, its flat colour (`userData.flatColor`: `wallFlatColor` for walls, the roof's colour for roofs, the
column's colour for a chimney) set.
Walls are named `wall_<phase>_<kind>` for the default look and `..._<finish>_<hex>` otherwise;
roofs `roof_<finish>_<phase>` (plus `_<hex>` when recoloured), `Fascia` meshes `fascia_<phase>` and `Rafters` meshes
`rafter_<phase>`, both plus `_<hex>` in a board colour other than tan (not when demolished). Each opening part is
a mesh named `Window` or `Door` with the material `trim`, `sash`, `glass`, `screen`, `door_leaf` (`door_leaf_<hex>`
for a leaf in another colour, unless demolished) or `shutter` (`_new` / `_demo` for other phases). Columns are
`column_<kind>_<phase>` (plus `_<hex>` in a colour other than the default, not when demolished), a chimney's cap and
spark arrestor `chimney_cap_<phase>` and `chimney_arrestor_<phase>` (see "Site and terrain"). UV attributes are
still written; no texture or image is. The Export menu says "Siding textures are not exported; colours are."

## 2D editor

One `<svg>` with a single `<g transform="translate(tx ty) scale(k)">`. Transient state (cursor, snap,
rubber band, length buffer, drag preview) lives in `uiStore.draft` and only `Overlay.tsx` subscribes
(plus the status bar's small readouts, each selecting one value). The overlay `<g>` has
`will-change: transform`, its own compositing layer, so a pointer move re-rasters only the overlay.
Entity components are `React.memo` and select their entity by id; layers select their id lists with
`useShallow`, so a drag step re-renders only the entities it changed (room fills and labels select
per face id). The merged wall paths depend on the walls, footprints and openings only, never on
hover or selection: `WallHighlightLayer` redraws just the hovered and selected walls on top (fills
between the merged fills and outlines, selected outlines last). `vector-effect="non-scaling-stroke"`.
Text that must stay constant on screen uses `scale(1/k)` from one `useViewport()` subscription.
Native `addEventListener('wheel', h, {passive:false})` via ref; `setPointerCapture` on pointerdown;
`touch-action: none; user-select: none`. Screen->world = `((clientX - rect.left) - tx) / k`, from our
own viewport state, never `getScreenCTM`.

### Snapping (`snap.ts`)

`snapPoint(raw, ctx) -> {point, kind, nodeId?, wallId?, guides}`. Radii in screen px, divided by k.
Priority: node (10px) > wall midpoint (8px) > on-wall projection (8px) > level-below corner
(`ghost-node`, 10px) > level-below wall (`ghost-wall`, 8px) > alignment guides to any node's x or y
(6px) > grid (settings.snapGrid). The ghost kinds exist only while "Show level below" is on:
`tools/index.ts` passes the lower level's visible nodes and wall centerlines as `ghostNodes` /
`ghostWalls`, and a ghost snap carries no node or wall id, so the wall tool always makes a new node
on the active level at that point (hollow grey marker in the overlay). Ortho lock (default on, Shift inverts while held,
`O` toggles): with a start point, project raw onto the horizontal or vertical axis through it first,
then only accept node/on-wall snaps within 1" of that axis. With ortho off, Shift snaps to 15 deg.

### Wall tool with typed lengths

States: idle -> drawing(start) -> drawing(next start) chained -> idle on Esc / double-click /
right-click.
1. Click (snapped) sets the start; reuse a snapped node, or split a wall if snapped on-wall.
2. Mouse move: rubber band start->snapped cursor; live length shown at the midpoint and in the status
   bar. Direction = snapped cursor minus start (ortho-locked by default). Default +x if not moved.
3. Typing any of `0-9 ' " / . - space` starts a length buffer (not an `<input>`; the canvas has
   `tabIndex=0` and owns key events; buffer lives in uiStore). Shown next to the cursor and in the
   status bar; the rubber band previews the typed length along the current direction. Backspace edits,
   Esc clears the buffer (second Esc cancels drawing).
4. Enter or Tab: parse; on failure flash red and keep the buffer. On success end = start + dir*len,
   adjusted for the `measureTo` preference (inside/outside face: add or subtract half the thickness of the
   walls at each end along the direction so the typed number is the face-to-face distance; v1 may
   approximate with the new wall's own thickness). If end is within node-snap radius of an existing
   node, use that node and tell the user in the status bar. One `addWall` set. New end node becomes
   the next start; direction persists.
5. Click without typing commits at the snapped cursor.

### Editing tools (docs/history/REVIEW-2.md batch B)

- **Move a wall by a distance** (`model/offset.ts planWallOffset`, store `offsetWalls(levelId, ids,
  distance, side)` / `shiftWalls(levelId, shifts)`, one undo step, null or the refusal message).
  `side` is relative to each wall's a->b direction; the shift is the left normal times the distance
  (negated for right). Walls collinear with a moved wall at its nodes move with it (followed node to
  node; two shifts on one line refuse). Each node of a moved wall: where two moved walls meet at an
  angle, the crossing of their target lines; with one target line and no other wall, the shift;
  otherwise the target line crossed with the neighbour closest to perpendicular, every other
  neighbour agreeing within 0.01" or "That corner has walls at odd angles; move its corner instead".
  A wall that would shrink to nothing or turn round refuses; `movesCreateOverlap` (batch A) refuses
  overlaps. Nodes move with `moveNodesInPlace` (openings keep their offset on the moved walls and
  their distance from the fixed end on the stretched ones), then `normalizeLevel`. The wall panel
  has "Move" plus two buttons named by `ui/wallMove.ts wallSideNames` (room, "outside", or "left /
  right of wall"); `runWallMove` puts the rooms' new net sizes in the status bar. Shift+arrows in
  the select tool shift the selected walls 1" (`nudgeShifts`: side by dot product, walls along the
  arrow skipped).
- **Box tool** (`tools/rectTool.ts`, B): first corner snaps like the wall tool (`ctx.snap`, no
  ortho); the box goes toward the cursor's quadrant. The buffer holds two sizes split by `x`, `×`,
  `by` (`lengthBuffer.ts splitSizePair`; Tab inserts ` x `). Typed sizes follow "Lengths to": each
  side's centerline is the face size plus (inside) or minus (outside) half the thicknesses at its
  two ends; a side through the first corner that lies along a visible wall takes that wall's
  thickness. Parts of a side already covered by a visible wall are left out (reused); the rest go to
  the store's `addWalls`, which dry-runs the segments on a copy of the level and adds all of them in
  one set (one undo step) or none (overlap message, first corner kept).
- **Measure tool** (`tools/measureTool.ts`, M): `measureSnap` takes the nearer of a wall-face
  corner and a node, then the usual snaps, then face edges. `draft.measure {a, b}`; the second click
  sets `draft.message` to "Measured …" (kept until Esc or the next measurement); the overlay draws
  the dimension line and dashed dx / dy legs. No plan change. The select tool's wall and corner
  drags put `draft.dragReadout` ("moved 6 1/2" east") in the status bar.
- **Hit priority** (`selectTool.hitTest`): nodes, then an opening's own rectangle (`hitOpeningRect`:
  jambs and wall faces plus 2 px), then walls, then door leaves and swings (`hitOpeningSwing`), then
  room labels, fixtures, stairs, decks, roofs. A click (no drag) on the opening that is the whole selection selects
  its wall; the status bar says "Click again for the wall" while one opening is selected.
- **Plan export** (`io/exportPlan.ts`, loaded on first use): `PlanLayers` reads its stores through
  `editor2d/layerStores.ts` (`useLayerPlan` / `useLayerUi`, the app's stores unless a
  `LayerStoresContext` provider gives others). `planSvg(plan, levelId, viewMode)` renders the layers
  with `renderToStaticMarkup` inside a provider of two throwaway zustand stores holding the plan and
  a UI snapshot (no selection, hover, draft or underlay; zoom = `EXPORT_PX_PER_INCH` = 2, i.e. 1/4" =
  1'-0" at 96 dpi). A server render reads a store's initial state, which for those stores is the
  snapshot, so the layers needed no export props. The viewBox is the level's drawing bounds
  (footprints, roofs with overhangs, stairs) plus 24" and a 96 px title block (plan, level, view,
  scale, date, scale bar, north arrow turned by `site.northAngle`), in whole pixels, at least 560 px
  wide; width and height are given in inches so it prints at scale. The layers' CSS lives in
  `editor2d/planStyles.ts` (`PLAN_STYLES`: the plan colours on `:root` and the layer rules), which
  `main.tsx` injects into the page and the export inlines. `planPng` draws the SVG on a canvas at 2x.

### Feet-inch parsing (`model/units.ts`)

Whitespace-insensitive, case-insensitive, `ft`/`in` synonyms for `'`/`"`.
```
length   := feet [sep] inches? | inches
feet     := number ("'" | "ft")
inches   := (number [space fraction] | fraction) ('"' | "in")?
fraction := int "/" int
sep      := "-" | space | ""
```
Bare number = inches. `150`->150, `12'`->144, `12.5'`->150, `12'6`->150, `12' 6"`->150,
`12'-6"`->150, `12-6`->150 (dash between two numbers is the architectural separator), `6"`->6,
`6 1/2"`->6.5, `6 1/2`->6.5, `1/2`->0.5, `12' 6 1/2"`->150.5, `12'6-1/2"`->150.5, `12' 6.5`->150.5.
Leading `-` negates. `3/0`, `12'6'`, empty -> error. Never rounded on parse.

`formatLength(inches, denom=16)`: round to nearest 1/denom (half up), reduce the fraction.
`0`->`0"`, `6`->`6"`, `6.5`->`6 1/2"`, `0.125`->`1/8"`, `150`->`12'-6"`, `144`->`12'-0"`,
`150.5`->`12'-6 1/2"`, `-150`->`-12'-6"`. Compact variant for labels drops `-0"`: `144`->`12'`.
`formatArea(sqIn)` -> `184 sq ft`.

### Keyboard (`ui/keymap.ts`)

One table, `KEY_BINDINGS`, drives both the global hotkey handler (App.tsx) and the `?` help
overlay. A binding has display keys, a label, a group, and optionally normalized combos
(`comboOf`: `mod+` for Ctrl or Cmd, `shift+` only for letters and named keys, so `?` is `?`) with
a runner; rows without combos are keys the tools or the walk view handle, listed for the help.
Order of handling: focused text fields, selects and sliders keep their keys (except Ctrl/Cmd+S
and +O, which commit the field and run); walk mode keeps its keys; an open help dialog takes all
plain keys (Esc or `?` closes it); then the active tool; then, while a typed length is pending,
every other plain key is swallowed; while a wall chain or calibration is in progress only bindings
marked `whileDrawing` run. Committing a properties field with Enter (or a select change) blurs it
and focuses the canvas, so the next Ctrl+Z undoes the plan, not the text.

### Narrow windows

Below 1400 px the toolbar drops the hotkey suffixes (the tooltips keep them), and below 1100 px it
also uses short tool names (Image, Opening, Tape) so it stays within two rows (CSS only; the long names stay in the DOM, hidden). Below 900 px (`NARROW_QUERY`
in `uiStore.ts`, mirrored in `index.css`) the level bar and properties panel float over the plan
instead of squeezing it, start closed, and toggle with the toolbar's Levels / Properties buttons or
the `[` and `]` keys (`levelBarOpen` / `propertiesOpen`; the keys do nothing in a wide window). The
split layout keeps the plan, shows a one-line hint, and does not mount the 3D canvas.

## Undo/redo

zundo `temporal` on planStore only, `partialize: s => ({plan: s.plan})`, limit 200. uiStore is not
tracked. Drag grouping: the first set of a drag is tracked, then `temporal.getState().pause()`,
moves are untracked, `resume()` on pointerup. One undo reverts the whole drag.

## Checks (`derive/checks.ts`, `model/codeLimits.ts`, `ui/checks.ts`, `ui/ChecksPanel.tsx`)

The code checks judge the proposed design (the proposed view, whatever view is showing: the
existing house is recorded, not designed) and return `Issue`s: a stable `id` (code, level and
sorted target ids, `issueId`), a `code` (`guard.deck-edge`, ...), a `severity` (`error`, `warning`
shown as "Check", `info` shown as "Note"), a `category`, the `levelId`, a plan point `at` and an
optional `outline` to draw when the issue is picked, the `message`, the code section `ref`, and
the `target` ids by selection kind. `getIssues(plan)` gathers every family (one file each:
`guardChecks.ts`, `stairChecks.ts`, `structureChecks.ts`) and orders them by level, severity, category and message; it is memoized
per plan object (`WeakMap`), so the panels, the list and the tests share one array per plan.
`issuesFor(issues, levelId, target)` picks an element's issues; `issueCounts` splits what to check
from notes.

The code's numbers are in one table, `model/codeLimits.ts` `CODE`, each with its value, its section
in the 2024 IRC numbering the 2025 Residential Code of New York State is built on, the older
section (`codeRef` quotes both: "R321.1 (was R312.1.1)") and a few words. New York's 8 1/4" riser
and 9" tread are its amendments; every entry is to be verified against the code text.

Guards (`guardChecks.ts`, from the layouts the 3D uses, in the proposed view): a deck edge with no
railing, no wall behind it and more than `CODE.guardDrop` (30") over the ground (`edgeDrops`) is a
warning; a floor opening's edge with no guard and no wall along it is an error.

Stairs (`stairChain.ts`, `stairChecks.ts`, new pieces only: existing stairs are recorded as they
are). `flightLinks` joins the pieces of a level into stairways: B follows A when B's bottom edge
(`stairsOutline` points 0 and 3) lies within `LINK_TOL` (1") of any edge of A's outline and B's base
is A's top (`stairsTop`) within 1/2" (a turn leaves a landing by its side, as the starter's flights
leave the platform and the landing); `stairChains` follows them bottom first. Each flight (two
risers or more) is held to the NY riser (8 1/4") and tread (9") limits, the 36" width, 151" of rise
without a landing, a handrail on four risers or more (a warning: a rail on a wall is not drawn) and a
graspable one (the drawn rail is a 3 1/2" board: a warning until the staircase styles); every piece
to 6'8" of headroom, sampled every 6" across the width from the nosing line (the walking surface on a
landing) to the underside of the floor above, except under a floor opening or a hole a flight cuts;
and every edge that no piece of the stairway joins, no railing guards and no wall stands along is an
error (category guard) where the surface is more than 30" over what is beside it (the floor inside
the house, the ground outside, a lower piece of stairs). Per stairway: risers within 3/8" of each
other, the last one up to the floor above counted when it is about a riser (a stairway that stops
lower reaches something not drawn); a landing (a one-riser piece) as wide as each flight it serves,
measured across that flight's travel, and 36" deep along it. Flights that reach a deck (its
layout's `openings`) arrive at its boards, not at the floor above. A staircase's style is checked
too: its handrail 34" to 38" over the nosings, a graspable one (a flight on its own, or a staircase
with the board rail, gets `stair.handrail-grip`), balusters under the 4 3/8" sphere, nosings of
3/4" to 1 1/4" where treads are under 11", no wall rising into its underside, and no piece left
unjoined (`stair.chain-broken`). Headroom counts the beams over the level too (a dropped beam, or a
flush one deeper than the joists), sampled every 1 1/2" where there are beams.

Structure (`structure.ts`, `structureChecks.ts`; see "Structure" for the inference): a wall taken
out that bears in the house as it stands, wherever what it carried stays (the floor above, or a
roof kept over it), needs a wall or beam of the proposed view on its line or within the joists'
depth of it (R502.4), sampled every 6"; gaps of 12" or more are a warning (an error when the wall
is marked bearing) (`structure.bearing-removed`). Each end of a new beam bears on a wall at least
1 1/2" along the beam (3" on a block, stone or river-stone wall, `isMasonryFinish`), or on a post, or on another beam (a hanger) (R502.6,
`structure.beam-end`). The load from each end of a new beam and from each new post is followed
down (`structure.load-path`, R301.1): at each level below, the wall, post or beam under the point
(a beam passes it to its two ends); on the lowest level a wall is a foundation wall and a post needs
a footing (`structure.footing`, R403.1); nothing under it is an error, or a note when the level is
not drawn at all. Notes (`info`, "HDR" on the structure overlay): a new floor opening's or a
cutting flight's edge across the joists with no wall or beam along it wants a header (single,
doubled over 4', on hangers over 6': R502.10, `structure.opening-header`); a new opening cut in an
existing bearing wall wants a header (R602.7, `structure.wall-opening`). A level where an existing
interior wall comes out and no joists are set gets `structure.framing-unset`. Issues of one code on
one element are told apart by a part suffix on the id (a beam's ends, an opening's edges).

The UI keeps a copy: `ui/checks.ts startChecks()` (main.tsx) sets `uiStore.issues` at start and
`CHECKS_DELAY_MS` (150 ms) after the plan stops changing, so a drag does not re-run the checks at
every step. The status bar counts errors and warnings ("2 to check", or notes when there are only
notes) as a button that opens `ChecksPanel` over the plan (`uiStore.checksOpen`): issues by level,
notes behind a checkbox, and **Show** (`showIssue`): out of the 3D-only layout and the existing
view, onto the level, the target selected, the plan centred at the same zoom, and the issue picked
(`pickedIssueId`). `editor2d/ChecksLayer.tsx` (rendered by PlanCanvas, not by PlanLayers, so the
plan export never draws it) marks the active level's issues with a disc of constant screen size and
outlines the picked one. The properties panel's `IssueNotes` lists an element's issues under its
fields (the deck and floor opening panels' old hand-written warnings are these now).

## Staircases (`model/stairStyle.ts`, store `groupStairs`, `selectTool.ts liftToStaircase`)

A staircase groups a stairway's flights, landings and platform (schema 6, `Level.staircases`). The
pieces name it (`Stairs.staircaseId`); it has no list of them and no phase. `migrate()` keeps its
style fields one by one (a bad one is dropped with a warning and its default applies, colours
lower-cased), forgets a piece's `staircaseId` that names no staircase on its level, and drops a
staircase no piece names; the store does the same (`pruneStaircases`) whenever stairs are deleted.
`groupStairs(levelId, ids, style)` makes one (taking the pieces out of any other), `updateStaircase`
patches its style (undefined clears a field, `staircaseFieldProblem` refuses a bad value),
`ungroupStaircase` lets the pieces go, `moveStairs` moves pieces in one undo step, and
`deleteEntities` / `setPhase` take `staircases` (deleting or phasing their pieces).

On the plan a click on a piece selects its staircase (`Selection.staircases`, `liftToStaircase`);
dragging it moves every piece; a double-click on a piece opens the staircase
(`uiStore.openStaircaseId`): clicks then pick its pieces alone until Esc (back to the staircase
selected) or a click elsewhere. Its pieces draw selected with it. The panel names it, sets its
phase and style, lists its pieces in stairway order (each a button selecting it alone) and their
issues, and ungroups it; a single piece offers "Make one staircase" (of the stairway it is part of,
`stairChains`), several selected flights the same.

**Its parts** (`derive/staircase.ts getStaircaseLayout`, memoized per plan and by a signature of
its pieces, style, floor to floor and the walls under it). Every part is a `StairSolid`: a plan
polygon between two height fields (`HeightFn`, z = max(min, c + g . p): level, or a plane along a
piece's slope), in the tread colour or the paint, in a group (stair, frame, rail); meshes.ts builds
one geometry per group and material with `slopedPrismPositions` (`buildStaircaseParts`), and the
pieces are not drawn on their own. The pieces, in stairway order (`stairChains` over the members):

- treads `treadThickness` thick, each overhanging the riser in front of it by `nosing`, on a carcass
  lowered by that thickness (so no faces lie on each other facing the same way); the carcass is
  solid to the floor (`underside: 'solid'`, and any piece 12" high or less), or framed: under each
  step down to a soffit following the nosing line `STAIRCASE.frame` (9 1/4") under the treads,
  square to the slope, and a landing on a 9 1/4" frame with a 3 1/2" post at each corner that no
  wall holds and no lower piece carries; `open` (or a piece's own `open`): two stringers. A piece's
  underside (`undersides`, null when solid) is what the closet walls and the checks read.
- walls under a piece: where a wall's footprint lies under it and stops at or below the underside,
  a panel (`frame` group) closes the gap up to it; a wall that rises into it is in `wallsThrough`
  (the check `stair.wall-through`).
- rails: each railed side (a flight's left or right, a landing's left, right or `end`) is a run
  between two newel centres half a newel in from its edge, a flight's at `-c` and `run + c` along
  it, so a flight's newels stand on the piece below (or the floor) and on the piece above (or the
  floor above when the stairway arrives there); newels within an inch of each other are one, so at
  a turn both flights' rails die into one newel on the landing. A newel (5 1/2" box with a 7" cap,
  or a 3 1/2" post) stands on the surface under its centre and rises `newelAbove` (4") over the
  highest rail it takes. The rail (2" round drawn square, or a 3 1/2" x 1 1/2" board) runs from
  newel face to newel face `handrailHeight` over the nosings; 1 1/4" balusters stand on the treads
  under it at most `balusterGap` apart.
- a bullnose (`startStep`): a disc of 8" round the starting newel (the one on or just in front of
  the first piece, nearest its bottom edge), clipped to the front of that piece; its tread starts
  past the piece's own nosing.

A floor opening a staircase's flight arrives at takes its style (floorOpenings.ts `guardStyle`):
its newels as the guard's posts, its rail as the cap (`rail`, in the tread colour; the rest in the
paint), balusters on the floor (no bottom rail), at least 36" high; at a railed side of the
arriving flight the guard's run reaches on to the stair's top newel and drops its own post there
(`railingParts` takes `RailSizes` and per-run `RunEnds`). On the plan (`StaircaseShape`) the rails
are heavy lines, the newels squares and the bullnose an outline; the pieces leave their own rail
lines out. The export names the parts `Stairs`, `Stair framing` and `Stair railing` (materials
`stair_tread_<phase>_<hex>`, `stair_paint_<phase>_<hex>`), and the styled guard `Guard` in the same
materials.

## Structure (`model/structure.ts`, `derive/members.ts`, `editor2d/tools/structureTools.ts`)

Schema 7 (docs/history/PLAN-v8-stair-structure.md M5). The tool draws and checks the load path; it
does not size anything, and every size it starts with is a placeholder for the engineer.

```ts
interface LevelFraming { joists: Degrees; depth?: Inches }          // Level.framing?
interface JoistZone { id; outline: Vec2[]; joists: Degrees; phase }  // Level.joistZones
interface Beam { id; kind: 'beam'; a; b; width; depth; mount: 'flush' | 'dropped'; phase; label?;
  za?; zb?; color?; profile?: 'log' }
interface Post { id; kind: 'post'; at; width; depth; rotation; phase; label?;
  footing?: { width; thickness }; base?; top?; color?; profile?: 'log' }  // Level.members: Beam | Post
```

A level's framing is the floor above it (on the top level, the ceiling under the roof), so a beam,
the walls it bears on and the joists it carries belong to one level, as framing plans are drawn.
`joists` is the joists' axis in plan degrees, normalized to [0, 180) (`joistWords` names it against
the north angle). A joist zone overrides it over its outline (a part built in another stage); the
last zone shown at a point wins (`joistsAt`). The joist depth is the framing's, else the level
above's `floorThickness` less the 3/4" subfloor (`SUBFLOOR`), else 5 1/2" for an attic
(`ATTIC_JOIST_DEPTH`); their top is `wallHeight + depth` over the floor (`joistTop`). A flush beam's
top is the joists' top, a dropped one's the wall height (`beamHeights`). A post runs from the floor
up to the underside of the lowest beam over it that can be seen with it, else the wall height; its
footing (lowest level only, `memberProblem`) sits under the slab (`memberBoxes`). Defaults
(`MEMBER_DEFAULTS`): a flush beam of two 1 3/4" x 11 7/8" LVLs, a 6x6 post, a 24" x 12" footing.

Tools: the beam (I) takes two clicks that snap like wall corners (the draft's `measure` holds the
first, so the overlay draws the line); the post (L) snaps to beam ends on its level and the one
above; the joist zone is an outline tool started from the Level panel, its joists square to the
level's. The select tool picks posts before walls (a post often stands in one) and beams after
them, drags the selected members together (`placeMembers`, one undo step), drags a selected beam's
end with the wall snap, and picks a joist zone only near its edge while the overlay is on (a click
inside is the room). Box-select takes members with every point inside.

2D: `MembersLayer` (over the walls) draws a beam as its dashed outline (it is overhead) and a post as
a box with an X over its dashed footing. `StructureLayer` (Y, `uiStore.showStructure`, under the
stairs) hatches the joists 16" apart over the level's inside slab outline, masked out of the joist
zones, which hatch their own way; arrows say "Joists N-S"; walls marked bearing get a dash-dot
line; beam labels show. The plan export takes the UI's `showStructure`, so a framing plan is an
export with the overlay on.

Timbers: a beam with `za`/`zb` (its top over the floor at a and at b, both or neither) or a post
with `base`/`top` is a timber at set heights (`isTimber`), with an optional `color`: a beam slopes
between its two tops, `depth` deep square to it (`timberTop`; drawn with `slopedPrism`, plumb
ends), and may stand above the ceiling (a truss in a gable). The structure checks and the bearing
inference do not follow timbers (supports, beam ends, load paths, header carriers, posts stopping
under beams); a timber over a flight still counts against its headroom. The panel's "Set heights"
turns a member into a timber and back.

3D: `getMemberMeshes` (cached per level and view like the decks, by each member's boxes) clips
every member 1/16" under the ceiling (`MEMBER_INSET`): a flush beam is drawn only where it hangs
below the ceiling (none when it is no deeper than the joists), and nothing shares a slab's face; a
footing stops 1/16" under the slab; timbers are drawn as set. Materials `memberMaterial` (pale
wood, concrete, or a timber's colour); the export names the meshes `Beam`, `Post` and `Footing`
(materials `member_<part>_<phase>`, plus `_<hex>` for a timber's colour).

Logs: a beam or post with `profile: 'log'` (`isLog`) is a round log, `width` its diameter and
`depth` kept equal to it (`cleanMember`, `migrate()`); `memberProblem` refuses any other profile.
`memberAxis(m, boxes)` gives its centreline over the floor: a post's up through `at` from its body's
bottom to its top (the top it is drawn to, clipped under the ceiling unless a timber), a sloped
timber's along `timberTop` half its plumb depth down, a level beam's halfway up it (drawn whole, not
clipped). `logBetween(a, b, diameter)` builds the log upright along +Y: the body a `FLUE_SIDES`-sided
cylinder (`circleOutline`, `prism` without caps) with `roundNormals`, the two end discs apart
(`prism` without sides), then turns both onto a to b with one `applyMatrix4` (a quaternion from +Y,
then a move to a). `MemberMesh.ends` holds the discs, in `memberMaterial('end', ...)`: the end grain,
the member's colour 60% toward cut wood `#d9b98a` (`logEndColor`, `CUT_WOOD`: a dark stained log shows amber
ends, a peeled one honey), else `MEMBER_COLOR.end`; the export names them
`Log end` (`member_end_<phase>`). On the plan a log post is a circle (`MemberShape`) and picks as one
(`selectTool` hitTest); a log beam keeps its outline. The panel's "Round log" checkbox turns it on and
off; a log shows Diameter in place of Width and Depth, and a log post no Rotation.

Which walls bear (`derive/structure.ts` `wallBearings(plan, view)`, memoized per plan and view,
top level first): a wall's mark wins; an exterior wall bears when the joists over it cross it (45°
or more) or are not set; any wall bears when a bearing wall of the level above stands on it
(parallel, within the joists' depth, overlapping 12"), a post above stands in it, or a beam of its
level ends in it; an existing interior wall whose collinear run is 4' or more bears when the joists
cross it and would span more than 14' (`SPAN_LIMIT`) without it, measured from points a quarter,
half and three quarters along it to the nearest wall or beam that crosses the joists either way
(`spanWithout`). A new wall never bears by span. `bearingOf` reads a wall in the view it is seen
in: the house as it stands for a demolished wall or the Existing view, after the work otherwise.
The Wall panel says what the tool made of an unmarked wall; the overlay draws marked bearing walls
dash-dot and inferred ones lighter.

## Renovation moves (`model/renovate.ts`, `ui/wallMove.ts`, `editor2d/WallMovePrompt.tsx`)

Moving a wall is a correction (it moves in every view: today's `shiftWalls`, `moveNodes`) or, for a
wall of the house as it stands moved while drawing new work, a renovation, and the editor asks which:
`requestWallMove` runs the move at once unless `needsRenovationChoice` (Draw as: new, a view that
shows new work, an existing wall among the moved ones) and the same walls were not just corrected
(`uiStore.wallMoveChoice`); then `WallMovePrompt` asks (R or Enter rebuild, C correct, Esc leave it;
its keys are taken in the capture phase, before the tools) and `resolveWallMove` applies the answer.
The panel's Move buttons, Shift+arrow nudges and the select tool's wall drag go through it; a drag
that will ask pauses the history before its first live step, and at pointer-up the plan goes back
to the drag's start (still paused) before the answer applies, so either way is one undo step. The
rebuild's shifts are the drag's displacement square to each wall (`perpendicularShift`); a
correction applies the dragged positions. Corner drags never ask.

`planRenovation(level, shifts)` is pure (on a `structuredClone`; the store's `renovateWalls` puts
its nodes, walls and openings in, one step). `planWallOffset` places the corners as a correction
would, with the walls running straight on from the moved ones; each moved existing wall is marked
`demo` with its existing openings and a `new` copy (same thickness, kind, finish, colour, height)
built between new nodes at the corners' places, with copies of those openings as new; its new
openings move to the copy; a moved new wall just moves. At each moved corner: a wall running on
through it (a T) is met further along (normalize splits it at the new node); a wall the move goes
away from gets a new piece out to the new corner; one it moves into is cut at the new corner and the
piece between demolished (removed, if it was new) with the openings on it. Refused: a demolished
wall (`DEMO_MOVE_MESSAGE`), a cut inside a door or window (`CUT_IN_OPENING_MESSAGE`), a new wall
lying on another (`WALL_OVERLAP_MESSAGE`), the corner rules of `planWallOffset`, and anything that
changes the existing view: `existingViewSignature` (the points every 3" along each existing or
demolished wall on a grid from the origin, its ends but for joints where two pieces of one wall run
on straight, and each such opening's centre and size) must come out the same. The new walls (between
new nodes) come back to be selected.

## Derivation and memoization

`derive/*` are pure functions of plan objects. `getGraph(level)`, `getFootprints(level, viewMode)`,
`getFaces(level, viewMode)` are memoized by `WeakMap<Level, ...>` (faces by the nodes/walls records,
labels by the rooms record). Store actions run on immer drafts and use the unmemoized
`computeFootprints` (a draft keeps its identity while mutated, so it must never key a cache). `getFootprints` compares each
wall's new footprint with the previous one by value and returns the previous object if equal, so
`<WallMesh3D>` can `useMemo` on the footprint reference and rebuild only changed walls. Dispose old
geometry in effect cleanup. That previous result (and the openings-by-wall one) is kept per level
id, not per Level object, so `pruneDerivedCaches(plan)` drops the entries of levels that are gone;
main.tsx calls it whenever `levelOrder` changes (New, Open). `getLevelMeshes` prunes its own
per-level-id caches, disposing geometry, on its next miss (so does `getDeckMeshes`, whose deck
geometry is keyed by the deck's layout object; see "Decks").

Room dimensions (`roomDimensions(face.netPolygon)`): the net outline with collinear vertices
merged (a T on a room's side does not break it), clockwise from the top-left corner; width x depth
when it is a rectangle. The room properties list them so typed lengths can be checked against the
tape.

### Image underlay (`model/underlay.ts`, `tools/underlayTool.ts`)

One optional `Underlay` per level: plan = origin + R(rotation) * (pixel * scale), the SVG transform
`translate(origin) rotate(rotation) scale(scale)` on an `<image>` drawn first on its own level only
(not on the ghost level below; uiStore `showUnderlay` hides it temporarily). Import
(`io/image.ts`) decodes with `createImageBitmap` (falls back to `<img>`), downscales to <= 2048 px
and stores a JPEG (0.85) data URL; PDFs are refused with a message. A new image is centred in the
view at a provisional 40' width, opacity 0.6, unlocked. Calibration is pure math the tool calls:
`calibrateScale(u, p1, p2, real)` sets scale = real / pixel distance and keeps p1 fixed;
`calibrateRotation(u, p1, p2)` turns about p1 so p1->p2 is axis-aligned (nearest axis). Underlay
tool (U) modes: move (drag, arrows 1", Shift 12"), scale by two points (click, click, type the
distance in the length buffer, Enter), rotate by two points. The select tool also drags an unlocked
image where nothing else is hit (Shift still box-selects). Picking is by `hitUnderlay` in the tools;
a locked image is never hit and never moves. The image is not part of snapping. The underlay
selection is `uiStore.underlaySelected`, exclusive with the entity selection. Store actions
`setUnderlay` / `updateUnderlay` are one undo step each; drags and opacity slides are grouped.

## 3D

r3f `<Canvas frameloop="demand">` (lazy-loaded chunk), invalidate on plan changes and on the UI
settings the 3D view uses (not on the 2D draft). One `<group>` per level at its floor top; meshes use
the cached geometry with `dispose={null}`. Shared `MeshStandardMaterial`s, flat shading, FrontSide:
existing warm grey, demolished translucent red (0.35, no depth write), new light green (in the All view only:
each mesh carries its shown phase, phase.ts `shownPhase`), exterior walls
textured by finish and colour (see "Exterior appearance"), the faces and floors rooms dress by their interior finishes
(see "Interior finishes"); slabs tan, stairs grey; roofs textured by finish (metal `#6e6259`
corrugated with rust streaks, metalness 0.35, roughness 0.55; shingle `#4a4a4a`), boards and rafter tails in the roof's board
colour, demolished translucent like walls, new pulled toward green. Fit 3D and the
walk start count roof overhangs and roof tops in the scene bounds.
The terrain is the ground (the lawn over the plan plus 100', and the far ground round it out to 1000', see
"Site and terrain"); drei `<Grid>` (12" cells, 10'
sections) is an overlay 1" above the lowest ground (`lowestGround`), toggled by the "Grid" checkbox in the 3D bar. Orbit (drei OrbitControls, makeDefault,
`maxDistance` 14000" so the camera stays inside the sky box)
framing the plan's bounding box on first mount; Fit re-frames the visible levels. Overlay toolbar:
level checkboxes, "Only active level and below", Grid, the view buttons (Perspective, N, S, E, W),
Fit 3D and Walk. Layout (uiStore): 2D, split (draggable divider,
ratio in uiStore) or 3D, toolbar buttons and backtick to cycle; the 2D canvas stays mounted (hidden
in 3D), the 3D canvas mounts only when shown. Camera near 1, far 40000 (scene in inches), so the far
ground's corners are in view from anywhere inside the sky.

**Light** (`Scene3D.tsx`; ACES tone mapping, r3f's default, at exposure 1.1, set on the renderer by
`SkyEnvironment`). The sun (`SunLight`) is a directional light at intensity 5.2 from `sunPosition(northAngle)`
(see "Site and terrain") that casts shadows:
`<Canvas shadows="percentage">` (PCF; three 0.186 has dropped PCF soft, r3f's default, and falls back to PCF
with a warning), map 2048 x 2048, bias -0.0002, normal bias 1.5". Its orthographic shadow camera is fitted
to `planBox(plan)` (every level) on each plan change by `bounds.ts sunShadowFit`: target the box centre,
the light twice the box's radius r toward the sun, a square frustum 1.1r either side of the axis, depth from
r/2 to past the far side of the box plus twice r over the sine of the sun's elevation, so the house's
shadow on lower ground is kept; a texel is about half an inch on the starter house (just over, since its
entry canopy). r3f applies props to
the light, never to its shadow camera, so an effect sets the frustum and calls
`shadow.camera.updateProjectionMatrix()`; the light's `target` is rendered as a `<primitive>` so its world
matrix follows its position. The shadow map does not depend on the camera, so `shadow.autoUpdate` is off
and `needsUpdate` is set when the plan or a UI setting that changes the scene's contents (`sceneUiChanged`:
view mode, level visibility, active level, site mode) changes, and when the fit changes: orbiting and
walking reuse the map. Shadows: every mesh receives them; walls, floors, stairs, roofs, fascia, columns
and opening parts cast them, except demolished work (translucent red would throw a solid shadow), glass
and screen walls, and the chimney's wire arrestor; the terrain and far ground only receive. The sky's fill is a hemisphere light at 2.4,
blue-white `#e1ebf6` from above and the lawn's bounce `#a39f7c` from below, so faces turned from the sun
(the north face) keep their siding visible while a sunlit face is about 2.6 times as bright as the eave
shadow on it (the south face reads about (115, 72, 66) in the sun and (44, 22, 18) under the eave). drei `<Sky>` is the backdrop: the same sun position, turbidity
6, rayleigh 1.5, `distance` 30000 (it scales a unit box round the origin that the camera must stay inside;
the far ground is inside it too), in a group with render order 2 and the ground at render order 1, so they
draw after the house's opaque meshes and the depth test can skip what the house covers.

**Glass and the environment map**: once per renderer `SkyEnvironment` renders a sphere (radius 50,
BackSide) with a gradient shader (blue zenith `#4d80bf`, pale horizon `#dde5ec`, green-brown ground
`#5e6044`) with `PMREMGenerator.fromScene` (size 128; no network asset) and hands the texture to
`materials.ts setEnvironmentMap`, which sets it on the materials that reflect the sky (glass); the generator
is disposed at once, the texture on unmount. It is deliberately not `scene.environment`: on every material
the extra image-based lookups cost about 270 ms a frame in headless SwiftShader, and on these matte
surfaces they add little over the hemisphere light. Glass (`openingMaterial('glass')`) is a
`MeshPhysicalMaterial` at its physical defaults (ior 1.5, no transmission pass): `#243139`, roughness 0.05,
metalness 0, opacity 0.75, `envMapIntensity` 2, no depth write, render order 1 after the opaque meshes, so
a pane reads dark with the sky in it, brightest at a glancing view; new glass is pulled toward green,
demolished glass is translucent red at 0.35. (At 0.65 the rooms behind, lit by the same unoccluded sky fill
as the outside, washed the panes out.) GLTFExporter writes it as a plain material named `glass`.

**Export is colours only**: `buildExportScene`'s `material()` clones the live material, sets `map` and
`normalMap` to null and, when the live material records `userData.flatColor` (wall materials, the
terrain), uses that colour; a textured live material keeps a white tint, so recording the flat colour is
part of attaching a texture.

**Frame cost** (headless SwiftShader, the starter at the screenshot poses, 1052 x 851): the 3D view before
these changes drew a demand frame in about 125 to 145 ms, now about 310 to 330 ms (a frame that redraws the
shadow map about 30 to 60 ms more). The additions: PCF shadow lookups about 80 ms, the lawn texture about
45 ms, the sky about 25 ms.

First-person walk (`uiStore.cameraMode`, overlay "Walk" button or `F` while the 3D view shows;
`view3d/FirstPerson.tsx`, pure helpers in `view3d/walk.ts`): the orbit controls unmount (saving
their pose) and drei `PointerLockControls` mount, so only one controls component exists at a time.
Entry (`walkStart`, REVIEW-2 C5): the point picked with "Walk from here" when it is on the start level
(looking +x); else 24" inside the level's first visible door in an exterior wall, at the door's
centre, looking in (`entryDoorPose`; the outside is `outwardSide`'s: the side with no closed room
when the other has one, else away from the level's node centroid, so the starter's house door from
the porch looks east into the hall); else the centre of the active level's outer face (the largest
room's label point if that is inside a wall), looking along +x. Eye 66" above the floor top, fov 65.
"Walk from here" is the select tool's right-click menu (`editor2d/PlanContextMenu.tsx`, absolutely
positioned over the canvas, closed by Esc, a click elsewhere, a tool or level switch); it sets
`uiStore.walkFrom {levelId, point}` (not plan data: not saved, not undone; dropped when its level
goes away), and "Clear walk start" appears once one is set. A click on the canvas
requests the pointer lock (our own call, so a refusal is caught; drei's document-wide click-to-lock
is disabled with a selector that matches nothing); while unlocked, dragging with the left button
looks around instead. WASD / arrows (by `KeyboardEvent.code`) move at 60"/s relative to the yaw,
Shift doubles it, using `useFrame` delta (clamped to 0.25 s), on what is there (`walkWorld`,
memoized per plan, view and the levels shown): surfaces to stand on (each shown level's slab
outline less its floor openings and the holes the flights below cut, a staircase's `stair` solids,
a lone flight tread by tread, deck boards, and the ground outside every level's outline) and
obstacles (stair solids from their underside to their top, rails and guards kept `BODY_RADIUS` 6"
away, lone flights' railings, deck boards and railings, floor opening guards). `walkMove` cuts a
move into 2" pieces; each goes where nothing stands between a step (`STEP_UP`, 9") and the waist
(`BODY_HEIGHT`, 48") over the feet and something is within a step up (`surfaceAt`: the highest),
sliding along x or y alone when the straight way is blocked; no surface refuses the piece. So the
feet climb stairs, fall into a stairwell, stay on the floor under a framed landing (its underside is
above the waist) and stop at a guard. The eye eases to the feet + 66" (`EYE_EASE`), and the active
walk level is the highest shown level whose floor is not above the feet (`levelAtFeet`). Q/E or
PageDown/PageUp jump through the levels the 3D view shows, putting the feet on that level's floor. Esc, `F`
or the pointer-lock `unlock` event return to orbit, restoring the orbit pose. Keys are captured on
`window` in the capture phase while walking, so the 2D tools and hotkeys never see them (App's
handler also ignores keys while a pointer lock is active). `frameloop="always"` while walking,
`"demand"` otherwise. A point light follows the eye (indoors the sky and sun reach only floors).
Crosshair and a hint ("Walls are not solid in walk mode": the walk is for looking).

**Elevations** (`uiStore.view3dPreset`: `perspective`, `north`, `south`, `east` or `west`; pure maths in
`view3d/elevation.ts`). The sides are the plan's: north looks toward +plan y from the road side, south
toward -y, east toward -x from larger x, west toward +x, Y up, whatever the north angle. `Controls` mounts
`ElevationView` instead of `OrbitView` (one controls component at a time, as with the walk): a drei
`OrthographicCamera` (makeDefault, near 1, far 40000; drei puts the perspective camera back when it
unmounts) and its own OrbitControls with no rotation, the polar angle held at pi/2, both mouse buttons and
one finger panning, and a `minZoom` that keeps the view under 24000" across. `elevationFit(box, face,
size)` frames `planBox` of the visible levels: drei's orthographic frustum is the canvas in CSS pixels, so
the zoom is min(width / (face width x 1.1), height / (face height x 1.1)), the face being the box's extents
across the view axis; the camera stands on the centre line 100" in front of the box, looking at its
centre. It refits on mount, on a face change and on Fit 3D (clicking the active side asks for one).
`OrbitView`'s pose effect and fit do nothing until the camera is the perspective one (the commit that
mounts it again still sees the orthographic camera), and since r3f resizes only the default camera,
`Controls` gives the perspective camera the canvas's aspect again when it comes back. Walking resets the
preset to perspective (`FirstPerson` needs the perspective camera), an elevation set while walking leaves
walk mode, and the view buttons are disabled while walking.

**The ground cut**: the orthographic camera stands inside the terrain's area, so the pixels below the
ground line would look underground, at the buried basement walls and the sky beneath them.
`elevationGroundCut` stands a vertical strip 2" in front of the camera (past its near plane), facing it,
from the drawn ground along that line (the grid's two triangles per cell, sampled at every grid line and
diagonal it crosses, plus 0.5") down to 24000" below and out to 24000" either side (flat past the grid), in
the lawn material, with no shadows: a section through the ground at the camera's plane. The ground rising
toward the house beyond it still shows. `ElevationView` rebuilds it on every fit and terrain change;
panning keeps the camera in its plane.

**The sun for an elevation**: `SunLight` and `SkyDome` take `viewSun(preset, northAngle)`:
`sunPosition(northAngle)` in perspective, else `elevationSun(face)`, behind the viewer, 30 degrees to
their left and 45 degrees up, as far away as `sunPosition`, so the face is lit and its eaves and frames
throw shadows down the wall to the right. The shadow camera is refitted round the same box for that
direction, and the effect that sets its frustum marks the map for redrawing; `InvalidateOnChange` redraws
on a preset change.

**Elevation capture and export** (`view3d/capture.ts`, `io/exportElevation.ts`, "Export elevations
(.png)" in the Export menu). `CaptureHandle` in the Canvas registers r3f's state getter with
`registerCapture` while it is mounted. `captureElevation(face, scale = 2)` renders one frame
synchronously with a plain three `OrthographicCamera` in inches at the canvas's aspect, framed by the same
`elevationFit`, with its own ground cut (the view's own one hidden), the sun light, its shadow camera and
the sky's sun turned to that face, and the renderer at `scale` times its pixel ratio (less if the browser
caps the drawing buffer); `toDataURL('image/png')` reads it in the same task, so the drawing buffer need
not be preserved. Then everything is put back, the shadow map marked for redrawing and the view
invalidated. Without a 3D view it returns null. `downloadElevations` renders north, south, east and west,
then downloads each through `downloadBlob` as `planFileName`'s slug plus `-<side>-elevation.png`. The menu
item is disabled in the 2D layout ("Open the 3D view first"); a split layout too narrow for the 3D pane
gets that message as an alert. Shadows and textures stay on: these are renderings, not line drawings.

## Persistence and export

JSON download/upload with `schemaVersion` and `migrate()`. `MIGRATIONS[n]` upgrades a version n
document to n + 1 and they run in order (0 -> 1: entity arrays become records keyed by id, a
missing `levelOrder` comes from the levels array, settings are filled; 1 -> 2: every level gets an
empty `roofs` record and the plan a default `site`; 2 -> 3: every level gets an empty `fixtures`
record; 3 -> 4: every level gets an empty `decks` record; 4 -> 5: every level gets an empty
`floorOpenings` record; 5 -> 6: `staircases`; 6 -> 7: `joistZones` and `members`; 7 -> 8: the site gets
empty `surfaces` and `fences` records; a broken surface or fence is dropped with a console warning naming
it, a bad colour alone, a colour lower-cased). The upgraded document is
then read into a Plan built from known fields only (`pick`: unknown keys dropped, known keys in the
file's order so a current file round-trips byte for byte), with defaults for missing optional
values and broken openings, rooms, stairs and underlays dropped (a broken roof, deck or floor opening is dropped
with a console warning naming it; railings are fitted to the outline). New and Open replace the plan and
clear the undo history (New confirms when the plan has walls, rooms, stairs, roofs, fixtures, decks, site elements or an image). Autosave
to IndexedDB (idb-keyval) on every plan change (debounced), restored on load; a failed save
(storage full, IndexedDB unavailable) shows "Autosave failed: ..." in the status bar until a later
save works (or the next edit, below), and is never thrown. Status bar notices (`uiStore.notice`, REVIEW-2
C3): an info notice clears itself 8 s after it is set (`NOTICE_MS`, the timer lives in `setNotice`, so
every caller gets it); an error stays until the next notice; any plan edit clears either
(`clearNoticeOnEdit`, from the plan-store subscription in `main.tsx`), so a notice that belongs to an
edit is set after it (Open, Undo's "Undid a change on ...", the duplicate room name). Underlays downscaled to <= 2048px JPEG data URLs.
3D export (`io/export3d.ts`, toolbar "Export" menu, loaded on first use): `buildExportScene` builds
a fresh Group from `getLevelMeshes` (not the live scene, which holds lights, grid and controls):
root named after the plan and scaled by 0.0254, one group per level the 3D view shows (empty levels
skipped) at its floor top, meshes `Wall <n> (<kind>, <phase>)`, `Floor`, `Stairs`, `Roof`, `Fascia`, `Rafters`,
`Beam`, `Post`, `Footing`, `Log end`, `Deck`, `Deck framing`, `Deck railing` (materials `deck_<phase>` and `deck_frame_<phase>`, plus `_<hex>` in a colour
other than the default), `Stair railing` and `Guard` (material `railing_<phase>`), `Window`, `Door`, then a `Site` group
(`Terrain`, `Chimney`, `Flue`, `Post`, `Pier`, `Surface`, `Fence`; a capped chimney's cap and arrestor are more `Chimney` meshes, a capped flue's
rain cap two more `Flue` meshes, `flue_stem_<phase>` and `flue_hood_<phase>`) with cloned geometry and cloned live materials
(one per phase/kind, roofs `roof_<finish>_<phase>`, boards `fascia_<phase>` and tails `rafter_<phase>` (plus `_<hex>`
in a board colour other than tan), columns `column_<kind>_<phase>` (plus `_<hex>` in a colour other than the
default), surfaces `surface_<material>_<phase>`, fences `fence_<phase>` and `fence_end_<phase>` (each plus
`_<hex>` likewise), `chimney_cap_<phase>`, `chimney_arrestor_<phase>`, `terrain`, named without spaces; no texture or
normal map, a textured material's flat colour instead, see "Exterior appearance"), disposed after
export. glTF: `GLTFExporter`, `binary: true`, `trs: true`. OBJ: `OBJExporter` on the same group with
the scale reset to 1 (inches; SketchUp asks for units) and each mesh name prefixed with its level,
since OBJ objects are flat. Only what the current view mode and level visibility show is exported.

## The starter plan (`scripts/example-plan.ts`, `docs/examples/146-mick-road.json`)

A plan of 146 Mick Road for the owner to refine, built by script through the store actions (so it
passes `normalizeLevel`, clamping and validation) and written by `npm run build:example`
(`scripts/run-ts.mjs` loads the script through Vite, so it can import the app's extensionless
TypeScript; ids are renamed to stable ones and the date is fixed, so a second run changes nothing).
`example.test.ts` loads the file through `migrate()` and checks it against the script's output. The
toolbar's "Open example" (`fileActions.openExample`) loads it with a dynamic import (a separate
chunk), after the same confirmation as New when the plan has content. Dimensions and the estimates
are in the README ("Modelling 146 Mick Road").

The exterior follows the photos with the appearance fields (realism plan, docs/history/PLAN-v3-realism.md):
casement sashes and fixed-centre picture windows, screens in the porch's four bays and a screen door,
the green half-lite house door, block basement walls with one board wall round a double door, open
eaves with rafter tails and boards in the stain on weathered metal roofs, and the chimney 24" x 20",
stained, capped. The script's `addOpeningAt` throws when the store moves an opening to make it fit (a
jamb past a corner or a partition's face), so every number in it is where the opening is, and
`example.test.ts` checks that no two surrounds (trim, sill, shutters) on one wall line overlap, which
would z-fight; the porch's openings have no trim, since its posts are only 3.5" wide.

The yard (`YARD`, all estimates) is site surfaces and a fence through the store: Mick Road
(asphalt), the gravel pull-off between it and the north face, the porch entry's concrete pad and two
flagstones (demolished in the proposed design, under the foyer and its stoop), a gravel strip along
the lake face, and a two-rail split-rail fence a foot inside the retaining wall's top, carried west
across the lawn. Surface and fence ids are renamed `surface-1` ... and `fence-1`.

The First Floor's rooms carry their interior finishes from the photos (the Utility's from the owner) through
`label()`'s finishes: the Kitchen's blue check wallpaper and beige tile, the Living's cream boards and the front
room's cream paint over red-brown painted boards, the Bath's green paint over a 40" pine wainscot on parquet, and the
Utility's pine paneling on a wood floor. The Second Floor's rooms and the proposed rooms have placeholder finishes
(`PLACEHOLDER_ROOM`, `PLACEHOLDER_WET`: off-white paint, wood boards, tile in the baths and the foyer) until the
owner chooses; the basement has none.

The proposed kitchen (docs/history/PLAN-v5-kitchen.md, with the east run of PLAN-v6-layout.md) is
placed through `fixture()`, which throws when the store refuses one; fixture ids are renamed like the
rest (`f-c1` ...). `example.test.ts` checks that every new fixture lies inside its room's face in the
proposed view, overlaps no wall footprint and shares no space with another fixture (plan and height),
and that `counterRuns` gives the island one 66 x 37 top and the east run's three bases one each.

The proposed layout of PLAN-v6-layout.md, with MK's stair of 15 Oct 2026: the stair hall's stair (a
one-riser bottom step 10 3/8" deep, a one-riser landing in the north-west corner, then one straight
run of 12 east along the north wall to x 167.5; 15 risers of 108 / 15 on 10 3/8" treads, railed on
the run's open side, cutting nothing, in 2" whitewashed pine treads) under the Second Floor's floor
opening (floor opening ids `s-h1` ...), its guard opening where the run arrives, the old upstairs
bath its top landing; a 14" peeled log post under the balcony header (a 6x6 on a footing under it); the north band's walls, placed where they
meet the old walls outside the old openings (the band's wall at y 51.5 touches the old bath door's
jamb, its divider at x 261.5 clears the old bath window), so nothing of the existing house moves;
the laundry closet in the master bath; the stove's boxes on the First Floor; and, routed outside
the house (PLAN-v7-exterior-flue.md), its black connector (an uncapped flue column from the stove's
top, and a box into the west wall), the tee (a box in the screen porch) and its flue column outside
the west wall (`kind: 'flue'`, capped, 2" off the siding), whose top the script sets by the 3-2-10
rule from the main roof (`roofHeightAt`: 3' over the rake where it passes, 2' over the roof 10' up
the slope);
the chimney column demolished (`setPhase` with `columns`); and the upstairs bath, whose new wall is
drawn before the old bath's east wall is demolished, so the stub of that wall south of it stays.
`example.test.ts` checks the stair's risers, treads and landings against the floor to floor, the
opening's outline, supported edges and guard, the slab hole, the stove's place, the connector
(under the ceiling) and the flue (outside, no chase upstairs) and its top against the roof, the
bath's and laundry's fixtures, and that no level has an open wall end or an orphan label in any
view.

The proposed deck off the master bedroom is added through `deck()` (deck ids `f-d1` ...), from the
retaining wall's east face to the wing's east face, its top at the retaining wall's (absolute -4).
It has no stair of its own (MK), so its east and south railings run their full length. Today's
wooden stair (photos 23 to 27: a flight up along the wing's east side, its landing, a deck at the
Basement's floor, -100, and a flight down the bank south of the walkout, all open) is drawn as
existing work and kept: the lower flight, 12 risers of 96 / 13 to the landing's edge, starts 96"
below the Basement floor on the lower lawn (`BANK`, from photos 24 to 27: the ground at -100 4' out,
-196 from 12'6" out). `example.test.ts` checks the deck's outline, that its top equals the wall's,
the supported edges, the two posts and that no stair opens its railings, and that today's flights
and landing are kept, the lower flight's heights against the landing and the lawn.

## Risks

- Miter blow-up at acute angles: cap and bevel; collinear -> square cap.
- T overlap / z-fighting: normalize() after every structural edit, including node drags.
- Open loops from tape error: node-snap on typed commit; report open ends in the status bar.
- Re-render storms: never subscribe to the whole plan in a layer; never allocate arrays in selectors.
- Winding/normals: normalized in prism(); test with FrontSide.
- Pin react 19 / fiber 9 / drei 10 together.
- Opening offsets must be remapped on split/reverse and clamped on shorten, inside store actions only.
- Never compare coordinates with ===; use MERGE_EPS.
