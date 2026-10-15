# 146 Mick Road: the proposed first floor, v13 (the Kitchen/Living wall opened, fridge and counters on the east wall)

## Context

MK (15 Oct 2026) wants:
- the island moved west;
- the wall between the hall's opening and the Living doorway removed, since the island would hit it;
- the fridge on the wall shared with the master bedroom;
- normal cabinets and counters along that wall.

His answers:
- the island stays 62" with its west end at the old wall line, and you walk round it through the
  Living;
- the fridge goes against the bedroom's new walk-in closet, which deadens its hum.

This also answers the review's main kitchen weakness: counter goes from about 9'8" to about 18'7".

Today the Kitchen/Living partition (x 170.5) has three openings, north to south:
- the new 32" cased opening from the hall (y 102.5..134.5);
- a 4'5" wall;
- today's 48" Living doorway (y 188..236);
- a 16" wall;
- the pass-through (y 252..300).

## The design (inches; x east, y south)

**The wall comes out.** One floor-to-ceiling passage, y 102.5..236 (133.5", about 11'1"), centred
y 169.25. It takes the place of the cased opening (not built), the 4'5" wall and today's Living
doorway (demolished with the other openings at the start of `proposed()`). The 16" wall and the
pass-through stay.

It is a bearing wall: the upstairs Master/Guest partition stands on it, and the two upstairs
ceiling beams' ends land on it. So:
- the opening gets the tool's header note (R602.7);
- the README tells the engineer a flush beam over the opening carries that load to its ends;
- the north end sits on the studs and (2) 6x6 already at y 99.5;
- the south end sits in the 16" wall, with a post below it to a footing;
- no members change in the model: the load-path check reads the wall as continuous, and the
  header note covers the opening.

**North wall** (fronts south, backs on y 60):
- the 24" trash base and the pantry door stay;
- then a 15" base, the range with its hood (x 237..267, the duct through the pantry unchanged);
- then a **20" base** (x 267..287, was 15") running into the corner;
- wall cabinets over the bases.

**East wall** (fronts west, backs on x 311, the wall shared with the master suite), north to south:
- corner base 24 (y 60..84, its counter mitred into the north run's), base 30 (84..114), base 24
  (114..138);
- the **refrigerator** 36" wide, counter-depth 29" (x 282..311), at y 140..176. Its back is on the
  bedroom's walk-in closet (y 122.5..180.5), with a 2" filler before it;
- base 24 (176..200) as its landing;
- wall cabinets over the bases, one over the fridge;
- the east wall south of y 200 stays open, the way to the bedroom door (y 248..280).

**Island:**
- dishwasher 24 (x 179..203) and sink 36 (x 203..239), fronts facing north as now (y 134..158);
- top 62 x 26, 1" all round: x 178..240, y 133..159;
- 46" to the east counter, 42" to the fridge front, 48" to the north counter, 45" to the table's
  chairs;
- its west end is 5" short of the old wall line, inside the new opening's span, so you walk round
  it through the Living.

**Table** and chairs unchanged.

**Results:**
- work triangle: range to fridge about 8'0", fridge to sink about 6'4", sink to range about 6'8",
  about 21'1" in all;
- counter about 18'7": the north run 24 + 15 + 20, the east run 24 + 30 + 24 + 24, the island 62.

## Files

- `scripts/example-plan.ts`, `proposed()`:
  - add today's Living doorway to the First Floor `demolish` (`openingAt(fId, { x: PART_KL, y: 212 })`);
  - replace the cased opening `add({ x: PART_KL, y: 118.5 }, passage 32)` with the 133.5" passage
    (height 96, sill 0);
  - in section 2, replace the north run's east base, the fridge and its wall cabinet, and the
    island positions;
  - add the east run (an `eastWall(...)` helper like `northWall`);
  - rewrite the comments (triangle, counter, aisles).
- `src/__tests__/example.test.ts`:
  - opening counts (existing 10, demo 22, new 31);
  - fixture count (+8: new 59);
  - the header-note list (the wide opening's centre in place of y 118.5);
  - the kitchen test: the north run, the east run with the fridge, the island top x 178..240, the
    aisles (42" min to the east run and the fridge), the triangle legs, counter runs (4 kitchen
    runs: the island, the 24" base, the 15" base, the L; plus the base after the fridge = 5), the
    mesh counts;
  - a check that the Kitchen/Living wall has one new passage of 133.5" and that today's 48"
    doorway is demolished.
- `src/__tests__/plan.test.ts`: only if the First Floor's wall count changes (it should not).
- `README.md`:
  - item 3 (the hall's way into the kitchen is now the wide opening);
  - item 5 (the kitchen: the east run, the fridge, the island, the triangle, about 18'7" of
    counter);
  - the livability notes (the counter note is now answered);
  - the engineer's list: the header over the 11' opening, its loads, and the posts at its ends.
- `docs/DESIGN.md`: the kitchen paragraph (counter runs).
- `docs/history/PLAN-v13-kitchen-open.md`: a copy of this plan plus "As built".
- Regenerate the example JSON and the viewer.

## Verification

1. `npm run build:example`, `npm test`, `npm run build` all pass, with no new non-info checks
   (fixtures inside their faces and clear of walls, counters clear of walls).
2. `npm run build:viewer`, then copy to `docs/viewer/`.
3. Playwright: the First Floor plan in Proposed, plus 3D shots from the Living through the opening
   to the island and the east run with the fridge. Send MK the plan and one 3D view.
4. Commit on main and push.

## As built

As planned, with these notes:

- The opening is a passage 133 1/2" wide and 96" high (the wall's full height), sill 0, centred
  y 169.25 on the partition. The tool notes its header ("11'-1 1/2" wide").
- The model's structure is unchanged; the README's engineer list says what the opening needs:
  - a flush beam to its ends;
  - a post in the 16" wall and one under it to a footing;
  - the basement 6x6s planned under the ceiling beams' ends move to the opening's ends.
- Counter runs in the kitchen: five (the island, the 24" base, the 15" base, the L from the 20"
  base round the corner to the refrigerator, the base after it). Counter frontage 223" (18'7").
- Counts: openings 10 existing, 22 demolished, 31 new; fixtures 59 new.
