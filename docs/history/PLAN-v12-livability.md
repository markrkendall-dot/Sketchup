# 146 Mick Road: the proposed design, v12 (a livability review and its fixes)

## Context

MK asked for a home design and flow expert's review of the target build (the Proposed view), with
changes wherever it would be bad to live in. I walked both floors for daily use: storage, privacy,
circulation, fixture clearances, life safety and the connection to the outdoors.

Most of the house works well:
- the foyer as a mudroom between two doors;
- the straight 42" stair with easy 7.2" risers;
- a main-floor primary suite for later years;
- the walk-in pantry and the powder room off the hall;
- the deck off the bedroom.

The changes below fix what would actually bother the people living there. Each one keeps MK's
earlier decisions: the kitchen layout of 15 Oct, the bedroom door's place, and the laundry in the
master bath.

## Findings and fixes (most serious first)

### 1. Guest room has no emergency escape window (life safety)

The Guest's east window became a 60"-sill transom under the new shed roof, so its only low window
is the south one: 66" wide in three casement sashes of about 20 1/2". Each sash opens about 18"
clear. Code (R310, to verify against the 2025 RCNYS) asks a bedroom window for 20" clear width,
24" clear height, 5.7 sq ft above grade, and a sill at most 44".

Fix: the same 66" x 46" opening, sill 34, re-sashed as **two casements**, each about 31" (opening
about 27" x 42", 7.9 sq ft), with 2 x 3 lites. The existing window is demolished and the new one
placed on the same centre (x 256, Second Floor south wall).

### 2. No clothes closet in any bedroom but a 2'6" one

