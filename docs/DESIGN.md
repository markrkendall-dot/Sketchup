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

export interface Node { id: Id; x: Inches; y: Inches }

export interface Wall {
  id: Id;
  a: Id;                     // start node
  b: Id;                     // end node; a->b direction defines the wall's "left" (+normal) side
  thickness: Inches;         // 4.5 interior, 6.5 exterior typical
  kind: 'exterior' | 'interior';
  phase: Phase;
  heightOverride?: Inches;   // defaults to level.wallHeight
  finish?: 'clapboard' | 'shingle' | 'board' | 'block' | 'plain' | 'screen'; color?: string; // see "Exterior appearance"
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
  fixedCenter?: boolean; glazing?: 'glass' | 'screen'; halfLite?: boolean; leafColor?: string;
}

export interface Room { id: Id; name: string; anchor: Vec2; ceilingOverride?: Inches }

export interface Stairs {
  id: Id; origin: Vec2;      // middle of the bottom edge of the flight
  direction: Degrees;        // plan angle of travel going up: 0 = +x, 90 = +y (down the screen)
  width: Inches; run: Inches; // run = horizontal length; climbs to the next level's floor top
  phase: Phase; cutsFloorAbove: boolean;
  headroom?: Inches;         // clear height the floor opening above keeps; default 80"
  holeStart?: Inches;        // where that opening starts along the run; overrides the headroom rule
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
}

export interface Level {
  id: Id; name: string;
  wallHeight: Inches;        // floor top to underside of next floor; 96 or 108
  floorThickness: Inches;    // the slab/framing under THIS level (~12 framed, 4 slab)
  nodes: Record<Id, Node>; walls: Record<Id, Wall>; openings: Record<Id, Opening>;
  rooms: Record<Id, Room>; stairs: Record<Id, Stairs>; roofs: Record<Id, Roof>; underlay?: Underlay;
}

