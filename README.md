# HomePlan

HomePlan is a browser floor-plan editor for one job: getting the house you live in onto the
screen from tape measurements, then drawing the changes you want (moved walls, an addition, a new
porch) and seeing them in 3D. You type wall lengths the way a tape gives them (`12'6`, `150`,
`6 1/2"`), walls join and split themselves, rooms are found and measured automatically, and the
house stands up in 3D with its roofs, the ground it sits on, siding, windows and doors. A kitchen
is laid out with cabinets, counters and appliances. The model exports to SketchUp. It is a focused
tool, not a Home Designer Pro clone: no furniture or construction drawings. Everything runs in your
browser; nothing is uploaded.

What it draws:

- **Walls, openings, rooms, stairs** on any number of levels (Basement, First Floor and Second
  Floor to start), with the three levels stacked in 3D and a faint ghost of the level below.
- **Roofs** (gable, shed, hip, flat) with overhangs, fascia and rake boards or open eaves with
  rafter tails; walls under a roof rise to meet it, so a gable end is a triangle.
- **The site**: spot elevations of the ground (grade points) become a terrain surface, so a walkout
  basement shows on the downhill side and is buried on the uphill side; **chimneys and posts**
  stand on it, a chimney with its cap and spark arrestor if it has them.
- **Exterior appearance**: clapboard, shingle, board, concrete block or screen siding in any
  colour; windows of one or more sashes with divided lites, picture windows, screens, trim and
  shutters; doors with panels or glass, double doors and screen doors; corrugated metal roofs that
  rust; a brick chimney in any colour.
- **Kitchens**: base, wall and tall cabinets, islands, sinks, ranges, fridges, dishwashers, wall
  ovens, hoods and microwaves placed along the walls, with one counter top running over each run
  of cabinets; slab or panel fronts in any colour.
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
   type its name, Enter. The label sits where you clicked and stays where you drag it (one left
   outside the room's floor moves to the middle of the room's widest part). Select a room label:
   the panel shows its net area and its sides
   measured face to face (width x depth for a rectangular room). If a number disagrees with
   your notes, fix the wall that is off rather than the room.
8. **Copy the walls to the next level and adjust.** Click the level tab (or press `3` for the
   top level, `1` for the bottom) and use "Copy walls from level below", then move, delete or
   add walls (walls that would land on top of walls already there are skipped, and the status
   bar says how many). Stairs (`T`) go on the lower level and cut the floor above where the
   headroom over the treads would be under 80": the opening starts at run x (floor to floor -
   80") / floor to floor up the flight (the stair's properties change the headroom or set the
   start).
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
- **Eaves, boards and rust.** "Eaves" is a fascia board along the eaves, or open with the rafter
  tails showing under the overhang (set their depth and spacing; 5 1/2" every 24" by default); the
  rake boards up the gables stay either way. "Board colour" paints the fascia, the rake boards and
  the rafter tails (tan by default; Default resets it). A metal roof is corrugated sheet, and its
  "Weathering" (0 to 1) sets how much rust streaks it.
- **The site (the Site tab under the lowest level).** Grade points (`E`) are spot elevations of
  the ground: click a spot and type its elevation (`-4`, `-6'4`; absolute, like the floor tops
  shown in the level bar). The terrain is smoothed between them. Put one at each house corner
  and a few out where the ground levels off. A chimney or a post (`C`; Tab switches kind) stands
  on the ground with its base and top set in the panel, in its "Colour" (brick red for a chimney,
  tan for a post until you set one). A chimney is drawn as brick in its colour; tick "Cap and spark
  arrestor" for a 4" concrete cap at its top, 2" proud of its faces, and a 12" wire box on the cap
  (in the export they are two more `Chimney` meshes). The north arrow turns with the plan's north
  angle, and the sun follows it.
- **Finishes.** The Level panel's "Exterior finish" and "Exterior colour" set every exterior
  wall of the level at once; the Wall panel sets one wall: shingle, clapboard, vertical board,
  concrete block (for a foundation), plain or screen. The siding, brick and roof textures are in
  the 3D view only: the export carries their colours.
- **Windows and doors.** A window's panel sets its "Sashes" (1 to 6 side by side with 2" mullions
  between them; the lites, cols x rows, are per sash), "Fixed centre pane" (at 3 sashes: a picture
  window, one undivided pane between two casements at most 24" wide), "Glazing" (glass, or an
  insect screen in a light frame), the trim width (0 for none) and shutters (one sash wide). A
  door's panel sets its "Leaves" (2 for a double door), the glazed lites per leaf (1 x 1 is a solid
  panel), "Half lite" (the lites in the upper part, two panels below), "Glazing" (a screen door:
  screen above and below a mid rail) and the "Leaf colour".
