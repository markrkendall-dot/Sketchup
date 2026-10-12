# Make the exterior view and elevations of 146 Mick Road realistic

## Context

HomePlan renders the starter plan of 146 Mick Road in 3D, but the exterior reads as a toy: flat
lighting with no shadows, a thick slab roof with a tan fascia band on every edge, pale opaque
glass in uniform-grid windows, a bright red chimney twice its real depth, a plain grey basement,
glazed porch bays where the house has screens, and siding textures whose 1 px course lines vanish
at any distance. MK re-shared the reference photos (docs/photos 01, 03, 05, 07, 08; the sixth
photo, a garage interior, is out of scope) and asked for the exterior view and the elevations to
look like the house: right scale, right materials, accurate to the photos. MK's answers: "elevation"
means straight-on orthographic views in the 3D view with a PNG export; scope is the house only
(no deck, retaining wall, road, shed or garage); sizes that disagree with the photos are
re-estimated from the photos and stay flagged as estimates.

Opus implements, one agent per batch (A, B, C, D, E below). The coordinator (this session) merges,
runs the unit tests and the build, regenerates the example, shoots headless screenshots from the
photo viewpoints, compares them with the photos, and commits one commit per batch on
`claude/cool-mccarthy-rqi8ka`, the convention in docs/history/REVIEW-2.md. A feasibility review
of this plan against the installed three 0.186 / r3f 9.8 / drei 10.7 sources is folded in below.

