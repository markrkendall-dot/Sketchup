# 146 Mick Road: the proposed kitchen (island facing the lake)

## Context

The proposed design (batch G, on `claude/cool-mccarthy-rqi8ka`) already has what MK confirmed:
the Utility is gone and the east addition holds only the master bedroom and master bath, and
the kitchen takes the old first-floor bath (the wall between them is demolished, so the kitchen is
an L). What is missing is the kitchen itself. MK wants the sink and dishwasher on an island
facing the lake, two stools on the island's lake side, and the refrigerator flanked by pantry
cabinets on the east wall. Only the proposed kitchen is drawn; today's cabinets are not measured.

The casework model (another session's M12: `Fixture` kinds base, wall, tall, island, sink, range,
fridge, dishwasher, hood, box; `addFixture` in src/store/planStore.ts; counters merged per run by
`counterRuns` in src/derive/casework.ts; DESIGN.md "Casework") draws all of it. No model change is
needed: this is one batch in scripts/example-plan.ts, its test and the README.

## Geometry (inches; x east, y south; inside faces, proposed view)

- Main kitchen: x 173 (Kitchen/Living partition face) to 311 (east wall face), y 102 to 308
  (lake wall face): 11'6" x 17'2". The Living doorway is in its west wall at y 188..236. The lake
  window is centred at x 242, x 183..301, sill 30 (nothing can stand against that wall).
- Old bath alcove, now kitchen: x 197..311, y 7..97, open to the main kitchen along y 97..102. Its
  north window: 42 x 44 at x 234 (x 213..255), sill 34. Its west wall (x 194.5) keeps the 30" door
  at y 13..43 into the pocket under the stair's top (x 169..192, y 7..43, closed on every other side).
- The room's width sets the island: with 36" walkways at both ends, its top is at most 66" long.

## The layout (all fixtures phase `new`, level finishes left at the defaults)

Fixture frame (src/model/casework.ts): `origin` is the middle of the back edge, `direction` the
way the front faces (0 = +x east, 90 = +y south, 180 = west, 270 = north); right of the front is
+x when the front faces north.

1. **Island** (fronts face north, so you stand north of it facing the lake): dishwasher 24 wide
   with its back centred at (224, 236), sink cabinet 36 wide centred at (254, 236), both
   `direction: 270`, depth 24, so the cabinets run x 212..272, y 212..236. Counter overhang: front
   1, back 12 (the seating ledge on the lake side), 3 past the outer end of each (dishwasher
   `left: 3`, sink `right: 3`), so `counterRuns` makes one top 66 x 37, x 209..275, y 211..248.
   Clearances: 36" walkways at both ends (to x 173 and x 311), the work aisle north of the island
   is open to the alcove, 60" from the ledge to the lake wall behind the stools.
2. **Stools**: two `box` fixtures 16 x 16 x 30, label "Stool", centred at (226, 258) and (258, 258).
3. **East wall, fridge between pantries** (fronts face west, `direction: 180`, backs on x 311):
   tall pantry 24 x 24 x 84 at y 102..126, refrigerator 36 x 30 x 70 at y 126..162 (its own
   30" depth standing 6" proud of the pantries), tall pantry at y 162..186; a 30" wall cabinet over
   the fridge (36 wide, 15 deep, 15 high at elevation 70).
4. **Range wall in the alcove** (east wall, `direction: 180`): base 30 at y 7..37, range 30 at
   y 37..67 (centred y 52), base 30 at y 67..97; a hood 30 wide at elevation 66 over the range and
   30" wall cabinets over both bases. One continuous counter over the two bases (they do not touch
   the range's counter: the range carries none, so two counter pieces either side, as built).
5. **North counter in the alcove** (`direction: 90`, backs on y 7): base cabinets x 221..287 (36
   and 30), meeting the range wall's base at the corner. The alcove's north window is raised above
   the counter: the existing one is demolished and a new 42 x 36 window, 2 sashes of 2 x 3 lites,
   sill 44, takes its place at x 234.
