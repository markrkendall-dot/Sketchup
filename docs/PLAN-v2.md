# HomePlan v2: render the whole house (146 Mick Road)

## Context

HomePlan v1 draws walls, openings, rooms, stairs, three stacked levels, and a 3D model with
existing/proposed phases, export to SketchUp, and a walkthrough. MK wants an accurate current-state
model of his house, and v1 cannot render it: the house has a gable roof with deep overhangs, a
one-story west wing with its own gable, a screened porch and an entry porch with their own small
roofs, a lean-to piece, a brick chimney, a west deck with outdoor stairs, a walkout basement on a
slope held by a concrete retaining wall, clapboard above shingles, multi-lite windows with trim and
shutters. None of those exist in the tool. This plan adds what the house needs, in the order that
makes the model look like the photos soonest, and ends with a starter plan file for this house.

What the photos and sketch establish (north is the road side, the lake is south and downhill):
- Main block 26.5' east-west by 25.5' north-south (from the sketch), two stories over a walkout
  basement. Main ridge runs east-west; gable ends face east and west; deep eaves with exposed rafter
  tails; standing-seam metal roof.
- East gable end: entry porch with a small gable roof and posts (house number 146), large window
  with green shutters, a small triangular window in the gable.
- North face (road): brick chimney on the wall, a screened porch with a lean-to metal roof at the
  north-east corner, a small lean-to bump-out near the west end.
- West side: one-story wing with an east-west gable, deck with railing wrapping its south-west
  corner, wooden stairs down the slope toward the lake. The sketch puts the wing on the south half of
  the west wall; the photos suggest it sits further north. The tape will settle it.
- South face (lake): two-story wall on a concrete-block foundation, two wide picture windows on the
  first floor, two multi-lite windows above, a one-story lean-to piece at the south-east corner, the
  basement double doors at the lower grade, a concrete retaining wall about 10' south of the house
  running east (22' then 37' per the sketch), grade dropping from first-floor level at the road to
  basement-floor level below the retaining wall.
- Cladding: horizontal clapboard on the second floor, shingles on the first floor and gables, dark
  red-brown stain, tan trim, white window sashes with divided lites, green board shutters on the
  east end.

Execution: Fable plans and coordinates; implementation by **Opus 5.5** for M8 (roofs and gable walls,
the geometry-heavy part) and **Sonnet 5.5** for M9, M10, and M11, each verified by the coordinator
with the build, unit tests, the milestone e2e scripts, screenshots, and the perf probe before a
commit and push. One commit per milestone.

## Data model additions (`src/model/types.ts`, `migrate()` in `src/model/plan.ts`, schemaVersion 2)

```ts
export type RoofShape = 'gable' | 'shed' | 'hip' | 'flat';
export interface Roof {
  id: Id;
  shape: RoofShape;
  outline: Vec2[];          // plan polygon of the bearing walls' outside faces (snaps to walls)
  ridgeAngle: Degrees;      // 0 = ridge runs along +x; for shed: the downhill direction
  pitch: number;            // rise per 12 (e.g. 8 for 8:12); hip and gable share one pitch
  overhang: Inches;         // eave and rake overhang beyond the outline (24 on this house)
  bearingOffset: Inches;    // bearing height above the level's ceiling (usually 0)
  thickness: Inches;        // roof slab thickness (8)
  fascia: Inches;           // fascia depth (6)
  phase: Phase;
  finish: 'metal' | 'shingle';
}
export interface Column { id: Id; at: Vec2; width: Inches; depth: Inches; rotation: Degrees; base: Inches; top: Inches; kind: 'post' | 'chimney'; phase: Phase }
export interface GradePoint { id: Id; at: Vec2; elevation: Inches }
export interface Site {
  northAngle: Degrees;      // plan rotation to true north; 0 = north is up the screen
  gradePoints: Record<Id, GradePoint>;
  columns: Record<Id, Column>;
}
// Level gains: roofs: Record<Id, Roof>; Wall gains: finish?: WallFinish; Opening gains: lites?: {cols: number; rows: number}; shutters?: boolean; trim?: Inches
// Plan gains: site: Site
export type WallFinish = 'clapboard' | 'shingle' | 'board' | 'plain' | 'screen';
```

Every new element carries `phase` and obeys the view mode exactly like walls do today
(`isVisible` in `src/derive/phase.ts`): hidden in 2D, absent from 3D, absent from export, styled
dashed red (demo) or green (new) in the All view. This is what makes before and after work for the
extension above the walkout basement and the enlarged front porch.

Migration 1 to 2 adds empty `roofs`, a default `site`, and leaves older files loadable. The
byte-identical round-trip test gets a v2 fixture; the v0 and v1 fixtures still load.

Deferred (not in this plan, MK did not ask for them): decks with railings, exterior stairs, the
concrete retaining wall as a modelled object, a lot outline. The data model leaves room for them
under `Site`.

## M8. Roofs and gable walls (Opus 5.5)