// The site (see "Site and terrain"; the file carries it from schema version 2).
export interface GradePoint { id: Id; at: Vec2; elevation: Inches }   // elevation: absolute, like floor tops
export interface Column {
  id: Id; at: Vec2; width: Inches; depth: Inches; rotation: Degrees; // plan rectangle, turned clockwise
  base: Inches; top: Inches;                                         // absolute elevations
  kind: 'post' | 'chimney'; phase: Phase;
}
export interface Site {
  northAngle: Degrees;      // degrees clockwise from the top of the plan to true north
  gradePoints: Record<Id, GradePoint>; columns: Record<Id, Column>;
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
  schemaVersion: 2; id: Id; name: string;
  levelOrder: Id[];          // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings; site: Site; modifiedAt: string;
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
Detection runs on the walls visible in the current ViewMode.

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
  part of the flight where headroom is short (`stairsHoleOutline(stairs, floorToFloor)`): from
  `d0 = holeStart ?? run * max(0, floorToFloor - headroom) / floorToFloor` (headroom default 80")
  to the top of the run, none when that is under 1". The starter's stair (108" floor to floor, 125"
  run) opens from 32" up, so the closet over its low end keeps its floor. The 2D view of the level
  above draws the same opening (dashed, with an X and the treads under it), and the stair panel
  has "Floor opening starts" (blank follows the rule, shown as the placeholder) and "Headroom". Outer faces nested in
  another component are skipped. If a level has no closed outer face, draw no slab. Where the walls
  of the level below run up through the slab, the edge stops at their inside face instead (see
  "Platform framing").
- Stairs: one solid, the stepped side profile extruded across the width (`risers` =
  round(floor-to-floor / 7.5")), the last step flush with the floor above.

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
not raise walls. `getLevelMeshes` caches each roof's geometry per roof object and bearing height.

2D: the outline dashed, the overhang outline lighter, ridge and hip lines thin and solid; demolished
roofs hatched red, new ones green; a selected roof shows corner handles that the select tool drags
(snapping like the roof tool, one undo step per drag). The level below's roofs show as a faint ghost.
Roof tool (K): click corners, snapping to wall outline corners (footprint fill points), then nodes,
then points on wall faces, then the usual snaps; where two exterior face lines meet just past the
end of one (the house corner under a porch whose wall continues the end wall) is a corner too.
Close on the first corner, a double-click or Enter. Defaults: gable, ridge along the longer side of
the bounding box, 8:12, 24" overhang, 8" thick, 6" fascia, metal, the toolbar's "Draw as" phase.
"Fit to walls" in the panel sets the outline to the level's outer-face polygon when the walls close
exactly one ring.

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

The plan's `site` holds the ground (grade points: spot elevations), the columns (chimney, posts) and
the north angle. None of it belongs to a level.

**Terrain** (`site.ts`, pure, position arrays like `roofs.ts`; `meshes.ts` wraps them). `terrainHeightAt`
is the inverse-distance-weighted (power 2) average of the grade points: exactly a point's elevation
within 1" of it, flat for a single point, `fallback` (the bottom of the lowest level's slab,
`fallbackElevation`) without points. `terrainGrid(site, bounds, fallback)` samples it on a 24" grid over
the plan bounds (`siteBounds`: nodes of every level, roof outlines, columns, grade points) plus 480",
rounded outward to whole cells, so a wall moving about does not change the grid; the step grows when
that would exceed 200 cells along an axis. The result is an indexed
surface (vertex = plan x, elevation, plan y; two triangles per cell, all facing +Y) plus its `bounds`
(`terrainBounds`). The house is cut out of it: `terrainGrid(site, bounds, fallback, footprints,
floorUnder)` sets the grid vertices inside the footprints (the lowest level's `slabOutlines(getFaces(lowest,
viewMode), true)`, out to its walls' outside faces) to `floorUnder` (that level's slab bottom minus 2"),
and splits the cells the outlines cross along them (convex pieces of each cell triangle inside and
outside the outline's triangles; extra vertices after the grid's), so the ground meets the outside face at
grade and drops straight down there, inside the wall. The memo `terrainFor` is keyed by the site's
`gradePoints` record (immer keeps its identity while a grade point is untouched, so a column, the north
angle or a wall inside the bounds never rebuilds anything), then by the rounded bounds, the fallback, the
`floorUnder` and the lowest level's `outerFaces` array (`terrainCut`; getFaces keeps it while that level's
nodes and walls are untouched, so an edit on another level does not rebuild the ground and a basement wall
edit does). `getTerrainGeometry(plan, viewMode)` keeps one `BufferGeometry` per grid (smooth normals) and
disposes the one it replaces. The terrain is
opaque and FrontSide (`#7f9a63`, roughness 1) and replaces the infinite grid as the ground, so the
basement walls below grade are buried and the walkout side shows. The drei grid stays as an overlay
("Grid" checkbox in the 3D bar, `uiStore.show3dGrid`, default on) 1" above the fallback elevation: with
grade points the terrain is above it and hides it, which is the point (no z-fighting). Under the lowest
level the ground sits 2" below its slab, so the basement interior is empty. A weighted average never
leaves the range of the grade points' elevations, so with every grade point at or below the First Floor
slab's underside (the "north pair at first floor top minus 12 inches" of the renovation scenario) the
ground never reaches that slab; a grade point above it would, and nothing clamps it.

**Columns** are boxes from `base` to `top` (absolute elevations) over a plan rectangle turned by
`rotation` (`columnOutline`, `buildColumnGeometry` = `prism`). Defaults (`columnDefaults`): chimney
24" x 40", base 12" below the ground at its point (`groundAt`), top 48" above the highest roof ridge
on the plan (the top surface at the ridge; above the top ceiling without roofs); post 6" x 6", base on
the ground, top at the lowest roof underside over it among roofs it can be seen with (a new post
ignores a roof being demolished; `phasesCoexist`), else the first floor's ceiling. `getSiteMeshes(plan,
viewMode)` returns the visible columns' geometry, memoized per view mode by the `columns` record and per
column object, disposing what drops out. The `Terrain` and the columns render in `view3d/SiteMeshes.tsx`
(columns: brick `#7a4a3e`, post tan `#c9b58c`, demolished translucent red, new pulled toward green).

