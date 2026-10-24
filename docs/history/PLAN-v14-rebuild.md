# Plan v14: 146 Mick Road rebuilt on its foundation (a second plan and viewer)

24 Oct 2026. MK's brief: a new view of 146 Mick Road in which the house is knocked down and rebuilt
on the existing main-block foundation; the foundation bump under the Utility wing goes, and any new
extension gets its own foundation. The attached reference was a floor plan of a 52' x 26' main
house with a 26' x 14' bedroom-suite addition, an 8' x 10' screen room and an 8' x 10' covered
entry: a main-floor master suite (bedroom 14' x 12', closet 6' x 6', bath 14' x 6' with a shower),
great room 13' x 14', dining 10' x 14', kitchen 11' x 12' with an island, pantry and powder room 5'
x 5', laundry 6' x 5', entry 6' x 8', a stair with a landing and a 90-degree turn. Still two
bedrooms upstairs with a full bath (shower).

The record below is the plan as built; the README's "The rebuild (a second plan)" is the
description for use, and `scripts/rebuild-plan.ts` the readable record of every number.

## What was made

- The app holds one existing state and one proposed overlay per plan, and the viewer bakes one plan
  per HTML file, so the new view is a **second plan**, `docs/examples/146-mick-road-rebuild.json`,
  with its own viewer `docs/viewer/146-mick-road-rebuild-viewer.html` and an **Open rebuild**
  button in the editor. Its Existing view is today's house with everything above the block ring
  marked demolished; its Proposed view is the new house. The starter plan is unchanged.
- `scripts/example-plan.ts` was split without changing its output: the helpers and constants moved
  to `scripts/planLib.ts` (exported; `stableIds` takes the plan id, `partition` takes
  `replacesDemolished`), the house as it stands became `buildExistingHouse(name)`, and `proposed()`
  stayed. The basement girders moved from the renovation half into the existing house, where they
  belong (both designs build on them); the starter JSON came out byte for byte the same.
- `scripts/rebuild-plan.ts` builds the existing house, demolishes both floors entire (walls with
  their openings, stairs, roofs, fixtures, labels), the chimney, the porch's pad and stones, the
  bump's three block walls with the walkout door and today's outdoor stairs, marks the demolished
  walls not bearing, and draws the new house as `new` work. `scripts/build-example.ts` writes both
  JSON files; `npm run build:viewer` bakes both viewers.
- `src/__tests__/rebuild.test.ts` pins the JSON to the script, the rooms per view and their sizes,
  the stacked stairs and their headroom, the foundation's phases, no open wall ends, and no errors
  or warnings from the checks in the Proposed view.
- A fix in `derive/stairChecks.ts`: the headroom check took the floor above to cover the whole
  level, so any new outdoor flight on the lowest level beside the house was short of headroom; it
  now counts only the floor inside the level above's outside walls (a test in
  `stairChecks.test.ts`).

## The design (inches, x east, y south, outside faces; new exterior walls 6 1/2" on the old centerlines, partitions 4 1/2")

Main block inside faces x 6 3/4..311 1/4, y 6 3/4..308 1/4. Levels and floor heights as today.

**First Floor**

