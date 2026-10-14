# Plan: address the README's "Still open" items

## Context

The README's "Still open" list (README.md ~781-820) mixes three kinds of item: design decisions, work for trades and the engineer, and things the tool cannot draw yet. MK's answers:

- **Garage:** don't draw it.
- **Retaining wall:** draw it, following the site sketch. The existing wall becomes the 10' return, 22' angled and 37' straight; the new wall adds about 20' angled and 27' straight to the west property line.
- **Vents:** "walls, not roof". The dryer vents out the master bath's north wall. The hood duct goes east through the wing's ceiling and out the wing's east wall.
- **Design changes, all four:** foyer hooks and bench; remove the stair hall / Living wall; a 4' north band, done by fixing the tool so new walls stop splitting demolished ones; the foyer gable's knee braces and timber truss, which needs sloped members.
- **Porch:** keep the estimate.

I'll also do these unasked, as already announced:
- tuck the stools under the island's ledge;
- draw the smoke and CO alarms the stove brings;
- put studs in the x 170.5 partition under the two beam ends;
- take the settled "how the bedroom is reached" item off the list.

The engineer's sizing, the plumber's pipe route, the chimney maker's details and the on-site measurements stay open, regrouped by who answers them.

The plan is saved as `docs/history/PLAN-v9-still-open.md` in the first commit. Every commit runs:
- `npm test` and `npm run build`;
- `npm run build:example`, `npm run build:viewer`, then the copy to `docs/viewer/`.

README and DESIGN are updated, and each commit goes straight to `main`.

## 1. New walls don't split demolished walls; the 4' north band

**Tool.** Today `normalizeLevel` in `src/model/plan.ts` (~271-413) splits walls whatever their phase. Two passes change:
- **Crossing pass** (`insertCrossingNode`, ~228-262): skip a pair of walls whose phases never coexist, using `phasesCoexist` from `src/derive/phase.ts:40` (new against demo).
- **Node-on-wall pass** (~321-397): skip a split when no wall at that node coexists with the wall being split.

The existing and proposed views never show both walls of such a pair, so their footprints and faces are unchanged. The All view does show both. `computeFaceGeometry` (`src/derive/rooms.ts:163`) assumes a planar graph, so:
- When the view shows both walls of such a pair, planarize the half-edges locally first: split each wall at its crossings and T points with virtual nodes, keep the positions in a local map, and set `wallOf` to the original wall id.
- `polygon` and `nodeIds` read that map. Check every user of `face.nodeIds` and handle the virtual ids.
- In the All view, crossing footprints just overlap. That is cosmetic, and acceptable.

Two follow-on changes:
- `setPhase` and `updateWalls({ phase })` re-run normalize for the walls they change. Then "Keep (existing)" on a demo wall crossed by a new wall splits it, as today.
- `planRenovation` (`src/model/renovate.ts`) relies on splits between walls that coexist, so it is unaffected. Its tests must stay green.

New tests:
- a new wall crossing a demo wall leaves the demo wall and its door unsplit;
- the All-view faces are correct, with no orphan labels;
- the existing view's signature is unchanged;
- marking the demo wall existing splits it.

**Starter** (`scripts/example-plan.ts` ~863-933, 1082-1113):
- `BAND.south` goes from 51.5 to 57.5 (faces 55..60). The powder room becomes 7'2" x 4' and the pantry 3'11" x 4'. The old bath door stays at y 54..84.
- The kitchen's east-wall run, the pantry shelves and the laundry fixtures shift 6" south. That is about 6" per the analysis; I'll check the exact shift against the band's face when implementing.
- The old "Bath" label anchor moves from (254, 52) to about y 70, so it doesn't fall into the powder room's face in the All view.
- Expected test changes in `example.test.ts`: wall counts (demo 13 → 12, new 29 → 28) and room sizes (powder room 86x48, pantry 47x48, kitchen 138x248).

## 2. Timbers at set heights; the foyer truss; studs under the beam ends

**Tool.**
- `Beam` gains optional `za`/`zb` (level-local heights of its top at a and b) and `color`. `Post` gains optional `base`/`top` and `color`. Types are in `src/model/types.ts`.
- `memberProblem` (`src/model/structure.ts`) validates them. `BEAM_KEYS`/`POST_KEYS` in `plan.ts` and `cleanMember` keep them. No schema bump: older files simply lack the fields.
- `isTimber(m)`, true when set heights are given, is defined in `derive/members.ts`.
- `memberBoxes` handles timbers like this:
  - A timber beam becomes a sloped prism: its top runs linearly from za to zb, and it is `depth` deep.
  - A timber post spans base..top.
- `getMemberMeshes` (`src/derive/meshes.ts` ~1238-1282) draws a timber beam with `slopedPrismPositions` (`roofs.ts:330`) and skips the ceiling clip for timbers.
- Materials: `memberMaterial(part, phase, color?)`, exported as `member_<part>_<phase>[_<hex>]`.
- Structure checks and inference ignore timbers; they are framing the checks don't follow. The places to gate:
  - `structureChecks.ts` (new beam ends and posts, `supportAt`, the supports for removed walls, header carriers);
  - `structure.ts` (`crossingSupports`, beam ends making walls bear);
  - `stairChecks.ts` (beams over a flight);
  - `members.ts` (a post stopping under a beam);
  - `structureTools.ts` (snapping to beam ends).
- Panel (`MemberProps`): a "Set heights" checkbox with the top-at-each-end fields (or base and top for a post), and a colour field. 2D is unchanged.

