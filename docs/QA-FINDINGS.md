# HomePlan QA pass (v1): findings and fix plan

## Context

HomePlan v1 (seven milestones, all on `claude/cool-mccarthy-rqi8ka`) is feature complete. Before MK enters his house measurements, I used the app as a homeowner would: three headless-browser sessions covering first use, drawing by clicks and by typed lengths, odd inputs, corner dragging, openings, rooms, levels, files, 3D, walk mode, underlay, narrow windows, and a timing probe at a realistic size (76 walls) plus a CPU profile. No console errors or crashes anywhere. The scripted milestone tests all still pass. What follows is what a tester would file, ranked, with the fix spelled out so a smaller model can implement each item without re-deriving it.

Execution: fixes are implemented by subagents, **Opus 5.5** for batch A (performance, touches the rendering architecture) and **Sonnet 5.5** for batches B and C (small, well-specified changes). The coordinating session reviews each batch, re-runs the milestone e2e scripts (`scratchpad/m1-e2e.mjs` … `m7-e2e.mjs`) and the QA probes (`scratchpad/qa/perf.mjs`, `qa1.mjs`, `qa2.mjs`, `qa3.mjs`), then commits and pushes. One commit per batch.

## Status

All three batches are merged on `claude/cool-mccarthy-rqi8ka`. Items 1 to 20 and 22 are fixed and verified
(400 unit tests, milestone e2e scripts m1 to m7, and the QA probes). Item 21 stays open: the
`THREE.Clock` warning comes from @react-three/fiber 9.8.1, the latest 9.x, so there is nothing to bump.
Item 15 needed no code change (the flush already existed); tests were added. Measured after batch A at
76 walls: hover 718 ms to 45 ms, 30 wall-tool mouse moves 3.1 s to 0.56 s, drag step 158 ms to 53 ms.

## Findings, ranked

### P1: fix before the measuring session

**1. Hover and selection re-render every wall (performance).** Measured at 76 walls: setting `hover.wallId` takes 688 ms to the next frame, clearing it 87 ms, a cursor move 18 to 33 ms, a node drag 140 ms per step, 30 mouse moves in the wall tool 2.5 s with a 667 ms frame gap. Cause: `WallsLayer` in `src/editor2d/PlanLayers.tsx` (lines ~109 to 150) merges all walls into one path per style, and the style key and the `useMemo` deps include `selected` and `hovered`, so every hover rebuilds every merged path and `outlinePath()` in `src/editor2d/outline.ts`.
Fix: remove `selected` and `hovered` from `WallsLayer` entirely (deps become `[level, viewMode]`). Add a `WallHighlightLayer` rendered above the walls that subscribes only to `hover.wallId`, `selection.walls` and the footprints, and draws the `poly` of just those walls with the existing `is-hovered` / `is-selected` CSS. Then profile `outlinePath` with 300 segments; if it is above 5 ms, fix the polyline joining to use a map from endpoint to segment rather than scanning. Also check `StatusBar.tsx` and `Overlay.tsx`: the cursor readout must live in its own small component so a cursor move re-renders only that and the overlay.
Acceptance (add to `scratchpad/qa/perf.mjs` and a vitest benchmark for `outlinePath`): at 100 walls a hover change renders in under 16 ms, 30 mouse moves finish in under 500 ms, a node drag step is under 30 ms, `outlinePath(300 segments)` under 5 ms.

**2. Ortho, grid and "Lengths to" toggles pollute undo.** Pressing O then Ctrl+Z undoes the toggle, not the last wall; `orthoLock` and `measureTo` live in `plan.settings` and every change is a history step. This bit my own test session within minutes.
Fix: move `orthoLock` and `measureTo` out of `plan.settings` into `uiStore` (persist both in `localStorage`, wrapped in try/catch). `migrate()` in `src/model/plan.ts` keeps accepting files that contain them and drops them. Update `Toolbar.tsx`, `keymap.ts`, `wallTool.ts`, `openingTool.ts`, `snap.ts` call sites, and the tests that read `plan.settings.orthoLock`. Default thicknesses stay in the plan (they are plan data).
Acceptance: draw a wall, press O, Ctrl+Z removes the wall and ortho stays off. Reload keeps the ortho and Lengths-to choice.