| Room | Where (inside faces) | Size | Notes |
| --- | --- | --- | --- |
| Entry | x 6.75..74.25, y 35..102.25; coat closet y 6.75..30.5 (partition y 32.75, 60" bifolds) | 5'7 1/2" x 5'7" + closet | 36" front door in the west wall centred y 66.5 |
| Entry hall | the strip y 43.5..102.25 along the stair, east to the corridor x 218.75..254.75 | 5' wide | one face with the entry; 7' cased opening (x 76..160) into the great room; 36" opening into the kitchen at the corridor; a 26 x 44 window over the corridor's landing |
| Stair up | origin (78.75, 25.5), east, 36 wide (y 7.5..43.5, on the block wall's inside face), run 140, 15 risers of 7.2", railing right (south), pine treads, framed under; a 46 x 34 window over its lower run, sill 54 | | the Second Floor's edge at x 218.75 is its top riser; the well upstairs is a floor opening from 1" before the 80" headroom line (x 89.2) to x 218.75, guarded west and south |
| Basement stair | on the Basement: origin (88.75, 25.5), east, 36 wide, run 130, 14 risers (102"), cuts the First Floor from x 92.2, railing right | stacked under the stair up | 30" door at its top in a wall at x 221; low walls under the stair above along the hole's south edge (y 41.25) in four pieces (2", 31 1/4", 54 1/4", 77 1/2" high) and a return at x 92.2, each under the framed underside; headroom over the basement flight about 90" |
| Powder room | x 259.25..311.25, y 7.5..66.75 | 4'4" x 5' | WC under a 36 x 18 transom (sill 72), 24" vanity east; 28" door from the corridor at y 40 |
| Pantry | x 259.25..311.25, y 71.25..102.25 | 4'4" x 2'7" | 12" shelves east and south; 28" door from the corridor at y 86 |
| Great room | x 6.75..169, y 106.75..308.25 | 13'6" x 16'9 1/2" | 144 x 60 picture window (x 84); door to the screen room at y 190; stove on the west wall at y 288, hearth 50 x 40, surround 3" x 46" x 60" high |
| Kitchen / dining | x 173.5..311.25, y 106.75..308.25; partition x 171.25 (3/4" east of the girder's line, so its end does not land on the old partition's node) | 11'6" x 16'9 1/2" | 94" cased opening to the great room (y 212..306) under a flush beam on x 170.5; fridge NW (36 x 30 at x 191.75); west run: base 24, range 30 (y 178) with hood, base 18; north wall: base 30 + upper at x 296.25; island back x 270 facing west: dishwasher 24 (y 151) and sink 36 (y 181), top 60 x 26; table 72 x 36 centred (239, 258), six chairs; 96 x 60 window (x 239); suite door 32" at y 137 |

**Master suite**: outside x 318..486, y 0..315 (14' out); inside x 317.75..479.5 (13'5 3/4").

| Room | Where | Size | Notes |
| --- | --- | --- | --- |
| Master bath | y 6.75..90.75 (partition y 93) | 13'5 3/4" x 7' | shower 60 x 42 NW with a glass panel, 72" vanity on the south wall (x 425), WC on the east wall (y 48) under a 36 x 44 window (sill 40), 48 x 24 transom north (x 430, sill 60); 30" door from the hall at x 335.75 |
| Suite hall | x 317.75..353.75, y 95.25..155.25 (partition x 356) | 3' x 5' | open south to the bedroom |
| Walk-in closet | x 358.25..415.25 (partition x 417.5) | 4'9" x 5' | 28" door from the hall at y 125; rods and shelves north, 12" shelves south |
| Laundry | x 419.75..479.5 | 5' x 5' | washer and dryer on the north wall, 56" bifolds from the bedroom (y 157.5), dryer vent east, 30 x 30 window (y 125, sill 48) |
| Master bedroom | y 159.75..308.25 (partition y 157.5) | 13'5 3/4" x 12'4 1/2" | king bed on the east wall centred y 234, 30 x 48 windows at y 184 and 284 (sill 30), braided rug; 72 x 80 sliding door in the lake wall at x 398.6 |

Foundation under the suite: 8" block, new, on CL y 3.5 (x 314.5..482.75), x 482.75 (y 3.5..311.5)
and y 311.5 (x 314.5..482.75, over the demolished bump wall's line), with a new 72 x 80 double door
at x 398.6; labelled "Basement under the suite (new, walkout)". Deck x 319.5..486, y 315..411, top
-6 below the floor (absolute -4), railings east and south.

**Second Floor** (inside x 6.75..311.25, y 6.75..308.25)

| Room | Where | Size | Notes |
| --- | --- | --- | --- |
| Hall | y 43.5..102.25 from x 83.25 to 254.75, with the landing x 218.75..254.75 north of it | 4'11" wide | over the First Floor's hall wall (y 104.5); 46 x 44 window over the well (x 190, sill 40), 26 x 44 over the landing |
| Bath | x 6.75..78.75, y 6.75..102.25 (partition x 81) | 6' x 7'11 1/2" | tub-shower 60 x 32 across the north end, WC west (y 62), 24" vanity south (x 30); 28" door at y 60; 36 x 36 windows north (x 42) and west (y 50), sill 48 |
| Linen closet | x 259.25..311.25, y 6.75..102.25 (partition x 257) | 4'4" x 7'11 1/2" | 18" shelves; 30" door at y 60; over the powder room and pantry |
| Bedroom west | x 6.75..168.25, y 106.75..308.25; closet x 6.75..78.75, y 106.75..131 (front y 133.25, end wall x 81, 60" bifolds) | 13'5 1/2" x 16'9 1/2" | door 30" at x 140; 66 x 46 south (x 82, sill 34), 46 x 44 west (y 200, sill 34); queen bed on the partition, dresser under the window |
| Bedroom east | x 172.75..311.25 (partition x 170.5); closet x 239.25..311.25 (end wall x 237) | 11'6 1/2" x 16'9 1/2" | door 30" at x 200; 66 x 46 south (x 242), 46 x 44 east (y 220, sill 42, over the suite's shed) |

**Roofs**: main gable (ridge east-west, 6:12, 24") on the Second Floor; the suite's shed (3:12 down
east, 18", outline from x 336 so its overhang ends at the main wall; its top 138" up, 30" over the
second floor); the covered entry's gable (x -96..-12, y 0..120, facing west, 6:12, 12"); the screen
room's shed (x -96..-12, y 120..264, 3:12 down west, 12"). All metal through `roof()`; the
Proposed view's look paints them hunter green standing seam.

**Covered entry**: a fieldstone stoop pier 96 x 120, top +1.5; two 10" log posts at x -91 (y 6 and
114) on 18" piers to +20, a 10" log plate under the eave, 6" braces; a flagstone landing x -66..-30,
y -24..0 (the old pad and stones demolished). **Screen room**: 6 1/2" walls (CL x -92.75, y 123.25
and 260.75) in shake with a 36" river-stone band; screens 40 x 44 (sill 36) at y 149, 192, 235
west, x -67 and -22 north, x -22 south; 36" screen door south at x -70; 36" door from the great
room at y 190. **Flue**: connector from the stove's collar (x 18.75, y 288) to a thimble 66" up,
tee outside, stainless chimney at (-6, 288) to 3' over the rake and 2' over the ridge.

**Outdoor stair**: open flights 36" wide at x 508 with rails both sides: 11 risers from a landing
deck (x 490..526, y 309..345, at the walkout's level) up north to a boardwalk landing on the lawn
(y 175..199, +80 over the basement floor); 12 risers from the landing down the bank (base -96).
Grade points added: (486, 188) -20, (540, 188) -20, (540, 175) -20, (486, 315) -100.

**Structure** (placeholders): Basement joists east-west (framing 0), First Floor east-west with a
north-south joist zone over the north band (y 0..104.5), Second Floor north-south. The middle
girder (x 170.5, existing placeholder) is marked demolished and redrawn new from y 45.75 to the
south wall; a flush header (y 45.75) from the west girder (x 77.5) to the east one (x 259.5); a
flush beam on x 170.5 from y 206 to the south wall over the dining opening. Demolished walls on all
three levels carry `bearing: false`. The Proposed view's checks: two header notes at the basement
stair's hole, nothing else.

## Decisions and why

- **A second plan, not a fourth view.** The model's phases are one existing state and one proposed
  overlay; the honest reading of "a new view" that keeps the renovation design intact is a second
  plan whose Proposed view is the rebuild. The All view of a full teardown overlays old and new
  rooms that coincide, so there the old labels keep their faces and the new ones go unlabelled (the
  test allows orphans in All only).
- **The stair straight up the north wall**, as MK chose for the renovation, rather than the
  reference's landing and turn: it stacks over the basement stair (the house has no inside way
  down today), and a straight run with one pitch keeps 90" of headroom over the flight below.
- **The suite 14' out**, the reference's addition; a full-height basement under it with the
  walkout, since the bank is at the basement floor there as today. Its roof a 3:12 shed so the
  upstairs east bedroom keeps a real window (a 5:12 shed forced transoms in the renovation design).
- **Laundry on the main floor** in the suite, where the clothes live (MK, for the renovation); the
  upstairs linen closet stands on the powder room's wet stack if that is wanted instead.
- **Screen room on the west face** beside the entry, as in the reference and the renovation; on
  the lake face it would take the great room's view and light.
- **Kitchen with no outside wall**, as the reference's; the island faces the range across a 53"
  aisle, the dining at the lake window. Task lighting, as noted for the renovation.
- **Three small quirks of the model**, all commented in the script: a new wall ending on a
  demolished wall's node becomes its duplicate and is dropped (so the kitchen partition sits 3/4"
  off the girder's line, and the beams on the line itself); nodes merge within 1/2"; and the stair
  strip sits on the block wall's inside face (y 7.5), 3/4" off the new wall's, so the basement
  flight clears the thicker wall.

## Still open (MK)

- The reference's kitchen is bigger (11' x 12' plus the dining); the island and the west run give
  about 11' of counter. A longer counter means a narrower great room or the dining moved.
- The stove in the great room's south-west corner: its view from the sofa, or by the screen room's
  door instead.
- Which bedroom upstairs is whose, and whether the linen closet becomes the laundry.
- Everything measured: the block ring (26'6" x 26'3" outside, worth one tape measurement), the
  girders' places and sizes, and the ground along the suite's east side.
