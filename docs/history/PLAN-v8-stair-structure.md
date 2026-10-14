# 146 Mick Road and HomePlan: grand staircase, stair checks, renovation moves, structure (v8)

## Context

MK wants the tool to (1) build out the two-storey grand stair in the entry stair hall in real
detail, and (2) handle moving and removing walls with proper structural support. His answers:

- **Stairs:** all four. One staircase object with wood treads, nosings, painted risers, box newels,
  a handrail running across the landing, a bullnose first step and a matching balcony guard. NY stair
  code checks. A framed underside, with a **coat closet** under the landing in the starter. Walk mode
  that climbs stairs.
- **Structure:** "draw and check". Beams, posts and footings; walls marked load-bearing, with the
  tool suggesting likely ones; warnings when a bearing wall goes with no beam, or a beam or post has
  nothing under it down to a footing. No sizing this round.
- **Moving walls:** ask each time: "rebuild it there" (old wall demolished, moved wall new) or
  "correct the drawing" (today's behaviour).
- **Joists:** north-south generally; the house was built in stages, so per-area overrides are needed.
- **Order:** stairs first.

Today nothing structural exists (no bearing flag, beams, posts on levels, footings or joists), a
stair is separate straight flights with grey solid geometry and a 3.5 x 1.5 board rail, and there
are no code checks. The starter shows why this matters: the proposed design removes the whole First
Floor y 99.5 wall (the only full-width east-west partition, likely bearing for north-south joists),
the balcony edge at y 91 spans 162" with nothing under it, and a kept Second Floor closet wall
(y 99.5, x 3.5..39.5) is left standing on nothing.

Each milestone ends green: `npm test`, `npm run build`, `npm run build:example`,
`npm run build:viewer` plus the copy to `docs/viewer/`, README and DESIGN.md updated, then
fast-forward to `main` (CLAUDE.md).

## Key decisions (where the first design did not fit the code)

- **Chain links:** flight B follows A when B's bottom edge (`stairsOutline` points 0 and 3) lies
  within 1" of any edge of A's outline and B's base is A's top within 0.5". The starter's flights
  leave the platform and landing through their sides, not their top edges.
- **Rails at turns:** heights jump one riser at each turn (flight top is the last tread), so the rail
  dies into a shared turn newel (allowed by the code). No goosenecks.
- **Landing rails:** extend `Stairs.railings` with `end?` (the far edge of a one-riser piece). No new
  array, no schema bump for this.
- **Bullnose:** belongs to the lowest piece, centred on the starting newel. `minRun` stays 36.
- **Selecting:** click selects the staircase; double-click a member edits that flight alone; Esc
  closes it (SketchUp's group convention; Alt-click clashes with Linux window managers).
- **Joists live with the level they are over:** `Level.framing` describes the floor or attic ceiling
  above that level, so beams, their bearing walls and the joists all belong to one level (as framing
  plans are drawn). Joist depth is derived: the level above's `floorThickness - 0.75`, or 5.5" for an
  attic.
- **Footing is a post property** (`Post.footing`, lowest level only), not a separate member.
- **Checks are view-independent:** they judge Proposed against Existing; markers show in Proposed
  and All. Untouched existing structure is assumed adequate.
- **Code table:** the 2025 RCNYS is built on the 2024 IRC, which renumbered chapter 3 (stairs R318.7,
  guards R321). Every value carries both numberings and is flagged "verify against the 2025 RCNYS
  text". NY's 8 1/4" riser and 9" tread come from its earlier IRC amendment and are unconfirmed for 2025.
- **Starter calls (estimates, for MK and the engineer):** the new y 137.5 wall is set not bearing;
  the balcony header sits at y 92.75 (faces 91..94.5), since a centred one would sit over the top tread.

## Data model

Schema 6 (M3a), in `src/model/types.ts`:

```ts
interface Staircase {             // Level.staircases: Record<Id, Staircase>
  id: Id; name?: string;
  treadColor?: string; riserColor?: string;        // oak #b5835a / #f1efe8
  nosing?: Inches; treadThickness?: Inches;        // 1 / 1
  stringer?: 'closed' | 'open';
  underside?: 'solid' | 'framed' | 'open';         // default solid (today)
  newel?: 'box' | 'square'; handrail?: 'round' | 'board'; handrailHeight?: Inches;
  balusterGap?: Inches; startStep?: 'square' | 'bullnose';
}
// Stairs gains staircaseId?: Id and railings.end?: boolean.
```

Phase is derived from the members; `setPhase` with `staircases` cascades. Empty staircases and
dangling ids are dropped by the store and `migrate`.

Schema 7 (M5):

```ts
interface LevelFraming { joists: Degrees; depth?: Inches }      // Level.framing?
interface JoistZone { id; outline: Vec2[]; joists: Degrees; phase }  // Level.joistZones
interface Beam { id; kind: 'beam'; a; b; width; depth; mount: 'flush' | 'dropped'; phase; label? }
interface Post { id; kind: 'post'; at; width; depth; rotation; phase; label?;
  footing?: { width; thickness } }                              // Level.members
// Wall gains bearing?: boolean (undefined = inferred).
```

Elevations are derived (`memberBoxes`): flush beam top = wallHeight + joist depth, dropped = wallHeight;
a post runs from the floor to the beam over it, else wallHeight; a footing sits under the slab.

New code limits in `src/model/codeLimits.ts`: riser 8.25, tread 9, uniformity 3/8, headroom 80,
width 36, handrail 34 to 38 at 4+ risers, Type I grip, guards 36 over 30" drops, 4" sphere (4 3/8" on
stair sides), landing depth, 151" per flight, nosing, R502.4 joist offset, R502.6 bearing 1.5 / 3,
R502.10 headers, R602.7 wall headers.

## Milestones

### M1. Checks framework (no schema change)

- New `src/derive/checks.ts`: `Issue {id, code, severity, category, levelId, at, outline?,
  message, ref, target}`; `getIssues(plan)` memoized per plan; `issuesFor(issues, levelId, target)`.
- New `src/derive/guardChecks.ts`: moves in today's ad hoc deck "over 30 inches, no railing" and
  floor opening "no guard" warnings (`PropertiesPanel.tsx` ~1614, ~1681) using
  `getDeckLayout`, `getFloorOpeningLayout().supported`.
- `src/ui/checks.ts` runs checks 150 ms after edits into `uiStore.issues`.
- UI: a "N to check" pill in `StatusBar.tsx`; `src/ui/ChecksPanel.tsx` (by level and category;
  **Show** switches level, selects the target, centres on it); `ChecksLayer` markers in
  `PlanLayers.tsx` modelled on `OpenEndsLayer`; an `IssueNotes` block in each element's panel.
- Tests: new `checks.test.ts`; `exportPlan.test.ts` (no markers in exports); starter has no guard issues.

### M2. Stair code checks on today's flights (no schema change)

- New `src/derive/stairChain.ts`: `flightLinks`, `stairChains` (rule above; arrival at the floor
  reuses `deckStairOpenings`' tolerance in `src/derive/decks.ts`).
- New `src/derive/stairChecks.ts`: riser max, tread min, uniformity, headroom (sampled every 6"
  along the nosing line, holes excepted), width, handrail missing (4+ risers), grip (board profile),
  guard on an open side over 30", landing size, 151" per flight, arrival height. New work only.
- Tests: new `stairChecks.test.ts` at the limits (8.25 passes, 8.3 fails; 9 passes, 8.9 fails);
  starter links platform, flight 1, landing, flight 2; its issues are two grip warnings.

### M3a. Staircase model and editing (schema 6)

- `src/model/plan.ts`: `MIGRATIONS[5]`, `LEVEL_KEYS`, `createLevel`, `SCHEMA_VERSION`,
  `migrateStaircases`, `staircaseProblem` (new `src/model/stairStyle.ts` with `staircaseStyleOf`).
- `src/store/planStore.ts`: `addStaircase`, `updateStaircase`, `groupStairs`, `ungroupStaircase`,
  `deleteStaircases`, `moveStairs`; `setPhase`, `deleteEntities`, `EntitySelection` gain staircases.
- `uiStore` `Selection.staircases`, `openStaircaseId`; `selectTool.ts` click, double-click and a
  one-undo-step staircase drag; `pruneSelection`.
- `PropertiesPanel.tsx`: `StaircaseProps` (style, members, Ungroup, issues) and "Make one staircase"
  on a multi-flight selection.
- 2D: `staircaseSymbol` in `src/derive/stairs.ts`: one walkline arrow, rails, newels, bullnose arc.
- `scripts/example-plan.ts` `stableIds` gains staircases (`x`), later members (`m`), zones (`z`).
- Tests: `migrate.test.ts` (v5 to v6), `levels.test.ts` literal, `floorOpenings.test.ts` schema
  literal, selection tests.

### M3b. Staircase geometry, balcony guard, underside, starter conversion

- New `src/derive/staircase.ts`: `getStaircaseLayout` (memoized by signature like `getDeckLayout`):
  members in chain order, rails, shared newels, balusters, bullnose, landing posts, soffits,
  spandrels. Starter newels: start (40.25, 46.25), turn (129.75, 46.25), top (129.75, 93.75).
- Framed underside: tread boards, risers, stringers, skirts, a soffit; landings as framed platforms
  with a post at free corners (starter: one at (128.75, 47.25)); spandrel panels over walls under it.
- New checks: `stair.wall-through` (a wall rising into the underside), `stair.nosing`,
  `stair.chain-broken`.
- `src/derive/meshes.ts`: `buildStaircaseParts` (tread, paint, frame, rail; round rail via a swept
  octagon); unstyled flights unchanged. `railingParts` in `decks.ts` takes an optional style so the
  floor opening guard matches when a staircase arrives.
- `materials.ts` `stairPartMaterial`; `export3d.ts`: `Stairs`, `Stair framing`, `Stair railing`.
- Starter: group the four pieces as "Grand stair" (oak treads, white risers, 1" nosing, closed
  stringer, framed underside, box newels, round 36" rail, bullnose start). **Coat closet** under the
  landing and flight 2 (x 131.5..168, y 7..86.5): a low wall at x 129.25 up to the landing's underside,
  a front wall at y 88.75 with a 24" door, label "Coat closet (proposed)"; README "Coats" item closed.
- Tests: `stairs.test.ts` (newel positions and heights, gaps at most 3.75, one landing post),
  `meshes.test.ts` (closed parts, space under a framed landing is empty), `floorOpenings.test.ts`,
  `export3d.test.ts`, `example.test.ts` (stair issues empty, closet face, no open ends).

### M4. Renovation wall moves

- New `src/model/renovate.ts` `planRenovation(level, shifts)`: targets from `planWallOffset`
  (`src/model/offset.ts`). Existing moved walls become demo with their openings; new copies carry
  thickness, kind, finish, colour, height and `bearing`, with openings copied as new. Moved new walls
  just move. Attached walls: moving away adds a new bridging piece; moving into one splits it and
  demolishes the overshoot. Refuses tiny shifts, overlaps, splits inside an opening, and any change
  to the Existing view (checked against a signature on a trial copy).
- Store `renovateWalls(levelId, shifts)`: one undo step.
- `src/ui/wallMove.ts`: `requestWallMove` and `resolveWallMove`. It asks when Draw as is new, the
  view is not Existing, and an existing wall moves. New `src/editor2d/WallMovePrompt.tsx` (built like
  `PlanContextMenu`): **Rebuild it there** (R, default), **Correct the drawing** (C), Esc cancels;
  ghost of the target. Nudges remember the choice per selection.
- `selectTool.ts`: when asking, `pauseHistory()` before the first live step; at pointer-up restore
  the start plan, `resumeHistory()`, then apply the choice as one step. Corner drags never ask.
- Tests: new `renovate.test.ts` (corner moving away and into, T, collinear, refusals, Existing view
  unchanged, openings, one undo step) and `wallMovePrompt.test.ts`.

### M5. Structure model and drawing (schema 7)

- Migration v6 to v7, `memberProblem`, `joistZoneProblem`; store `addMember`, `updateMember`,
  `deleteMembers`, `moveMembers`, joist zone actions, `setLevelFraming`; `updateWalls` takes `bearing`.
- Tools: beam (I; two clicks, default 3.5 x 11.875 flush, label "(2) 1 3/4 x 11 7/8 LVL"), post (L;
  5.5 x 5.5, with a 24 x 12 footing on the lowest level), joist zone (outline tool from the Level panel).
- 2D: posts as X boxes with dashed footings, beams as dashed double lines. A **Structure overlay**
  (Y): joist hatching via `scanSegments` (`decks.ts`), "Joists N-S" arrows, beam labels, bearing marks;
  exportable as a framing plan.
- Panels: Level "Joists over this level" and "Draw a joist zone"; Wall "Bearing: Auto / Bearing / Not
  bearing"; member and zone props.
- 3D: `getMemberMeshes` cached like decks; flush beams drawn only below the slab; a "Structure" 3D
  toggle shows full members with see-through slabs. Export `Beam`, `Post`, `Footing`.
- Starter (estimates): joists north-south on all levels; east-west zones over the addition; balcony
  header (3.5, 92.75) to (170.5, 92.75); kitchen flush beam (170.5, 99.5) to (314.5, 99.5); a basement
  post at (170.5, 96.125) on a 24 x 12 footing; y 137.5 wall not bearing.
- Tests: new `structure.test.ts`, `meshes.test.ts` (no face coplanar with the slab), `export3d`,
  `keymap` (I, L, Y), `exportPlan`, `example`.

### M6. Bearing inference and load-path checks

- New `src/derive/structure.ts`: `joistsAt`, `wallBearings` (top-down, memoized). A wall is bearing
  if marked; or a bearing wall, post or beam end stands on it; or (exterior) a roof edge or joists
  bear on it; or (existing interior, 48"+) joists cross it mid-span over 168" without it. New walls
  never become bearing by span alone. The reason shows in the Wall panel and overlay.
- New `src/derive/structureChecks.ts`: removed bearing wall with load not picked up within the joist
  depth (merged runs); beam end bearing (1.5", 3" on block); load path traced down levels to a
  foundation wall or a post with a footing (info when the basement is unsurveyed); floor opening
  headers (R502.10); new or widened openings in bearing walls (R602.7); joists unset. Headroom
  checks also count beams. "HDR" tags in 2D.
- Starter expectation, pinned in `example.test.ts` after the first run: the y 99.5 removal is
  covered by the header and kitchen beam; the beam ends trace to the basement post and footing; one
  warning remains for the Bunk's south wall (attic ceiling joists); infos for headers and the basement.
- README "Still open": engineer to size the header, kitchen beam, post and footing; whether the
  Bunk wall carried the ceiling; survey the basement girder; verify joist directions on site.

### M7. Walk mode climbs stairs

- `src/view3d/walk.ts`: `walkSurfaces` (slabs less holes, treads, landings, bullnose, deck tops,
  terrain) and `walkBarriers` (guards, rails); `walkMove` with a 9" step up, falling, and blocking.
  The eye eases to feet + 66; the active level follows the feet. PageUp/PageDown still jump.
  Walls stay walk-through.
- `FirstPerson.tsx` uses it. Tests in `walk.test.ts`: walking the starter's stair from the door ends
  on the Second Floor; side of flight 1 blocks; under the framed landing stays on the floor; the
  balcony guard blocks.

## Order

M1, M2, M3a, M3b, M4, M5, M6, M7. M4 and M5 are independent of each other; M6 needs M5; M7 needs M3b.

## Risks

- Z-fighting: flush beams clipped below the slab; treads lifted off the carcass; spandrels inset 1/16".
- Performance: checks debounced and memoized; inference memoized per level chain.
- Migration v5 to v7: older builds refuse new files (expected); `stableIds` must list new records.
- Inference false positives: worded "likely"; explicit flags win; span rule only for existing walls.
- Code numbers unverified against the 2025 RCNYS text: one table, flagged, easy to correct.

## Verification

Per milestone: `npm test` and `npm run build` pass; `npm run build:example` leaves the JSON matching
the script (the example test checks this); `npm run build:viewer` and copy; Playwright screenshots of
the viewer (as done for the flue) for the stair hall in 3D (Proposed, Perspective and W), the
Structure overlay on the plan, and a walk up the stair; the Checks panel lists exactly the pinned
issues for the starter.

## Built differently from the plan

- **M2**: the floor opening a flight cuts started where the headroom from the treads' line to the
  floor top above was 80", which left a default flight about 5' of headroom at the opening's edge.
  It now starts where the headroom from the nosings to the underside of the floor above is 80", as
  the code measures it (the stair checks would otherwise flag every default stair).
- **M3a**: the staircase panel's style fields came with M3b, when the style is drawn.
- **M3b**: the coat closet's west wall is at x 138.5 (faces 136..141), not under the landing's edge:
  there it would meet the north wall inside the old 80" window (jambs 56..136), which keeps its place
  in the existing view only if that wall is not split there. The closet is 2'3" x 6'7" inside, and
  the landing's free corner keeps its post. Its label is "Coats". The round handrail is drawn as a
  2" square bar; the bullnose is a disc of 8" round the starting newel in front of the platform.
