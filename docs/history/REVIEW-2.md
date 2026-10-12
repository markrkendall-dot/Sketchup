# HomePlan review pass: what the house and the tools still get wrong

## Context

146 Mick Road is now in the starter plan with both floors measured. I went through the model as a
renovation user would: opened the example, looked at every level in 2D and every side in 3D,
walked inside, then did MK's renovation through the UI (a new bedroom over the Utility wing on the
Second Floor with its own roof, the wing roof marked demolish) and probed the editing tools. The
scripts are `scratchpad/qa/house-tour.mjs` and `scratchpad/qa/house-reno.mjs`, screenshots
`scratchpad/qa/tour-*.png` and `reno-*.png`. No crashes or console errors. What follows is what is
wrong or missing, ranked by how much it would hurt MK's renovation work, with the fix for each.

Execution: **Opus 5.5** implements, one agent per batch. The coordinator (Fable) re-runs the
milestone e2e scripts (m1 to m11), the QA probes, `npm test`, `npm run build`, inspects screenshots,
then commits and pushes one commit per batch.

## Findings

### Batch A: correctness bugs that corrupt the plan or the model

**A1. Drawing a wall on top of an existing wall silently deletes the existing piece.** Repro
(`house-reno.mjs` step A): Draw as *new*, draw a wall along the First Floor north wall from x 99 to
x 194. The existing north wall is split at 99 and 194 and the middle piece is replaced by the new
wall. In the Existing view the house now has a hole in its north wall with two open ends. Cause:
`normalizeLevel` step 2 in `src/model/plan.ts` drops "duplicate" walls between the same two nodes
and keeps whichever came first in iteration, which after the T-splits is the new wall. For a
renovation this is the exact gesture a user makes when they mean "this wall gets rebuilt" or when
they overshoot a corner, and the data loss is invisible until they switch views.
Fix: in `addWall` (store) reject a segment that overlaps an existing visible wall collinearly by
more than MERGE_EPS (compute with `projectPointToSegment` from `src/model/geometry.ts` on the
existing wall's centerline; parallel within 1e-6 and perpendicular distance under MERGE_EPS and the
projected intervals overlap). Status message: "A wall is already there. Select it and Mark
demolish, or draw the new wall beside it." The same check guards `copyWallsFromLevel` (skip
overlaps) and node drags that would land a wall on top of another (the drag is refused at that
position, like the existing clamp behaviour). `normalizeLevel` keeps the duplicate drop as a last
resort but prefers the wall whose phase is `existing` over `new`, and never drops a wall that has
openings in favour of one that has none. Tests in `graph.test.ts` and `plan.test.ts`: overlap
rejected with the message, partial overlap rejected, end-to-end touching allowed, copy skips
overlaps, the north-wall repro leaves 24 walls and no open ends.

