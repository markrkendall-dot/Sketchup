# Plan: an Adirondack entry and screen porch

## Context

MK wants the proposed foyer entry and the screen porch (west face, `scripts/example-plan.ts` `proposed()`) to look "thoroughly Adirondack", with the ends of exposed beams showing at the entry.

What the research says (web search summaries; the full pages could not be fetched from here):
- **Materials:** native ones throughout: whole, split or peeled logs, bark, and fieldstone.
- **Posts and railings:** rough-pole log posts, and twig or branch work on railings and gables.
- **Exposed structure:** roof trusses and beams left showing; log ends extended past corners and gables; cross-bracing of poles used as ornament.
- **Eaves:** exposed rafter tails, often scroll-sawn.
- **Stone bases:** logs and timber set on stone, to keep them off the damp ground.
- **Siding:** bark-on half-log.
- **Roofs:** broad shingled or ribbed-metal roofs.
- **Palette:** brown and green. The starter's proposed look already has dark brown shakes, a green standing-seam roof and red trim.
- **Knee braces:** documented as a Craftsman detail, but common on rustic porches.

Sources:
- [Wikipedia, Adirondack Architecture](https://en.wikipedia.org/wiki/Adirondack_Architecture)
- [The Plan Collection](https://www.theplancollection.com/blog/adirondack-architecture-style-a-model-for-rustic-elegance-and-flair)
- [Isaac Kremer glossary](https://isaackremer.com/glossary/adirondack/)
- [NPS, McClelland on rustic design](https://www.nps.gov/parkhistory/online_books/mcclelland/mcclelland2d1.htm)
- [Adirondack Life, the roots of rustic style](https://www.adirondacklife.com/2022/09/29/the-roots-of-rustic-style/)
- [Middlebury, Adirondack architecture](https://sites.middlebury.edu/adirondack/?p=577)
- [Houzz, a Vermont porch](https://www.houzz.com.sg/magazine/porch-of-the-week-perched-like-a-nest-in-the-vermont-mountains-stsetivw-vs~173124881)

MK chose:
- an **open log canopy**: the foyer's gable extended about 5' west over the front door on log posts, with the ridge, purlin and tie log ends showing;
- **peeled, golden logs** with lighter end grain;
- all four details: log porch posts, twig work, stone piers and base, and half-log knee walls (below the screens only).

The tool cannot yet draw:
- round logs;
- stone or half-log finishes;
- a finish on the lower part of a wall's outside face;
- a stone pier.

So two tool commits come first, then the starter. Each commit ends green and goes straight to `main` (CLAUDE.md): `npm test`, `npm run build`, `npm run build:example`, `npm run build:viewer` plus the copy. The plan is saved as `docs/history/PLAN-v10-adirondack.md`, with these sources.

## 1. Tool: stone and half-log finishes; an exterior band

- **New wall finishes `'stone'` and `'halflog'`.**
  - Code: the `WallFinish` union (`src/model/types.ts:21`) and `WALL_FINISHES`/`WALL_FINISH_LABEL` in `src/model/finish.ts`. Both stay out of `SIDING_FINISHES`, so the proposed look's re-siding leaves them alone (`meshes.ts` ~1810).
  - Textures in `src/view3d/textures.ts`, on the existing 48" tile, each with a `sidingHeight` relief branch and a draw function next to `drawBlock`/`drawShingle`. Without a branch a finish falls through to `drawScreen`, so both need one.
  - **Stone:** irregular rounded fieldstones in a mortar bed, seeded and multi-tone grey and brown. Reuse `seeded`, `shade`, `speckle`, `mortarColor` and `heightRect`.
  - **Half-log:** horizontal bark-on logs, 8" courses, a rounded profile in the relief, dark chink lines, and bark texture via `grain`/`speckle`.
  - Stone counts as masonry for beam bearing: `structureChecks.ts` currently tests `finish === 'block'`.
  - Loading (`plan.ts` :631/:683) and the panel's `finishOptions` follow `WALL_FINISHES` automatically.
- **`Wall.band?: { finish: WallFinish; color?: string; height: Inches }`.** This is the wall's outside face below `height`, in its own finish, like a wainscot outside.
  - The store's `updateWalls` handles it, and so does loading (WALL_KEYS plus validation).
  - The Wall panel gets "Lower band": finish, colour and height, with a Clear button.
  - In 3D the band's height joins the level-wide band heights (`meshes.ts` ~1688-1706), so neighbouring walls are cut alike.
  - The outside face is split into band and upper parts with the existing face-splitting code (`splitFaces`, `band: 'upper' | 'wainscot'`, ~598-666) and gets a separate mesh in the band's `wallMaterial`. The outside is the side no room dresses, `outwardSide`.
  - The proposed look re-sides only the upper part.
  - The export adds that mesh with the usual `wall_<phase>_<kind>_<finish>_<hex>` material.
- **Tests:**
  - `finishes.test.ts`: the two new finishes and their relief.
  - `proposedLook.test.ts`: a stone or half-log wall and a banded wall are not re-sided below the band.
  - New `band.test.ts`: store, loading, mesh split and export.
- **Docs:** DESIGN's finishes list and textures section.

## 2. Tool: round logs and stone piers

- **`profile?: 'log'` on `Beam` and `Post`.** The diameter is `width`; `depth` is kept equal to it.
  - Wiring for the new field:
    - `memberProblem` (structure.ts);
    - `BEAM_KEYS`/`POST_KEYS` (plan.ts:600);
    - `cleanMember` and the patch-clear list (planStore.ts:353, :1133).
  - `members.ts` gains `memberAxis(m)` (3D end points): a log post runs from base (or 0) to top at `at`; a sloped log runs along the timber's centreline (`timberTop`, with the axis at top minus half the plumb depth).
  - New helper in `meshes.ts`, `logBetween(a, b, diameter)` returning `{ body, ends }`:
    - the body is a 24-sided cylinder (`circleOutline`, `site.ts:573`) built with `prism(..., { top: false, bottom: false })`;
    - smooth normals come from `roundNormals`, generalised to an axis;
    - the ends come from `prism(..., { side: () => false })`;
    - both are placed with `applyMatrix4` (a quaternion turning +Y onto a→b, plus a translation).
  - `MemberMesh` gains `ends`.
  - The end grain gets its own colour, a lighter tint of the member's colour (`memberMaterial('end', ...)`, `MEMBER_COLOR.end`). `LevelMeshes` and the export add a "Log end" mesh.
  - 2D: a log post draws as a circle (`MemberShape`) and hit-tests as one (`selectTool.ts:161`); a log beam keeps its outline.
  - Panel: a "Round log" checkbox. Width becomes Diameter; Depth and Rotation are hidden.
- **Column kind `'pier'`: fieldstone.**
  - Wiring for the new kind:
    - `types.ts:282`;
    - `plan.ts:1121`;
    - `COLUMN_COLOR`;
    - `COLUMN_DEFAULTS`/`columnDefaults` (from the ground to the floor);
    - `COLUMN_KINDS`/`COLUMN_KIND_NAME` (siteTools);
    - the panel options;
    - `planStyles` `.column-pier`;
    - `index.css` ghost.
  - It is drawn with the stone texture through the chimney's path (`columnMaterial`), using `sidingTextures('stone', ...)` with box UVs.
  - A pier can also be a low wide stoop (any width or depth).
- **Tests** (`members.test.ts`, `site.test.ts`):
  - a log's body and ends, and where its end discs sit;
  - a log post drawn as a circle;
  - the pier kind, its texture and its defaults;
  - loading files with and without these fields.

## 3. Starter: the Adirondack entry and screen porch (estimates)

All in `proposed()`. Colours:
- peeled log `#c79a5b` (honey), end grain about `#e2c48f`;
- bark-on half-log `#5b4632`;
- stone grey-brown `#8e8579`.

Logs are timbers at set heights (the structure checks ignore them), `profile: 'log'`.

- **Open log canopy over the front door.** The foyer gable's outline runs 60" further west (`CANOPY_X0 = FOYER.x0 - 60`, outline x -156..-18; the rake is at -174). `FOYER.x0` itself does not change. The roof heights depend only on y, so the gable wall and the front door's opening stay as they are; the door now has about 6'6" of cover.
  - The old sawn 6x6 timbers on the wall face are removed.
  - **At the canopy's outer end** (x ≈ -150):
    - two fieldstone piers, 18" square, from the ground to about +20;
    - a 10" log post on each, up to a 10" log tie beam across the eave line;
    - the tie runs about 8" past the posts each way, so its round ends show;
    - 6" log knee braces from the posts to the tie;
    - an 8" log king post up to the ridge;
    - two 8" principal rafter logs under the roof.
  - **Under the roof:**
    - a 10" ridge log and two 8" purlin logs, one midway up each slope, from the foyer wall west past the rake to x ≈ -182, so their ends show about 8" beyond the rake board;
    - plus the existing open eaves' rafter tails.
  - **Twig work:** a sunburst of 3" branches from the tie's centre to the two rafters, in the open gable over the tie.
  - **Stoop:** a fieldstone landing under the canopy, a pier-kind column about 60" x 72", its top 1/2" under the door's threshold (+1.5). The exterior landing rule is to be checked against the 2025 RCNYS.
- **Screen porch.** The three square 8" site columns at x -92 are replaced by 10" log posts (First Floor members), each on a low fieldstone pier (16" square, ground to +12).
  - A 10" log plate along the eave line, under the shed's low edge, from the foyer to about 12" past the porch's south corner, so its end shows.
  - Log knee braces from each post to the plate.
  - Twig crossed-branch (X) panels in the two knee-wall bays of the west wall, 2.5" branches applied over the half-log.
- **Half-log knee walls.** A 36" `band` in bark-on half-log on the porch's west and south walls; shakes above the screens, re-sided by the proposed look.
- **Stone base.** The foyer's block footing becomes fieldstone (`finish: 'stone'`). It shows about 1" to 10" above grade, more on the south.

**Tests** (`example.test.ts`):
- the roofs list, with the gable at `[-156, -18, 64.25, 158]`;
- the site columns: the 3 square posts are replaced by piers;
- the timber list, now logs;
- the porch walls' band;
- the footing's finish;
- the fixture and wall counts;
- the flue still inside the screen porch's face.

## 4. Docs

- **README:** proposed design item 8 (the foyer and screen porch) rewritten as the Adirondack entry, with the research summary and sources. The DESIGN sections for the new finishes, bands, logs and piers.
- **`docs/history/PLAN-v10-adirondack.md`:** this plan, plus a "Built differently" note. Add it to the `docs/README.md` index.
- **Open item for MK:** the exact log sizes and species (cedar or spruce), the stone, and how the canopy's posts are anchored to their piers (the engineer and the builder).

## Verification

- `npm test` (new and updated tests), `npm run build`, and the regenerated example and viewer.
- Playwright 3D screenshots (Proposed view), sent to MK:
  - the entry canopy from the west and south-west, showing the log ends, truss, twig sunburst, piers and stoop;
  - the screen porch with its log posts, braces, plate end, half-log knee walls and X panels;
  - a close view of the log ends.