Files: `src/derive/roofs.ts` (new), `src/derive/meshes.ts`, `src/editor2d/tools/roofTool.ts`
(new), `src/editor2d/PlanLayers.tsx`, `src/ui/PropertiesPanel.tsx`, `src/ui/Toolbar.tsx`,
`src/ui/keymap.ts`, `src/store/planStore.ts`, `src/io/export3d.ts`, `src/view3d/materials.ts`.

- **Roof geometry** (`roofs.ts`, pure): a roof is a set of planes over its outline. Gable: two
  planes meeting at a ridge through the outline's centre along `ridgeAngle`; shed: one plane; hip:
  four planes (standard hip over a rectangle; for non-rectangular outlines use the bounding box and
  say so in the UI); flat: one horizontal plane. `roofHeightAt(roof, p)` returns the underside height
  at a plan point (used by walls below). The solid: the outline expanded by `overhang` (rakes and
  eaves alike), top surface at `roofHeightAt + thickness`, underside at `roofHeightAt`, fascia boards
  along the eaves, closed at the gable ends (rake boards). Built with the existing `prism`-style
  helpers as non-indexed geometry with flat normals; no CSG. Roofs that overlap (wing roof into the
  main wall) simply overlap, like SketchUp accepts.
- **Walls follow the roof**: in `buildWallGeometry`, a wall piece's top is no longer flat at
  `wallHeight` when a roof on the same level covers it: the top profile is `max(wallHeight,
  roofHeightAt)` sampled at the piece ends and at every ridge or hip crossing, so a gable-end wall
  rises to the ridge as a triangle and eave walls stay at the plate. Openings keep their heights.
  The `WallContext` cut-height list gains the roof crossings so neighbours still share vertices.