**A2. The stair cuts the floor under the master closet.** The hole in the Second Floor slab is the
whole stair rectangle, so the closet that MK says sits over the low end of the stair has no floor.
Fix in `src/derive/stairs.ts` and `src/derive/meshes.ts`: the hole is only the part of the stair
where headroom under the floor above is less than 80". With `rise(d) = floorToFloor * d / run`,
the hole starts at `d0 = run * (floorToFloor - 80) / floorToFloor` measured from the bottom and
runs to the top (for this house: 108" floor to floor, run 125, hole starts 32" up the stair, so the
30" closet keeps its floor). Add `Stairs.headroom?: Inches` (default 80) and `Stairs.holeStart?:
Inches` (overrides the computed start) to the type and the properties panel ("Floor opening starts
… from the bottom", read-only computed value shown next to it), migrate strict-field. The 2D stair
symbol on the level above (ghost) and the `slabOutlines` hole use the same function. Tests: hole
length for the example stair, override honoured, a stair shorter than the headroom distance cuts
nothing (and says so in the panel).

**A3. The terrain fills the basement.** `tour-basement-open.png`: with the First Floor hidden the
ground surface passes straight through the basement interior. Fix in `src/derive/site.ts`
`terrainGrid`: grid vertices that fall inside the lowest level's outer face polygons (from
`getFaces(lowest, viewMode).outerFaces`, grown by the wall thickness via `slabOutlines(...,
toWallFaces)`) are set to the basement slab bottom minus 2". The terrain then dips under the house
instead of passing through it. Cache key gains the lowest level's outer polygons. Test: a point
inside the footprint returns the lowered height, a point outside is unchanged, no grade points
means a flat surface everywhere except the footprint.

**A4. "Only active level and below" and walk start use the wrong level in site mode.** Already
noted by the M9 report; still true. Fix: in site mode both use the first level above the lowest
(the First Floor), the same level the site view ghosts.

### Batch B: editing tools a renovation needs

**B1. Move a wall by a typed distance.** Dragging is imprecise, and dragging a wall where a window
sits grabs the window instead (`house-reno.mjs` step G). Add to the wall section of
`PropertiesPanel.tsx`: "Move" with a length field and two buttons for the two sides of the wall,
labelled with the room names on each side when known ("toward Kitchen" / "toward Living", the
helper from M10's face lookup). Store action `offsetWalls(levelId, ids, distance)`: translate the
walls' nodes along the wall's normal; a node shared with a non-collinear neighbour slides along
that neighbour's direction so the neighbour stays attached and straight (solve the intersection of
the moved wall line with the neighbour's line); collinear neighbours move with it; openings keep
their offset from the `a` end; normalize after. One undo step. Also `Shift+arrow` keys nudge a
selected wall 1" (arrows alone are taken by the underlay only when an underlay is selected).
Tests: move a partition 6" and check both rooms' net sizes change by 6", exterior wall move keeps
the corners square and the roofs' outlines unchanged (roofs do not follow; say so in the panel).

**B2. Rectangle tool for rooms and additions.** Hotkey `B` (box): click a corner, move, type
`12' x 10'` or `12'`, Tab, `10'` (two lengths separated by `x`, `by`, or Tab), Enter; or click the
opposite corner. Draws four walls of the current kind/thickness/phase through `addWall`, snapping
the first corner like the wall tool (including ghost snaps). The typed sizes obey "Lengths to"
(inside face: the room's interior is exactly the typed size). This is how the new bedroom and the
garage from the site sketch get drawn in four keystrokes. Tests in a new `rectTool.test.ts` via the
store: inside-face 12' x 10' gives a face with net 144 x 120.

**B3. Measure tool.** Hotkey `M`: click two points (with snapping), the overlay shows the distance,
dx, dy, and the status bar keeps the last measurement until Esc. No plan change. Also show the
measurement when the user holds a wall drag (live distance moved).

**B4. Export the 2D plan.** There is no way to hand a drawing to a contractor. Export menu gains
"Export plan (.svg)" and "Export plan (.png)": the active level in the current view mode, rendered
from the same layers as the screen (reuse `PlanLayers` in an offscreen `<svg>` via
`renderToStaticMarkup`, or serialise the live SVG node and strip the overlay), scaled so 1/4" = 1'
at 96 dpi for PNG (and a scale note plus a north arrow and the level name in a title block), with
dimension labels and room labels on, hover/selection off. PNG via a canvas at 2x. Tests: the SVG
string contains the level's room names and a `<title>`; the PNG is non-empty with the expected
pixel size for the example.

**B5. Hit priority and selection feedback.** Clicking a wall where a window sits should select the
window only when the click is within the opening's own rectangle; the trim gap zones at either end
of the opening count as wall. Clicking a selected window a second time selects its wall (cycle),
with the status bar saying "Click again for the wall". Tests on the hit function.

### Batch C: readability and polish seen on this house

**C1. Room labels in L-shaped rooms sit on the concave corner.** `tour-2d-second-floor.png`: the
"Office / hall" label lands next to the bath door arc. `labelPoint` in `src/derive/rooms.ts` uses
the centroid when it is inside the polygon. Replace with a pole-of-inaccessibility (largest
inscribed circle; the polylabel grid algorithm on the net polygon, 1" precision cap at 200
iterations) and let a room's own anchor win when it is inside the face (so MK can drag a label
where he wants it; today the anchor is ignored once a face is found). Test: an L gives a point in
the fatter arm.

**C2. Small-room clutter.** The closet's "3'" and "3'-2"" dimension labels overlap its name;
"Kitchen (17'2" adjusted: re-measure)" collides with the passage. Hide the wall dimension labels of
walls shorter than 4' when the room they bound is under 60 sq ft, and let long room names wrap to
two lines at 18 characters.

**C3. Status notice persistence.** "Opened the example: …" stays in the status bar for the rest of
the session. Notices clear after 8 s or on the next edit.

**C4. New-phase walls look black in 3D** (`reno-3d-proposed.png`). `pullGreen` lerps the dark stain
toward green and then multiplies the texture, which reads near-black. For `new`, mix the texture
with the green at 50% opacity instead (a second material layer is not needed: generate the "new"
variant of the siding texture with the green blended in `textures.ts`).

**C5. Walk start.** Starts in the biggest room looking east at a wall. Start just inside the entry
door looking into the house (the first `door` opening on an exterior wall of the level, facing
inward), falling back to the current rule. A "Walk from here" entry in the 2D right-click of the
select tool sets the start point explicitly (store in `uiStore`, not the plan).

**C6. Basement label.** The walkout bump under the wing has an unlabeled area. The starter adds
"Utility (below)" there, and the README's basement line says the bump is a separate space until
MK measures it.

### Not done on purpose (unchanged)

Deck, exterior stairs, retaining wall and garage as modelled objects (MK declined decks; the
garage is drawn with walls when he wants it); roof valleys; elevation drawings; furniture.

## Verification

- Every batch: `npm test`, `npm run build`, m1 to m11 e2e scripts from the scratchpad, `qa/perf.mjs`
  (no regression: wall tool 30 moves under 700 ms, drag under 800 ms).
- Batch A: `house-reno.mjs` step A shows 24 walls and no open ends after the overlap attempt;
  `tour-basement-open.png` re-shot shows an empty basement; the Second Floor 2D shows the stair
  hole starting past the closet and the 3D close-up shows closet floor.
- Batch B: an e2e that draws MK's new bedroom with the rectangle tool typed as `12'1 x 9'5` inside
  face on the Second Floor over the wing (ghost snap on the first corner), moves the
  Kitchen/Living partition 6" toward Living from the panel and checks both rooms, measures the
  Living room diagonal, exports the First Floor as SVG and PNG and checks the files.
- Batch C: re-shoot both floors in 2D and the proposed 3D; inspect label placement, clutter, and
  the new-wall colour.
- Commit and push each batch to `claude/cool-mccarthy-rqi8ka`; update `docs/QA-FINDINGS.md` with
  this pass and the README's limitations list.
