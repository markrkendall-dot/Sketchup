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
  id: Id; origin: Vec2; direction: Degrees; width: Inches; run: Inches;
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
  orthoLock: boolean;
  measureTo: 'center' | 'inside' | 'outside';   // what a typed wall length refers to
}

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
clamped). Crossings without a node are not auto-split in v1 (the on-wall snap creates the node).
Simple graph, not multigraph: at most one wall between two nodes.

## Corner joins (`derive/footprint.ts`)

For wall a->b with unit direction d and left normal n, the left offset line is `a + n*t/2 -> b + n*t/2`.
At node a, sort incident walls by outgoing angle. The wall's left edge meets the right edge of the next
wall counter-clockwise; intersect the offset lines. Symmetrically for the right edge and the previous
wall clockwise. Fallbacks: degree 1 -> square cap; collinear neighbour (|cross| < 1e-6) -> square cap
(the through wall at a T); miter longer than `1.5 * max(t, t_neighbour)` -> bevel at that cap length.
Output per wall: `quad: [leftA, leftB, rightB, rightA]` and the core interval
`s0 = max(0, proj(leftA), proj(rightA))`, `s1 = min(L, proj(leftB), proj(rightB))`. Openings are
clamped to `[s0 + w/2, s1 - w/2]`.

2D stroke trick: fill the quad, stroke only the two long edges plus end caps at degree-1 nodes, so a
through wall split by a T shows no seam.

## Rooms (`derive/rooms.ts`)

Planar face enumeration: two half-edges per wall, sort outgoing half-edges by atan2 at each node,
trace faces by stepping to the next half-edge clockwise from the twin. Discard the outer face of each
component (negative signed area with the chosen convention; assert the sign in a test with one
rectangle) and faces under 1 sq ft. Remove spike pairs `p, q, p` from dangling walls. A Room's anchor
is point-in-polygon tested against faces; the containing face gets the name. Rooms whose anchor is in
no face render at the anchor in a warning colour. Net area: offset each edge inward by half the
bounding wall thickness; fall back to centerline area if the offset polygon self-intersects.
Detection runs on the walls visible in the current ViewMode.

## Openings in 3D (`derive/meshes.ts`)

No CSG. `prism(polygon: Vec2[], y0, y1)` triangulates the cap with `ShapeUtils.triangulateShape`,
emits side quads, uses flat per-face normals (non-indexed). A wall = start cap wedge (full height) +
each solid gap between openings + for each opening: under-sill piece (0..sill, if sill > 0) and header
piece (sill+height..wallHeight, if positive) + end cap wedge. Merge with
`BufferGeometryUtils.mergeGeometries`. Floor slab: outer face polygon reversed, with stair holes.
If a level has no closed outer face, draw no slab.

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
   adjusted for `settings.measureTo` (inside/outside face: add or subtract half the thickness of the
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

## Undo/redo

zundo `temporal` on planStore only, `partialize: s => ({plan: s.plan})`, limit 200. uiStore is not
tracked. Drag grouping: the first set of a drag is tracked, then `temporal.getState().pause()`,
moves are untracked, `resume()` on pointerup. One undo reverts the whole drag.

## Derivation and memoization

`derive/*` are pure functions of plan objects. `getGraph(level)`, `getFootprints(level)`,
`getFaces(level, viewMode)` are memoized by `WeakMap<Level, ...>`. `getFootprints` compares each
wall's new footprint with the previous one by value and returns the previous object if equal, so
`<WallMesh3D>` can `useMemo` on the footprint reference and rebuild only changed walls. Dispose old
geometry in effect cleanup.

## 3D

r3f `<Canvas frameloop="demand">`, invalidate on store change. One `<group>` per level at its
elevation. Orbit (drei OrbitControls) by default; first-person = PointerLockControls + WASD in
useFrame with delta time, eye height 66", `frameloop="always"` while active, mount only one controls
component at a time, listen to `unlock` to return to orbit. Camera near 1, far 20000 (scene in inches).
No collision in v1.

## Persistence and export

JSON download/upload with `schemaVersion` and `migrate()`. Autosave to IndexedDB (idb-keyval) on
every plan change (debounced), restored on load. Underlays downscaled to <= 2048px JPEG data URLs.
glTF export builds a fresh Group from derived geometry (not the live scene), root scaled by 0.0254,
`binary: true`, named mesh and group per level, one material per phase. OBJ export in inches.
Export only what the current view mode shows.

## Risks

- Miter blow-up at acute angles: cap and bevel; collinear -> square cap.
- T overlap / z-fighting: normalize() after every structural edit, including node drags.
- Open loops from tape error: node-snap on typed commit; report open ends in the status bar.
- Re-render storms: never subscribe to the whole plan in a layer; never allocate arrays in selectors.
- Winding/normals: normalized in prism(); test with FrontSide.
- Pin react 19 / fiber 9 / drei 10 together.
- Opening offsets must be remapped on split/reverse and clamped on shorten, inside store actions only.
- Never compare coordinates with ===; use MERGE_EPS.