**Starter (estimates, from photo 08's old porch).** The foyer's west gable carries exposed timbers in the stain (`FINISH_COLOR`), 5 1/2" square, just proud of the west wall's siding (x about -98.75):
- a tie beam across the gable at the eave line (y 67.75..154.5);
- a king post from the tie to under the ridge (y 111.125, about 127" up);
- two principal rafters from the tie's ends to the ridge, under the roof (`roofHeightAt`/`roofBearing`, `src/derive/roofs.ts`);
- two 45° knee braces from the wall at each corner up to the tie.

Studs go under the beam ends: two `(2) 2x4` posts (3.5 x 3.5) in the x 170.5 partition at y 92.75 and 99.5. They make the load path explicit, and it stays green.

## 3. Interior items in the starter

- **Stair hall wall.** Remove the y 137.5 partition, its two passages, its `bearing:false` mark (~1197; that `wallAt` throws otherwise) and the "Stair hall (proposed)" label. In the Proposed view the hall and the Living become one room, labelled Living.
  - Tests to update: names at `example.test.ts` 70-82; counts at 105, 106 and 114; the bearing list at 443; sizes at 472 and 477; `faceAt` at 519; doors at 693-702; bearing marks at 672.
  - Elsewhere: `plan.test.ts` 428/434 and `offset.test.ts` 31 and 62-97 (its kitchen/Living wall becomes 170.5,99.5..311.5).
- **Foyer.** A 48" x 16" x 18" bench under the north window (x -68..-20, y 71.25..87.25), clear of the front door's swing. Two 24" hook rails at 60" on either side of the window (x -89..-65, -24..0). Both in the stain.
- **Stools.** Move them to centre y 250, 6" under the 12" ledge.
- **Dryer vent.** Move the washer and dryer 4" east (backs at x 322; the dryer's front ends flush with the closet's opening at x 350) to leave a 4" chase behind them. Then:
  - a 4" duct rises behind the dryer from 30" to 86";
  - it runs north at 86..90 to the master bath's north wall and through it at x 320;
  - a vent hood sits outside.
  - About 8'4" of run plus two 90° elbows, well under the 35' the code allows less 5' per 90° bend (M1502.4.5.1; verify against the 2025 RCNYS).
- **Hood duct.** An 8" duct from the hood's top at y 153 east through the kitchen's east wall and along the wing's ceiling at 86..94, boxed in a soffit (the east wall tops out at 96, so the duct cannot sit above the ceiling). It leaves the east wall at y 153 above the window there (head 74) and ends in an outside cap. About 13' of run.
- **Alarms** (box fixtures, about 6" x 6" x 2", under the ceiling, labelled):
  - smoke alarms in each bedroom: the master bedroom, and upstairs the Guest and Office (check the labels);
  - combination smoke/CO alarms outside the sleeping areas on each storey (the upstairs hall; the kitchen side of the master bedroom's door);
  - one smoke alarm in the basement.
  - Written as R314/R315 with "verify against the 2025 RCNYS".

## 4. The retaining wall, following the site sketch (estimates)

Basement level (`scripts/example-plan.ts` ~473-477, `RETAIN`):
- **Existing wall:**
  - keep the 10' return at x 314.5 from the house to y 435;
  - a 22' angled piece west to about (56, 489), stepping 4'6" south as the sketch draws it;
  - a 37' straight piece to about (-388, 489).
- **New wall** (`drawWalls(bId, pts, 10, false, NEW)`, the same plain concrete finish, 96" tall):
  - about 20' angled to (-660, 519);
  - then 27' straight to the west property line at x -984.
- **Ground:** move the terrace and lawn grade points with it. The terrace stays at -6 behind the walls, with the lawn level at the west end. Outside the new wall the ground falls toward -50, an estimate.

Tests:
- `example.test.ts`:
  - the existing view's open end becomes (-388, 489); in the Proposed and All views it is (-984, 519);
  - the plain-wall count;
  - "new Basement walls are block" filtered by finish;
  - terrace and grade-point counts.
- `lighting.test.ts` 232-236: the sun shadow fit covers a wider plan, so its texel grows to about 0.85". Update the expectation and say so in DESIGN; the shadows get coarser.

## 5. README and docs

- Rewrite "Still open":
  - **Done items** go into the design list: the band, the hall, the coats bench, the vents, the stools, the alarms, the truss.
  - **For MK:** the porch, pending his reference pictures; the garage, not drawn, its place west of the house reserved by the new wall.
  - **For the engineer:** the header, the beam, the post, the footing and the studs; whether the y 99.5 wall bore load; the Bunk wall; how the foyer truss is fixed.
  - **For the trades:** the bath's pipe route through the powder room; the chimney maker's and stove's clearances and the roof brace; the duct and vent hood products.
  - **To measure on site:** every new size, the joist directions, the retaining wall's line.
  - Remove "how the bedroom is reached" (settled).
- DESIGN: the phase-aware normalize, the All-view planarization, timbers, the walk and shadow notes.
- `docs/history/PLAN-v9-still-open.md`: this plan, with a "Built differently" section.

## Order (one commit each)

1, 2, 3, 4, 5. Steps 1 and 2 are tool changes with their own tests before the starter uses them.

## Verification

- `npm test`, plus the new tests:
  - normalization and All-view faces;
  - timber meshes and their checks;
  - the starter: band sizes, merged Living, no orphan labels in any view, structure issues still only the header notes.
- `npm run build`; the regenerated example JSON matches the script; the viewer is rebuilt.
- Playwright screenshots:
  - the north band in the All and Proposed plans;
  - the foyer's west gable in 3D (the truss);
  - the laundry and kitchen ducts in 3D;
  - the retaining wall in 3D from the south-west;
  - sent to MK.