- **Main-floor master bedroom** (none today). Fix: a small walk-in in its north-west corner, inside
  x 318..368, y 122.5..180.5 (4'2" x 4'10"):
  - front wall at y 183, from the main block's east wall (meeting it south of the demolished east
    window's jamb at y 180) to a side wall at x 370.5, which runs from the bath partition (y 120)
    and stays 2" clear of the bath door's jamb at 375;
  - a 24" door at x 343..367 swinging out into the bedroom;
  - a "Hanging" box 24" deep along its west wall;
  - a bed still fits head-on the east wall, with 40" from its foot to a dresser on the west wall.
- **Upstairs Master** (a 2'6" x 2'9" closet today). Fix: a reach-in wardrobe along its north wall,
  inside x 42..130.5, y 102..126 (7'4" of rod):
  - front wall at y 128.5, from the old closet's east wall (x 39.5) to an end wall at x 133. The end
    wall stays west of the demolished Bunk door's span (x 136..164) and clear of the Master door's
    swing;
  - an 80" opening for bifolds;
  - the old closet stays.
- **Guest** (none). Fix: a 24" x 60" reach-in at the west end of its alcove (the old Office), inside
  x 223..247, y 75..135:
  - front wall at x 249.5, from the upstairs bath's south wall (y 72.5) to y 137.5;
  - the landing's south wall (y 137.5) carried east to meet it;
  - a 56" bifold opening facing east;
  - the alcove keeps a 59" x 65" desk nook under its transom.

Labels: "Bedroom closet (proposed)", "Master wardrobe (proposed)", "Guest closet (proposed)",
carpet like their bedrooms (pine for the main-floor one).

### 3. The upstairs bath's fixtures don't work

Today's layout in the 7'4" x 5'3" room:
- the 48" vanity stands 6" in front of the 36" shower;
- the shower's other side opens onto a 17" gap beside the WC;
- you cannot step into the shower.

Fix, the standard layout for this size:
- a **32" x 60" shower** along the east wall (x 279..311, y 7..67), its valve on the inside wall;
- the **WC** under the north window (x 230..250, 17" to the west wall, 21" clear in front);
- a **24" vanity** on the south wall east of the door's swing (x 255..279), with a mirror over it.

All clearances meet R307.1 (15" to the side, 21" in front). The door stays.

### 4. The screen porch is cut off from the house's living spaces

Today the porch is reached only through the foyer, and the Living and kitchen have no door to the
lake side.

Fix:
- the Living's west window (which now only looks into the porch) becomes **60" French doors** on
  the same centre (y 177..237), glazed, swinging into the Living;
- it is 23" clear of the hearth and 43" from the stovepipe's thimble;
- the porch becomes a summer room off the Living and the way to the lawn and lake.

Also swap the porch's south screen door and screen window: the door to x -86..-50, the window to
x -46..-2. Today you step through that door straight into the stove's insulated chimney, 24" inside
on your right.

### 5. The main-floor bedroom's door is half glass, from the kitchen

Today's grey door has 3 x 3 clear lites over two panels, so anyone at the table sees into the
bedroom.

Fix: keep MK's chosen place (y 248..280) but demolish that door and hang a **solid 32" stained
door** on the same centre, swinging into the bedroom.

### 6. The kitchen has about 8' of counter

That is 15 + 15 + 62, against about 13' or more that a kitchen this size wants (NKBA, a
guideline). It also has no trash or recycling spot. The 11'6" width won't take more island.

Fix: a **24" base (trash and recycling pull-out) with a wall cabinet over it** in the free 24" west
of the pantry door (x 173..197, y 60..84), clear of the hall's cased opening. Counter goes to
about 9'8". The README says plainly that the walk-in pantry carries the storage.

### Noted in the README, not modeled (no good change inside MK's choices)

- **Kitchen daylight:** the work end is about 16' from the only window (the lake one), so plan
  strong task lighting: under-cabinet lights and pendants over the island.
- **Laundry in the master bath:** right for the owner's daily life (laundry where the clothes
  live), but upstairs guests must cross the kitchen and the bedroom to use it.
- **Basement access:** no inside stair to the basement is drawn. A question for MK: how is it
  reached today, and where are the water heater and the panel?

## Implementation (scripts/example-plan.ts, `proposed()`)

Reuse the existing helpers and steps:
- `partition`, `addOpeningAt` / `add`, `fixture` / `kitchen` / `upstairs`, `label`, `wallAt`;
- `demolish(...)` for the two openings (the Guest's south window and the grey door; find their ids
  via `wallAt` and the opening's position);
- passages for the bifold openings, as the laundry's 56" one;
- the Living's replacement window `add({ x: CL.x0, y: 207 }, ...)` becomes the French door
  (`type: 'door'`, `sashes: 2`, glazed lites, `into: EAST`);
- swap the two `add(...)` calls of the porch's south wall;
- the upstairs bath's three fixtures are replaced in section 9;
- the closet walls go with the other partitions, before the openings, so `addOpeningAt` checks
  every door against them.

Comments follow the new layout.

## Tests and docs

- `src/__tests__/example.test.ts` (update where the build changes):
  - wall, opening, fixture and room counts;
  - room sizes, adding the three closets;
  - the door list (the French door into the Living, the porch door's place, the solid bedroom door
    replacing the grey one, the closet doors);
  - the header notes if the French door's changes;
  - the kitchen run (the new base, 4 counters) and the mesh counts;
  - the upstairs bath fixtures;
  - add an egress check: the Guest's south window sashes ≥ 20" wide each.
- `src/__tests__/plan.test.ts`: the First Floor's wall count in the north-wall repro.
- `README.md`, "The proposed design in the starter":
  - items 1 (bedroom closet, solid door), 3 (wardrobe, Guest closet, egress window), 5 (24" base,
    the counter number), 7 (bath layout) and 8 (French doors, porch door);
  - a short "Livability review" list of the reasons and the three notes;
  - "Still open": the basement question for MK, and R310 for the inspector.
- `docs/DESIGN.md`: one line on the closets and the egress check, if the test is added.
- `docs/history/PLAN-v12-livability.md`: a copy of this plan plus "As built".

## Verification

1. `npm run build:example`, `npm test`, `npm run build` all pass. No new non-info code checks.
2. `npm run build:viewer`, then copy to `docs/viewer/`.
3. Playwright (dev server, `window.__homeplan`):
   - export the First and Second Floor plans in Proposed;
   - 3D shots of the upstairs bath, the Living's French doors from inside and the porch, and the
     bedroom closet;
   - send MK both plan images.
4. Commit on main and push (CLAUDE.md).

## As built

Where scripts/example-plan.ts differs from the plan above, and why:

- **Guest window**: the two sashes are 32" each, (66 - a 2" mullion) / 2, not about 31".
- **Double doors on the plan**: the 2D symbol drew every swinging door with one leaf, so the 60"
  French doors read as one 5' leaf (and today's basement double door as one 6' leaf).
  `openingSymbol` (src/derive/openings.ts) now returns `leaves` and `arcs`: a double door
  (`sashes` 2) gets a half-width leaf and arc on each jamb. PlanLayers, the opening ghost and the
  swing hit test draw and test each. The 3D already drew two leaves.
- **Labels**:
  - the master bedroom's label moved to (414, 160), east of the new closet and still north of the
    old Utility's face in the All view;
  - the Guest closet's label sits at y 84, clear of the landing's.
- **Header notes**: eight, not six. The bedroom's solid door and the Guest's window go in today's
  openings, whose headers are there; the tool notes them as new openings in bearing walls all the
  same (info only).
- **Counts**:
  - walls 55 existing, 13 demolished, 38 new;
  - openings 11, 21, 31;
  - 51 new fixtures and 14 new rooms.