**3. The length parser accepts garbage.** `-5` draws a 5" wall, `1e3` gives 13", `12,5` gives 125", while `12 6` (what a person types for 12'-6") is rejected.
Fix in `src/model/units.ts`: reject any letter that is not part of `ft`, `in`, `f`, `i` tokens (so `1e3` errors); reject commas; accept `N M` and `N M F/D` with no unit marks as feet then inches when both are whole numbers and M < 12 (`12 6` = 150, `12 6 1/2` = 150.5). Keep the sign for fields that need it (base floor elevation) but have the wall tool, opening tool, and every size field reject values ≤ 0 with the existing "Must be greater than 0" message. Add the cases to `units.test.ts`.

**4. Opening and stairs sizes are not sanity-checked.** A door height of 20' is accepted on an 8' wall (the 3D header piece then has negative height). Stairs accept a 500" width and a 50' run.
Fix in `planStore.ts` (`addOpening`, `updateOpening`, `addStairs`, `updateStairs`) and in `PropertiesPanel.tsx` messages: reject `sill + height > wallHeight` (level `wallHeight` or the wall's `heightOverride`) with "Taller than the wall (8'-0")"; clamp when the wall height is lowered later (in `updateLevel` / `updateWall`). Stairs: width 24" to 96", run 3' to 30'; message names the range. Tests in `openings.test.ts` and `stairs.test.ts`.

**5. Validation errors go stale in the properties panel.** After a rejected value the field reverts to the old value but stays red with the message, even after other fields are edited successfully (screenshot `qa3b-04-stale-error.png`).
Fix in `PropertiesPanel.tsx` length/degree field components: keep the error only while the field is focused and holds the invalid text; clear it on blur, on Escape, on a successful commit, and when the bound value changes. Test by e2e: type a bad width, Enter, then edit height; no error text remains.

### P2: fix soon, each is a small annoyance a user hits daily

**6. Undo while drawing leaves a rubber band anchored to nothing.** Ctrl+Z mid-chain removes the wall but `draft.wallStart` stays at the undone wall's end (screenshot `qa3-01-undo-midchain.png`).
Fix in `wallTool.ts`: subscribe to undo/redo (or check in `onPointerMove` that the start node still exists); when the chain's current start node is gone, end the chain with the message "Undid the last wall. Click to start again."

**7. Undo of a change on another level is invisible.** Draw on Second Floor, switch to First Floor, Ctrl+Z: the Second Floor wall disappears with no feedback.
Fix in the plan-store subscription in `main.tsx` (or a small helper in `planStore.ts`): after undo/redo, find the level whose object identity changed; if it is not the active level, switch to it and set a notice "Undid a change on Second Floor". Test in `plan.test.ts` with the store alone plus one e2e check.

**8. No snapping to the ghost level below.** With "Show level below" on, the wall tool snaps to the grid, not to the lower level's corners and walls, so stacking an upper floor over a lower one is guesswork.
Fix in `snap.ts` and `tools/index.ts`: when the ghost is shown, include the lower level's visible nodes and wall centerlines as snap candidates with kinds `ghost-node` and `ghost-wall` at the same radii, drawn with a distinct marker in `Overlay.tsx`. Snapping to a ghost creates a new node at that point (never a reference to the other level). Tests in `snap.test.ts`.

**9. Labels clutter and collide at low zoom.** Every wall piece shows a dimension on both split halves, and room area text overlaps wall labels in small rooms (screenshot `qa2-13-grid.png`).
Fix in `PlanLayers.tsx`: hide a dimension label when its rendered text width (estimate 6.5 px per character) exceeds the wall's screen length; hide the room area text when the room's screen bounding box is under 60 px on either side, and the room name when under 40 px. Keep labels on the exterior side only for exterior walls when a face exists on exactly one side.

**10. Typed face-to-face lengths show as centerline labels.** With "Lengths to: inside face" the user types 30'11" and sees 31'-5 1/2" on the wall, which looks like an error.
Fix: the live rubber band label and the status bar show both, e.g. `30'-11" inside (31'-5 1/2" centerline)`, while a non-center setting is active. The wall section of `PropertiesPanel.tsx` gains read-only "Left face" and "Right face" lengths from the footprint's trimmed `edge` points, labelled with the room name on that side when known ("Face to Kitchen: 11'-7 1/2"").

**11. Door swing wording is jargon.** "Swings to: Left of wall", "Hinge: Start side" mean nothing to a homeowner.
Fix in `PropertiesPanel.tsx` using `getFaces` to find the room on each side of the opening's wall: "Swings into: Kitchen / Hallway" and "Hinge: near the Living Room corner / near the Bedroom corner"; fall back to "left / right of the wall as drawn" when no room is named. Tab in the tool keeps working.

