# 146 Mick Road: the proposed design in the starter plan

## Context

The starter plan (docs/examples/146-mick-road.json, built by scripts/example-plan.ts) is the house
as it stands. MK now wants the tool to hold a "desired state": the renovation drawn as `new` and
`demo` work on the same plan, so the Existing, Proposed and All views show before and after, the
3D view and the elevations render the proposal, and the exports carry either state. The app was
built for exactly this (phases on walls, openings, roofs, stairs, columns), so the work is mostly
design and script, plus two small model additions the design needs.

MK's brief (his answers, 12 Oct 2026):

1. **Master bedroom where the Utility is**, the wing growing north along the east wall all the way
   to the road corner at the same depth (12'1" out): a 12' x 26' one-storey addition down the whole
   east side. The master bath is in the addition.
2. **Kitchen grows** into some of the current first-floor bath's space.
3. **Half bath downstairs**, under the stair or in the remaining space by the foyer.
4. **Stairs**: the front door moves to the west wall near where the old stair bottom is; you enter,
   turn left (north), climb two risers to a landing in the north-west corner, then the main flight
   climbs east along the inside of the north wall (the framed-garage photo). Width 36".
5. **New foyer** where the entry porch is, with an **attached screen porch south of it** along the
   west face. Roofline from MK's reference pictures: a gable end over the entry and a shed roof
   over the screen porch, joined; heavy stained timber posts in the spirit of the second picture,
   no white trim.

Everything stays on `claude/cool-mccarthy-rqi8ka`; Opus implements in two batches, the coordinator
verifies (tests, build, screenshots in all three views) and commits one commit per batch, as before.

## Model additions

Optional fields, no schema bump, validated in `migrate()` with the `put` pattern and appended to
`STAIRS_KEYS` / `ROOM_KEYS` in src/model/plan.ts; `updateStairs` / `updateRoom` delete them on
`undefined` (src/store/planStore.ts).

```ts
// Stairs (src/model/types.ts)
base?: Inches      // height of the bottom step above the floor top (default 0): a flight that starts on a landing
rise?: Inches      // height the flight climbs (default floorToFloor - base): a short flight to a landing
risers?: number    // step count override (default round(rise / 7.5), at least 1): a landing is one riser, one deep tread
// Room
phase?: Phase      // default existing: a label hidden in the views that hide its phase (a new room's name is not
                   // an orphan in the Existing view; a label of a demolished room disappears in Proposed)
```

Where they take effect (src/derive/stairs.ts and callers):

- `stairSteps(totalRise, risers?)`: `risers` wins when given; `rise` per step = total / risers.
- `stairsRise(plan, levelId, s)`: `s.rise ?? floorToFloor - (s.base ?? 0)`; `stairsBase(s)`.
- `headroomHoleStart(s, floorToFloor)`: the tread height is `base + rise * d / run`, so the hole
  starts at `d0 = run * (floorToFloor - headroom - base) / rise`, clamped to [0, run]; a flight whose
  top is lower than `floorToFloor - headroom` (the two-riser flight, the landing) cuts nothing.
  `stairsHoleOutline` unchanged otherwise.
- `buildStairsGeometry(stairs, rise, risers, base)` in src/derive/meshes.ts: the profile starts at
  `y = base` (a box from 0 to base under the first riser, so a flight on a landing has no void below
  it); `getLevelMeshes` passes the per-flight rise, risers and base (today it uses one
  `stairSteps(ftf)` for the level).
- 2D: `stairsSymbol(s, risers)` already takes the count; `PlanLayers.tsx` passes the per-flight
  count; a one-riser flight draws no tread lines and no UP arrow (a landing).
- Panel (src/ui/PropertiesPanel.tsx, stairs section): "Starts at" (base, 0 default), "Climbs"
  (rise, placeholder shows the computed default), "Risers" (placeholder the computed count), with
  the existing validation style; `columnProblem`-like checks in `addStairs` / `updateStairs`:
  base >= 0, rise > 0, base + rise <= floorToFloor + 1", risers a whole number >= 1.
- Room phase: `RoomLabelsLayer` / `roomLabels.ts` skip labels whose phase the view hides
  (`isVisible(room.phase ?? 'existing', viewMode)`); the room panel gets a "Phase" select like the
  others; "Mark demolish" (`setPhase`) accepts rooms; the plan export (exportPlan.ts) follows.
- Walk mode: unchanged (no collision). Export: stairs geometry already comes from `buildStairsGeometry`.

Tests (stairs.test.ts, rooms.test.ts, migrate.test.ts): a 22" flight with rise 14 has 2 risers of 7"
and cuts no hole; a landing (rise 14, risers 1, run 36) is a 14" box; a flight with base 14 and rise
94 over run 126 has 13 risers and its hole starts where `14 + 94 d / 126 = 28`, d about 18.8";
round trips; a room with phase `new` is hidden in the existing view's labels.

## The proposed design (scripts/example-plan.ts, all `new` unless marked demo)

Coordinates as in the script: inches, x east, y south, outside faces of the main block
x 0..318, y 0..315, centerlines 3.5" inside; the existing wing x 318..463, y 188..315; the old
porch x -66..0, y 0..96; first-floor bands: hall y 7..97, wall y 99.5, strip y 102..135, wall
y 137.5, Living / Kitchen y 140..308; Kitchen/Living partition x 170.5; old bath x 197..311,
its west wall x 194.5.

The script gains a second half, `proposed(ids)`, run after the existing house is built, with its
own helpers taking a `phase` (`drawWalls(…, phase)`, `partition(…, phase)`, `addOpeningAt(…, phase)`,
`roof(…, phase)`, `label(…, phase)`) and a `demolish(levelId, { walls, openings, stairs, roofs })`
helper over the store's `setPhase` and `updateOpening`. Walls that will be partly demolished are
drawn in pieces from the start so a piece can be marked demo without splitting: the y 99.5 line is
drawn as `(314.5 → 194.5)`, `(194.5 → 170.5)`, `(170.5 → 60)`, `(60 → 3.5)` (the existing geometry
is unchanged: same faces, one extra node at x 60 that the 2D merge hides).

### 1. East addition: master suite (First Floor, Basement)

- New exterior walls (7", shingle, the stain): north wall y 3.5 from x 314.5 (the main block's
  north-east corner node) to x 459.5; east wall x 459.5 from y 3.5 down to y 191.5 (the existing
  wing's north-east corner node). The whole east side is now one wing, outside x 318..463, y 0..315.
- Demolish: the existing wing's north wall (y 191.5) with its window; the main block's first-floor
  east window at y 152 (it would face into the bedroom); the existing wing roof.
- Partition (5") y 120 from x 314.5 to x 459.5: **Master bath** north of it (inside 131" x 110",
  about 10'11" x 9'2") and **Master bedroom** south (inside 131" x 186", 10'11" x 15'6", the old
  Utility plus 6'). Bath door 28" in the partition at x 345, swinging into the bath. Bedroom door
  32" in the main block's east wall (x 314.5) at y 150, swinging into the bedroom, from the kitchen
  (the only room beside it; a note in the README says a hall or closet wall can be added later).
- Windows (new, 2 x 3 lites per sash, sill 30 unless said): bath north 36 x 36, 1 sash, sill 48 at
  x 390; bath east 48 x 44, 2 sashes at y 62; bedroom east 48 x 44, 2 sashes at y 160 (the existing
  wing east window at y 251.5 stays); the existing wing south window stays.
- New roof over the whole wing: gable, outline x 318..463, y 0..315, ridge north-south
  (`ridgeAngle: 90`), pitch 7, overhang 18, same metal and colours as the wing roof, open eaves;
  its top meets the main east wall at 142.5" above the first floor, under the upstairs east
  windows' sills (144"). The old wing roof is demo.
- Basement: new 8" block walls under the new part: (314.5, 3.5) → (459.5, 3.5) → (459.5, 191.5),
  joining the bump's corner node; so the foundation shows where the ground is below the slab.
  Label "Crawl space (proposed)" phase new.
- Labels (phase new): "Master bedroom (proposed)", "Master bath (proposed)"; the "Utility" label
  gets phase demo.

### 2. Kitchen into the bath

- Demolish only the y 99.5 wall piece 194.5 → 314.5 (between the kitchen and the old bath). The
  old bath's west wall (x 194.5) and its 30" door stay: the door becomes the hall's door into the
  kitchen. The kitchen becomes an L: its old area plus the old bath area (x 197..311, y 7..97).
- The "Bath" label gets phase demo; the existing "Kitchen" label stays (its anchor is inside the
  proposed L as well).

### 3. Stairs and the front door

- Demolish: the existing stair; the existing house door at (3.5, 48); the y 99.5 piece 60 → 3.5
  (so the strip and the hall join at the west end, where you turn north); the hall's 36" passage
  at x 150 in the y 99.5 wall (the powder room takes that spot: set the opening's phase to demo).
- New house door 32" x 80 in the west wall at y 118.5 (the middle of the old strip; 32" because
  the clamp uses the All view, where the strip's partitions' faces at 102 and 135 leave 33"),
  swinging in (east), half lite 3 x 3, the green leaf. The foyer's outer front door is 36".
- Two-riser flight: origin (25, 65), direction 270 (north), width 36 (x 7..43), run 22 (y 65 up
  to 43), rise 14, risers 2, `cutsFloorAbove: false`. Landing: origin (25, 43), direction 270,
  width 36, run 36, rise 14, risers 1, `cutsFloorAbove: false`: a 36 x 36 platform 14" high in the
  north-west corner, x 7..43, y 7..43. Main flight: origin (43, 25), direction 0 (east), width 36
  (y 7..43 along the north wall; its bottom edge is the landing's east edge), run 126, base 14,
  rise 94 (13 risers of 7.2", treads 9.7"), `cutsFloorAbove: true`: it tops out at x 169, the
  Bunk's east wall face, upstairs. The floor opening starts about 19" up the run (x 62) and runs
  to x 169, y 7..43: the Bunk loses a 3' strip along its north wall (a railing is not modelled;
  the README says so). From the new door at y 118.5 you walk about 4'6" north across the old
  strip and the hall's west end to the first step.
- Labels: "Stair" (existing) gets phase demo; "Entry (proposed)" phase new at (40, 118).

### 4. Powder room

Under the stair's top there is no standing room (the flight is 76" high only over its last 3'), so
the powder room sits beside the stair's top in the old hall: new partitions (5") x 134.5 from
y 45.5 to y 99.5 and y 45.5 from x 134.5 to x 194.5 (both T-join), making a room x 137..192 by
y 48..97 (4'7" x 4'1" inside) south of the flight. Door 28" in the x 134.5 wall at y 72, swinging
into the powder room from the hall. Label "Powder room (proposed)" phase new. The hall keeps its
"Entry hall" label (now the hall round the stair); rename it "Hall" with a second label? Keep
"Entry hall" as is.

### 5. Foyer and screen porch (west face)

- Demolish the old porch: its three walls (their five screen openings go with them), its roof;
  the "Entry porch (est.)" label gets phase demo.
- **Foyer**: outside x -96..0, y 70..166 (8' x 8', centred on the new door): new walls (7",
  shingle) y 73.5 from (3.5, 73.5) to (-92.5, 73.5), x -92.5 from y 73.5 to y 162.5, y 162.5 from
  (-92.5, 162.5) to (3.5, 162.5); the new wall y 73.5 crosses the old porch's west wall (demo) and
  normalize splits both at the crossing, which is fine. Front door 36" x 80 in the foyer's west wall
  at y 118.5 swinging in, half lite, green; a window 36 x 44 (1 sash 2 x 3) in its north wall at
  x -48, sill 36. Label "Foyer (proposed)" phase new.
- **Screen porch**: outside x -96..0, y 166..315 (12'5" along the wall, 8' out; MK's picture may
  change the size): new walls x -92.5 from y 162.5 to y 311.5 and y 311.5 from (-92.5, 311.5) to the
  main block's south-west corner node (3.5, 311.5); the foyer's south wall is shared. Knee walls
  with screens above them (windows of sill 36, height 44, glazing screen, trim 0): three 40" wide
  in the west wall at y 190, 237 and 284, and one 44" wide in the south wall at x -62. Doors: a 36"
  screen door in the foyer's south wall at x -48 swinging into the porch (from the foyer), and a
  36" screen door in the porch's south wall at x -20 swinging out (to the lawn). The Living's west
  window at y 203 now looks into the porch and stays. Label "Screen porch (proposed)" phase new.
- **Roofs** (from MK's reference pictures: a gable end over the entry, a shed over the porch,
  joined; the timber-porch photo is the style, no white trim):
  - Foyer: gable, outline x -96..0, y 70..166, `ridgeAngle: 0` (ridge east-west, the gable faces
    west over the front door like the old porch's), pitch 8, overhang 18, open eaves, 7" rake
    boards in the stain, galvanized colour. Ridge 96 + 48 x 8 / 12 = 128" above the first floor at
    the house wall, under the upstairs west window's sill (158 absolute vs 130).
  - Screen porch: shed, outline x -96..0, y 166..315, `ridgeAngle: 180` (high at the house wall,
    sloping down away from it), pitch 4, overhang 18, open eaves, same colour: 128" at the wall,
    96" at the outer wall, so it meets the gable's eave line. The two roofs overlap at y 166 (no
    valley modelling; the README's limitation).
  - Posts: the foyer is enclosed, so no posts there; the porch gets 8" x 8" posts in the stain
    (Site columns, kind post, `color` the stain, phase new) at its two outer corners (-92, 170) and
    (-92, 311) and between the screens at (-92, 237), from the porch floor top (+2) to the shed's
    underside (`columnDefaults` for a post). Knee braces and the timber truss in the gable are not
    modelled (README note).

### 6. Second floor and the rest

- Nothing new upstairs except the hole from the new flight; the old stair's hole disappears in
  the Proposed view by itself. README note: the Bunk becomes the stair hall and needs a railing and
  a new layout, not designed yet.
- Grade points: none change (the new wing's north part sits where the ground is -4 to -6, the
  block shows 6" or so above grade). Chimney unchanged.
- Plan name stays; the README's "Drawing the renovation on top of it" section becomes "The
  proposed design in the starter" describing the five changes, the views to use (Proposed for the
  3D and the elevations, All to see both), and what is still open (porch roofline and sizes,
  bedroom entry, upstairs layout, railing, measurements). Copy this plan to
  docs/history/PLAN-v4-proposed.md and list it in docs/README.md.

### Example tests (src/__tests__/example.test.ts)

Counts by phase: walls, openings, stairs (3 new, 1 demo), roofs (2 new, 2 demo), labels. In the
`proposed` view: no open ends on any level, faces named Master bedroom, Master bath, Powder room,
Foyer, Screen porch, Kitchen with the L's bounding box 138 x 301; the Entry hall face contains the
landing; in the `existing` view the faces and sizes of today's tests are unchanged (the existing
tests keep passing with `getFaces(level, 'existing')`); the new flight's hole outline on the Second
Floor; the roof over the whole wing; no overlapping surrounds in either view.

## Batches

**Batch F (Opus): the model additions.** Files: src/model/types.ts, src/model/plan.ts,
src/store/planStore.ts, src/derive/stairs.ts, src/derive/meshes.ts, src/editor2d/PlanLayers.tsx,
src/editor2d/roomLabels.ts, src/ui/PropertiesPanel.tsx (stairs and room sections), src/io/exportPlan.ts
(room labels by phase), docs/DESIGN.md ("Plan document", "Openings in 3D" stairs paragraph, "Rooms"),
tests. No change to the starter.

**Batch G (Opus, after F): the proposed design.** Files: scripts/example-plan.ts,
docs/examples/146-mick-road.json (regenerated), src/__tests__/example.test.ts, README.md,
docs/README.md, docs/history/PLAN-v4-proposed.md. Every coordinate above; `addOpeningAt` keeps
throwing when an opening does not fit, so the agent adjusts a position only by reporting it.
Points the agent must check and report on, because they are the known pitfalls: the new foyer
wall crossing the demolished porch wall (normalize splits both; the proposed view must show the
new wall whole with no open end); new walls T-joining existing ones keep the existing pieces'
phase and openings; a hidden (demo) wall hides its openings in the proposed view; the bedroom door
at y 150 and the demo window at y 152 share the main east wall (if `addOpening` refuses the
overlap, move the door to y 200); the new front door's jambs (y 100.5..136.5) must fit between the
two partitions' faces at the west wall (102..135): if not, the door is 32" wide; in the `all` view
faces are the union of every wall, so the existing size tests move to `getFaces(level, 'existing')`;
the Existing view must render pixel-identical to today's screenshots.

Both: `npm test`, `npm run build`, `npm run build:example`; no em dashes in prose; do not commit.

## Verification by the coordinator

- Screenshots (scratchpad shots.mjs, with `uiStore.setViewMode('proposed')` added as a step) in
  the Proposed view from the photo viewpoints and the four elevations: the wing runs the whole east
  side under one roof meeting the wall under the upstairs windows; the foyer and porch on the west
  face with the front door in the foyer; the old porch gone; the chimney untouched.
- The Existing view is pixel-identical to the final set from the realism work (same viewpoints),
  apart from the one extra node on the y 99.5 wall which draws nothing.
- The All view in 2D (First Floor): demolished walls dashed red (old porch, wing north wall,
  the two y 99.5 pieces), new walls green, the three flights with the landing, the powder room.
- 3D close-up of the stair from inside (walk mode from the new front door): two steps up, the
  landing, the flight along the north wall, the floor opening above it.
- `npm test` (example counts), `npm run build`; commit per batch, push.

## As built (batch G)

Where scripts/example-plan.ts differs from the design above, and why:

- **Two-riser flight**: run 36" from y 79 to 43 (two 18" treads), not 22" from y 65: the store
  refuses a run under 36" (`STAIRS_LIMITS.minRun`).
- **Main flight**: 35.5" wide at y 7.5..43 (origin y 25.25), 1/2" off the north wall: a floor opening
  that touches the Second Floor slab's edge (the north wall's inside face, y 7) is not cut.
- **Powder room**: west wall at x 129.5, not 134.5 (inside x 132..192, 5' x 4'1"): a node at x 134.5
  would split the y 99.5 wall inside the existing 36" passage (x 132..168) and move it.
- **Hall and strip**: the whole y 99.5 piece west of the powder room (x 3.5..129.5) is demolished,
  not only x 3.5..60: a piece ending at x 60 is an open wall end in the Proposed view. The y 99.5
  line is drawn in pieces at x 194.5, 170.5 and 129.5. There is no "Entry (proposed)" label: the
  hall and the strip are one face in Proposed, already named "Entry hall".
- **Foyer**: outside y 64.25..158 (7'10" x 8'), not 70..166: its north wall (y 67.75) runs through
  the post between the old porch's screen door and its south screen, and its south wall (y 154.5)
  stops north of the Living's west window, so no existing opening is split or moved. Screen porch
  y 158..315. The foyer's north window is at x -42 (x -48 would straddle the old porch wall's
  crossing at x -62.5).
- **Living west window**: demolished and replaced by the same window without shutters, 4" south
  (y 207): its north shutter would lie inside the foyer, against the new house door's trim.
- **Porch screens and posts**: two 56" screens in the west wall (y 199 and 273) either side of a
  middle post at y 236, posts at y 162 and 311; the planned three 40" screens put the middle post
  across a screen. Posts stand on the porch floor (+2"), tops from `columnDefaults`.
- **Foyer and porch roofs**: outlines x -96..-18, so the 18" overhang ends at the house wall's face
  instead of running into the house; the slopes are as planned (shed 128" at the wall, 96" out).
- **Master suite sizes**: both rooms are 138" (11'6") east-west inside, not 131".
- **Wing roof**: as planned (ridge north-south), so its ridge is 72.5" out from the main wall, about
  138" above the first floor, and it meets the main wall at its west eave, at the first floor's
  plate; its 18" west overhang runs into the kitchen at the ceiling (roofs overlap, as the old
  wing roof's rake did).
- **New roofs** are weathering 0.1 (new sheet) in the planned colours.
