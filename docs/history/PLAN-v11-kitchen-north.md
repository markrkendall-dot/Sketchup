# 146 Mick Road: the proposed first floor, v11 (powder room under the stair, range on the north wall)

## Context

MK's brief (15 Oct 2026), on top of the proposed design (PLAN-v6 north band, the straight stair of
72453be, the kitchen of PLAN-v5/v6):

- powder room under the stair, to use that space;
- range on the north wall, its vent horizontal through the pantry and out the north wall;
- fridge on the east wall; sink and dishwasher stay in the island;
- island moves north into the work triangle, a table near the lake window;
- pantry stays on the north wall.

MK's choices (asked): everything under the stair with a short door from the hall; the pantry
fills the whole north band; a 36 x 60 table, no island stools.

No app change is needed. Walls under a framed stair are already supported: `derive/staircase.ts`
closes the gap from a low wall's top to the soffit with a panel, and `stairChecks.ts` reports
any wall that rises into the soffit. So the work is all in `scripts/example-plan.ts` `proposed()`,
its test, the README, the regenerated JSON and viewer, and a plan record.

## Geometry (inches; x east, y south; inside faces)

The run's soffit (framed, 2" treads, a 9.25" frame) is about `8.3 + 0.694 (x - 43)`: 47.5 at
x 99.5, 77 at x 142, 80 at x 146, 94.7 at x 167.5. The script computes the wall heights from the
derived staircase layout (`getStaircaseLayout(...).undersides`), not from this formula, and
floors them to 1/4".

## The design

**Powder room under the stair's high end**, inside x 104.5..168, y 7..44 (5'3 1/2" x 3'1"):
- new 5" walls, all within the stair's outline (y 7..49, x up to 167.5), each with a
  `heightOverride` at or under the soffit above it:
  - west wall x 102 from the north wall to y 46.5 (about 47");
  - south wall y 46.5 in two pieces: x 102..142 (about 47") and x 142..170.5 (about 76.75");
- its east wall is the hall's existing new partition (x 170.5), full height;
- door: 24" x 76" in the south wall's east piece (x 143.5..167.5, opening onto the hall at the top
  of the run). It swings out, hinged on the east jamb, and is stained like the other doors. A
  6'8" door doesn't fit under the soffit;
- placeholders: WC 20 x 28 on the west wall facing east (x 104.5..132.5, centre y 25.5, 18 1/2"
  to each side wall) under the slope, so you sit in the low part; a small wall-hung lav 18" wide x
  12" deep on the east wall facing west (x 156..168). That leaves 23 1/2" between the two fronts,
  over the 21" the code asks (R307.1/P2705.1);
- no window. An exhaust fan goes out through the north wall (noted in the README, not drawn);
- the label "Powder room (proposed)" with tile (PLACEHOLDER_WET);
- under the run west of x 99.5 stays open.

**Pantry fills the north band**, x 173..311, y 7..55 (11'6" x 4'):
- remove the powder/pantry divider (x 261.5), the old powder room door (x 214), its north
  window (x 214) and its WC/vanity;
- the band wall (y 57.5) stays. The pantry door is 24" at x 198..222 swinging in (it must stay
  east of the band wall's split at the old bath wall line, x 194.5);