**12. Narrow windows.** At 1024 px the toolbar wraps to three rows; at 800 px the properties panel squeezes the plan to ~350 px (screenshots `qa2-11-narrow-1024.png`, `qa2-12-narrow-800.png`).
Fix in `index.css`, `Toolbar.tsx`, `App.tsx`: below 1100 px drop the hotkey suffixes and shorten labels ("Underlay" to "Image"), below 900 px make the properties panel and level bar collapsible with a toggle button (and the `[` `]` keys, added to `keymap.ts`). The split layout's 3D pane is hidden below 900 px with a hint.

**13. Status bar hints are truncated.** The wall and door hints are cut with an ellipsis at 1280 px ("Esc to fin...").
Fix: shorten each tool hint to about 60 characters, move the long form into the `?` help, and show the full text as the hint's `title`.

**14. Grid vanishes at high zoom.** At k = 40 (max) the canvas is blank white (screenshot `qa1-09-zoom-in.png`).
Fix in `PlanCanvas.tsx`: when the 12" spacing exceeds 200 px on screen, also draw 1" minor lines (lighter) and keep the 12" lines; cap the line count by the visible range as today.

**15. Autosave can lose the last edit.** The 300 ms debounce means closing the tab right after a change loses it.
Fix in `src/io/file.ts`: flush the pending save on `visibilitychange` (hidden) and `pagehide`. Test with a unit test on the debounce helper.

**16. Toolbar buttons keep focus mid-draw.** Clicking Fit while drawing leaves focus on the button, so the next Enter triggers Fit again instead of only committing the length.
Fix: every toolbar button calls the existing `focusCanvas()` helper from `src/ui/focus.ts` after its action (same as the selects already do).

### P3: polish, do if time allows

**17.** Duplicate room names are accepted silently; show a status notice "There is already a Kitchen on this level" (still allow it).
**18.** Enter with nothing typed commits the wall at the cursor; keep the behaviour but say so in the hint ("Enter or click commits at the cursor").
**19.** In the 3D-only layout the status bar still shows 2D tool hints; show orbit hints instead ("Drag to orbit, right-drag to pan, wheel to zoom, F to walk").
**20.** The opening placement message says "inside corner at the start of the wall" when the reference is a partition at a T; name it ("from the partition").
**21.** The react-three-fiber `THREE.Clock` deprecation warning prints on every 3D mount; harmless, pin or silence when fiber ships the fix.
**22.** `New` confirms, `Open` does not; fine, but add the file name to the Open success notice (already done) and clear the previous "Saved a copy" notice when an Open fails (the stale notice stayed after a rejected file).

## What is working well (no action)

Typed-length drawing and loop closing, T and crossing splits, miters, room detection and net dimensions, phase views in 2D and 3D, undo grouping for drags, file open rejection messages, New confirmation, export menu text, keyboard help blocking hotkeys, walk mode ignoring 2D keys, underlay load/delete/undo, level field validation (0, negative, text all rejected with messages), Backspace on an empty buffer does not navigate, hotkeys ignored while typing in fields.

## Batches and verification

**Batch A (Opus 5.5): item 1.** Verify with `scratchpad/qa/perf.mjs` numbers before and after (report both), the new `outlinePath` benchmark, `npm test`, `npm run build`, and m1 to m7 e2e unchanged.

**Batch B (Sonnet 5.5): items 2, 3, 4, 5, 6, 7, 15, 16.** Verify with the new unit tests named above, `scratchpad/qa/qa1.mjs` section B (typed inputs now: `-5` rejected, `1e3` rejected, `12,5` rejected, `12 6` = 150), section D (height 20' rejected), `qa3.mjs` R3 (chain ends after undo), K2 in `qa2.mjs` (level switches on undo), m1 to m7 e2e (update m2/m7 expectations for the settings move with a note).

**Batch C (Sonnet 5.5): items 8 to 14, 17 to 22.** Verify with screenshots at 1280x800, 1024x700 and 800x600 of the m7 house in All view and inspect them: no label collisions at fit zoom, grid visible at max zoom, toolbar at most two rows at 1024, panel collapsible at 800; ghost snapping shown by drawing a Second Floor wall onto a First Floor corner and asserting the node coordinates match exactly.

After all three batches: run every e2e script once more, commit, push, and give MK a short changelog.