- **Walls run through the floors.** An exterior wall on a level with a level above it is taller by
  that level's floor thickness, and the floor slab stops at the inside face of the wall, the way a
  platform-framed house is built, so the siding is continuous from one storey to the next.
- **Elevations.** The 3D bar's **N**, **S**, **E** and **W** buttons show each side straight on,
  and the Export menu saves all four as images (see "3D and walk mode" and "Export to SketchUp").

## Kitchens: cabinets, counters and appliances

Press `C`. The properties panel shows the kind the next click places (base cabinet, wall cabinet,
tall cabinet, island, sink, range, fridge, dishwasher, wall oven, hood, microwave, or a labelled
box); pick one there. Then:

- **Point along a wall.** The cabinet follows the cursor with its back on the nearest wall face and
  its front facing into the room. Click to place it at its stock size (a base cabinet is 36" wide,
  24" deep, 34 1/2" high; a wall cabinet 30 x 12 x 30 with its bottom at 54"). The next one slides
  up to the end of the last when you aim near it, so a run is placed by clicking along the wall.
- **Type a width first** (`30`, `2'6`) to place a narrower or wider one; Enter also places it. Esc
  clears what you typed.
- **Hold Shift** to place away from the walls (an island; the cursor is then its middle) and press
  Tab to turn it.
- **Counters** are drawn by themselves: one top over each run of touching base cabinets, the sink
  and the dishwasher, 1" past their fronts, mitred where a run turns a corner, cut out at the sink.
  An island has a counter 1" all round. The counter is 1 1/2" thick on top of the cabinets.
- **Select a cabinet** (`S`, click it) to change its kind, width, depth, height, bottom, facing,
  phase, label, fronts (slab or framed panel), front colour and counter overhangs; drag it to move
  it, Shift+click to select several and move them together. Delete removes it. The Level panel sets
  the cabinet colour, counter colour and front style every cabinet on the level uses unless it has
  its own.
- On the plan, cabinets are outlined with a heavier front edge and a tick where two doors meet;
  wall cabinets, hoods and microwaves are dashed; appliances carry a word (REF, RANGE, DW, OVEN); a
  range shows its burners and a sink its basin. In 3D they are painted boxes with doors, drawer
  fronts and toe kicks, steel appliances, and the counter in its colour.

Cabinets follow the phases like walls: draw the new kitchen as *new*, mark the old cabinets
*demolish*, and the Existing, Proposed and All views show each state.

## Planning the renovation

1. Switch the view to **All** (the toolbar, or `V` to cycle). All shows existing walls in grey,
   walls to demolish in dashed red and new walls in green.
2. Set **Draw as: new**. Everything you draw from now on is new work: new walls, roofs and posts,
   the addition (start its walls on the existing exterior wall so they join as T junctions),
   new doors.
3. To remove something, select it and click **Mark demolish**. That works for walls, doors,
   windows, stairs, roofs, cabinets, chimneys and posts; a window that becomes a door is a
   demolished window plus a new door. To take out part of a wall (open a kitchen to the living
   room), right-click the wall with the select tool and choose **Split wall here**, then mark the
   piece you want gone.
4. Flip between **Existing** (what is there, with the demolition shown) and **Proposed** (what
   it will be). Rooms are found per view, so in Proposed two rooms whose dividing wall is
   demolished become one, with its new net area. Roofs and posts follow the view too, and walls
   rise to a roof only in the views where that roof is shown.

## Editing walls

- **Move a wall by a distance.** Select the wall; in the properties panel type the distance in
  **Move** and click the side to move it to ("toward Living" / "toward Kitchen", named after the
  rooms either side). The walls at its ends stretch or shorten so they stay attached and straight
  (corners stay square), walls running straight on from it move with it, and windows and doors
  keep their place along it. The status bar then gives both rooms' new net sizes. `Shift` + an
  arrow key moves the selected walls 1" that way. A move that would put a wall on top of another,
  or a corner whose walls meet at odd angles, is refused with a message. Roofs do not follow.
- **Draw a box (`B`).** For a room, an addition or a garage: click a corner (it snaps like the
  wall tool, including the corners of the level below), move the mouse toward where the box goes,
  type the two sizes, `12' x 10'` (or `12' by 10'`, or `12'` Tab `10'`) and Enter; or click the
  opposite corner. "Lengths to" applies: with inside face the room inside is exactly the typed
  size. A side that lies along a wall already there reuses that wall. One undo step.
- **Measure (`M`).** Click two points (the corners of wall faces snap, so inside corners measure
  the room); the overlay shows the distance with its x and y parts, and the status bar keeps
  "Measured 12'-6" (dx 10'-0", dy 7'-6")" until Esc. Dragging a wall or a corner with the select
  tool shows how far it has moved in the status bar.
- **Selecting a wall where a window is.** A click inside a window's or door's own opening selects
  it; anywhere else on the wall selects the wall. Click a selected opening again to select its
  wall.
- **Split a wall.** Right-click a wall with the select tool and choose **Split wall here**: a corner
  goes in at that point and the wall becomes two pieces, each selectable on its own (to demolish
  one, or move it). A split inside a door or window is refused; move the opening first.

## 3D and walk mode

The **Split** and **3D** layouts (or the backtick key) show the model, built from the plan and
updated as you edit. Drag to orbit, right-drag to pan, scroll to zoom, **Fit 3D** to frame it.
The checkboxes hide levels. **Walk** (or `F`) drops you in at eye height just inside the level's
entry door (the first door in an outside wall), looking into the house; on a level without one, in
the middle of the house. To start somewhere else, right-click that spot in the 2D plan (select
tool) and choose **Walk from here** ("Clear walk start" goes back to the door). Click the view to
look with the mouse, WASD or the arrows to move, Shift to go faster, Q/E to change level, Esc to
leave. Walls are not solid in walk mode.

**N**, **S**, **E** and **W** in the 3D bar show an elevation: a straight-on view of that side of
the house, without perspective, framed to fill the view and lit from over your left shoulder, so
the eaves and window frames throw their shadows down the wall. The sides are the plan's: north is
the top of the plan. Drag to pan (either button), scroll to zoom, and click the side again or
**Fit 3D** to frame it again. The ground is cut just in front of you, so what is below grade stays
hidden. **Perspective** goes back to orbiting where you left off; a walk started from an elevation
also comes back to perspective.

## Export to SketchUp

**Export** makes a 3D file of exactly what the 3D view shows (the current view mode and the
visible levels): to export the proposed design, switch to Proposed first.

- **glTF (.glb)**, in metres: in SketchUp, File > Import and choose the glTF file. Each level is
  a group holding its walls, floor, roofs (with their fascia), windows and doors, cabinets
  (`Cabinet (base)`, `Appliance (range)`, `Sink`, ...) and `Counter` slabs; a `Site` group holds the
  `Terrain`, `Chimney` and `Post` meshes. Walls are named by kind and phase.
- **OBJ (.obj)**, in inches: when importing, set the units to inches.
- Siding textures are not exported, colours are.
- **Elevations (.png)**: **Export elevations** saves the north, south, east and west elevations as
  four images (`<plan name>-north-elevation.png` and so on), rendered as the elevation buttons show
  them, with shadows and siding textures, at twice the 3D view's resolution. It needs the 3D view
  open (Split or 3D layout), and the browser may ask once to allow several downloads. They are
  pictures, not scaled drawings.

## Share a viewer

`npm run build:viewer` makes `dist-viewer/146-mick-road-viewer.html`: one self-contained HTML
file (about 1.6 MB, no network access needed) that shows the house in 3D (drag or one finger to
orbit, two fingers to pinch and pan, level checkboxes, the four elevations, Fit) and the plan of
each level (pinch or scroll to zoom, drag to pan, double-tap to reset), with no editing. Put it on
any static host and send the link, or send the file; on an iPad, open the link in Safari (Mail's
and Files' previews of an HTML attachment do not run its script). To bake another plan in, save
it from the editor and run `node scripts/build-viewer.mjs that-plan.json` after the build.

A built copy of the starter's viewer is kept at `docs/viewer/146-mick-road-viewer.html` so it can
be downloaded from GitHub (the download button on the file's page) and passed on by AirDrop or
mail; rebuild and copy it over after changing the starter.

## Export the plan

**Export > Export plan (.svg)** saves the active level's 2D plan as a drawing for a contractor or a
permit: the walls, openings, rooms with their names and areas, dimension labels, stairs and roofs
exactly as the plan shows them in the current view mode (switch to Proposed or Existing first),
without the selection or the image underlay, at 1/4" = 1'-0" (96 dpi), with a title block (plan
name, level, view, scale, date, a scale bar and a north arrow). The SVG prints at that scale and
opens in a browser or a drawing program. **Export plan (.png)** is the same drawing as an image at
twice the resolution (48 pixels per foot).

## Keyboard shortcuts

Press `?` in the app for the full list (it is generated from the same table the shortcuts run
from). Shortcuts do nothing while you type in a field; Enter in a field commits it and hands the
keyboard back to the plan.

| Keys | Action |
| --- | --- |
| `S` `W` `R` `D` `N` `P` `T` `K` `U` | Select, Wall, Room, Door, Window, Passage, Stairs, Roof, Underlay |
| `C` | Cabinet: the chosen kind follows the cursor along the nearest wall; click to place, type a width first to change it (Site tab: Column) |
| `B` | Box: four walls; click a corner, type `12' x 10'` (or `12'` Tab `10'`), Enter |
| `M` | Measure between two points; Esc clears |
| `E` `C` (Site tab only) | Grade point, Column (chimney; Tab before the click for a post) |
| digits, `'`, `"`, space, `/`, then Enter | Type a length or a distance while drawing |
| `Enter` or click | Walls: with nothing typed, commit the wall at the cursor; roof: close the outline |
| `Backspace` | Edit the typed length; roof: remove the last corner |
| `Esc` | Clear the typed length, then end the wall chain / cancel the roof / clear the selection |
| `X` | Next wall exterior or interior |
| `Shift` (hold) | Invert ortho lock; with ortho off, 15° steps; cabinet: place away from the walls |
| `Tab` / `Shift+Tab` | Door swing side / hinge; stairs and free cabinets turn 90°; column chimney or post |
| `Delete` | Delete the selection |
| `Enter` / `F2` | Rename the selected room |
| `Arrows` (`Shift`) | Nudge the selected underlay 1" (1') |
| `Shift` + arrows | Move the selected walls 1" across, the way the arrow points |
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
sketch, the owner's floor sketches and nine photos (`docs/photos/`) so that the 3D model already reads as the same house:
the gable roof with deep open eaves and rafter tails under rusting corrugated metal, the east wing
with its own gable, the screened entry porch with its knee walls and west-facing gable, the chimney
stained like the house with its cap and spark arrestor, shingle below and clapboard above, the
casement and picture windows, the green shutters, and the walkout basement on the lake side, grey
block with vertical boards round its double door. It is a **starter, not a survey**. Both floors'
interiors come from the owner's tape and sketches (face to face): the First Floor's rooms, 5"
partitions and stair, and the Second Floor's rooms and partitions. The exterior
wall thickness (7") and the outside size are derived from those measurements. Everything else (the
basement, the windows, the roofs, the porch, the terrain) is an estimate from the photos, and every
room name that depends on one says "(est.)" or "not measured". A room name that says "adjusted"
is a measurement that disagreed with a neighbour and was changed to make the house close (see
below). The plan's name says so too.

Open it with **Open example**. Replace the estimates one by one with tape measurements, in the
order below. The owner's proposed design is already drawn on top as new and demolished work (see
"The proposed design in the starter"): the Existing view shows the house as it stands.

### How the starter was built

`scripts/example-plan.ts` builds it through the editor's own store actions (`addWall`,
`addOpening`, `addRoof`, `addColumn`, `addGradePoint`; the kitchen's cabinets are not in it, the
existing ones have not been measured, so every level's `fixtures` is empty), so every wall passes through the same
joining, clamping and validation as a wall you draw), and `npm run build:example` writes the JSON.
The script is the readable record of every number: read it before changing the file, edit the
script rather than the JSON for bulk changes, and run `npm test` (a test checks the file against
the script). Coordinates: plan x east, y south (down the screen), inches; north is the road side
and the plan's north angle is 0.

- **Levels**: Basement (wall height 90", slab 4"), First Floor (96", 12"), Second Floor (96",
  12"); the basement floor is at -100" so that the road side meets the first floor and the lake
  side falls to the basement floor.
- **Main block**, on all three levels: outside faces x 0 to 318 (26'6"), y 0 to 315 (26'3"). The wall
  centerlines are placed 3 1/2" inside those faces by hand, which is what "Lengths to: outside
  face" does for you when you draw. Exterior walls 7"; the basement's walls are 8" grey concrete
  block (`#8f8a84`, photos 1 and 2). First Floor shingle, Second Floor clapboard on the south and
  east faces and shingle on the north and west faces (photos 1, 3, 6 and 8), all `#5a3a35`.
- **East wing** (the Utility), First Floor over a walkout basement bump, flush with the south face,
  interior 11'6" x 9'5" so outside x 318 to 463, y 188 to 315, with its own gable roof (ridge
  east-west). Below it the bump's south wall is vertical boards in the stain round a double door of
  two plain leaves in the stain, with no trim (photo 2).
- **Entry porch** on the west face at its north end, flush with the north face (photo 8, taken
  facing east; photos 6 and 7 show the same porch from the road): shingled walls with screens above
  a 36" knee wall in all four bays (the two narrow ones of the front either side of the entry, and
  its north and south sides), a screen door in line with the house door, and a gable facing west.
  The wall pieces between the openings stand in for the posts; the porch's openings have no trim,
  since those posts are only 3 1/2" wide.
- **Roofs**: the main gable over the Second Floor (ridge east-west, 6:12, 24" overhang), the wing's
  (7:12, 18") and the porch's (5:12, 18"). All are corrugated metal 2 1/2" thick with open eaves
  (rafter tails 5 1/2" deep every 24", photos 1, 2 and 7) and 7" rake boards, the tails and boards in
  the stain: weathered galvanized `#8a8378` on the main roof (weathering 0.6) and the porch (0.7),
  a darker, browner `#6e4b3c` on the wing (0.3, photo 3).
- **Chimney** against the north wall, centred: 24" along the wall and 20" out from it, stained
  like the house, with a concrete cap and a wire spark arrestor (photos 6 and 7).
- **Windows and doors** on the four faces, built from casement sashes with their lites (picture
  windows of a casement, a fixed pane and a casement on the south and west faces, photos 1 and 8),
  shutters on the two west windows, and the house door dark green with nine lites over two panels.
- **Terrain**: nineteen grade points, see below.
- **The two floors share three north-south bands** (inside faces, from the north wall): the north
  band y 7 to 97 (7'6"), a 5" wall (centerline y 99.5), the stair strip y 102 to 135 (2'9"), a 5"
  wall (centerline y 137.5), and the south band y 140 to 308. The north-south inside length is 301",
  which is the upstairs west side (Bunk 90 + 5 + strip 33 + 5 + Master 168).
- **First Floor interior** (measured, face to face; partitions 5", existing): the y 99.5 line from
  the east wall to the west wall (the Kitchen's north wall and the hall's south wall) with a 36"
  passage at x 132 to 168; the Kitchen/Living partition (x 170.5) with a 48" passage (y 188 to
  236, south jamb 6' from the lake wall); the Bath's west wall (x 194.5) with a 30" x 80" door;
  and the stair's south wall (y 137.5) with a 36" passage at x 132 to 168 and a 30" opening at
  x 7 to 37 (the stair's bottom, from Living). The stair climbs **east** from the west wall's
  inside face (x 7) to x 132, 33" wide (the whole 2'9" strip), under the Second Floor's landing,
  and cuts the Second Floor's floor from 32" up the run (where the headroom drops under 80"), so the
  Master closet over its low end keeps its floor. Rooms, east-west x north-south: Entry hall 15'5" x 7'6",
  Bath 9'6" x 7'6", Kitchen 11'6" x 17'2" (adjusted, see below), Living 13'5" x 14'0", Stair
  13'5" x 2'9" (the strip), Utility 11'6" x 9'5". There are **no open wall ends** on this floor.
- **Second Floor interior** (the owner's sketch, face to face; partitions 5", existing): the Bunk's
  south wall (y 99.5) and east wall (x 171.5), the Master's north wall (y 137.5) and the
  Master/Guest partition (x 171.5), the closet's east wall (x 39.5), the Bath's east (x 220.5) and
  south (y 83.5) walls, and the Guest's north wall (y 152.5). The x 171.5 line has a gap at y 102
  to 135: the landing (x 131 to 169) opens east to the hall in front of the Bath and the Office.
  Doors: Bunk 28" and Master 28" (centred x 150, off the landing, swinging into the Bunk and the
  Master), Bath 24" (centred x 196, swinging out into the hall), Guest 30" (centred x 196,
  swinging into the Guest); the Master closet is a 24" opening (centred x 22). Rooms: Bunk
  13'6" x 7'6", Bath 3'8" x 6'2", Master closet 2'6" x 2'9", Master 13'6" x 14'0", Guest 11'5" x
  12'9" (adjusted), Office / hall 7'4" x 11'11" (adjusted). The Office / hall is one face with the
  landing and the stair well, with no wall between them, so its net bounding box is wide
  (x 42 to 311) and its panel lists the sides of the L. Also no open wall ends.
- **Basement**: no partitions yet. The main block is one area ("Basement (unpartitioned, est.)")
  and the walkout bump under the wing is labelled separately as "Utility (below)": it is closed off
  from the main block by the block's east wall in the starter, and stays a separate space until you
  measure how the two connect (delete or move the wall and the labels as you go).
- Not modelled: the deck and its stairs, the concrete retaining wall, the lot, the entry porch
  floor and steps, the foundation under the wing and porches (the ground meets them where the
  grade points say it does).

### Check the sides first

With the lake to the south and the road to the north, east is on your left when you stand on
the road and look at the house. Photos 1 and 9 (from the lake) and photo 6 (from the road) put
the wing and its roof on the **east** side, and photos 7 and 8 put the entry porch with the
number 146 and the shuttered window on the **west** face. The owner confirmed that photo 8 was
taken facing east (its left side is north) and that photo 3 shows the east face (its left side is south). The owner's sketch agrees once you
read it with north at the bottom: its top-left extension is the south-east wing and its small
box on the right is the north-west porch. The starter follows that. If your own measuring says
otherwise, mirror the plan (the `x` coordinates in the script) before you refine it.

### What to replace with measurements

Dimensions are inches; feet are given where that is how you will measure them. "Position" is
from the main block's outside corners (north-west corner = 0, 0).

| What | Starter value (estimate) | Measure |
| --- | --- | --- |
| Wall thickness, exterior | 7" (derived: the measured interior 11'6" + 5" + 13'5" = 25'4" against the sketch's 26'6" outside) | At a door jamb |
| Outside size of the main block | **26'6" x 26'3"** (derived: 25'4" inside east-west, 301" inside north-south from the upstairs west side, plus two 7" walls each way; the site sketch's 25.5' was rounded). **Worth one outside tape measurement** | Corner to corner, outside, at the first-floor sill |
| Basement wall thickness | 8" grey concrete block; vertical boards in the stain on the wing's south wall, round the walkout door (photo 2) | At the basement door jamb |
| First Floor rooms | measured, face to face: Entry hall 15'5" x 7'6", Bath 9'6" x 7'6", Living 13'5" x 14'0" (measured 14'1"), Utility 11'6" x 9'5" | Re-check any that look wrong |
| Kitchen | 11'6" x 17'2", **adjusted: re-measure.** MK measured 16'3"; the upstairs wins, and the first-floor mistake is suspected near the bottom of the stairs | Kitchen north-south, between the lake wall and the y 99.5 wall |
| Interior partition thickness | 5" (measured) | At a jamb |
| Stair | 33" wide, 125" run climbing east from the west wall to x 132 (under the upstairs landing), cuts the Second Floor floor from 32" up the run (80" headroom); the 2'9" strip | Width, run, riser count |
| Bath door (First Floor) | 30" x 80" in the Bath's west wall, north jamb 6" from the north wall's inside face (y 13 to 43); **position is an estimate** | Jamb to the north wall |
| Kitchen/Living passage | 48" wide, south jamb 6' from the lake wall (y 188 to 236), sill 0, 80" high | Jamb to jamb |
| Hall and Living passages | 36" wide at x 132 to 168 in the y 99.5 line and the y 137.5 wall; 30" opening at x 7 to 37 (the stair's bottom, from Living) | Jamb to jamb |
| Second Floor rooms | Bunk 13'6" x 7'6", Bath 3'8" x 6'2", Master closet 2'6" x 2'9", Master 13'6" x 14'0" (sketch) | Face to face |
| Guest | 11'5" x 12'9", **adjusted:** MK measured 11'8" east-west; the north side adds up to Bath 3'8" + 5" + Office 7'4" = 11'5", so the Guest takes 3" less | Guest east-west, between the Master/Guest partition and the east wall |
| Office / hall | 7'4" x 11'11", **adjusted:** MK measured 11'6" north-south; the 301" inside length less the Guest's 12'9" and a 5" wall leaves 11'11" | North wall to the Guest's north wall, at the east wall |
| Second Floor doors | Bunk 28" and Master 28" (x 150), Bath 24" and Guest 30" (x 196, swing directions from the sketch), closet opening 24" (x 22); **positions are estimates** | Jamb to jamb |
| Wall heights | basement 90", first 96", second 96" | Floor to floor, minus the framing |
| Floor thickness | basement slab 4", floors 12" | Joists plus subfloor, at a stair opening |
| First-floor height above the basement floor | basement floor -100", first floor top +2" | Basement floor to first floor |
| East wing (Utility) size and place | interior 11'6" x 9'5" (measured), so 12'1" outside east-west past the main wall and 10'7" north-south, flush with the south face | Outside, at the foundation |
| Wing north wall | y 188" (10'7" from the south face) | From the south-east corner |
| Entry porch | 5'-6" out x 8' along the wall, flush with the north face. **Photos 6 and 7 read 7' to 9' out**; the starter keeps 5'6" until it is measured | Outside faces, at the floor |
| Porch openings | knee walls 36"; screens 44" high above them in all four bays: the front's two 18" bays either side of the entry (y 17.5" and 78.5"), the north and south sides 44"; a 36" screen door at the entry, swinging out; no trim | Jamb to jamb, knee wall height |
| Entry door | 36 x 80, centred 4' from the north corner (y 48"), dark green, nine lites over two panels (photo 8) | Jamb to the corner |
| Chimney | 24" along the wall x 20" out (photos 6 and 7), centred on the north wall (x 159"), stained like the house; a 4" concrete cap and a 12" spark arrestor on top | Width, projection, position |
| South windows, first floor | picture windows of a casement (2 x 3 lites), a fixed pane and a casement (casements 24" wide): 144 x 60 at x 87.5" and 118 x 60 at x 242", sill 30; the jambs clear the Kitchen/Living partition's faces at x 168" and 173" (photo 1) | Jamb to corner, rough opening |
| South windows, second floor | four casements 88 x 46 at x 115" and three 66 x 46 at x 256", 2 x 3 lites each, sill 34 (photo 1) | Same |
| West windows | first floor 90 x 44 at y 203", sill 44 (head above the door head): a casement (2 x 3 lites), a fixed pane and a casement; second floor two casements of 2 x 2 lites, 48 x 32 at y 200", sill 48; both with shutters one casement wide (photo 8) | Jamb to the north corner |
| North windows | first floor three casements (2 x 3 lites) 80 x 56 at x 96", sill 30, west of the chimney, and two single panes 42 x 44 at x 234", sill 34; second floor two casements (2 x 3 lites) 46 x 44, sill 36, at x 78" and x 248" (was x 240", moved east so it clears the Bath's east wall and sits in the Office; its west jamb is 2" from that wall's face) (photos 6 and 7) | Jamb to the west corner |
| East windows | second floor two pairs of casements (2 x 3 lites) 46 x 44, sill 34, at y 98" and y 222"; first floor one casement (2 x 3 lites) 36 x 40, sill 42, at y 152" (photo 3) | Jamb to the north corner |
| Wing windows | pairs of casements (2 x 3 lites): east end 48 x 44 (photo 3), north face 48 x 40, south face 48 x 44 (photos 1 and 2), sill 30 | Rough openings |
| Basement double door | 72 x 80 on the wing's south wall, two plain leaves in the stain (photo 2) | Jamb to jamb |
| Roof pitches | main 6:12, wing 7:12, entry porch 5:12 (photos 3 and 8) | A level and a tape against the rafter or the gable |
| Roof overhangs | main 24", wing 18", entry porch 18" | Eave to the wall face |
| Roof thickness, eaves | 2 1/2" (corrugated sheet); open eaves, rafter tails 5 1/2" deep every 24" (photos 1 and 7); 7" rake boards | A rafter tail and the rake board |
| Grade points | see below | Spot levels from the floor top down |

Grade points (absolute elevation in inches; the first floor top is +2", the basement floor -100"):
five at +1 round the porch, whose floor is about at grade (its two outer corners, the middle of its
front and its two corners against the house, one of them the main block's north-west corner); the
main block's north-east corner -4, middle of the north wall -4, middle of the west wall -8,
south-west corner -14, south-east corner -88, the wing's south-east corner -100 and north-east
corner -20, a point 6' east of the main block's east wall -6, a point 10' south of the south wall at
its middle -100 and another 10' south of the wing -100 (the terrace in front of the doors), two at
the walkout's threshold (-100, 6" out from the wall at the double door's jambs), and two points 30'
north of the house at +6 (the road is slightly higher). Measure them down from the first-floor sill
with a level and a tape or a laser, and edit them in the Site tab.

### The order to measure in

1. **The exterior perimeter and the wall thickness first.** Outside, at the foundation or the
   first-floor sill, corner to corner; thickness at a jamb. Set "Lengths to: outside face". Fix the
   main block if it is not square, then the basement walls.
2. **The wing and the porch**, outside faces: size, where each starts, and where its roof
   meets the wall. Move their walls by selecting a wall and typing the distance in the panel's
   Move field (see "Editing walls"); drag
   the roof outline's corners to match, or press "Fit to walls".
3. **The windows and doors, by jamb distance** from the nearer corner's inside face to the near
   edge, then rough width, height and sill. The starter's positions are centres from photos; the
   panel's "From start" / "From end" fields take your tape numbers.
4. **The roofs and the chimney**: pitch, overhang, ridge position; the chimney's width and
   projection; the grade points last.
5. **Interior partitions and stairs**, room by room, face to face: `X` for interior walls, `T` for
   stairs, `R` to name the rooms. The First Floor and the Second Floor are done (re-measure the
   rooms marked "adjusted" first: the Kitchen, the Guest and the Office / hall, and the bottom of
   the stair); the basement is still to do (delete its "unpartitioned" label as you go).

### The proposed design in the starter

The starter also holds the owner's proposed design (his brief of 12 Oct 2026), drawn as *new* and
*demolish* work on the house as it stands (the second half of `scripts/example-plan.ts`,
`proposed()`; the plan is `docs/history/PLAN-v4-proposed.md`, with the places where the built
design differs from it). Five changes, all on the First Floor:

1. **Master suite.** The east wing grows north to the road corner at the same depth: one
   one-storey wing down the whole east side, outside 12'1" x 26'3", under one new gable roof with
   its ridge north-south. A 5" partition divides the master bath (north, 11'6" x 9'2 1/2" inside)
   from the master bedroom (11'6" x 15'5 1/2", the old Utility plus 6'). The bedroom door is in the
   main block's east wall, from the kitchen. The wing's north wall, its window and its roof, and the
   main block's first-floor east window, are demolished. New 8" block walls carry the new part
   (a crawl space).
2. **Kitchen.** The wall between the kitchen and the old bath is demolished, so the kitchen is an
   L round the old bath's area. The bath's door becomes a door from the hall.
3. **Stair and front door.** The old stair and the house door at the porch are demolished. The new
   house door (32", green) is in the west wall in the middle of the old stair strip. Inside, two
   risers go north to a 14" landing in the north-west corner, then the flight climbs east along
   the north wall to the Bunk's east wall upstairs, and cuts the Second Floor's floor from about
   19" up its run. The wall between the hall and the strip, west of the powder room, is demolished,
   so the hall, the strip and the stair are one room.
4. **Powder room**, 5' x 4'1", in the old hall south of the top of the flight, where the hall's
   passage to the strip was.
5. **Foyer and screen porch** on the west face in place of the entry porch: an enclosed foyer
   (7'10" x 8') with the 36" front door in line with the house door and a gable facing west, and
   south of it a screen porch (13'1" x 8') with screens above knee walls, two screen doors, three 8"
   timber posts in the stain and a shed roof high at the house wall. The Living's west window,
   which now looks into the porch, is replaced by the same window without shutters.

Which view to use:

- **Proposed** for the 3D view, the elevations, walk mode and exports of the house after the work.
- **Existing** for the house as it stands; the parts to be demolished show in translucent red.
- **All** to see both on the plan: demolished walls dashed red, new walls green. The demolished
  rooms keep their labels in the All view and the new labels sit beside them (the Utility and the
  master bedroom's new north part are two areas there).

Still open:

- The porch's size and roofline: MK's reference pictures may change them (estimated 8' out, the
  foyer's gable and the porch's shed overlap with no valley).
- How the bedroom is reached: its door opens from the kitchen, the only room beside it; a hall or a
  closet wall can be added later. The old bath's door now opens from the hall into a pocket
  between the top of the flight and the powder room: decide whether it stays.
- Upstairs: the Bunk becomes the stair hall and needs a new layout and a railing round the stair
  opening; neither is drawn.
- The knee braces and the timber truss in the foyer's gable are not modelled.
- Every new size is from the plan, not measured: check them on site before ordering anything.
- The garage from the site sketch (24' x 26', 55' west of the house and 20' from the road) is not
  drawn: on the First Floor, **Draw as: new**, the Box tool (`B`, `24' x 26'`, Enter).

To change the design, edit it in the app (select, move, **Mark demolish**, draw with **Draw as:
new**) or edit `proposed()` in the script and run `npm run build:example`.

## Known limitations

- **Roofs**: no valleys or dormers; roofs that meet (a wing roof running into the main wall,
  porch roofs, the starter's proposed foyer gable and porch shed) simply overlap, and the walls
  only follow the roofs on their own level. A roof's overhang on an edge against a wall runs into
  the house unless its outline stops short of the wall by the overhang. A hip roof
  over an L-shaped outline uses the bounding box of the outline. Overhangs are the same on every
  edge of a roof. Rafter tails are not cut round a chimney that stands in the eave: a tail can
  show a short stub on the chimney's face.
- **Not drawn yet**: decks and railings (a stair opening has no railing round it), exterior stairs, retaining walls, the lot outline, porch
  floors and steps, foundations under additions and porches, gutters, bathroom fixtures,
  furniture, and text or dimension notes you place yourself.
- **Cabinets** are boxes with simple fronts: no door swings on the plan, no backsplash, open
  shelves or corner cabinets (an inside corner is two cabinets whose counter is mitred), and a
  counter is only joined across cabinets turned by a quarter turn (a cabinet at 45° carries its
  own). Inside faces of walls still show the siding and floors are one colour (interior finishes
  are next).
- **Walk mode has no collision**: you can walk through walls and the ground.
- The terrain is the average of your grade points, weighted by distance. Under the lowest level's
  footprint (out to its walls' outside faces) it drops to 2" below that level's slab, so the
  basement is empty; the ground is not shaped any further around the house (no window wells,
  no foundation under a wing or porch that has no basement).
- A wall has one thickness; layered walls (siding, sheathing, studs, drywall) are not modeled, and
  both faces of an exterior wall show the siding.
- At most one wall between two corners, and walls are straight (no curved walls). A wall cannot
  be drawn on top of another one: to rebuild a wall, mark the old one *demolish* and draw the new
  one beside it.
- Moving a wall (by dragging or by a typed distance) does not move the roofs: adjust the roof's
  outline yourself.
- "Lengths to" inside/outside assumes square corners; at other angles a typed length is
  measured along the centerline.
- Dimensions on the plan are centerline lengths of each wall piece; face-to-face sizes are in
  the room's properties. Walls under 4' around a room under 60 sq ft (a closet) show no dimension
  on the plan, to keep the room's name readable; select the wall for its length.
- Openings are rectangular holes with a fixed frame and sash design; arched or bay windows are
  not modeled.
- The plan export (SVG or PNG) is one level per file at 1/4" = 1'-0"; there is no sheet layout
  with several levels. The elevations export as rendered images at the 3D view's size, not as
  dimensioned drawings to scale.
- A walk start picked with "Walk from here" lasts until you clear it or reload the page; it is not
  saved with the plan.
