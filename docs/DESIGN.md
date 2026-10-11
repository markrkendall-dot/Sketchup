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
}

export interface Room { id: Id; name: string; anchor: Vec2; ceilingOverride?: Inches }

export interface Stairs {
  id: Id; origin: Vec2;      // middle of the bottom edge of the flight
  direction: Degrees;        // plan angle of travel going up: 0 = +x, 90 = +y (down the screen)
  width: Inches; run: Inches; // run = horizontal length; climbs to the next level's floor top
  phase: Phase; cutsFloorAbove: boolean;
}

export interface Underlay {
  image: string;             // data URL (JPEG, downscaled on import)
  pixelWidth: number; pixelHeight: number;
  origin: Vec2;              // plan position of image pixel (0,0)
  scale: number;             // inches per image pixel
  rotation: Degrees; opacity: number; locked: boolean;
}

export interface Level {
  id: Id; name: string;
  wallHeight: Inches;        // floor top to underside of next floor; 96 or 108
  floorThickness: Inches;    // the slab/framing under THIS level (~12 framed, 4 slab)
  nodes: Record<Id, Node>; walls: Record<Id, Wall>; openings: Record<Id, Opening>;
  rooms: Record<Id, Room>; stairs: Record<Id, Stairs>; underlay?: Underlay;
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
  schemaVersion: 1; id: Id; name: string;
  levelOrder: Id[];          // bottom to top
  levels: Record<Id, Level>;
  baseFloorElevation: Inches; // floor-top of levelOrder[0]; e.g. -100 for a basement
  settings: PlanSettings; modifiedAt: string;
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
Simple graph, not multigraph: at most one wall between two nodes.

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
  level below that have `cutsFloorAbove` (only holes that fit strictly inside). Outer faces nested in
  another component are skipped. If a level has no closed outer face, draw no slab.
- Stairs: one solid, the stepped side profile extruded across the width (`risers` =
  round(floor-to-floor / 7.5")), the last step flush with the floor above.

`getLevelMeshes(plan, levelId, viewMode)` memoizes per level and view mode, reuses each wall's
geometry while its footprint object, wall, openings list, height and context (bands, neighbour
heights, split points) are unchanged, and disposes geometry that drops out of the cache.

## 2D editor

One `<svg>` with a single `<g transform="translate(tx ty) scale(k)">`. Transient state (cursor, snap,
rubber band, length buffer, drag preview) lives in `uiStore.draft` and only `Overlay.tsx` subscribes.
Entity components are `React.memo` and select their entity by id. `vector-effect="non-scaling-stroke"`.
Text that must stay constant on screen uses `scale(1/k)` from one `useViewport()` subscription.
Native `addEventListener('wheel', h, {passive:false})` via ref; `setPointerCapture` on pointerdown;
`touch-action: none; user-select: none`. Screen->world = `((clientX - rect.left) - tx) / k`, from our
own viewport state, never `getScreenCTM`.

### Snapping (`snap.ts`)

`snapPoint(raw, ctx) -> {point, kind, nodeId?, wallId?, guides}`. Radii in screen px, divided by k.
Priority: node (10px) > wall midpoint (8px) > on-wall projection (8px) > alignment guides to any
node's x or y (6px) > grid (settings.snapGrid). Ortho lock (default on, Shift inverts while held,
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
existing warm grey, demolished translucent red (0.35, no depth write), new light green, exterior a
little darker; floors tan, stairs grey. Hemisphere + one directional light, no shadows. drei `<Grid>`
(12" cells, 10' sections) at the lowest slab's bottom. Orbit (drei OrbitControls, makeDefault)
framing the plan's bounding box on first mount; Fit re-frames the visible levels. Overlay toolbar:
level checkboxes and "Only active level and below". Layout (uiStore): 2D, split (draggable divider,
ratio in uiStore) or 3D, toolbar buttons and backtick to cycle; the 2D canvas stays mounted (hidden
in 3D), the 3D canvas mounts only when shown. Camera near 1, far 20000 (scene in inches).

First-person walk (`uiStore.cameraMode`, overlay "Walk" button or `F` while the 3D view shows;
`view3d/FirstPerson.tsx`, pure helpers in `view3d/walk.ts`): the orbit controls unmount (saving
their pose) and drei `PointerLockControls` mount, so only one controls component exists at a time.
Entry at the centre of the active level's outer face (the largest room's label point if that is
inside a wall), eye 66" above the floor top, looking along +x, fov 65. A click on the canvas
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
missing `levelOrder` comes from the levels array, settings are filled). The upgraded document is
then read into a Plan built from known fields only (`pick`: unknown keys dropped, known keys in the
file's order so a current file round-trips byte for byte), with defaults for missing optional
values and broken openings, rooms, stairs and underlays dropped. New and Open replace the plan and
clear the undo history (New confirms when the plan has walls, rooms, stairs or an image). Autosave
to IndexedDB (idb-keyval) on every plan change (debounced), restored on load; a failed save
(storage full, IndexedDB unavailable) shows "Autosave failed: ..." in the status bar until a later
save works, and is never thrown. Underlays downscaled to <= 2048px JPEG data URLs.
3D export (`io/export3d.ts`, toolbar "Export" menu, loaded on first use): `buildExportScene` builds
a fresh Group from `getLevelMeshes` (not the live scene, which holds lights, grid and controls):
root named after the plan and scaled by 0.0254, one group per level the 3D view shows (empty levels
skipped) at its floor top, meshes `Wall <n> (<kind>, <phase>)`, `Floor`, `Stairs` with cloned
geometry and cloned live materials (one per phase/kind, named without spaces), disposed after
export. glTF: `GLTFExporter`, `binary: true`, `trs: true`. OBJ: `OBJExporter` on the same group with
the scale reset to 1 (inches; SketchUp asks for units) and each mesh name prefixed with its level,
since OBJ objects are flat. Only what the current view mode and level visibility show is exported.

## Risks

- Miter blow-up at acute angles: cap and bevel; collinear -> square cap.
- T overlap / z-fighting: normalize() after every structural edit, including node drags.
- Open loops from tape error: node-snap on typed commit; report open ends in the status bar.
- Re-render storms: never subscribe to the whole plan in a layer; never allocate arrays in selectors.
- Winding/normals: normalized in prism(); test with FrontSide.
- Pin react 19 / fiber 9 / drei 10 together.
- Opening offsets must be remapped on split/reverse and clamped on shorten, inside store actions only.
- Never compare coordinates with ===; use MERGE_EPS.
