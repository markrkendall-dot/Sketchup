# HomePlan

HomePlan is a browser floor-plan editor for one job: getting the house you live in onto the
screen from tape measurements, then drawing the changes you want (moved walls, an addition, a new
porch) and seeing them in 3D. You type wall lengths the way a tape gives them (`12'6`, `150`,
`6 1/2"`), walls join and split themselves, rooms are found and measured automatically, and the
house stands up in 3D with its roofs, the ground it sits on, siding, windows and doors. The model
exports to SketchUp. It is a focused tool, not a Home Designer Pro clone: no cabinets, furniture
or construction drawings. Everything runs in your browser; nothing is uploaded.

What it draws:

- **Walls, openings, rooms, stairs** on any number of levels (Basement, First Floor and Second
  Floor to start), with the three levels stacked in 3D and a faint ghost of the level below.
- **Roofs** (gable, shed, hip, flat) with overhangs, fascia and rake boards; walls under a roof
  rise to meet it, so a gable end is a triangle.
- **The site**: spot elevations of the ground (grade points) become a terrain surface, so a walkout
  basement shows on the downhill side and is buried on the uphill side; **chimneys and posts**
  stand on it.
- **Exterior appearance**: clapboard, shingle, board or screen siding in any colour, windows with
  divided lites, trim and shutters, doors with panels, roof colour.
- **Before and after**: everything you draw is existing, new or to be demolished, and the Existing,
  Proposed and All views show each state, in 2D, in 3D and in the export.

## Quick start

```sh
npm install
npm run dev        # then open the URL it prints (http://localhost:5173)
```