6. **Closet door**: the 30" door at y 28 cannot swing into the 23" pocket. Demolish it and add a
   24" door at y 31 (jambs 19..43) swinging into the kitchen, which the north counter clears
   (it starts at x 221). Label the pocket "Closet (proposed)".
7. **Bedroom door moves**: the pantry run now covers the east wall at y 102..186, where batch G put
   the bedroom door (y 150). Move it to y 205 (jambs 189..221), between the pantry run and the
   island's east walkway; it still swings into the bedroom.

Work triangle, centre to centre: sink to fridge about 6'3", fridge to range about 7'8", range to
sink about 13'7" (27' in all, a little over the usual 26' guideline). README notes it, and that the
range is on the wall shared with the master bath, so the hood ducts up through the wing roof or
recirculates.

## Batch H (Opus, one worktree)

Files: scripts/example-plan.ts (the kitchen in `proposed()`, after the openings; a `fixture(...)`
helper over `store().addFixture` that throws when one is refused), docs/examples/146-mick-road.json
(`npm run build:example`), src/__tests__/example.test.ts, README.md ("The proposed design in the
starter": the kitchen paragraph and its open items), docs/viewer/146-mick-road-viewer.html
(`npm run build:viewer`, then copy dist-viewer/146-mick-road-viewer.html over it), and
docs/history/PLAN-v5-kitchen.md (a copy of this plan).

Checks the agent must make and report: every fixture inside the kitchen's faces in the proposed
view and none overlapping another or a wall (bounding boxes against the wall footprints);
`counterRuns` gives one island top 66 x 37 and the alcove's L counter; the moved bedroom door and
the new closet door fit their walls (`addOpeningAt` throws otherwise); the existing view and its
tests are unchanged (fixtures are new, so hidden there). Tests: fixture counts by kind, the island
top's size, the walkways (island top to x 173 and x 311 at least 36"), the doors' positions, and the
existing tests still passing. `npm test`, `npm run build`. No em dashes in prose. Do not commit.

## Verification by the coordinator

- 2D First Floor in the proposed and all views: the island with the sink basin and DW, the stools,
  the pantry and fridge run, the range with its hood, the alcove counter, the doors.
- 3D in the proposed view: a shot from the Living doorway toward the lake (island, window behind),
  one from the island looking north into the alcove, and the south elevation (nothing changes
  outside except the raised alcove window on the north elevation).
- `npm test`, `npm run build`, example and viewer rebuilt; commit, fetch and rebase if the remote
  moved, push.

## As built (batch H)

Where scripts/example-plan.ts differs from the design above, and why:

- **Bedroom door** at y 211 (jambs 195..227), not y 205: the main block's east wall is in two
  pieces either side of y 191.5, where the old wing's north wall meets it, so jambs at 189..221
  would straddle the joint (`addOpeningAt` refused it). y 211 puts the north jamb at that old
  wall's south face. It is still south of the pantry run and beside the island's east walkway.
- **Closet**: a new 5" partition at x 171.5 (faces 169..174, the top of the main flight against
  its west face, under the Bunk's east wall upstairs) from the north wall to the powder room's
  north wall. The pocket was open to the hall under the flight, so its label shared the hall's
  face and was an orphan. The closet is 18" x 36" inside (x 174..192, y 7..43), not 23" deep; the
  partition splits the existing north wall at x 171.5 (the existing walls count 54, not 53; the
  existing view looks the same) and the Entry hall's face is 162" east-west, not 185".
- **Hood**: 30" high (66 to 96), so its flue reaches the ceiling instead of stopping at 78 between
  the wall cabinets (84).
- **Stools**: `box` fixtures facing north, back edge at y 266 (y 250..266), as planned; they stand
  2" clear of the ledge (y 248) rather than under it.
- **Counters**: three runs, as planned: the island top (x 209..275, y 211..248, the basin cut
  out), the alcove's L (the north counter and the range wall's north base) and the range wall's
  south base on its own.
- Fixture ids are renamed like the other ids (`f-c1` ...), so the JSON is stable.
- The new wing roof's 18" west overhang shows inside the kitchen at the ceiling over the east
  wall, as noted in PLAN-v4 ("roofs overlap"); not changed here.