**Site mode** (`uiStore.siteMode`, the "Site" tab below the lowest level in the level bar): entering it
makes the lowest level active (so the panel and store actions have a level), clears the selection and
shows, in place of the level's layers (`PlanLayers.tsx SiteView`), the first floor (the level above the
lowest, or the lowest if alone) as a ghost, every level's roofs as faint ghosts, and the site layer: grade
points as small triangles with their elevation, columns as rectangles (chimney hatched like brick, post
solid; demolished hatched red, new green; hidden in the views that hide them), a north arrow in the
canvas corner turned by `northAngle`. Choosing any level (the lowest too) leaves site mode
(`setActiveLevel` clears the flag). In site mode only select, grade point (E) and column (C) work;
`switchTool` refuses the level tools and says "Choose a level to draw walls" in the status bar (the
toolbar buttons stay clickable but dimmed and `aria-disabled`; E and C do nothing outside it). In
site mode the 3D view's "Only active level and below", the export and the walk start use the level
the site view ghosts (the first floor) as the active level (`active3dLevel`), since the active level
is parked at the lowest.

**Site tools** (`siteTools.ts`): `siteSnap` snaps to the first floor's wall-face corners and faces, nodes,
midpoints and the grid. Grade point: a click stores the spot in `draft.gradePending`; the length buffer
takes the elevation in feet-inches (a minus sign is allowed); Enter places it, with nothing typed at the
first floor's floor top (the level the view shows; `defaultGradeElevation`); Esc clears the buffer, then
the spot. Column: the column follows the cursor (`draft.columnPreview`), Tab toggles chimney / post,
the click places it with the defaults above in the toolbar's "Draw as" phase. The site select tool
(`getTool('select')` returns it in site mode) picks grade points (10 px) before columns (visible ones, with
a 4 px slack), shift-click and box-select add, a drag moves the whole selection with `moveSiteItems`
(one set; the first changing step is tracked and the rest folded in, one undo step), Delete removes
through `deleteEntities`. Store actions: `addGradePoint`, `updateGradePoint`, `deleteGradePoints`,
`clearGradePoints`, `addColumn`, `updateColumn`, `deleteColumns` (`columnProblem` rejects a non-positive
size or a top at or below the base), `moveSiteItems`, `setNorthAngle` (normalized to [0, 360)); each is
one undo step and a no-op leaves the plan object alone. `setPhase` and `deleteEntities` take `columns`
(and `deleteEntities` `gradePoints`). `Selection` gains `gradePoints` and `columns`. The panel has Grade
point (elevation, position, against the first floor), Column (kind, size, rotation, base, top, phase,
"Reset heights") and, with nothing selected in site mode, Site (north angle, "Road is north", counts,
"Clear grade points" with a confirm).

**North and light**: `sunPosition(northAngle)` is the directional light's position, the south-west offset
(-700, 1100) in plan turned clockwise by the angle, so the sun comes from the south-west once north is
applied.

**Phases** apply to roofs and columns exactly like walls: `isVisible(phase, viewMode)` in `RoofShape` and
`ColumnShape` (2D), `hitTest` / `hitSite` (picking), `pruneSelection`, `getLevelMeshes` (roofs, and walls
they raise), `getSiteMeshes`, the export, and the status bar counts; "Mark demolish" (panel, `setPhase`)
and the toolbar's "Draw as" cover them.

**Export**: after the level groups a `Site` group (elevation 0, absolute heights) holds `Terrain` (material
`terrain`, only when the site has grade points: flat ground would only be a plane at the slab) and the
visible columns as `Chimney` / `Post` (materials `column_<kind>_<phase>`).

**Fit 3D** (`bounds.ts planBox`) includes the columns and the terrain's height over the house area (a
6 x 6 sampling of the plan box), never the 40' margin.

## Exterior appearance (`model/finish.ts`, `view3d/textures.ts`, `derive/openings3d.ts`)