`npm run build` makes a static site in `dist/` that runs from any static web host (also from a
subfolder): copy the folder up, or try it locally with `npm run preview`. `npm test` runs the
unit tests. `npm run build:example` rebuilds `docs/examples/146-mick-road.json` (see
[Modelling 146 Mick Road](#modelling-146-mick-road)).

To see what the tool does before drawing anything, click **Open example** in the toolbar: it
loads the starter plan of 146 Mick Road, then press the **3D** button.

## Drawing an existing house

Before you start, measure on paper. Then follow these steps in order.

1. **Measure the outside perimeter first.** Go around the house with the tape and write down
   every run of exterior wall, corner to corner, in order. If you can only get inside, measure
   each room wall to wall instead and use the inside face setting below.
2. **Measure the wall thickness at a door jamb.** The jamb shows the full wall, siding or brick
   to drywall: typically 5" to 8" for a framed exterior wall (6 1/2" is the default) and 4 1/2"
   for an interior 2x4 partition (a 3 1/2" stud and 1/2" drywall each side).
   With nothing selected, the properties panel has "New exterior walls" and "New interior
   walls": set them before drawing. Walls already drawn: select them (drag a box around them
   with the select tool) and type the thickness in the panel.
3. **Set "Lengths to" to the face you measured.** `outside face` for the outside perimeter,
   `inside face` for measurements taken inside a room, `center` for lengths off a drawing. The
   app then turns your typed number into the wall's centerline, so the face lands where your
   tape said. Square corners are assumed (hover the setting for the exact rule).
4. **Draw the exterior walls clockwise from one corner.** Press `W`, click a starting corner,
   point the mouse the way the wall runs (ortho lock keeps it straight), type the length and
   press Enter. The next wall starts where that one ended: point, type, Enter, all the way
   around. Typing the last wall closes the loop onto the first corner when it ends within a few
   pixels of it (tape error), and the status bar says so. Esc ends a chain. Red dots mark wall
   ends that join nothing, and the status bar counts them.
5. **Then the interior walls, by face-to-face measurement.** Press `X` for interior walls
   (4 1/2"). Click on an existing wall to start a partition there (it splits the wall and joins
   cleanly as a T), type its length, Enter. Partitions that cross each other are split at the
   crossing automatically. For a wall's exact position, select it and use the properties panel,
   or drag its corners with the select tool (`S`).
6. **Place doors and windows by jamb distance.** Press `D` (door), `N` (window) or `P`
   (passage), point at the wall near the corner you measured from, type the distance from that
   corner's inside face to the near edge of the opening, Enter. Or just click to place it, then
   adjust "From start" / "From end", width, height and sill in the properties panel. For doors,
   Tab flips the swing side and Shift+Tab the hinge.
7. **Name the rooms and check them against the tape.** Press `R` and click inside each room,
   type its name, Enter. Select a room label: the panel shows its net area and its sides
   measured face to face (width x depth for a rectangular room). If a number disagrees with
   your notes, fix the wall that is off rather than the room.
8. **Copy the walls to the next level and adjust.** Click the level tab (or press `3` for the
   top level, `1` for the bottom) and use "Copy walls from level below", then move, delete or
   add walls. Stairs (`T`) go on the lower level and cut the floor above.
9. **Load a photo as an underlay if you have one.** A scanned plan, a real-estate sketch or a
   photo of graph paper: press `U`, load the image, click "Scale by two points", click the two
   ends of a wall whose length you know and type it, then lock the image and trace over it.

Fix mistakes with Ctrl+Z (Cmd+Z on a Mac); every edit, including a whole drag, is one step.

## Roofs, site and appearance

Once the walls are in, these make the 3D model look like the house.

- **Roofs (`K`).** Click the corners of the roof outline on the outside faces of the walls
  (they snap there) and close the shape on the first corner, a double-click or Enter. The roof
  belongs to the level whose walls it sits on. In the properties panel choose the shape (gable,
  shed, hip, flat), the ridge direction (for a shed: the way it slopes down), the pitch (rise per
  12), overhang, thickness and fascia, the finish (metal or shingle) and colour. **Fit to walls**
  sets the outline to the outer face of the level's walls when they close one ring. Small roofs
  (a porch, a wing) go on the level they sit on; their ridge and slope are set the same way.
- **The site (the Site tab under the lowest level).** Grade points (`E`) are spot elevations of
  the ground: click a spot and type its elevation (`-4`, `-6'4`; absolute, like the floor tops
  shown in the level bar). The terrain is smoothed between them. Put one at each house corner
  and a few out where the ground levels off. A chimney or a post (`C`; Tab switches kind) stands
  on the ground with its base and top set in the panel. The north arrow turns with the plan's
  north angle, and the sun follows it.
- **Finishes.** The Level panel's "Exterior finish" and "Exterior colour" set every exterior
  wall of the level at once; the Wall panel sets one wall. Siding textures are in the 3D view only
  (the export carries colours). A window panel sets lites (cols x rows), trim width and shutters.
- **Walls run through the floors.** An exterior wall on a level with a level above it is taller by
  that level's floor thickness, and the floor slab stops at the inside face of the wall, the way a
  platform-framed house is built, so the siding is continuous from one storey to the next.

## Planning the renovation

1. Switch the view to **All** (the toolbar, or `V` to cycle). All shows existing walls in grey,
   walls to demolish in dashed red and new walls in green.
2. Set **Draw as: new**. Everything you draw from now on is new work: new walls, roofs and posts,
   the addition (start its walls on the existing exterior wall so they join as T junctions),
   new doors.
3. To remove something, select it and click **Mark demolish**. That works for walls, doors,
   windows, stairs, roofs, chimneys and posts; a window that becomes a door is a demolished window
   plus a new door.
4. Flip between **Existing** (what is there, with the demolition shown) and **Proposed** (what
   it will be). Rooms are found per view, so in Proposed two rooms whose dividing wall is
   demolished become one, with its new net area. Roofs and posts follow the view too, and walls
   rise to a roof only in the views where that roof is shown.

## 3D and walk mode

The **Split** and **3D** layouts (or the backtick key) show the model, built from the plan and
updated as you edit. Drag to orbit, right-drag to pan, scroll to zoom, **Fit 3D** to frame it.
The checkboxes hide levels. **Walk** (or `F`) drops you inside at eye height: click the view to
look with the mouse, WASD or the arrows to move, Shift to go faster, Q/E to change level, Esc to
leave. Walls are not solid in walk mode.

## Export to SketchUp

**Export** makes a 3D file of exactly what the 3D view shows (the current view mode and the
visible levels): to export the proposed design, switch to Proposed first.

- **glTF (.glb)**, in metres: in SketchUp, File > Import and choose the glTF file. Each level is
  a group holding its walls, floor, roofs (with their fascia), windows and doors; a `Site` group
  holds the `Terrain`, `Chimney` and `Post` meshes. Walls are named by kind and phase.
- **OBJ (.obj)**, in inches: when importing, set the units to inches.
- Siding textures are not exported, colours are.

## Keyboard shortcuts

Press `?` in the app for the full list (it is generated from the same table the shortcuts run
from). Shortcuts do nothing while you type in a field; Enter in a field commits it and hands the
keyboard back to the plan.

| Keys | Action |
| --- | --- |
| `S` `W` `R` `D` `N` `P` `T` `K` `U` | Select, Wall, Room, Door, Window, Passage, Stairs, Roof, Underlay |
| `E` `C` (Site tab only) | Grade point, Column (chimney; Tab before the click for a post) |
| digits, `'`, `"`, space, `/`, then Enter | Type a length or a distance while drawing |
| `Enter` or click | Walls: with nothing typed, commit the wall at the cursor; roof: close the outline |
| `Backspace` | Edit the typed length; roof: remove the last corner |
| `Esc` | Clear the typed length, then end the wall chain / cancel the roof / clear the selection |
| `X` | Next wall exterior or interior |
| `Shift` (hold) | Invert ortho lock; with ortho off, 15° steps |
| `Tab` / `Shift+Tab` | Door swing side / hinge; stairs turn 90°; column chimney or post |
| `Delete` | Delete the selection |
| `Enter` / `F2` | Rename the selected room |
| `Arrows` (`Shift`) | Nudge the selected underlay 1" (1') |
| `1` `2` `3` | Levels, bottom to top |
| `V` | Cycle view: Existing, Proposed, All |
| `O` / `G` | Ortho lock / grid |
| `[` / `]` | Narrow window (under 900 px): show or hide the level bar / the properties panel |
| `Z` or `Home` | Zoom the plan to fit (also the Fit button) |
| `` ` `` | Cycle layout: 2D, Split, 3D |
| `F` | Walk mode (Split or 3D layout) |
| `W` `A` `S` `D` / arrows, `Q` `E`, `Esc` | Walk: move (Shift: faster), change level, back to orbit |
| Space + drag, middle drag, wheel | Pan and zoom the plan |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` | Undo, redo |
| `Ctrl/Cmd+S`, `Ctrl/Cmd+O` | Save a copy, open a file |
| `?` | Keyboard help |

## Files and saving

The plan is saved automatically in your browser (IndexedDB) after every change, and comes back
when you reopen the page in the same browser. That copy lives only in that browser profile:
clearing site data removes it, and if the browser's storage is full the status bar says
"Autosave failed". Use **Save** (Ctrl+S) to download the plan as a `.json` file and keep it
somewhere safe; **Open** (Ctrl+O) loads one back, replacing the current plan (and its undo
history). **Open example** loads the 146 Mick Road starter plan the same way. **New** and **Open
example** ask before discarding a plan that has walls, roofs or site elements.

The file is plain JSON with a `schemaVersion`; lengths are inches. Older files are upgraded on
open, and unknown fields are dropped. Underlay images are stored inside the file (downscaled),
so a plan with photos can be a few megabytes.

## Modelling 146 Mick Road

`docs/examples/146-mick-road.json` is a starter plan of the owner's house, made from the site
sketch and nine photos (`docs/photos/`) so that the 3D model already reads as the same house:
the gable roof with deep eaves, the east wing with its own gable, the screened and entry porches
with their roofs and posts, the brick chimney, shingle below and clapboard above, the multi-lite
windows, the green shutters and the walkout basement on the lake side. It is a **starter, not a
survey**: only two things in it are measured, the main block's 26.5' x 25.5' outside size (from
the sketch) and the wall thickness defaults. Everything else is an estimate from the photos, and
every room name that depends on one says "(est.)" or "not measured". The plan's name says so too.

Open it with **Open example**. Replace the estimates one by one with tape measurements, in the
order below, then draw the renovation on top.

### How the starter was built

`scripts/example-plan.ts` builds it through the editor's own store actions (`addWall`,
`addOpening`, `addRoof`, `addColumn`, `addGradePoint`, so every wall passes through the same
joining, clamping and validation as a wall you draw), and `npm run build:example` writes the JSON.
The script is the readable record of every number: read it before changing the file, edit the
script rather than the JSON for bulk changes, and run `npm test` (a test checks the file against
the script). Coordinates: plan x east, y south (down the screen), inches; north is the road side
and the plan's north angle is 0.