Current render (scratchpad/shots/*.png) versus the photos, face by face:

| Face | Photo | What the render gets wrong |
| --- | --- | --- |
| South (lake) | 01, 02, 09 | Two picture windows are plain 6x2 grids; real ones are a 2x3-lite casement, a wide fixed centre pane, a 2x3 casement, about 12' and 10' wide. Upstairs windows are 4 and 3 casements with 2x3 lites each. No eave shadow, no rafter tails. Basement is a flat grey box; real one is grey block under the main block and brown vertical boards with brown double doors under the wing. |
| North (road) | 05, 06, 07 | Chimney is brick red and 40" deep; real one is stained the house brown, about 20" deep, with a concrete cap and a wire spark arrestor. Roof is flat grey; real one is rusted corrugated steel. West first-floor window is 3 casements about 80" x 56". |
| West (entry) | 08 | Porch bays are glass; real ones are screens over a shingled knee wall, with a screen door in front of the dark green nine-lite house door. Shutters on the big window are one third of its width; real ones are one casement wide. |
| East (wing) | 03, 04 | Wing gable window is 3 sashes; real one is 2 casements. Rake boards are tan; real ones are the house brown. Open eaves with rafter tails everywhere. |
| All | all | No shadows, no sky, no ground texture, horizon is a flat grey. Shaded faces render near black with no visible texture. Textures too fine to read (256 px per 48", 1 px lines). |

## Conventions for every batch

- Read docs/DESIGN.md first (the sections the batch names), then the files. Keep the existing
  patterns: pure derive code with no three imports in `roofs.ts` / `site.ts` / `openings3d.ts`,
  memoized caches that dispose replaced geometry, materials shared per key, phase variants
  (`existing` as drawn, `new` pulled toward green, `demo` translucent red) for every new material.
- Optional data fields only, no schema bump: validated in `migrate()` (`src/model/plan.ts`) with
  the `put(...)` pattern, appended to the `*_KEYS` arrays so `pick` keeps them, and the byte-for-byte
  round trip test extended. Store `update*` actions delete a key set to `undefined` (see
  `updateRoof`); `updateOpening` (about line 581) and `updateColumn` (about line 762) need the new
  keys added to their delete lists.
- Export stays colours only: `buildExportScene`'s `material()` in `src/io/export3d.ts` must always
  set `m.map = null; m.normalMap = null;` and a flat colour; every textured live material records
  its flat colour in `userData.flatColor` when `materials.ts` attaches a texture (today only walls
  do this, through `wallFlatColor`). `export3d.test.ts` asserts `map` null on every exported mesh.
- Tests: vitest in `src/__tests__`, pure functions tested with numbers, geometry closure tests kept
  green. Run `npm test` and `npm run build` before reporting; report what changed and any deviation
  from the brief. Do not commit; the coordinator commits.
- Prose in docs and comments without em dashes or en dashes (MK's preference).

## Data model additions (`src/model/types.ts`, validated in `migrate()`)

```ts
// Wall
finish?: WallFinish                      // gains 'block' (concrete block, for foundations)
// Opening
sashes?: number                          // 1..6 (default 1). Windows: vertical divisions by 2" mullions, lites
                                         // apply per sash. Doors: number of leaves (1 or 2), each a full leaf
fixedCenter?: boolean                    // windows with sashes = 3 only: the middle sash is one undivided pane,
                                         // side sashes min(24", (w - 4) / 4) wide each
glazing?: 'glass' | 'screen'             // default glass; screen: dark mesh pane, no muntins, 1" frame
halfLite?: boolean                       // doors: the lite grid glazes the upper 55% of the leaf, two panels below
leafColor?: string                       // doors: hex, default '#2f3a33'
// Roof
eave?: 'fascia' | 'open'                 // default fascia (old files unchanged); open: rafter tails, no eave board
rafter?: { depth: Inches; spacing: Inches }   // open eaves, default 5.5 x 24 o.c.
boardColor?: string                      // fascia and rake boards, default TRIM_COLOR
weathering?: number                      // 0..1, rust and streaking on a metal roof, default 0.35
// Column
color?: string                           // chimney or post colour, default brick '#7a4a3e' / tan '#c9b58c'
cap?: boolean                            // chimney: 4" concrete cap (top - 4 .. top, 2" proud) plus a 12" wire
                                         // spark arrestor above top
```

Validation rules (in `migrateOpenings` after `trim`, `migrateRoofs` after `color`, the column loop
in `migrateSite`): `sashes` integer 1..6; `fixedCenter`, `halfLite`, `cap` boolean; `glazing`
`'glass' | 'screen'`; `eave` `'fascia' | 'open'`; `rafter` an object with finite `depth > 0` and
`spacing > 0`, rebuilt as `{ depth, spacing }`; `weathering` finite 0..1; colours `isHexColor`,
lower-cased. Keys appended to `OPENING_KEYS`, `ROOF_KEYS`, `COLUMN_KEYS` (`plan.ts` about lines
505 to 513). Defaults in `src/model/finish.ts` (`DEFAULT_SASHES = 1`, `DEFAULT_RAFTER`,
`DEFAULT_WEATHERING = 0.35`, `COLUMN_COLOR` moved here from `materials.ts`).

## Batch order and parallelism

- A (light, sky, ground) and C (siding textures, openings) run in parallel in worktrees: their
  only shared files are `materials.ts` (A: glass, terrain, env intensities; C: wall normal maps,
  opening parts) and `LevelMeshes.tsx` (A: shadow flags; C: the `screen` part), separate hunks the
  coordinator merges.
- B (roof) and E (elevation views) run next, in parallel: B touches derive/roof files, textures,
  materials, the roof panel, export; E touches `Controls.tsx`, `Scene3D.tsx` (toolbar and
  invalidation only, after A's lighting changes are in), `uiStore.ts`, `Toolbar.tsx`, a new
  `capture.ts`.
- D (chimney parts, starter accuracy, docs) runs last: it uses C's screen material, B's roof
  fields and E's feature list in the README.

## Batch A: light, shadows, sky, glass, ground

Files: `src/view3d/Scene3D.tsx`, `src/view3d/materials.ts`, `src/view3d/LevelMeshes.tsx`,
`src/view3d/SiteMeshes.tsx`, new `src/view3d/groundTexture.ts`, `src/derive/meshes.ts`
(`buildTerrainGeometry` only), `src/derive/site.ts` (`TERRAIN_MARGIN`, `TerrainGrid.skirtElevation`),
`src/__tests__/site.test.ts`.

1. **Shadows.** `<Canvas shadows>` (r3f sets PCFSoft). Replace `Sun` with `SunLight`: a
   `directionalLight` with `castShadow`, `shadow-mapSize` 2048 (measure before raising to 4096:
   headless SwiftShader is slow), `shadow-bias` about -0.0002, `shadow-normalBias` about 1.5 (world
   units are inches). Fit the shadow camera to `planBox(plan)` (`src/view3d/bounds.ts`) on every plan
   change: target = box centre, position = centre + normalized sun direction x (2 x box radius),
   left/right/top/bottom = +-(radius x 1.1), near/far around that distance. r3f never calls
   `updateProjectionMatrix` on a light's shadow camera, so the component keeps a ref to the light and
   calls `light.shadow.camera.updateProjectionMatrix()` in an effect keyed on the box; the light's
   target is not in the scene by default, so render `<primitive object={light.target} position={centre} />`.
   The sun direction stays `sunPosition(northAngle)` from `derive/site.ts` (south-west); batch E adds
   a per-preset override.
   `castShadow receiveShadow` on walls (not `demo` phase: a translucent wall casts a solid shadow),
   floors, stairs, roofs, fascia, columns and opening parts other than glass (and other than
   batch C's `screen`); terrain `receiveShadow` only.
2. **Sky.** drei `<Sky>` with the same sun position, turbidity about 6, rayleigh about 1.5. Its
   `distance` scales a unit box (default 1000, so the camera at (900, 700, 1200) would be outside it
   and see no sky): use `distance={30000}`, raise the camera `far` to 40000 in `Scene3D.tsx`, and keep
   the far ground (below) inside the box.
3. **Environment.** Once per renderer, in an effect: `PMREMGenerator.fromScene(envScene)` where
   `envScene` holds one sphere (radius 50, BackSide) with a gradient ShaderMaterial (sky blue at the
   zenith, pale at the horizon, grass green-brown below); set `scene.environment`, dispose the
   generator and the texture on unmount. No network assets. (drei `<Environment>` with children is
   the alternative; either is fine, pick one.) Re-balance: sun intensity about 2.2, hemisphere down
   to about 0.5, `envMapIntensity` about 0.6 on the shared materials. Acceptance from the
   screenshots: the shaded north face shows its shingle courses (not black); the sunlit stain on
   the south face stays red-brown, no clipping toward pink.
4. **Glass.** `openingMaterial('glass')` becomes a `MeshPhysicalMaterial`: colour about `#2b3a44`,
   roughness 0.05, metalness 0, transparent, opacity 0.65, `envMapIntensity` 1.2, depthWrite off,
   renderOrder 1 as now; keep the demo red and new green tints. GLTFExporter handles it (all
   physical extensions at their defaults are skipped); the export test's material name `glass`
   is unchanged.
5. **Ground.** `src/view3d/groundTexture.ts`: a 512 px canvas standing for 96" of lawn (two greens
   with brown and straw specks, seeded noise from `textures.ts seeded`), `RepeatWrapping`,
   `repeat 1/96`, on `terrainMaterial` (UVs in inches: `buildTerrainGeometry` writes `uv = (x, z)`
   per vertex). Raise `TERRAIN_MARGIN` from 480 to 1200 (100') and update `site.test.ts` lines
   133 to 137 (bounds for {0, 0, 318, 306} become {-1200, -1200, 1536, 1512}, cellsX 114, cellsY 113,
   positions 115 x 114 x 3, indices 114 x 113 x 6). Add a skirt: `TerrainGrid.skirtElevation` = the
   lowest boundary vertex minus 12"; `buildTerrainGeometry` emits vertical quads from the boundary
   ring down to it (grid boundary rows and columns only; split vertices are interior). Add a far
   ground plane in `Scene3D.tsx`: 24,000" square (inside the sky box), at `skirtElevation`, grass
   colour, `receiveShadow`, so the horizon shows ground, not sky.

Tests: `site.test.ts` margin numbers and a skirt test (vertex count grows by the boundary ring,
every skirt vertex at `skirtElevation`); a materials test that glass is transparent and
`MeshPhysicalMaterial`. `Scene3D` is verified by screenshots.

## Batch C: siding textures at scale, foundation block, window sashes, screens, doors, shutters

Files: `src/view3d/textures.ts`, `src/view3d/materials.ts`, `src/derive/openings3d.ts`,
`src/derive/meshes.ts` (`buildOpeningFill`, `OpeningMesh`), `src/model/types.ts`,
`src/model/finish.ts`, `src/model/plan.ts` (migrate), `src/store/planStore.ts` (`updateOpening`
delete list), `src/ui/PropertiesPanel.tsx` (opening section, about lines 560 to 745; field helpers
`LengthField`, `NumberField`, `SelectField`, `ColorField`, `check-row` near the top),
`src/view3d/LevelMeshes.tsx` (the `screen` part), `src/io/export3d.ts`, `docs/DESIGN.md`
"Exterior appearance", `src/__tests__/finishes.test.ts`.

1. **Texture tile** 512 px for 48" (`TEXTURE_PX = 512`, a texel 3/32"). Every finish also draws a
   height canvas (lap steps, joints, mortar grooves) turned into a normal map: Sobel per pixel,
   sampling modulo `TEXTURE_PX` so the seam has no line; canvas y is down, so
   G = 0.5 + 0.5 k dh/dy_canvas and R = 0.5 - 0.5 k dh/dx; the normal texture keeps `NoColorSpace`
   (not the albedo's `SRGBColorSpace`), the same wrap, `repeat` and anisotropy; attached as
   `normalMap` with `normalScale` about 0.6. No tangent attribute is needed (three derives the frame
   from derivatives; `flatShading: true` is compatible). `rect()` already draws y up from the canvas
   bottom and `flipY` is true, so v = height stays right. Cache albedo and normal together.
2. **Clapboard** courses 8" (`CLAPBOARD_COURSE = 8`, 6 per tile; photo 02 shows 8" to 10" drop
   siding), a 3 px soft shadow under each lap, +-6% brightness per board, faint horizontal grain.
   **Shingle** keeps 4.8" courses and the staggered joints, adds a 3 px butt shadow, per-shingle
   brightness and a slight warm/cool hue shift, fine vertical grain. **Board** keeps 8" boards, adds
   a V-groove shadow. New **block**: 8" x 16" running bond, 3/8" mortar lighter than the face,
   per-block brightness; `WALL_FINISHES`, `WALL_FINISH_LABEL` ('Concrete block'), a `drawBlock`
   branch in `sidingTexture` before the screen fallback, the panel's finish select picks it up,
   migrate accepts it through `WALL_FINISHES`. **Screen** (`drawScreen`) at the new tile: 1 px lines
   every 2 px over translucent dark grey (alpha about 0.55) so screens read as mesh, not a grille.
3. **Sashes** (`openingFill`): windows with `sashes` n > 1 are divided by n - 1 mullions 2" wide
   (part `sash`, kind `mullion`, full hole height, sash depth); each sash gets its own 1.5" frame and
   its own lite grid; muntin counts and glass panes are per sash. `fixedCenter` (n = 3 only): side
   sashes `min(24, (w - 4) / 4)` wide with the lite grid, the centre sash the rest with no muntins.
   Doors with `sashes` 2 are double doors: two leaves (stiles, rails, panel or glazing each) meeting
   at the centre, one frame.
4. **Screens**: `glazing: 'screen'` puts the pane in a new part `screen` (kind `screen`), no
   muntins, 1" sash frame. A door with `glazing: 'screen'` is a screen door: 1.5" frame, a 4" mid
   rail (kind `midRail`) at 36", screen panels above and below, no leaf panel. Every place a new
   `FillPart` touches: `openings3d.ts` (`FillPart`, `FillKind` gains `mullion`, `batten`, `midRail`,
   `screen`; `FillInput` gains the new fields), `meshes.ts` (`buildOpeningFill` passes them;
   `OpeningMesh` gains `leafColor`), `materials.ts` (`OPENING_COLOR` is
   `Record<Exclude<FillPart, 'glass'>, string>`, exclude `screen` too; `openingMaterial(part, phase,
   color?)` gets a screen branch reusing `sidingTexture('screen', ...)`, transparent, DoubleSide, no
   depth write; `trimLike`'s key gains the colour, `${name}|${phase}|${color}`, or a second leaf
   colour returns the first material), `LevelMeshes.tsx` (`renderOrder` 1 and `castShadow` false
   for `screen` like `glass`), `export3d.ts` (`OPENING_MATERIAL.screen = 'screen'`;
   `openingMaterialName(part, phase, color)` gives `door_leaf_<hex>` for a non-default leaf colour,
   then `_new` / `_demo`), DESIGN.md's parts list.
5. **Doors**: `halfLite` glazes the top 55% of the panel area with the lite grid and splits the rest
   into two recessed panels by a 5" centre stile; `leafColor` keys the leaf material.
6. **Shutters**: each board is one sash wide (`w / sashes`), clamped to 10" to 18", with two 3" x 1"
   battens (kind `batten`, part `shutter`) across it at 1/4 and 3/4 of its height, 0.75" proud.
   Rewrite the shutter test (`finishes.test.ts` lines 143 to 155): two boards by kind `shutter` of
   width `min(18, max(10, w / sashes))` and four battens.
7. **Panel**: "Sashes" (1 to 6; label "Leaves" for a door, limited to 1 or 2), "Fixed centre pane"
   checkbox shown when sashes is 3, "Glazing: glass / screen", for doors "Half lite" and a "Leaf
   colour" `ColorField` with reset; lite labels say "per sash". `updateOpening` deletes the five
   new keys on `undefined`.

Tests (`finishes.test.ts`): box counts and widths for 3 sashes with 2x3 lites (2 mullions, 3 glass
panes, 9 muntins), fixedCenter widths (24 / 92 / 24 for a 144" window), screen door parts, half
lite door (one glass, two panels), double door (two leaves), shutter width clamp and battens,
block finish accepted and labelled, migrate accepts and drops each new field, round trip byte for
byte, the normal-map pixel rule on a one-step height field (G sign).

## Batch B: roof realism (open eaves, rafter tails, corrugated metal, ridge cap, board colour)

Files: `src/derive/roofs.ts`, `src/derive/meshes.ts` (`buildRoofParts`, `RoofEntry`, `disposeEntry`,
`addRoofUVs`), `src/view3d/textures.ts` (`roofTexture`), `src/view3d/materials.ts` (`roofMaterial`,
`fasciaMaterial(phase, color)`, `rafterMaterial`), `src/view3d/LevelMeshes.tsx`,
`src/model/types.ts`, `src/model/finish.ts`, `src/model/plan.ts`, `src/ui/PropertiesPanel.tsx`
(roof section about lines 980 to 1080), `src/io/export3d.ts`, `docs/DESIGN.md` "Roofs",
`src/__tests__/roofs.test.ts`, `src/__tests__/meshes.test.ts`.

1. **Open eaves** in `roofSolid`: a level outline stretch of an `eave: 'open'` roof gets no fascia
   board where the roof surface descends toward that edge (the plane's gradient points away from
   the edge; a shed's high edge and every edge of a flat roof keep their boards). Instead rafter
   tails: 1.5" wide boxes every `rafter.spacing` measured along the overhang outline edge `a -> b`
   in the `ordered` loop (first at half a spacing), keeping each tail whose centre falls inside the
   stretch, running from the eave edge minus 1" inward by `overhang - 1` (none when `overhang <= 1`),
   top on the region's plane, bottom `rafter.depth` lower (`slopedPrismPositions` with zt = plane,
   zb = plane - depth). Clip every tail quad with the same half-planes `roofRegions` uses
   (`clipHalfPlane(poly, {x: pl.gx - o.gx, y: pl.gy - o.gy}, o.c - pl.c)` for each other plane) so a
   tail near a hip corner does not poke through the neighbouring slope. Sloped stretches keep their
   rake boards (`fascia` deep). `RoofSolid` gains `rafters: number[][]`; `buildRoofParts` returns
   `{ slab, fascia, rafters }`; `RoofEntry` and `RoofMesh` gain `rafters` (and `RoofMesh`
   `boardColor`); `disposeEntry` (meshes.ts about line 844) disposes it.
2. **Ridge cap** on gable and hip metal roofs: along each line from `roofRidgeLines`, two 6" strips,
   one in each adjoining plane's region, `zb = plane + thickness`, `zt = zb + 2.5`, the shared face at
   the line omitted via `side`. Kept in its own `RoofSolid.ridge: number[]` and merged into the slab
   geometry only in `buildRoofParts`, so `buildRoofGeometry` and the roofs tests (slab 20 triangles,
   `volume`, bbox `ridge + thickness`, `closed(slab)`, 20 + 72 triangles for the default metal gable)
   are unchanged.
3. **Roof UVs** (`addRoofUVs` in meshes.ts, per triangle by flat normal like `addWallUVs`): for
   |ny| > 0.5, `down` = normalize(nx, nz) in plan (the frame's `v` when the normal is vertical),
   `along` its perpendicular, u = dot(p, along) / 24, v = dot(p, down) x sqrt(1 + k^2) / 48 with k the
   slope, so corrugations run down the slope, repeat every 2.67" along the eave and courses are not
   stretched on the slope; vertical faces: u along the edge / 24, v = Y / 48. These UVs are in tile
   units: the roof textures use `repeat (1, 1)`, unlike siding (inches, 1/48). Say so in DESIGN.md.
4. **Textures** (`roofTexture(finish, color, weathering)` in textures.ts): metal: 512 px tile =
   24" x 48", 9 ribs per tile shaded light/dark across each rib, long down-slope rust streaks
   (orange-brown, alpha scaled by `weathering`, seeded), a normal map from the rib profile (the
   batch C Sobel helper; coordinate with it or duplicate the 20 lines and let the coordinator
   unify); shingle: 5" courses of 12" tabs with a butt shadow. `roofMaterial` keys by finish, phase,
   colour and weathering quantized to 0.05 (a slider must not allocate a texture per step);
   metalness 0.35, roughness 0.55 for metal; `userData.flatColor` for the export.
5. **Colours**: `fasciaMaterial(phase, color)` keyed by colour (`boardColor`), `rafterMaterial(phase,
   color)` the same colour; export names `fascia_<phase>_<hex>` when not tan, `Rafters` meshes with
   `rafter_<phase>`.
6. **Panel**: "Eaves: fascia board / open rafter tails", rafter depth and spacing (when open),
   "Board colour" `ColorField` with reset to tan, "Weathering" 0 to 1 number field (metal only).
   `updateRoof` deletes the new keys on `undefined`. New roofs keep today's defaults.

Tests (`roofs.test.ts`): tail count and spacing (an outline 270" wide with 24" overhang: 318" eave,
13 tails, first centred 12" from the corner), tails only on descending level stretches (none on a
flat roof, none on a shed's high edge), tail top on the plane and bottom 5.5" lower, tails clipped
inside their region on a hip roof, ridge strips total length = ridge length, slab tests unchanged,
migrate accepts and drops the fields, UV ranges on a 24"-wide gable.

## Batch E: elevation views and elevation export

Files: `src/store/uiStore.ts` (`view3dPreset: 'perspective' | 'north' | 'south' | 'east' | 'west'`,
`setView3dPreset`; `setCameraMode('walk')` resets it to perspective since `FirstPerson.tsx` assumes a
`PerspectiveCamera`), `src/view3d/Controls.tsx`, `src/view3d/Scene3D.tsx` (toolbar buttons N, S, E, W,
Perspective; `view3dPreset` added to `InvalidateOnChange`; `SunLight` override), new
`src/view3d/capture.ts`, new `src/io/exportElevation.ts`, `src/ui/Toolbar.tsx` (Export menu),
`README.md` "3D and walk mode", `docs/DESIGN.md` "3D", `src/__tests__/viewport.test.ts` or a new
`elevation.test.ts` for the pure fit maths.

1. **ElevationView**: `Controls()` returns a new `ElevationView` instead of `OrbitView` when the
   preset is not perspective (the `FirstPerson` pattern, so exactly one controls component exists).
   It owns `<OrthographicCamera makeDefault near={1} far={40000}>` and its own
   `<OrbitControls makeDefault enableRotate={false} enableDamping={false} minPolarAngle={Math.PI / 2}
   maxPolarAngle={Math.PI / 2}>` (pan and zoom stay; `OrbitView`'s `maxPolarAngle` of 0.495 pi would
   tilt the view). drei's ortho frustum is in CSS pixels, so the fit is
   `zoom = min(size.width / (boxW x 1.1), size.height / (boxH x 1.1))` with boxW/boxH the `planBox`
   extents across the view axis (width and height of the face), camera position = box centre +
   axis x (depth / 2 + 100), `controls.target` = centre, then `invalidate()`; the fit also answers
   `fit3dRequest`. North looks toward +plan y from the road side, south toward -y, east toward -x,
   west toward +x (plan x east, y south). Guard `OrbitView`'s effect with
   `if (!(camera instanceof PerspectiveCamera)) return;` (during the commit that re-mounts it,
   `useThree(s => s.camera)` still returns the orthographic camera). drei restores the perspective
   camera on unmount; `OrbitView` then restores its saved pose as today.
2. **Sun for elevations**: `SunLight` reads the preset and, for an elevation, lights the face from
   behind the viewer, 45 degrees up and 30 degrees to the viewer's left, so the north face is not
   rendered in its own shadow; the shadow fit is the same box.
3. **Capture** (`capture.ts`): a module-level `registerCapture(fn)` set from a component inside the
   Canvas; `captureElevation(face, scale = 2)` builds a plain three `OrthographicCamera(-w/2, w/2,
   h/2, -h/2, 1, 40000)` in world units at the canvas aspect, `lookAt(centre)`,
   `updateProjectionMatrix()`, `updateMatrixWorld()`, sets the sun override for that face, then
   `gl.setPixelRatio(scale x dpr); gl.setSize(size.width, size.height, false); gl.render(scene, cam);
   gl.domElement.toDataURL('image/png')`, restores pixel ratio, size and sun, `invalidate()`. No
   `preserveDrawingBuffer` needed (synchronous render then read).
4. **Export**: "Export elevations (.png)" in the Export menu (disabled when `layout === '2d'`, with
   a note "Open the 3D view first"): downloads `<plan>-north-elevation.png` and the other three via
   `downloadBlob`; shadows and textures stay on (a realistic elevation, not a line drawing).

Tests: the fit maths (zoom and position for a given box, size and face) as a pure function in
`view3d/elevation.ts`; the preset reducer in the ui store (walk clears it).

## Batch D: chimney parts, starter accuracy, docs

Files: `src/derive/site.ts` (`columnDefaults` unchanged for size; `highestRidge` unchanged),
`src/derive/meshes.ts` (`buildColumnParts`, `addBoxUVs`, `ColumnMesh.parts`, `getSiteMeshes` dispose
loop), `src/view3d/bounds.ts` (+12" for a capped chimney), `src/view3d/SiteMeshes.tsx`,
`src/view3d/materials.ts` (`columnMaterial(kind, phase, color)` keyed by colour, brick texture by
colour, concrete, arrestor from the screen material), `src/view3d/textures.ts` (brick tile: 2.67" x 8"
running bond tinted by the colour, mortar slightly lighter, albedo + normal), `src/ui/PropertiesPanel.tsx`
(column section: "Colour" with reset, "Cap and spark arrestor" checkbox for chimneys),
`src/store/planStore.ts` (`updateColumn` delete list), `src/io/export3d.ts`, `scripts/example-plan.ts`,
`docs/examples/146-mick-road.json`, `README.md`, `docs/DESIGN.md`, `src/__tests__/site.test.ts`,
`src/__tests__/export3d.test.ts`, `src/__tests__/example.test.ts`.

1. **Chimney parts**: `ColumnMesh.geometry` stays the shaft (so `site.test.ts` lines 524 to 531 and
   the export test's Site children `['Chimney', 'Post', 'Terrain']` keep passing) and gains
   `parts` only when `cap` is true: `cap` (4" slab from top - 4 to top, 2" proud all round, concrete
   `#b8b4ac`) and `arrestor` (wire box from top to top + 12, inset 1", the screen material, no
   shadow). Export: shaft `column_chimney_<phase>` (plus `_<hex>` when coloured), parts
   `chimney_cap_<phase>` and `chimney_arrestor_<phase>` as `Chimney` meshes. `prism()` writes no
   `uv`: add `addBoxUVs(g)` in meshes.ts, per triangle by flat normal (|ny| > 0.5 gives (x, z); a
   vertical face with normal (nx, 0, nz) gets tangent (-nz, 0, nx), u = x t.x + z t.z, v = Y), in
   inches with the brick texture at `repeat 1/48`. `planBox` adds 12" above a capped chimney.
2. **Starter plan** (`scripts/example-plan.ts`; every value is an estimate from the photos and the
   README table says so):
   - South first floor: Living window 144 x 60, sill 30, centre x 87.5, 3 sashes fixedCenter, 2x3
     lites; Kitchen window 118 x 60, sill 30, centre x 242, same composition. (Jambs clear the
     Kitchen/Living partition faces at 168 and 173.)
   - South second floor: 88 x 46 at x 115, 4 sashes (2x3), sill 34; 66 x 46 at x 256, 3 sashes
     (2x3), sill 34.
   - North first floor: 80 x 56 at x 96, 3 sashes (2x3), sill 30; 42 x 44 at x 234, 2 sashes (1x1),
     sill 34. North second floor: 46 x 44, 2 sashes (2x3), sill 36 at x 78 and x 248.
   - West: first floor 90 x 44, sill 44, 3 sashes (2x3), shutters; second floor 48 x 32, sill 48,
     2 sashes (2x2), shutters. House door: lites 3x3, halfLite, leafColor `#2f4a3a`.
   - East: second floor 46 x 44, 2 sashes (2x3), sill 34 (both); first floor 36 x 40, sill 42, 1 sash
     (2x3). Wing: east gable 48 x 44, 2 sashes (2x3); north 48 x 40, 2 sashes (2x3); south 48 x 44,
     2 sashes (2x3), sill 30.
   - Porch: the four bays become windows with `glazing: 'screen'`, sill 36, height 44 (front north
     bay 18" at y 17.5, front south bay 18" at y 78.5, north side 44", south side 44"); the entry a
     36" screen door at y 48 swinging out (west). Grade points at the porch's two outer corners and
     the front's midpoint at +1 (the first floor top is +2, so no slab edge shows).
   - Basement: block walls `finish: 'block'` (colour `#8f8a84`); the wing's south basement wall
     `finish: 'board'` in the stain, its door 72 x 80 with `sashes: 2` (double door), leafColor the
     stain, lites 1x1.
   - Roofs: main roof `eave: 'open'`, rafter 5.5 x 24, thickness 2.5, fascia 7, boardColor the stain,
     colour `#8a8378` (weathered galvanized), weathering 0.6; wing roof the same with colour
     `#6e4b3c` and weathering 0.3; porch roof as the main roof with weathering 0.7.
   - Chimney: 24" along the wall x 20" deep (`{ ...chimneyHeights(), depth: 20 }`, depth after the
     spread since `columnDefaults` returns 40) centred at y -10, colour the stain, cap true.
   - `example.test.ts`: roof colours no longer all `#6e6259`, doors 7 to 8, passages 8 to 5.
3. **Docs**: README "Roofs, site and appearance" (eaves and rafter tails, sashes and fixed centre
   panes, screens, double doors, chimney cap, block finish), "3D and walk mode" (elevation views and
   export, from batch E), the "What to replace with measurements" table (new window numbers; porch
   depth note: photos 06 and 07 read 7' to 9' deep, the starter keeps 5'6" until measured), export
   notes; DESIGN.md "Exterior appearance", "Roofs", "3D", "Site and terrain", "Persistence and
   export"; copy this plan to `docs/history/PLAN-v3-realism.md` and link it from docs/README.md.

Tests: chimney parts count with and without cap, `addBoxUVs` ranges, `columnMaterial` keyed by
colour, export names, `planBox` with a capped chimney, example counts, migrate column fields.

## Verification by the coordinator

- Per batch: `npm test`, `npm run build`, `npm run build:example` (a diff only when the batch changes
  the starter), then the screenshot script (scratchpad `shots.mjs`: Playwright from
  `/opt/node22/lib/node_modules/playwright` with `/opt/pw-browsers`, `npm run dev` on 5173, click
  "Open example", `uiStore.setLayout('3d')`, grid off, poses set through `window.__homeplan.scene3d`
  with `camera.position`, `controls.target`, `controls.update()`, `invalidate()`): south straight on
  (photo 01: camera (160, 130, 950) to (160, 110, 157)), north from the road (06: (160, 140, -800)),
  west with the porch (08: (-900, 140, 157)), east with the wing (03: (1263, 140, 157)), south-east
  low (02: (700, 60, 700) to (200, 90, 200)), the porch close-up ((-330, 110, -170) to (-20, 70, 48)),
  and after batch E the four elevation presets and the exported PNGs.
- Inspect against the photos: shadows under the eaves and in the window reveals; shingle and
  clapboard courses visible on every face at the fit distance, 8" boards and 5" shingles by count;
  corrugation and rust on the roof; rafter tails at 24" with none poking through the wing's hip-free
  gable; the south picture windows reading casement, fixed, casement; screens on the porch; the
  chimney brown with its cap; block foundation; no black faces; no z-fighting at eaves, slab edges
  or the chimney; the sky and ground at the horizon from eye level.
- Regressions: the Proposed and Existing views still show new work green and demolished red for
  every new material; walk mode works (perspective camera restored after an elevation); the glTF and
  OBJ exports of the example open (parse the glb in node, no textures embedded, `map` null).
- Perf: the demand-rendered frame on the example stays under about 100 ms in headless Chromium
  with the 2048 shadow map, normal maps and the 512 px tiles (`performance.now()` around
  `invalidate()` and the next `requestAnimationFrame`); raise the shadow map to 4096 only if that
  holds.
- Commit one commit per batch on `claude/cool-mccarthy-rqi8ka` with the batch letter and a one-line
  summary, push after each, then give MK a short changelog with the before/after screenshots.