All of it is optional data on existing elements (no schema bump: `migrate()` reads the fields when they are
valid and drops them otherwise): `Wall.finish` (`clapboard | shingle | board | block | plain | screen`; an unknown
value is dropped) and `Wall.color` (`#rrggbb`, lower-cased on load), `Opening.lites {cols, rows}` (whole numbers 1 to
12), `Opening.shutters`, `Opening.trim` (0 to 24"), `Opening.sashes` (whole number 1 to 6), `Opening.fixedCenter`,
`Opening.glazing` (`glass | screen`), `Opening.halfLite`, `Opening.leafColor` (`#rrggbb`, lower-cased), `Roof.color`.
Defaults when absent (`wallFinishOf`, `wallColorOf`, `roofColorOf`, `sashesOf`, `glazingOf`, `leafColorOf`):
exterior walls shingle in the house's stain `#5a3a35`, interior walls plain `#e8e4dc`, a metal roof `#6e6259`, a
shingle roof `#4a4a4a`, one sash, glass, a dark green door leaf `#2f3a33`; the fascia, rake boards and window trim are
tan `#d9c9a3`. The Level panel's
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
faces, per-block brightness and speckle, the top of each bed joint in the shadow of the block above. Plain: no
texture, a flat colour. Screen: 1 px wires every 2 px (3/16") over a translucent dark grey (alpha 0.55), a fine mesh
up close and an even grey veil further off (as a wall finish: material `transparent`, opacity 0.4, no depth write,
`DoubleSide`).

**Relief**: every finish but plain and screen has a height field in inches (`sidingHeight`): clapboard tapers from
its butt to nothing under the next board (a 0.6" step at each lap), shingles taper from a 0.4" butt, each a little
proud or shy of its neighbours, with 0.3" deep keyways, boards have 0.2" V-grooves, block mortar is raked 0.25".
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
siding** (the inside of a window reveal shows shingle too); interior walls are plain unless given a finish.

**UVs**: `buildWallGeometry` ends with `addWallUVs`, which gives every triangle UVs in inches by its flat normal:
faces along the wall (long faces, jambs of a gable triangle, the part above the plate) take u = distance along the
centerline from the wall's start, v = height above the level's floor top; faces across the wall (jambs, free ends)
take u = distance across the wall; top and bottom faces (also the sloped tops under a roof) u along, v across. A
wall's courses therefore run level and continuous across its pieces, openings and the gable triangle, restart at each
level's floor top, and need not line up across a corner (the horizontal courses do; the vertical joints do not).

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
(kind `midRail`) centred 36" up and a screen above and below it, no panel. Passages stay open.
The outside is found by `outwardSide`: the side of the wall with no closed room beside it when the other has one
(`facesBesideWall`), else the side facing away from the level's node centroid. `getLevelMeshes` returns
`openings: OpeningMesh[]` (id, type, phase, `leafColor` after its default, and one geometry per part: `trim`, `sash`,
`glass`, `screen`, `leaf`, `shutter`), cached per opening object, wall object, footprint, wall height and outside
side, and disposed like the rest. Materials (`openingMaterial(part, phase, leafColor)`): trim tan, sash and window
muntins white `#f4f1ea`, glass `#bcd4e6` at opacity 0.35 (transparent, no depth write, drawn after the opaque
meshes), the screen with the screen texture (transparent, opacity 0.85 over the texture's alpha, no depth write,
drawn after the opaque meshes; `FrontSide`, since the pane is a closed box and both faces at once would double its
darkness), leaf `#2f3a33` or its `leafColor` (materials shared per part, phase and colour), shutters `#3f6f5f`; a
demolished opening is translucent red, a new one pulled toward green. Fills follow `isOpeningVisible` like the hole
they sit in. The Opening panel has "Sashes" (1 to 6; "Leaves", 1 or 2, for a door), "Fixed centre pane" at 3 sashes,
"Glazing", the lite grid per sash or leaf, and for a door "Half lite" and "Leaf colour" with a reset.

**Roofs** are two geometries per roof (`buildRoofParts`: the slab, and the fascia and rake boards in tan); the colour
field changes the slab only. The chimney stays brick red.

**Export** is colours only. Wall materials are clones of the live ones with `map` and `normalMap` dropped and the
flat colour (`wallFlatColor`) set, named `wall_<phase>_<kind>` for the default look and `..._<finish>_<hex>` otherwise;
roofs `roof_<finish>_<phase>` (plus `_<hex>` when recoloured), `Fascia` meshes `fascia_<phase>`. Each opening part is
a mesh named `Window` or `Door` with the material `trim`, `sash`, `glass`, `screen`, `door_leaf` (`door_leaf_<hex>`
for a leaf in another colour, unless demolished) or `shutter` (`_new` / `_demo` for other phases). UV attributes are
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
  room labels, stairs, roofs. A click (no drag) on the opening that is the whole selection selects
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
per-level-id caches, disposing geometry, on its next miss.

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
existing warm grey, demolished translucent red (0.35, no depth write), new light green, exterior walls
textured by finish and colour (see "Exterior appearance"); floors tan, stairs grey; roofs by finish (metal `#6e6259`, metalness 0.4, roughness
0.5; shingle `#4a4a4a`), demolished translucent like walls, new pulled toward green. Fit 3D and the
walk start count roof overhangs and roof tops in the scene bounds. Hemisphere + one directional light (turned with the north angle, see "Site and terrain"), no shadows.
The terrain is the ground (opaque green surface over the plan plus 40'); drei `<Grid>` (12" cells, 10'
sections) is an overlay 1" above the flat fallback ground, toggled by the "Grid" checkbox in the 3D bar. Orbit (drei OrbitControls, makeDefault)
framing the plan's bounding box on first mount; Fit re-frames the visible levels. Overlay toolbar:
level checkboxes and "Only active level and below". Layout (uiStore): 2D, split (draggable divider,
ratio in uiStore) or 3D, toolbar buttons and backtick to cycle; the 2D canvas stays mounted (hidden
in 3D), the 3D canvas mounts only when shown. Camera near 1, far 20000 (scene in inches).

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
looks around instead. WASD / arrows (by `KeyboardEvent.code`) move at 60"/s in the horizontal plane
relative to the yaw, Shift doubles it, using `useFrame` delta (clamped to 0.25 s). Q/E or
PageDown/PageUp step through the levels the 3D view shows, snapping the eye to that level. Esc, `F`
or the pointer-lock `unlock` event return to orbit, restoring the orbit pose. Keys are captured on
`window` in the capture phase while walking, so the 2D tools and hotkeys never see them (App's
handler also ignores keys while a pointer lock is active). `frameloop="always"` while walking,
`"demand"` otherwise. A point light follows the eye (indoors the sky and sun reach only floors).
Crosshair and a hint ("Walls are not solid in walk mode": no collision in v1).

## Persistence and export

JSON download/upload with `schemaVersion` and `migrate()`. `MIGRATIONS[n]` upgrades a version n
document to n + 1 and they run in order (0 -> 1: entity arrays become records keyed by id, a
missing `levelOrder` comes from the levels array, settings are filled; 1 -> 2: every level gets an
empty `roofs` record and the plan a default `site`). The upgraded document is
then read into a Plan built from known fields only (`pick`: unknown keys dropped, known keys in the
file's order so a current file round-trips byte for byte), with defaults for missing optional
values and broken openings, rooms, stairs and underlays dropped (a broken roof is dropped with a
console warning naming it). New and Open replace the plan and
clear the undo history (New confirms when the plan has walls, rooms, stairs, roofs, site elements or an image). Autosave
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
skipped) at its floor top, meshes `Wall <n> (<kind>, <phase>)`, `Floor`, `Stairs`, `Roof`, then a `Site`
group (`Terrain`, `Chimney`, `Post`) with cloned geometry and cloned live materials (one per phase/kind,
roofs `roof_<finish>_<phase>`, columns `column_<kind>_<phase>`, `terrain`, named
without spaces), disposed after
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

## Risks

- Miter blow-up at acute angles: cap and bevel; collinear -> square cap.
- T overlap / z-fighting: normalize() after every structural edit, including node drags.
- Open loops from tape error: node-snap on typed commit; report open ends in the status bar.
- Re-render storms: never subscribe to the whole plan in a layer; never allocate arrays in selectors.
- Winding/normals: normalized in prism(); test with FrontSide.
- Pin react 19 / fiber 9 / drei 10 together.
- Opening offsets must be remapped on split/reverse and clamped on shorten, inside store actions only.
- Never compare coordinates with ===; use MERGE_EPS.