- **Levels**: Basement (wall height 90", slab 4"), First Floor (96", 12"), Second Floor (96",
  12"); the basement floor is at -100" so that the road side meets the first floor and the lake
  side falls to the basement floor.
- **Main block**, on all three levels: outside faces x 0 to 318, y 0 to 306. The wall
  centerlines are placed 3 1/4" inside those faces by hand, which is what "Lengths to: outside
  face" does for you when you draw. Exterior walls 6 1/2"; the basement's concrete-block walls are
  8", plain grey (`#8a8580`). First Floor shingle, Second Floor clapboard on the south and east
  faces and shingle on the north and west faces (photos 1, 3, 6 and 8), all `#5a3a35`.
- **East wing**, First Floor over a walkout basement bump, flush with the south face, with its own
  gable roof (ridge east-west) and the double door below it.
- **Screened porch** (screen walls, shed roof sloping north) and **entry porch** (open: two posts,
  a gable facing west, the entry door in the house wall behind it) on the west face, the screened
  part reaching 4' north of the north wall, as photos 6, 7 and 8 show.
- **Main roof**: gable over the Second Floor, ridge east-west, 8:12, 24" overhang, metal
  `#6e6259`. **Chimney** against the north wall, centred.
- **Windows and doors** on the four faces, each with lites; shutters on the two west windows.
- **Terrain**: thirteen grade points, see below.
- No interior partitions and no stairs: those are the next job (below).
- Not modelled: the deck and its stairs, the concrete retaining wall, the lot, the entry porch
  floor and steps, the foundation under the wing and porches (the ground meets them where the
  grade points say it does).

### Check the sides first

With the lake to the south and the road to the north, east is on your left when you stand on
the road and look at the house. Photos 1 and 9 (from the lake) and photo 6 (from the road) put
the wing and its roof on the **east** side, and photos 7 and 8 put the entry porch with the
number 146 and the shuttered window on the **west** face. The owner's sketch agrees once you
read it with north at the bottom: its top-left extension is the south-east wing and its small
box on the right is the north-west porch. The starter follows that. If your own measuring says
otherwise, mirror the plan (the `x` coordinates in the script) before you refine it.

### What to replace with measurements

Dimensions are inches; feet are given where that is how you will measure them. "Position" is
from the main block's outside corners (north-west corner = 0, 0).

| What | Starter value (estimate) | Measure |
| --- | --- | --- |
| Wall thickness, exterior | 6 1/2" | At a door jamb |
| Basement wall thickness | 8" (block) | At the basement door jamb |
| Wall heights | basement 90", first 96", second 96" | Floor to floor, minus the framing |
| Floor thickness | basement slab 4", floors 12" | Joists plus subfloor, at a stair opening |
| First-floor height above the basement floor | basement floor -100", first floor top +2" | Basement floor to first floor |
| East wing size and place | 12' east-west x 10' north-south, flush with the south face | Outside, at the foundation |
| Wing north wall | 10' from the south face (y 186") | From the south-east corner |
| Screened porch | 8' deep x 8' long, 4' north of the north wall | Outside faces, at the floor |
| Entry porch | 6' deep x 8' long, starts 8" south of the screened porch | Outside faces, at the floor |
| Entry door | 36 x 80, centred 8'-8" from the north corner (y 104") | Jamb to the corner |
| Chimney | 24 x 40, centred on the north wall (x 159") | Width, projection, position |
| South windows, first floor | 140 x 60 at x 105" and 96 x 60 at x 260" (6 x 2 lites), sill 30 | Jamb to corner, rough opening |
| South windows, second floor | 88 x 48 at x 115" and 64 x 48 at x 256" (6 x 3 lites), sill 30 | Same |
| West windows | first floor 96 x 48, sill 30, shutters; second floor 48 x 36, sill 36, shutters; both at y 204" | Jamb to the north corner |
| North windows | first floor 72 x 48 at x 96" and 48 x 36 at x 234"; second floor 48 x 40 at x 78" and x 240" | Jamb to the west corner |
| East windows | second floor two 48 x 40 at y 96" and y 216"; first floor 36 x 40 at y 150" | Jamb to the north corner |
| Wing windows | east end 60 x 48; north face 48 x 40; south face 36 x 36 | Rough openings |
| Basement double door | 60 x 80 on the wing's south wall | Jamb to jamb |
| Roof pitches | main 8:12, wing 8:12, screened porch 3:12, entry porch 6:12 | A level and a tape against the rafter or the gable |
| Roof overhangs | main 24", wing 18", porches 12" | Eave to the wall face |
| Roof thickness, fascia | 8", 6" | Fascia board |
| Grade points | see below | Spot levels from the floor top down |

Grade points (absolute elevation in inches; the first floor top is +2", the basement floor -100"):
north corners of the main block -4, north-west of the screened porch -4, middle of the north wall
-4, middle of the west wall -8, south-west corner -14, south-east corner -88, the wing's south-east
corner -100 and north-east corner -70, a point 10' south of the south wall at its middle -100 and
another 10' south of the wing -100 (the terrace in front of the doors), and two points 30' north of
the house at +6 (the road is slightly higher). Measure them down from the first-floor sill with a
level and a tape or a laser, and edit them in the Site tab.

### The order to measure in

1. **The exterior perimeter and the wall thickness first.** Outside, at the foundation or the
   first-floor sill, corner to corner; thickness at a jamb. Set "Lengths to: outside face". Fix the
   main block if it is not square, then the basement walls.
2. **The wing and the porches**, outside faces: size, where each starts, and where its roof
   meets the wall. Move their walls by selecting the walls and typing positions in the panel; drag
   the roof outline's corners to match, or press "Fit to walls".
3. **The windows and doors, by jamb distance** from the nearer corner's inside face to the near
   edge, then rough width, height and sill. The starter's positions are centres from photos; the
   panel's "From start" / "From end" fields take your tape numbers.
4. **The roofs and the chimney**: pitch, overhang, ridge position; the chimney's width and
   projection; the grade points last.
5. **Interior partitions and stairs**, room by room, face to face: `X` for interior walls, `T` for
   stairs, `R` to name the rooms (delete the "unpartitioned" and "interior not measured" labels as you go).

### Drawing the renovation on top of it

Set the view to **All** and **Draw as: new**, then:

- **The extension above the walkout basement.** On the First Floor, draw the new walls over the
  basement terrace in front of the walkout doors, as *new*: their outside faces on the basement's
  outside faces, joining the house at T junctions, then add a roof (`K`, still *new*) with its
  own pitch and overhang. Windows and doors in those walls are *new* too. Where the new wall
  replaces an existing wall or window, select the old one and **Mark demolish**.
- **The porch.** Select the existing porch roof and both posts, **Mark demolish**. Draw the larger
  porch as new: posts (Site tab, `C`, Tab for a post, with Draw as *new*), its roof, and any
  walls. The entry door stays unless you change it.
- **The garage.** From the sketch: 24' x 26', 55' west of the house and 20' from the road. Draw its
  walls on the First Floor as *new*, outside the house (the retaining walls themselves are not
  modelled).

Existing then shows the house as it stands with the demolished porch and no extension; Proposed shows
the extension and the new porch only; All shows both, the demolished parts dashed red and the new
parts green. Export from Existing and from Proposed to give the contractor or SketchUp each state.

## Known limitations

- **Roofs**: no valleys or dormers; roofs that meet (a wing roof running into the main wall,
  porch roofs) simply overlap, and the walls only follow the roofs on their own level. A hip roof
  over an L-shaped outline uses the bounding box of the outline. Overhangs are the same on every
  edge of a roof.
- **Not drawn yet**: decks and railings, exterior stairs, retaining walls, the lot outline, porch
  floors and steps, foundations under additions and porches, gutters, cabinets, fixtures,
  furniture, and text or dimension notes you place yourself.
- **Walk mode has no collision**: you can walk through walls and the ground.
- The terrain is the average of your grade points, weighted by distance; it does not cut away for
  the basement, so the ground shows through basement openings.
- A wall has one thickness; layered walls (siding, sheathing, studs, drywall) are not modeled, and
  both faces of an exterior wall show the siding.
- At most one wall between two corners, and walls are straight (no curved walls).
- "Lengths to" inside/outside assumes square corners; at other angles a typed length is
  measured along the centerline.
- Dimensions on the plan are centerline lengths of each wall piece; face-to-face sizes are in
  the room's properties.
- Openings are rectangular holes with a fixed frame and sash design; arched or bay windows are
  not modeled.