- **Roof tool** (hotkey K): click the corners of the roof outline snapping to wall outside faces
  (the footprint `quad` corners and edges), close the polygon, then choose shape and ridge direction
  from the properties panel (default: gable, ridge along the longer side, pitch 8:12, overhang 24",
  thickness 8"). A "Fit to walls" button sets the outline to the outer face polygon of the level's
  enclosed walls. Select, drag outline vertices, delete, phase, finish.
- **2D**: roof outline as a dashed line with the ridge drawn and the overhang as a lighter dashed
  line, on the level that owns it, and as a faint ghost on the level above (so the second floor is
  drawn knowing where the wing roof is).
- **3D and export**: roof meshes per level in `getLevelMeshes` with a `roofMaterial(finish, phase)`
  (metal: grey-brown with a slight sheen; shingle: dark grey), named `Roof` in the glTF/OBJ.
- Tests (`roofs.test.ts`, extend `meshes.test.ts`): ridge height for a 26.5' span at 8:12; wall top
  profile of a gable end has exactly one peak at the ridge; eave walls unchanged; shed roof on the
  porch; overhang expands the outline correctly for a rotated ridge; roof geometry is closed.

Verify: draw the 26.5' x 25.5' block, add a gable roof with 24" overhangs, add the west wing with
its own gable, the porch sheds; orbit in 3D and screenshot from the east, north, and south; the
gable walls must reach the roof with no gap and no z-fighting at the eaves. Re-run m1 to m7 and
`qa/perf.mjs`.

## M9. Site terrain, chimney and posts, and before/after coverage (Sonnet 5.5)

Files: `src/derive/site.ts` (new), `src/derive/meshes.ts`, `src/view3d/Scene3D.tsx`,
`src/editor2d/tools/siteTools.ts` (new: grade point, column), `src/editor2d/PlanLayers.tsx` (site
layer), `src/ui/PropertiesPanel.tsx`, `src/ui/LevelBar.tsx` (a "Site" tab below the Basement),
`src/store/planStore.ts`, `src/io/export3d.ts`, `src/derive/phase.ts`.

- **Terrain**: grade points are spot elevations; `terrainMesh(site, bounds)` builds a 2' grid over
  the plan bounds plus a 40' margin, elevation = inverse-distance-weighted average of the grade
  points (exact at each point), flat at the lowest level's floor top minus its slab when no points
  exist. Rendered as a grass-green surface in place of the infinite grid (the grid stays as an
  overlay option). The terrain is opaque, so basement walls below grade are buried and the walkout
  side shows, which is what the photos show. Exported as `Terrain`.
- **Site tab**: a pseudo-level in the level bar showing the site layer over a ghost of the first
  floor. Tools: grade point (click, type the elevation; default is the active level's floor top) and
  column (post or chimney with plan size, base, top; chimney defaults 24" x 40" from grade to 4'
  above the ridge, post 6" x 6" from grade to the porch roof). A north arrow that rotates with
  `northAngle`; the 3D directional light follows it so shadows read right.
- **3D and export**: column = box, brick-red for chimneys, trim colour for posts, named `Chimney`
  and `Post`.
- **Before and after coverage**: phase and view-mode handling for roofs and columns in 2D, 3D, and
  export, plus the "Mark demolish" and "Draw as" controls applying to them. An e2e scenario that
  models MK's renovation on the starter geometry: new first-floor walls over the walkout basement's
  south terrace with a new roof (phase new), the existing entry porch roof and posts marked demo
  with a larger new porch (walls, posts, roof as new); assert the Existing view shows the old porch
  and no extension, the Proposed view shows the extension and the new porch only, and the All view
  shows both styled; export each view and check the node names present.
- Tests: terrain interpolation hits the grade points exactly and is flat without points; column
  geometry; migrate v1 to v2 adds a default site; `isVisible` applied to roofs and columns.

Verify: enter grade points at the four house corners (north pair at first-floor top minus 12", south
pair at basement floor plus 24") and the chimney on the north wall; screenshot from the south-east
and from the road; the basement doors must be exposed on the south and the north side buried to the
first floor. Run the before/after scenario and inspect its three screenshots.

## M10. Exterior appearance: siding, trim, window lites, doors, shutters (Sonnet 5.5)

Files: `src/view3d/materials.ts`, `src/derive/meshes.ts` (opening fills), `src/ui/PropertiesPanel.tsx`,
`src/io/export3d.ts`.

- **Wall finish** per wall (`finish`, default by kind: exterior walls `shingle`, interior `plain`),
  with a level-wide "exterior finish" setter in the level panel ("Second floor: clapboard, first
  floor: shingle" is two clicks). Rendered as procedural canvas textures generated once per finish
  and colour (clapboard: 6" horizontal courses with a shadow line; shingle: 5" staggered courses;
  board: vertical boards; screen: 60% transparent dark mesh), tinted by a colour picker in the panel
  (default the house's red-brown `#5a3a35`). Interior faces stay plain. Textures are UV-mapped in
  inches so courses line up across pieces; export writes the colour only (textures are not exported
  to keep the glTF small), with a note in the export menu.
- **Window and door fills**: each opening gets a frame (trim width, default 4") on the outside, a
  sash with a lite grid (`lites` cols x rows, default 2 x 3 for this house's casements), glass as a
  translucent pane, a sill; doors get a leaf with a panel inset and the same trim; passages stay
  open. Shutters: two boards each 1/3 the window width, green `#3f6f5f` when `shutters` is on.
  Built as small merged geometries per opening, cached like walls.
- **Roof finish colour** and fascia colour fields on the roof panel; chimney gets a brick-red material.
- Tests: texture generator returns a canvas of the expected size in jsdom-less code (skip in node
  if no canvas; test the UV math instead); opening fill geometry counts for 2x3 lites.

Verify: screenshot the south face in 3D next to photo 1 and the east gable next to photo 8; the
read should match: shingles below, clapboard above, white divided-lite sashes with tan trim, green
shutters on the east end, the metal roof with overhang.

## M11. The 146 Mick Road starter plan and guide (Sonnet 5.5)

Files: `docs/examples/146-mick-road.json` (plan file), `README.md` (new section "Modelling 146
Mick Road"), `src/__tests__/example.test.ts` (loads the file through `migrate()` and asserts
counts), a toolbar "Open example" entry under Open.

- Build the plan from the sketch and photos with every dimension marked in the room names where it
  is an estimate ("Living (est.)" style), so MK replaces them with tape measurements: main block
  26.5' x 25.5' with 6.5" exterior walls; three levels (basement walkout, first, second) with the
  base floor elevation set so the north grade meets the first floor; the west wing (one story,
  estimated 12' x 14', position per the photos, flagged), the screened porch at the north-east
  corner (estimated 8' x 12', screen finish), the entry porch on the east face (posts and a gable),
  the south-east lean-to (estimated 8' x 10'); openings from the photos (two 10' picture windows on
  the south, 2x3-lite casement pairs upstairs, the east 3-sash window with shutters, the gable
  triangle skipped); the main gable roof ridge east-west at an estimated 8:12 with 24" overhangs;
  wing gable; porch sheds; chimney on the north wall; entry porch posts; terrain grade points so the
  basement walks out on the south; north angle 0 (road on the north). The west deck and the
  retaining wall are not modelled (deferred) and the README says so.
- README section: how the house was entered, which numbers are estimates, and the order to replace
  them with measurements (exterior perimeter, wing, porches, then interiors), how to add the
  interior partitions MK measures, and how to draw the renovation as "new" and "demolish" so the
  Existing and Proposed views show before and after.

Verify: open the example, switch to 3D, screenshot from the six photo viewpoints and compare by eye
to the photos; the massing, roof forms, openings, chimney, and walkout must read as the same house.
`npm test` includes the example load test.

## Verification across milestones

- `npm run build` and `npx vitest run` green after every milestone; m1 to m7 e2e scripts still pass
  (adjust only for intentional changes, noted); `qa/perf.mjs` numbers do not regress (wall tool 30
  moves under 700 ms, drag under 700 ms at 76 walls).
- Each milestone adds an e2e script `m8-e2e.mjs` … `m11-e2e.mjs` in the scratchpad that drives the
  app, asserts store state, and takes screenshots the coordinator inspects.
- glTF export of the example parses in node and contains Roof, Chimney, Post, and Terrain nodes,
  and the Proposed export of the renovation scenario contains the new roof but not the demolished
  porch.