- shelves 12" deep, 84" high on the north wall (the full 138") and on the east and west end walls
  (y 19..55), clear of the door swing.

**Kitchen**, x 173..311, y 60..308. All fixtures are new, using the level's default colours:
- north run, backs on y 60, facing south: base 15 (x 222..237), range 30 (x 237..267, centre 252)
  with its hood (66..96), base 15 (x 267..282), and a wall cabinet over each base;
- fridge on the east wall in the north-east corner: 36" wide, 29" counter-depth (x 282..311),
  y 62..98 (2" off the band wall for the hinge), with a wall cabinet over it. South of it the
  east wall stays open (the walkway to the bedroom door, y 248..280);
- island: dishwasher 24 (x 212..236) and sink 36 (x 236..272), fronts facing north (the cook
  faces the lake), cabinets y 134..158. One top 62 x 26 with 1" all round (x 211..273, y 133..159),
  no ledge, no stools. That gives a 48" work aisle to the north counter, 38" walkways at each end,
  and about 36" from the island's north-east corner to the fridge;
- table 60 x 36 x 30 (box "Table") at x 212..272, y 222..258, centred on the lake window, with
  four 18" "Chair" boxes on its long sides (y 204..222 and 258..276). That leaves 45" from the
  island to the chairs, 39" past its east end to the bedroom door, and 32" behind the south
  chairs. It seats 6 with end chairs pulled up;
- range vent: an 8" duct (box "Hood duct") from the hood's back north through the band wall and
  across the pantry ceiling (86..94", over the 84" shelves) to a wall cap on the north face at
  x 252, about 5'. It is 48" under the upstairs bath window's sill (the code asks for 3' from
  openings, M1504.3, to verify). Remove the old east duct across the master bedroom and its cap on
  the wing's east wall;
- work triangle, centre to centre: range to fridge about 3'9", fridge to sink about 6'7", sink to
  range about 6'2", about 16'8" in all. The range-to-fridge leg is a little under the usual 4'
  (the pantry door pins the run's west end); say so in the README.

**Unchanged**: the stair, hall, beams and posts, the cased opening at y 118.5, the Living passage,
the pass-through, the bedroom door, the alarms, and upstairs.

## Files

- `scripts/example-plan.ts`:
  - `proposed()`: section 4 (band: no divider, pantry door, shelves), the openings (drop the
    powder room door and window), section 3 (the powder room walls, door and label after the
    staircase exists, so the soffit heights can be read), section 2 (the kitchen: north run,
    fridge, island, table, chairs), the vents (the new duct and cap) and the labels;
  - rewrite the comments that describe these, including the doc comment of `proposed()`;
  - reuse the existing helpers `partition`, `addOpeningAt`, `fixture`/`kitchen`, `label`,
    `wallAt`, `store().updateWalls(..., { heightOverride })`.
- `src/__tests__/example.test.ts`. Update:
  - room sizes: Powder room [63.5, 37], Pantry [138, 48], and Living (now with the notch);
  - the door list (the powder room's 24 x 76 into the hall, the pantry's at x 210);
  - the kitchen test: fixture kinds and counts, the north run, the fridge, the island top
    62 x 26, the walkways, the table and chairs, the duct in the pantry;
  - the band window test and the new and demolished counts.

  Add: the powder room walls are under the soffit (no `stair.wall-through` issue) and the
  panels exist.
- `README.md`, "The proposed design in the starter":
  - item 3: the space under the run is now the powder room;
  - item 4: the band is all pantry;
  - item 5: the new kitchen and the triangle;
  - "Still open": for the inspector, the powder room's sloped ceiling against R305.1 (6'8"/7' for
    bathrooms, with the exception that fixtures must be usable) and the short door; for the
    trades, the fan, the duct cap, and makeup air if the hood exceeds 400 cfm (M1503.6);
  - "The upstairs bath's pipes come down through the powder room": now through the pantry.
- `docs/history/PLAN-v11-kitchen-north.md`: a copy of this plan, plus an "As built" section.
- Regenerate `docs/examples/146-mick-road.json` and `docs/viewer/146-mick-road-viewer.html`.

## Verification

1. `git checkout main && git pull origin main` first (the session is on a detached HEAD at main).
2. `npm run build:example`, `npm test`, `npm run build`. All must pass, with no new code-check
   issues in the proposed view (wall-through, open wall ends, orphan labels, overlapping
   fixtures).
3. `npm run build:viewer` and `cp dist-viewer/146-mick-road-viewer.html docs/viewer/`.
4. Visual check with Playwright (the `run` skill): the First Floor plan in Proposed, plus 3D shots
   of the powder room's walls closing up to the soffit, the north run with the hood, and the
   island and table. Send MK the plan image.
5. Commit on main (CLAUDE.md: work lands on main) and push.

## As built

Where scripts/example-plan.ts differs from the design above, and why:

- **Powder room vanity**: an 18" x 12" sink cabinet standing on the floor (the casework model has
  no wall-hung sink), its top 1" proud, so 22 1/2" from the WC's front to the top, not 23 1/2".
- **Wall heights**: 47 1/2" (the west wall and the south wall's west piece) and 77" (the door's
  piece), read from the derived soffit; the door's piece meets the hall's east wall at x 170.5 and
  splits it there.
- **Door**: hinged on its east jamb, swinging out into the hall (part of the Living's face in the
  proposed view).
- **Kitchen label**: today's Kitchen label moved from y 205 to y 182, between the island and the
  table, so it no longer sits on the north chairs (the existing view shows it there too).
- **North window**: the powder room's small north window is gone with it; the old bath's north
  window is still demolished, so nothing new is cut in that stretch of the north wall.
- **Checks**: the proposed view has no new issues; the header notes are six, not seven (that
  window was one).
- Wall counts: 30 new (19 on the First Floor), not 28; fixtures 48 new, not 46.
