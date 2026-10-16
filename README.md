# HomePlan

HomePlan is a browser floor-plan editor for one job: getting the house you live in onto the
screen from tape measurements, then drawing the changes you want (moved walls, an addition, a new
porch) and seeing them in 3D. You type wall lengths the way a tape gives them (`12'6`, `150`,
`6 1/2"`), walls join and split themselves, rooms are found and measured automatically, and the
house stands up in 3D with its roofs, the ground it sits on, siding, windows and doors. A kitchen
is laid out with cabinets, counters and appliances, and the rooms furnished. The model exports to
SketchUp. It is a focused tool, not a Home Designer Pro clone: no construction drawings. Everything
runs in your browser; nothing is uploaded.

What it draws:

- **Walls, openings, rooms, stairs** on any number of levels (Basement, First Floor and Second
  Floor to start), with the three levels stacked in 3D and a faint ghost of the level below.
- **Roofs** (gable, shed, hip, flat) with overhangs, fascia and rake boards or open eaves with
  rafter tails; walls under a roof rise to meet it, so a gable end is a triangle.
- **Decks** on posts down to the ground, with railings that open where a flight of stairs arrives.
- **Stair railings** on the open sides of a flight: newels, a handrail over the nosings, balusters.
- **Floor openings**: a hole in a floor, open to the level below (a double-height hall, a stair
  well), with a 36" guard round it that opens where a flight from below arrives.
- **The site**: spot elevations of the ground (grade points) become a terrain surface, so a walkout
  basement shows on the downhill side and is buried on the uphill side; **chimneys and posts**
  stand on it, a chimney with its cap and spark arrestor if it has them; a **flue** is a round
  stainless pipe (a wood stove's chimney) with a rain cap; **ground surfaces** (a gravel drive, an
  asphalt road, a concrete pad, flagstones) lie on it and **split-rail fences** follow it.
- **Exterior appearance**: clapboard, shingle, board, concrete block or screen siding in any
  colour; windows of one or more sashes with divided lites, picture windows, screens, trim and
  shutters; doors with panels or glass, double, sliding and screen doors; corrugated metal roofs that
  rust; a brick chimney in any colour.
- **Kitchens**: base, wall and tall cabinets, islands, sinks, ranges, fridges, dishwashers, wall
  ovens, hoods and microwaves placed along the walls, with one counter top running over each run
  of cabinets; slab or panel fronts in any colour, or in a wood.
- **Furniture** in an Adirondack camp style, on a layer of its own (**Shift+F** shows or hides it on
  the plan, in 3D and in the exports; also the toolbar's and the 3D bar's **Furniture** buttons).
  The **Furniture** tool (**Shift+C**) places a piece from a catalogue: beds (twin, full, queen,
  king), nightstands, dressers, chests, bookcases, trunks, a desk and desk chair, dining, coffee and
  side tables, ladder-back dining chairs, a log sofa and armchair, a rocker, a bench, an Adirondack
  chair, a floor lamp, rugs. Each is built to its size from logs or sawn stock in a wood (Nordic
  pine, hickory, peeled log, log with bark, fumed oak, painted green, red or cream) and a fabric
  (buffalo check, point blanket, wool plaid, canvas, leather, a Navajo or braided rug); a bed, a
  dresser or a desk backs onto the nearest wall, a table, a chair or a rug sits where you click
  (Shift swaps the two, Tab turns it). Select a piece to change its size, wood and fabric.
- **Textures** drawn in the browser: pale, cool **Nordic natural pine** floors and stair treads
  (grain and knots, never amber), the furniture's woods and fabrics, an eggshell stipple on
  painted walls, and the siding, stone, brick and roofs.
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

Every load opens on the **Proposed** view with the **roofs** and the **furniture** off (tick Roofs
and Furniture in the 3D bar, or press Shift+F for the furniture, to show them); the viewer opens
the same way.

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
   headroom would be under 80", measured as the code does from the line of the nosings to the
   underside of the floor above (the stair's properties change the headroom or set the start).
   Outdoor steps: tick "Open" for treads on stringers instead of a solid flight; on the lowest
   level "Starts at" may be negative, for steps that go on down a slope below its floor.
   A stair made of several pieces (a flight, a landing, another flight) becomes one **staircase**
   with "Make one staircase" in a piece's properties: a click then selects all of it and a drag
   moves all of it; double-click a piece to edit it alone (Esc goes back to the staircase).
   Tick "Railing on the left" or "on the right" (as you climb) for a 36" handrail with newels and
   balusters on an open side.
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
- **Decks (`J`).** Draw the outline like a roof's, on the level whose floor the deck steps out
  from. A new deck's top is one step (6") below that floor; set "Top" in the properties panel
  (negative is below the floor). An edge against a wall, on any level (the house, a retaining wall
  on the Basement), is carried by a ledger: no posts and, by default, no railing. Every other edge
  gets 5 1/2" posts down to the ground (from the grade points) at most 8' apart and, when ticked, a
  36" railing; the panel names each edge by the way it faces, says how high it stands over the
  ground, and warns about an edge more than 30" up without a railing (Reset railings puts them
  back). Draw the deck's stair as a flight on the level below whose top reaches the deck's edge
  (within 8" below the boards): the railing opens there. Drag a corner with the select tool.
- **Floor openings (`H`).** On the level whose floor is cut (the Second Floor over a double-height
  hall), click the corners of the hole; they snap to the wall faces, so it can run right up to the
  walls. The floor is cut through in 3D and the plan shows it "open to below". Every edge not along
  a wall gets a 36" guard (untick it in the properties panel); a flight from the level below whose
  top is one riser under the floor at an edge opens the guard there.
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
  (in the export they are two more `Chimney` meshes). A flue (Tab twice) is a round stainless
  pipe, its "Diameter" 8" by default, from a stove top 30" over the first floor to 2' over the
  ridge; tick "Rain cap" for a disc twice its width 3" over its top. Columns stand through floors
  and roofs without cutting them: draw a stove and its chase as boxes on each level. The north
  arrow turns with the plan's north angle, and the sun follows it.
- **Ground surfaces and fences (Site tab).** A surface (`A`) is a gravel drive, an asphalt road, a
  concrete pad or flagstones: click its corners and close it on the first corner, with a
  double-click or Enter; Tab before closing steps gravel, asphalt, concrete, stone. In 3D it lies on
  the ground, following the grade points (gravel speckled with stones, asphalt grained, stone as
  flagstones); the panel sets its "Material", "Colour" (Default resets it) and phase, and shows its
  area. A fence (`Q`) is a split-rail fence along the points you click (double-click or Enter
  finishes, Backspace removes the last point): 6" log posts at every point and at most 10' apart
  between them, set 6" into the ground, with 4" log rails between them following the slope. Its
  panel sets the "Height" (42" by default, the posts' top over the ground), "Rails" (1 to 4, 2 by
  default, spread from 30% to 85% of the height; one is a top rail), "Post spacing" (at least 24"),
  "Colour" (weathered grey by default) and phase, and shows its length and post count. With the
  select tool, click a fence near its line or a surface inside it (the smaller of two overlapping
  surfaces first), drag to move the whole thing, and Delete removes it.
- **Finishes.** The Level panel's "Exterior finish" and "Exterior colour" set every exterior
  wall of the level at once; the Wall panel sets one wall: shingle, clapboard, vertical board,
  concrete block (for a foundation), plain or screen. The siding, brick and roof textures are in
  the 3D view only: the export carries their colours.
- **The look after the work.** The Level panel's "Proposed ..." fields re-side, re-roof and re-trim
  the whole house without redrawing it: siding and colour (painted shakes among the finishes),
  roof and colour (standing seam among them), roof boards, window trim and sash colours, and
  shutters kept or removed. They show in the Proposed view only; Existing and All keep today's
  look.
- **Interior finishes.** Select a room's label: its panel sets "Walls" (paint, painted boards,
  knotty pine or check wallpaper) with "Wall colour", a "Wainscot" (a lower band in another finish,
  with its height and colour) and "Floor" (plain, boards, tile, parquet, wide face-nailed pine or
  carpet) with "Floor colour". A room that is kept can have a "Proposed floor", a new floor laid in
  it in the proposed design, which the Proposed view shows in place of today's.
  The walls round the room show its finish on the room's side only (an exterior wall keeps its
  siding outside, a partition shows each room's finish on its own side), and the floor covers the
  room inside the wall faces. "Default" clears each one. Ceilings are not drawn yet.
- **Windows and doors.** A window's panel sets its "Sashes" (1 to 6 side by side with 2" mullions
  between them; the lites, cols x rows, are per sash), "Fixed centre pane" (at 3 sashes: a picture
  window, one undivided pane between two casements at most 24" wide), "Glazing" (glass, or an
  insect screen in a light frame), the trim width (0 for none) and shutters (one sash wide). A
  door's panel sets "Sliding" (a patio door: two glass panels in tracks, framed in the window
  colour, no swing; its lites are per panel), its "Leaves" (2 for a double door), the glazed lites
  per leaf (1 x 1 is a solid panel), "Half lite" (the lites in the upper part, two panels below),
  "Glazing" (a screen door: screen above and below a mid rail) and the "Leaf colour".
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
   walls to demolish in dashed red and new walls in green. Existing and Proposed show each layout
   on its own, in real finishes, with no red or green.
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
5. Watch the status bar's **to check** count. The tool checks the proposed design against the 2025
   Residential Code of New York State as it goes: a deck edge more than 30" above the ground with no
   railing, a floor opening's edge with no guard, and new stairs (risers at most 8 1/4", treads at
   least 9", 36" wide, 6'8" of headroom from the nosings, a graspable handrail on four risers or
   more, guards on open sides more than 30" up, matching risers and big enough landings), and the
   structure: a wall taken out that likely bears needs a beam or wall within the joists' depth of
   it, a new beam's ends need 1 1/2" of bearing, and every new beam and post needs something under
   it on each level down to a footing (headers for new openings are notes). Click the count for the list; **Show**
   selects the element, centres the plan on it and outlines it, and the plan marks each issue with a red
   (error) or orange (to check) disc in the Proposed and All views. The element's properties
   repeat its issues with their code sections. The code numbers live in `src/model/codeLimits.ts`:
   verify them against the code text before relying on them.

6. Draw what carries a wall you take out. Set **Joists over this level** in the Level panel (the
   floor or ceiling framing above it: north-south or east-west) and, where part of the house was
   framed another way, **Draw a joist zone**. `I` draws a beam (two clicks; it starts as a flush
   pair of 1 3/4" x 11 7/8" LVLs in the floor framing, a placeholder for the engineer to size),
   `L` places a post that runs up to the beam over it (on the lowest level it stands on a 24" x 12"
   footing). A wall's **Bearing** field marks it bearing or not; Auto leaves it to the tool, which
   says what it made of it (likely bearing when the joists cross it and would span more than 14'
   without it, when something above stands on it, or when the joists bear on an exterior wall). `Y`
   shows the structure overlay: the joists, their direction, beam labels and bearing walls; export
   the plan with it on for a framing plan. Nothing is sized: the sizes are for the engineer.

## Editing walls

- **Move a wall by a distance.** Select the wall; in the properties panel type the distance in
  **Move** and click the side to move it to ("toward Living" / "toward Kitchen", named after the
  rooms either side). The walls at its ends stretch or shorten so they stay attached and straight
  (corners stay square), walls running straight on from it move with it, and windows and doors
  keep their place along it. The status bar then gives both rooms' new net sizes. `Shift` + an
  arrow key moves the selected walls 1" that way. A move that would put a wall on top of another,
  or a corner whose walls meet at odd angles, is refused with a message. Roofs do not follow.
- **Moving a wall of the house as it stands, while drawing new work.** With **Draw as: new**, moving
  an existing wall (by dragging it, the **Move** buttons or `Shift` + an arrow) asks how:
  **Rebuild it there** (`R` or Enter) leaves the old wall in place, marked demolished with its
  doors and windows, builds the moved wall new with copies of them, and joins it to its
  neighbours with new pieces (a wall it moves away from is carried out to it) or cuts them back (a
  wall it moves into loses the piece it passes, demolished); **Correct the drawing** (`C`) moves it
  in every view, as a measurement fix; `Esc` leaves it. Either is one undo step, and "correct" is
  remembered while you keep nudging the same walls. A rebuild that would cut a wall through a door
  or window, lay a wall on another, or change the house as it stands is refused with a message.
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
The checkboxes hide levels, and **Roofs** lifts every roof off: untick it to look down into
the top floor and see its rooms from above (untick the Second Floor too to look into the First
Floor). **Walk** (or `F`) drops you in at eye height just inside the level's
entry door (the first door in an outside wall), looking into the house; on a level without one, in
the middle of the house. To start somewhere else, right-click that spot in the 2D plan (select
tool) and choose **Walk from here** ("Clear walk start" goes back to the door). Click the view to
look with the mouse, WASD or the arrows to move, Shift to go faster, Q/E to jump a level, Esc to
leave. You walk on what is there: up stairs and steps (9" at most), down to what is below, and the
rails, guards and the sides of stairs stop you; the level follows your feet, so walking up the
grand stair puts you on the Second Floor. Walls are not solid in walk mode.

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
  `Terrain`, `Chimney`, `Flue`, `Post`, `Pier`, `Surface` and `Fence` meshes. Walls are named by kind and phase.
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
orbit, two fingers to pinch and pan, level checkboxes, a Roofs checkbox to look down into the
Second Floor, the four elevations, Fit) and the plan of
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
| `S` `W` `R` `D` `N` `P` `T` `K` `J` `U` | Select, Wall, Room, Door, Window, Passage, Stairs, Roof, Deck, Underlay |
| `C` | Cabinet: the chosen kind follows the cursor along the nearest wall; click to place, type a width first to change it (Site tab: Column) |
| `B` | Box: four walls; click a corner, type `12' x 10'` (or `12'` Tab `10'`), Enter |
| `M` | Measure between two points; Esc clears |
| `I` / `L` | Beam (two clicks) / post (one click) |
| `Y` | Structure overlay: joists, beams, bearing walls |
| `E` `C` (Site tab only) | Grade point, Column (chimney; Tab before the click for a post, again for a flue) |
| `A` `Q` (Site tab only) | Ground surface (an outline; Tab steps gravel, asphalt, concrete, stone), Fence (a line of points; double-click or Enter finishes) |
| digits, `'`, `"`, space, `/`, then Enter | Type a length or a distance while drawing |
| `Enter` or click | Walls: with nothing typed, commit the wall at the cursor; roof, deck or surface: close the outline; fence: finish it |
| `Backspace` | Edit the typed length; roof, deck, surface or fence: remove the last corner |
| `Esc` | Clear the typed length, then end the wall chain / cancel the roof, deck, surface or fence / clear the selection |
| `X` | Next wall exterior or interior |
| `Shift` (hold) | Invert ortho lock; with ortho off, 15° steps; cabinet: place away from the walls |
| `Tab` / `Shift+Tab` | Door swing side / hinge; stairs and free cabinets turn 90°; column chimney, post or flue; surface material |
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
sketch, the owner's floor sketches and photos (`docs/photos/`: 01 to 09 outside, 13 to 23 of the first floor inside and the lake side) so that the 3D model already reads as the same house:
the gable roof with deep open eaves and rafter tails under rusting corrugated metal, the east wing
with its own gable, the screened entry porch with its knee walls and west-facing gable, the chimney
stained like the house with its cap and spark arrestor, shingle below and clapboard above, the
casement and picture windows, the green shutters, and the walkout basement on the lake side, grey
block with vertical boards round its double door, and the yard: Mick Road, the gravel pull-off
where the cars park, the porch's step and the split-rail fence along the retaining wall. It is a **starter, not a survey**. Both floors'
interiors come from the owner's tape and sketches (face to face): the First Floor's rooms, 5"
partitions and stair, and the Second Floor's rooms and partitions. The exterior
wall thickness (7") and the outside size are derived from those measurements. Everything else (the
basement, the windows, the roofs, the porch, the terrain, the yard) is an estimate from the photos, and every
room name that depends on one says "(est.)" or "not measured". A room name that says "adjusted"
is a measurement that disagreed with a neighbour and was changed to make the house close (see
below). The plan's name says so too.

Open it with **Open example**. Replace the estimates one by one with tape measurements, in the
order below. The owner's proposed design is already drawn on top as new and demolished work (see
"The proposed design in the starter"): the Existing view shows the house as it stands.

### How the starter was built

`scripts/example-plan.ts` builds it through the editor's own store actions (`addWall`,
`addOpening`, `addRoof`, `addColumn`, `addGradePoint`, `addFixture`; today's kitchen, bath and
front-room fixtures are drawn from photos 13 to 22, not measured), so every wall passes through the same
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
  shutters on the two west windows, and the house door dark green outside with one large lite over
  two panels, swinging in (photos 8 and 19). The first-floor picture windows' casements are 2 x 4
  lites on the south face and 2 x 2 on the west (photos 14, 17, 18 and 23).
- **Terrain**: forty-eight grade points, see below, with the lake side's terrace behind the retaining
  wall.
- **The two floors share three north-south bands** (inside faces, from the north wall): the north
  band y 7 to 97 (7'6"), a 5" wall (centerline y 99.5), the stair strip y 102 to 135 (2'9"), a 5"
  wall upstairs (centerline y 137.5; on the First Floor there is none, see below), and the south
  band y 140 to 308. The north-south inside length is 301",
  which is the upstairs west side (Bunk 90 + 5 + strip 33 + 5 + Master 168).
- **First Floor interior** (measured, face to face; partitions 5", existing; openings from photos
  13 to 22): the y 99.5 line from the east wall to the west wall (the Kitchen's north wall and the
  front room's south wall) with a tall cased opening, 36" x 88", at x 132 to 168; the Kitchen/Living
  partition (x 170.5) with a 48" passage (y 188 to 236, south jamb 6' from the lake wall) and,
  south of it past a short wall, a 48" **pass-through** with a shelf ledge, sill 42", head 84"
  (y 252 to 300); the Bath's west wall (x 194.5) with a flush stained 30" door at its south end
  (y 54 to 84, its south jamb about 1' from the Bath's south wall, photos 20 and 22) swinging into
  the Bath; and in the main block's east wall a grey 32" half-lite door
  of 3 x 3 lites from the Kitchen into the Utility (y 248 to 280), swinging into the Utility. There
  is **no wall on the stair's south side**: the flight is open to the Living, with a newel, a
  spindle rail and shelves under it (photo 16), so the strip is part of the Living. The stair
  climbs **east** from about 2' in from the west wall (x 31, photos 16 and 18; the stringer reads
  about 45 degrees) to x 132, a 101" run, 33" wide (the whole 2'9" strip), under the Second Floor's
  landing, and cuts the Second Floor's floor from 7 3/4" up the run (where the headroom from the
  nosings drops under 80"), so the Master closet over its low end keeps its floor. Rooms, east-west x north-south:
  Front room (MK's name for the old entry hall) 15'5" x 7'6", Bath 9'6" x 7'6", Kitchen 11'6" x
  17'2" (adjusted, see below), Living 13'5" x 14'0" south of the strip and 17'2" with it, Utility
  11'6" x 9'5". There are **no open wall ends** on this floor.
- **Fixtures as they are** (photos 13 to 22, sizes estimated; knotty pine fronts and a light
  laminate counter are the First Floor's casework defaults). Kitchen north wall, west to east: a
  30" top-freezer refrigerator, a 24" base, the 30" range under its hood, a 15" drawer bank; a 30"
  base set at 45 degrees in the north-east corner; on the east wall the sink base under the window,
  the dishwasher and a 24" drawer base; wall cabinets up to the crown, one of them across the
  corner. Bath: a 60" tub along the east wall in an alcove, with a pine-clad stub wall at its south
  end (photo 21), the toilet south of it, a 36" vanity on the south wall, the dryer and the washer
  along the north wall (labelled boxes). Front room: the north-east corner is cut off at 45
  degrees by a **pipe chase** for the Bath upstairs (photo 20; MK), its face from the north wall at
  x 168 (by the chimney, where the stovepipe goes in) to the Bath's west wall at y 31, drawn as a
  full-height cream box 4" thick (a wall there would split the Bath's west wall); the wood stove on its hearth stands in front of it, turned to face south-west.
  Utility (MK's description, no photos, so all estimates): old wood wall cabinets on the north wall
  (three 42") and on the west wall north of the Kitchen door (two 24"), open shelves under the south
  and east windows (48" wide, 12" deep, up to the 30" sills), and a blue mini fridge on the south
  wall east of the shelves. All of them are demolished in the Proposed view.
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
- **Basement ceiling** (MK's markup, 15 Oct 2026): the First Floor's joists run east-west over
  three north-south girders on posts, the middle one the heaviest. The girders are drawn as
  existing placeholders, from the sketch, at about 6'5", 14'2" and 21'8" from the west face (the
  middle one taken as under the Kitchen/Living partition; the sketch puts it about 8" west), a
  built-up 4 1/2" x 7 1/4" until measured; their posts are not drawn yet.
- **Basement**: no partitions yet. The main block is one area ("Basement (unpartitioned, est.)")
  and the walkout bump under the wing is labelled separately as "Utility (below)": it is closed off
  from the main block by the block's east wall in the starter, and stays a separate space until you
  measure how the two connect (delete or move the wall and the labels as you go).
- **Retaining wall and terrace** (photos 2 and 23; its line from the site sketch, photo 10): a
  poured concrete wall, 10" thick, drawn on the Basement level: a return 10' south from the corner
  of the main block and the wing, a 22' piece angled west and 4'6" further south, and 37' straight
  west to its free end, about 32' past the main block's west face. Its top is 2" over the terrace
  behind it, which sits a few inches under the first floor, so only the wing's basement walks out.
  Its west end is free, so the Basement shows one open wall end (a red dot) by design. The fence
  on the wall is not drawn. The proposed design carries it on west (see 11 below).
- **The bank and the lower lawn** (photos 24 to 27, from the lake road and the lower lawn): the
  ground in front of the walkout doors stays level only about 4' out, then a steep bank falls 8'
  (MK) to the lower lawn, level from about 12'6" out (estimates from the photos).
- **Today's wooden stair** (photos 23 and 25): open treads on stringers, from a landing at the
  walkout's level beside the wing's south-east corner up north along the wing's east side to the
  lawn (11 risers), and from the same landing on south down the bank to the lower lawn (13 risers
  with the landing's edge); the landing is drawn as a small deck with its east railing, the
  flights' railings are not drawn. All estimates.
- Not modelled: the small deck at the top of today's wing stair (photo 3), the lot, the entry porch
  floor and steps, the foundation under the wing and porches (the ground meets them where the grade
  points say it does).

### Inside finishes from the photos

The First Floor's rooms carry their interior finishes (photos 13 to 22; the Utility's from MK):
the Kitchen has blue check wallpaper (`#2e3f6b` on white) and beige vinyl tile (`#cbbd9c`); the
Living has cream-painted vertical boards (`#ddd6b4`) and the front room smooth cream paint, both over
a dark red-brown painted board floor (`#5e2a22`); the Bath has green paint (`#2f7a68`) over a knotty
pine wainscot 40" high and a parquet floor; the Utility has pine paneling and a wood board floor
(`#a87a4c`). Not drawn yet: the ceilings (the Kitchen's knotty pine tongue-and-groove with boards
running east-west, the Bath's pine, white-painted boards or flat in the Living and the front room,
wood in the Utility), the Kitchen's pine crown and baseboard, and window reveals (they show the
siding). The appliances are white (the app draws them as steel). In the Proposed view the Kitchen's
check and tile carry on into the old bath's alcove, which becomes part of the kitchen.

The Second Floor's rooms (no photos) have **placeholder** finishes: off-white paint and wood board
floors, tile in the Bath; their doors are stained like the First Floor's Bath door. Change them in
each room's panel once you know them.

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
| First Floor rooms | measured, face to face: Front room 15'5" x 7'6", Bath 9'6" x 7'6", Living 13'5" x 14'0" (measured 14'1") south of the open stair strip, Utility 11'6" x 9'5" | Re-check any that look wrong |
| Kitchen | 11'6" x 17'2", **adjusted: re-measure.** MK measured 16'3"; the upstairs wins, and the first-floor mistake is suspected near the bottom of the stairs | Kitchen north-south, between the lake wall and the y 99.5 wall |
| Interior partition thickness | 5" (measured) | At a jamb |
| Stair | 33" wide, 101" run climbing east from x 31 (about 2' in from the west wall, photos 16 and 18) to x 132 (under the upstairs landing), cuts the Second Floor floor from 7 3/4" up the run (80" headroom from the nosings); open to the Living on its south side | **Distance from the west wall to the bottom riser**, run, riser count |
| Bath door (First Floor) | 30" x 80" flush, at the south end of the Bath's west wall (y 54 to 84: photos 20 and 22 both put its casing 9" to 13" from the Bath's south wall), swinging into the Bath; **position is an estimate** | Jamb to the Bath's south wall |
| Front room's pipe chase | 45 degrees across the north-east corner, behind the wood stove, hiding the upstairs Bath's pipes (photo 20, MK): 2' each way, its face from the north wall 161" east of the west wall's inside face (x 168) to the Bath's west wall 24" south of the north wall's inside face (y 31); photo 20 reads 1'6" to 2'7" | **How far it comes out along each wall** |
| Utility fittings | wall cabinets 12" deep, 30" high, bottom at 54": three 42" on the north wall and two 24" on the west wall north of the Kitchen door; open shelves 48" x 12" x 29" under the south and east windows; mini fridge 20" x 20" x 34" on the south wall at x 424 to 444 (MK's description) | Lengths, heights, and where the fridge stands |
| Kitchen/Living passage | 48" wide, south jamb 6' from the lake wall (y 188 to 236), sill 0, 80" high | Jamb to jamb |
| Kitchen/Living pass-through | 48" wide, sill 42", head 84", south jamb 8" from the lake wall's inside face (y 252 to 300; photos 14 and 17) | **Width, sill, head, distance from the south-west corner** |
| Kitchen to Utility door | 32" x 80" grey half-lite, 3 x 3 lites, south jamb 28" from the lake wall's inside face (y 248 to 280), swinging into the Utility (photos 13 and 14) | **Width and distance from the lake wall** |
| Front room to the stair strip | a tall cased opening, 36" x 88", at x 132 to 168 in the y 99.5 line (photos 16 and 20) | Jamb to jamb, head |
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
| Entry door | 36 x 80, centred 4' from the north corner (y 48"), dark green outside, one lite over two panels, swinging in (photos 8 and 19) | Jamb to the corner |
| Chimney | 24" along the wall x 20" out (photos 6 and 7), centred on the north wall (x 159"), stained like the house; a 4" concrete cap and a 12" spark arrestor on top | Width, projection, position |
| South windows, first floor | picture windows of a casement (2 x 4 lites, photos 14, 17 and 23), a fixed pane and a casement (casements 24" wide): 144 x 60 at x 87.5" and 118 x 60 at x 242", sill 30; the jambs clear the Kitchen/Living partition's faces at x 168" and 173" (photo 1) | Jamb to corner, rough opening |
| South windows, second floor | three casements 78 x 46 at x 115" (photo 1 shows three over the Master, not four) and three 66 x 46 at x 256", 2 x 3 lites each, sill 34 (photo 1) | Same |
| West windows | first floor 90 x 44 at y 203", sill 44 (head above the door head): a casement (2 x 2 lites, photo 18), a fixed pane and a casement; second floor two casements of 2 x 2 lites, 48 x 32 at y 200", sill 48; both with shutters one casement wide (photo 8) | Jamb to the north corner |
| North windows | first floor three casements (2 x 3 lites) 80 x 56 at x 96", sill 30, west of the chimney, and two single panes 48 x 44 at x 234", sill 42 (the Bath's, over the washer and dryer, its sill just above the wainscot, photo 22); second floor two casements (2 x 3 lites) 46 x 44, sill 36, at x 78" and x 248" (was x 240", moved east so it clears the Bath's east wall and sits in the Office; its west jamb is 2" from that wall's face) (photos 6 and 7) | Jamb to the west corner |
| East windows | second floor two pairs of casements (2 x 3 lites) 46 x 44, sill 34, at y 98" and y 222"; first floor a casement pair (2 x 3 lites) 40 x 40, sill 42, at y 160" over the Kitchen sink (photos 3, 13 and 15) | **Jamb to the north corner, and where the wing's north wall meets this wall: the sink sits further south than the model's wing allows** |
| Wing windows | pairs of casements: east end 48 x 44, 2 x 3 lites (photo 3); south face 48 x 44, 2 x 2 lites (photo 23); sill 30. The north face has no window (MK) | Rough openings |
| Mick Road | asphalt, 18' wide, its near edge 12' north of the north face (site sketch; a car parks between, photo 07), drawn from 100' west to 75' east of the house | **Distance from the north face to the road's edge**, road width |
| Gravel pull-off | from 18' west of the west face (past the porch, photo 05) to 25' east of it (near the north-east corner, photo 04), from the road to 2' short of the north face | Its corners from the house's north-west corner |
| Gravel strip, lake face | 12" wide, 12" out from the south face, x 6" to 300" (photo 01) | Width, distance from the wall, where it ends |
| Porch step | a concrete pad 4' x 2'6" at the porch's screen door and two flagstones 20" x 16" south of it (photos 07 and 08); demolished in the proposed design (the foyer and its stoop) | Pad size, stone sizes and places |
| Split-rail fence | two rails, posts 42" high and at most 10' apart, a foot inside the retaining wall's top: from the house down the wall's return, along its angled and straight pieces, then on west across the lawn to 58' west of the house (photos 01, 05, 07 and 24) | **Where it ends west**, post height and spacing |
| Retaining wall | poured concrete, 10" thick, top 96" above the basement floor, about 10' south of the main block, from 10' past its west face to the wing's corner (photos 2 and 23) | **Distance from the house, height, where it ends west** |
| Basement double door | 72 x 80 on the wing's south wall, two plain leaves in the stain (photo 2) | Jamb to jamb |
| Roof pitches | main 6:12, wing 7:12, entry porch 5:12 (photos 3 and 8) | A level and a tape against the rafter or the gable |
| Roof overhangs | main 24", wing 18", entry porch 18" | Eave to the wall face |
| Roof thickness, eaves | 2 1/2" (corrugated sheet); open eaves, rafter tails 5 1/2" deep every 24" (photos 1 and 7); 7" rake boards | A rafter tail and the rake board |
| Grade points | see below | Spot levels from the floor top down |
| **The bank and the lower lawn** | level about 4' out from the walkout doors, then down 8' (MK) to the lower lawn from about 12'6" out (photos 24 to 27); today's lower flight is drawn as 12 risers of 7.4" to the landing's edge, and each 7.4" more or less is a riser and 10" of run | Where the bank starts and ends, and the lawn against the walkout doors' threshold |

Grade points (absolute elevation in inches; the first floor top is +2", the basement floor -100"):
five at +1 round the porch, whose floor is about at grade (its two outer corners, the middle of its
front and its two corners against the house, one of them the main block's north-west corner); the
main block's north-east corner -4, middle of the north wall -4, middle of the west wall -8; the
terrace, level at -6 between the house and the retaining wall (MK: filled in, level with the west
lawn), at the main block's south-west corner, the middle of its south face and its south-east
corner, at the old line of the retaining wall's end against the house's line, and on the lawn behind the
wall out west (-6, where the garage is to go); the wing's south-east corner -100 and
north-east corner -20, a point 6' east of the main block's east wall -6, pairs either side of the
retaining wall and its new length west (-6 on the terrace and lawn just inside it; -40, -45, -50,
-50, -60, -65, -85 and -100 on the ground just outside, west to east; east of its return -100 beside the house and -153 on the bank), the bank in front
of the walkout (its top 4' south of the wing at -100, its foot 12'6" south at -196, and the lower
lawn at -196 out to 40'; photos 24 to 27, the 8' drop from MK), two at the walkout's threshold (-100, 6" out from the wall at the double door's jambs), and two points 30'
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
   the stair); the basement is still to do (delete its "unpartitioned" label as you go). The
   photos added five items to check (bold in the table): the Kitchen's east window and the wing's
   north wall, the Kitchen to Utility door, the pass-through, the stair's bottom riser, and the
   retaining wall.

### The proposed design in the starter

The starter also holds the owner's proposed design (his briefs of 12 and 14 Oct 2026), drawn as
*new* and *demolish* work on the house as it stands (the second half of `scripts/example-plan.ts`,
`proposed()`; the plans are `docs/history/PLAN-v4-proposed.md`, `docs/history/PLAN-v5-kitchen.md`
for the island, `docs/history/PLAN-v6-layout.md` for the stair hall, the north band, the stove and
the upstairs bath, `docs/history/PLAN-v7-exterior-flue.md` for the stove's flue outside, and
`docs/history/PLAN-v11-kitchen-north.md` for the powder room under the stair and the kitchen around
the island, and `docs/history/PLAN-v12-livability.md` for the livability review, with the places
where the built design differs from them):

1. **Master suite.** The east wing grows north to the road corner at the same depth: one
   one-storey wing down the whole east side, outside 12'1" x 26'3", under one new shed roof (5:12)
   high at the main block's east wall and sloping down east to the wing's east wall: its top meets
   the main wall 50.9" above the Second Floor. That is over the sills of the two upstairs east
   windows (34"), so they are demolished and high transoms replace them (the Office's at y 110,
   clear of the new bath's wall; the Guest's on its window's centre, y 222): 46" x 24", two sashes
   of 2 x 2 lites, sill 60" (head 84"), 9" over the roof. A 5" partition divides the master bath
   (north, 11'6" x 10'5 1/2" inside) from the master bedroom (11'6" x 14'2 1/2", the old Utility
   plus 4'9"). The bedroom is entered from the kitchen where today's grey Kitchen to Utility door is
   (MK chose that place over a new 32" door further north), through a **solid** 32" door: the old
   one's clear lites looked from the dining table into the bedroom. It takes a **king bed** (MK, 15
   Oct 2026), 78" x 84" with its headboard on the east wall: a 4'5" aisle on its north side (to
   the bath) and 3'3" on its south (to the sliding door), with nightstands under two 30" east
   windows that flank it (they replace a 48" pair and today's casement pair in the wing's gable
   end, which the bed would cover; the south one is a new hole in today's wall, so it needs a
   header). The walk-in closet gives way to two built-in **wardrobes**, 24" deep and 84" high,
   along the west wall at the bed's foot (8'10" of rod, 2'6" from the bed), backing onto the
   kitchen's refrigerator, which they quiet. The
   bedroom's south window becomes
   a 72" x 80" sliding door on the same centre, over the walkout's 72" double door, two glass
   panels of 2 x 4 lites, with no transom (under the 96" ceiling there is no room for one). The
   master bath's north window is a transom, high for privacy from the road: 46" x 18", sill 70".
   The wing's north wall, its roof and its south window, and the main block's first-floor east
   window, are demolished. New 8" block walls carry the new part (a crawl space). The master bath
   has a **walk-in shower** (MK, 15 Oct 2026) along its north wall's west end, 7' x 4', curbless
   and doorless: an 18" tiled bench across its west end, a fixed glass panel and a 30" way in
   straight ahead of the bath door, a tiled wall at its east end. Its other fixtures are
   **placeholders**: a 48" vanity east of the shower under the transom and a WC on the east wall;
   its door is east of the laundry.
2. **Laundry** (MK): a closet in the master bath's south-west corner, 2'8" x 6'0 1/2" inside, with
   the dryer and washer side by side (27" each, the dryer north) behind bifold doors (drawn as a 56" opening), 4"
   off the back wall for the **dryer's vent**: a 4" metal duct up behind the dryer to 86", north
   under the ceiling over the shower and out through the master bath's north wall to a vent hood
   (about 11' with two bends, inside the code's 35' less 5' a bend: M1502.4.5.1, to verify).
3. **Stair hall.** The old front room, the stair strip and the Bunk over them are one stair hall,
   13'5" x 10'8", **open through both floors** north of the upstairs Master (a floor opening over x
   7 to 167.5, y 7 to 97). The old stair, the front room's walls (the y 99.5 line and the old bath's
   west wall) and its 80" north window are demolished; upstairs the Bunk's door, its whole east
   wall and the old bath's south wall and door go, and the Bunk's south wall stays as the Master's
   north wall. The new stair (MK, 15 Oct 2026) is
   **a step up to a landing, then one straight run up the north wall** with no second turn: 15
   risers of 7.2" on 10 3/8" treads, one staircase (the "Grand stair") in **thick pine treads**
   (2", the floors' Nordic natural pine, drawn with its grain along each tread) with a 1" nosing over white risers, box newels and a round
   handrail on white balusters, framed underneath:
   - one **step** up heading north from the hall, clear of the house door;
   - a **landing** in the north-west corner, a step higher, where you turn east;
   - a run of 12 risers **straight east along the north wall**, railed on its open side, arriving
     at x 167.5, just short of the hall's east wall;
   - a **top landing** upstairs where the old bath was (pine), 3'8" x 10'8", with a guard along
     the opening's east edge; **no upstairs hall** (MK, 15 Oct 2026): the landing is all there is,
     with a door to each room, the bath's (east), the Master's (west) and the Guest's (south);
   - the **powder room** under the high end of the run (MK, 15 Oct 2026), 5'3 1/2" x 3'1": its
     walls stand under the stair, each no higher than the stair's underside over it (47 1/2" at the
     west end, 77" where the door is), and the stair's framing closes the gap above them. The door,
     from the hall at the top of the run, is **24" x 76"**: the underside is about 6'5" there, so a
     6'8" door does not fit. The WC stands against the west wall facing east, so you sit where the
     ceiling is low (4'3" to 5'10" over it); a narrow 18" x 12" vanity is on the east wall, where it
     is 7'3" to 7'11" (placeholders). The run west of it stays open underneath (the coat closet that
     stood under the old landing went with it).
   - **steel I-beams where the old front room wall was** (MK, 16 Oct 2026): on its line, flush in
     the second floor's framing, 13'11" from the west wall to the Kitchen/Living corner and 12' on to
     the east wall, so the hall, the Living and the Kitchen have flat 8' ceilings with no post in the
     room. The one post you see is at that corner, by the powder room: a **peeled log**, 14" across,
     pale and barkless, from the floor to the ceiling, dressing the structural post inside it, with
     a post on a 3' square footing under it in the basement. The beams' other ends rest on posts
     built into the end walls (see "The engineer").

   Upstairs the rooms take the old hall: the **Master** takes the balcony (its north wall, solid, on
   the stair hall's edge), 13'6" x 17'2", with a **wardrobe** along that wall (7'4" x 2', an 80"
   opening for bifolds) beside its old 2'6" closet; the **Guest** takes the Office as an alcove (an
   L, 11'5" across, 19'5" long on its east side, with the Office's transom), with a 2' x 5'
   **closet** at the alcove's west end (a 56" opening for bifolds) and a 5' x 5'5" desk nook left
   under the transom. Its south window, its only low one since the east window became a transom, is
   **two 32" casements** in place of three of 20 1/2", so it is a way out in a fire. The old walls
   between them carried the ceiling joists, so a flush beam in the ceiling on each of their lines
   picks them up, down the Master/Guest partition onto the beam over the Kitchen/Living opening
   below (placeholders for the engineer).

   The house door (32", green) is in the west wall in the middle of the old stair strip, in line
   with the foyer's front door, and the strip runs straight on into the kitchen through the wide
   opening in the Kitchen/Living wall (item 5). New windows light the hall: a 24" one over the
   landing, a second casement pair upstairs in the north wall over the top of the run and one in the
   upstairs west wall. The hall is **open to the Living** (MK): no wall on the strip's south side,
   as today (photo 16).
4. **North band** (MK: the kitchen stops short of the north wall): a 4' band along the north wall
   east of the stair hall, all of it a **walk-in pantry** (11'6" x 4'; MK, 15 Oct 2026: the powder
   room went under the stair), with 12" shelves on its north wall and both end walls and a 24" door
   from the kitchen's north-west corner. The band's wall is the kitchen's north wall, with the range
   on it. It crosses the old bath's west wall across its door; the door keeps its place in the house
   as it stands, since a new wall does not split a demolished one.
5. **Kitchen**, 11'6" x 20'8", south of the band, the old bath included (MK, 15 Oct 2026). All of
   its casework is new; today's cabinets and the bath's fixtures (photos 13 to 22) are demolished:
   - the **Kitchen/Living wall opened up**: one opening floor to ceiling, 11'1 1/2", from the hall's
     end to the south side of today's 48" Living doorway, in place of the hall's cased opening, the
     4'5" wall and that doorway; the 16" wall south of it and the pass-through stay. The wall bears
     (the upstairs Master/Guest partition stands on it and two ceiling beams' ends land on it), so a
     flush beam over the opening carries that to its ends: the log post at the corner (y 99.5), and
     studs in the middle of the 16" wall, each with a post on a footing under it in the basement, on
     the middle girder's line. No other post stands in a room (see "The engineer");
   - on the **north wall** (the pantry's): west of the pantry door a 24" base for trash and
     recycling, then a 15" base, the **range** with its hood and a 20" base into the corner, wall
     cabinets over the bases. The hood's 8" duct runs straight north through the pantry, across its
     ceiling over the shelves (86" to 94"), to a wall cap on the north face: about 5', no bends, no
     roof penetration;
   - on the **east wall**, shared with the master suite: base cabinets and counter from the corner
     (24", 30" and 24", the counter one L with the north run's), the **refrigerator** (36" wide,
     counter-depth) with its back on the master bedroom's wardrobes, which deaden its hum, and
     a 24" base after it for a landing; wall cabinets over them all. South of them the east wall is
     the way to the master bedroom's door;
   - the **island**, moved west into the work triangle, its fronts facing north so whoever is at
     the sink faces the lake with the range behind them: a 24" dishwasher and a 36" sink cabinet
     under one top 62" x 26", no seating ledge; a 48" work aisle to the range, 46" to the east
     counter and 42" to the refrigerator; its west end is 5" short of the old wall's line, so you
     walk round it through the Living;
   - a **table** by the lake window, 36" x 60", centred on it, with four chairs (six with chairs at
     the ends): 45" from the island to its chairs, 39" past its east end to the bedroom door;
   - the **work triangle**, centre to centre: range to refrigerator about 8', refrigerator to sink
     about 6'4", sink to range about 6'8", about 21' in all.

   About 18'7" of counter in all. The cabinet colour, the counter colour and the fronts are the
   First Floor's casework defaults: change them in the Level panel, or per cabinet in its panel.
6. **Wood stove** (MK) on the Living's **west wall** where the bookcase was (moved there from the
   south-west corner on 15 Oct 2026), its back to the wall, facing east into the room, centred
   13'6" from the north wall's outside face, its stone surround just clear of the house door's
   trim: a stone hearth 4'2" x 3'4", a stone surround behind it and the stove 6" off it. Its flue
   runs **outside the Living** (MK), to the 2025 Residential Code of New York State, and goes up
   the gable wall **just north of the Master's west window** upstairs (MK). Below that spot is the
   foyer, so: a black double-wall stovepipe rises from the stove, runs 17" north over the stone and
   turns west into a listed wall thimble; in the foyer's south-east corner, beside the house door,
   an insulated **stainless chimney** (8", an insulated 6" chimney, UL 103 Type HT) rises straight
   from a tee with a cleanout, 2" off the siding, through the foyer roof where it meets the house,
   up the gable wall and through the main roof's rake overhang a foot north of the ridge, with a
   rain cap. It stands 3' over the rake, 2'6" over the ridge (the 3-2-10 rule). Nothing passes
   through the bedroom upstairs. The code checklist is in
   `docs/history/PLAN-v7-exterior-flue.md`. The **masonry chimney** on the north wall is
   demolished.
7. **Upstairs bath** (MK: a full bath with a stall shower in the north-east): east of the stair's
   top landing, across the Office's north end, 7'4" x 5'3", the old bath's east wall its west wall:
   a 32" x 60" shower along its east wall, the WC under the north window and a 24" vanity on its
   south wall east of the door's swing (placeholders; MK asked for the shower in the north-east, but
   a 36" square one there left no room to step into it), and a 28" door from the stair's top
   landing. South of it the old Office is now the Guest room's alcove, with its transom.
8. **The Adirondack entry: foyer and screen porch** on the west face in place of the entry porch
   (MK: "thoroughly Adirondack", with the ends of exposed beams showing at the entry;
   `docs/history/PLAN-v10-adirondack.md`). An enclosed foyer (9'4" x 8' outside, 8'1 3/4" x 7'5"
   inside; MK, 15 Oct 2026: its north wall, on your left as you come in, 18" closer to the
   driveway than first drawn) with the 36" front door in
   line with the house door, under a gable facing west, and south of it a screen porch (13'1" x 8')
   with screens above knee walls, two screen doors and a shed roof high at the house wall. The
   Living's west window, which would only look into the porch, goes and the wall is closed (the
   stove's stone is there; its chimney stands in the foyer's south-east corner); the porch is reached from the foyer. (The livability review's 60" French
   doors from the Living were taken out on 15 Oct 2026, MK.) The porch's lawn door is at the west
   end of its south wall. For coats (there is no closet under the stair), a
   **transom** high in the foyer's north wall facing the driveway (60" x 18", sill 70") and under
   it a **built-in coat bench** wall to wall in Nordic pine: boot cubbies under a cushioned seat, a
   beadboard back, iron hooks at 58", a shelf along the top 4" under the transom. The foyer's
   north wall meets the house across today's front door, so that stretch of today's wall is shown
   demolished and rebuilt closed (the Existing view keeps today's door). All sizes are estimates.
   - **The style, from the research** (web search summaries; the full pages could not be fetched):
     native materials throughout (whole, split or peeled logs, bark and fieldstone); rough log
     posts with twig and branch work on railings and gables; the structure left showing, with log
     ends carried past corners and gables and crossed poles as ornament; logs set on stone to keep
     them off the damp ground; bark-on half-log siding; broad shingled or metal roofs; browns and
     greens. Knee braces are a Craftsman detail, but common on rustic porches. Sources:
     [Wikipedia, Adirondack Architecture](https://en.wikipedia.org/wiki/Adirondack_Architecture),
     [The Plan Collection](https://www.theplancollection.com/blog/adirondack-architecture-style-a-model-for-rustic-elegance-and-flair),
     [Isaac Kremer glossary](https://isaackremer.com/glossary/adirondack/),
     [NPS, McClelland on rustic design](https://www.nps.gov/parkhistory/online_books/mcclelland/mcclelland2d1.htm),
     [Adirondack Life, the roots of rustic style](https://www.adirondacklife.com/2022/09/29/the-roots-of-rustic-style/),
     [Middlebury, Adirondack architecture](https://sites.middlebury.edu/adirondack/?p=577),
     [Houzz, a Vermont porch](https://www.houzz.com.sg/magazine/porch-of-the-week-perched-like-a-nest-in-the-vermont-mountains-stsetivw-vs~173124881).
   - **Materials:** dark stained logs and twigs (`#3f2c1f`, MK: dark rather than peeled golden),
     their cut ends amber; a dry-stacked river-stone knee wall in the stones' own grey, tan,
     blue-grey and rust; grey-brown fieldstone (`#8e8579`) for the piers, the stoop and the foyer's
     base. The logs are timbers at set heights, so the
     structure checks leave them to the engineer.
   - **An open log canopy over the front door:** the foyer's gable runs on 5' west of the foyer
     (its rake at x -174), so the door has about 6'6" of cover. At its outer end two 18" fieldstone
     piers to +20 carry 10" log posts up to a 10" log tie whose round ends show 8" past the posts;
     6" log knee braces, an 8" king post and two 8" principal rafter logs under the roof. A 10"
     ridge log and two 8" purlins run from the foyer wall out past the rake, their ends showing 8"
     beyond it. A sunburst of 3" twigs fills the gable over the tie, and a fieldstone stoop
     (60" x 72") sits under it, its top 1/2" under the threshold.
   - **The screen porch:** three 10" log posts on 16" fieldstone piers (to +12), a 10" log plate
     along the eave line whose end shows 12" past the south corner, and log knee braces. The
     porch's west and south walls are a river-stone knee wall up to the screens' sills (36"), with
     the shakes above.
   - **Stone base:** the foyer stands on 8" walls (a crawl space) like the east addition, faced in
     fieldstone; the screen porch stands on its log posts and piers.
9. **Deck off the master bedroom** (MK, 14 Oct 2026), about 8' deep: the wing's width from the
   retaining wall's east face to the wing's east face (x 319.5 to 463, y 315 to 411, 11'11 1/2" x
   8'). Its top is 6" below the bedroom floor (elevation -4), flush with the retaining wall's top,
   so you step onto it from the lake-side terrace behind the wall. The house and the wall carry its
   north and west edges; two posts stand on the walkout terrace (at the south-east corner and the
   middle of the south edge, 8' in front of the walkout doors); railings run the full east and
   south edges. The deck has no stair of its own (MK): **today's wooden stair stays** as it is,
   4" east of the deck's east edge, from the lawn down along the wing's east side to its landing
   at the walkout's level and on down the bank to the lower lawn.

10. **Alarms** (the wood stove brings carbon monoxide alarms; R314 and R315, to verify against the
    2025 RCNYS): a smoke alarm in each bedroom (the master bedroom, the upstairs Master and Guest)
    and in the basement, and a combination smoke and CO alarm outside the sleeping areas on each
    floor (by the master bedroom's door in the kitchen, on the stair's top landing upstairs) and in the Living
    with the stove. The code asks for alarms hard-wired and interconnected in new work, with
    exceptions in alterations; which apply here is for the electrician and the inspector.
11. **Retaining wall carried west** (MK, after the site sketch): from today's free end about 20'
    angled and 27' straight to the west property line (x -984, 3' west of the planned garage), the
    same poured concrete, its top 2" over the lawn behind it. The garage itself (24' x 26', 55' west
    of the house, 5' north of this wall) is not drawn. Walls that close no room, like this one, are
    left out of what the 3D view frames and shadows, so the house keeps its size on screen.
12. **Floors** (MK, 15 Oct 2026): **6" pine, face-nailed** with old square cut nails, **Nordic
    natural**: pale and cool, its grain and knots showing, never amber or yellow. Pine yellows from
    ultraviolet light through an oil-based or amber-tinted finish; to keep it pale, use a clear,
    "water-white" two-component water-based finish (check the label for no amber tint), or a
    white-tinted water-based sealer first; none stops ageing entirely, but they slow it a lot. Pine
    through **the first floor** (the hall, the Living, the kitchen, the foyer, the pantry and the
    master bedroom) and on the stair's treads and **top landing** upstairs; **tile** in the wet
    rooms (the powder room, the master bath and its laundry, the upstairs bath); **oatmeal carpet**
    in the upstairs bedrooms and the master closet. The screen porch keeps its outdoor boards. Rooms
    kept from today carry their new floor as a proposed floor, so the Existing view still shows
    today's floors. **Walls** are painted and kept light (MK): the kept Kitchen and Living are
    repainted a warm white in the Proposed view (`proposedWall`), the new rooms are painted. The
    proposed **cabinets** (kitchen, island, wardrobes, vanities, pantry shelves) are in the same
    Nordic pine.
13. **Furniture** (MK, 15 Oct 2026; Adirondack camp style, on the furniture layer, Shift+F):
    - the **Living** (rearranged round the stove on the west wall, 15 Oct 2026): a peeled-log sofa
      in red buffalo check facing the lake window, its end 3'5" from the stove; a Navajo rug before
      the hearth with a log coffee table; a hickory rocker and a wool-plaid armchair turned to face
      the stove, a side table between them; an iron floor lamp by the rocker; a pine bookcase in
      the south-west corner;
    - the **kitchen**: the pine farm table and four hickory ladder-back chairs with cane seats;
    - the **foyer**: the built-in coat bench (shown with the furniture layer off too); the **screen porch**: two green Adirondack
      chairs and a side table facing the lake;
    - the **master bedroom**: the king bed in peeled log under a point blanket, hickory nightstands,
      a braided rug at its foot;
    - upstairs, the **west room** (the Master): **two full log beds** on its east wall with a
      nightstand between, a pine dresser under the west window, a braided rug;
    - the **east room** (the Guest): a **queen log bed** under the east transom with nightstands, a
      **hickory desk in the alcove** under its transom with its chair, a dresser, a Navajo rug.
    The deck has none yet (its floor is below the bedroom's and a piece cannot sit below its
    level's floor).
**After the work** (MK, after his garage across the road), the Proposed view shows the whole house
re-sided in brown painted engineered shakes (`#4b3a32`), under a dark hunter green standing-seam
roof (`#2f4a36`) with its rake and fascia boards in the shake brown, with black windows (`#1c1c1c`)
trimmed in red (`#a8322d`) and the shutters off. Existing and All keep today's look.

The new rooms' walls have **placeholder** paint until you choose them (off-white), and their
floors are MK's (item 12; a wood floor on the screen porch); the paint also covers the
inside faces of the old outside walls the additions enclose. Interior doors are stained like the
old Bath door.

**The livability review** (`docs/history/PLAN-v12-livability.md`): the design walked through for
daily life, and what changed:

- **Closets**: the main-floor bedroom had none and the upstairs ones one 2'6" closet between them;
  each bedroom now has one (items 1 and 3).
- **A way out of the Guest room in a fire**: its south window re-sashed (item 3).
- **The upstairs bath**: its shower could not be stepped into; re-laid out (item 7).
- **The porch** was reached only through the foyer: French doors from the Living (item 8), since
  taken out for the stove (MK, 15 Oct 2026).
- **Privacy**: a solid door to the main-floor bedroom (item 1).
- **Counter**: a 24" base by the pantry door (item 5); later the east wall's run (MK) took it to
  about 18'7".

And three things it could not change inside the choices already made, for MK to weigh:

- **Light in the kitchen**: its work end is about 16' from its only window, the lake one; plan
  for strong task lighting (under the wall cabinets, pendants over the island).
- **The laundry** in the master bath suits daily life on the main floor (it is where the clothes
  live), but someone staying upstairs crosses the kitchen and the bedroom to use it.
- **The basement**: no stair down to it is drawn inside the house (see "Still open").

Which view to use:

- **Proposed** for the 3D view, the elevations, walk mode and exports of the house after the work.
- **Existing** for the house as it stands, every part solid in its own finish (what the design
  takes out included).
- **Proposed** shows the finished house the same way: new work in its own finish, not green.
- **All** to overlay the two layouts: demolished work dashed red on the plan and translucent red in
  3D, new work green. This is the only view with phase colours. The demolished
  rooms keep their labels in the All view and the new labels sit beside them (the Utility and the
  master bedroom's new north part are two areas there).

Still open, by who answers it (the design decisions are made; what follows is for MK's pictures,
the engineer, the trades and the tape measure):

**MK**
- Which way the Second Floor's joists run (over the First Floor): see the old stair opening's
  header, which way the Second Floor's subfloor or floorboards run (joists cross them), or look
  through a ceiling light's box. It decides which walls bear (see "The engineer").
- How is the basement reached today? No stair down to it is drawn inside the house; where are the
  water heater, the panel and the well equipment, and is an inside stair wanted?
- The porch's size and roofline wait on MK's reference pictures (estimated 8' out; the foyer's
  gable and the porch's shed overlap with no valley, which the tool cannot draw).
- The garage (24' x 26', 55' west of the house, 20' from the road, 3' off the west property line)
  is not drawn; the retaining wall carried west sets its south side. To draw it: on the First
  Floor, **Draw as: new**, the Box tool (`B`, `24' x 26'`, Enter).

**The engineer** (the tool draws and checks the load path; it sizes nothing)
- Size the stair hall's header and the kitchen beam (both on y 99.5), drawn as **W8x15 steel**
  flush in the second floor's framing (MK, 16 Oct 2026: I-beams, flat 8' ceilings, one post); the
  post inside the log at their shared end, the basement post under it (two 6x6s) and its footing,
  drawn 36" x 36" x 12"; the posts in the end walls, drawn (3) 2x6; and upstairs the two ceiling
  beams on the Master's and the Guest's old north walls' lines (y 137.5 and y 152.5). The checks
  find nothing missing in that load path. The estimate behind the drawn sizes, to check:
  - Loads: the second floor's joists bearing on y 99.5 from both sides (about 4' of floor north
    and 9' south, 40 psf live and 12 dead), the Master's north wall over the line and its ceiling:
    about 900 plf. More if the rafters or ceiling joists bear on that wall upstairs.
  - The 13'11" span: about 21 kip-ft, 6.1 kips at each end; the 12' span about 16 kip-ft and 5.3
    kips. A W8x15 (Zx 13.6 in3, I 48 in4) needs Zx 8.5 and I 33 (L/360 live). At 8" deep it fits
    flush in 2x10 framing (the joists hung off wood nailers bolted to its web); wood would take a
    3-ply 1 3/4 x 11 7/8 LVL, which drops below 2x10s. **Measure the joists' size** first.
  - The corner post carries both beams' ends and the opening beam's north end: about 14 to 16
    kips. Its own post and footing in the basement, not on the middle girder; about 10 sq ft of
    footing at the code's 1,500 psf without a soil test.
  - The end walls: about 6 kips each into a built-up post, carried down to the foundation wall by
    solid blocking through the first floor. The west one stands against the **house door's north
    jamb** (its opening from y 102.5): build it into the door's king studs, or move the door 2"
    south.
  - Two pieces bolted at the corner post go in easier than one 26' beam.
- The flush beam over the 11'1 1/2" Kitchen/Living opening, 12' from y 99.5 into the 16" wall: it
  carries the upstairs Master/Guest partition and the two ceiling beams' inner ends to its ends,
  the studs and (2) 6x6 at y 99.5 and new studs in the 16" wall with a 6x6 and footing under them.
  Both basement posts stand on the middle girder's line, next to or replacing its existing posts.
- **Where posts go, and whether one has to stand in a room upstairs.** Every new beam ends on a
  wall, with studs in it and a post on a footing straight under them in the basement (never on a
  joist between girders, never on the slab without a footing). As drawn, no post has to stand in an
  open room on either floor except the log-dressed post at the Kitchen/Living corner, MK's choice.
  That holds in both cases below, so long as each beam can be
  sized (LVL, PSL, glulam or steel; deeper, or dropped as a soffit, where flush depth is not enough)
  to span from wall to wall.
- **Which way the Second Floor's joists run** (over the First Floor) decides which walls come out
  bearing. North-south (drawn): the y 99.5 wall bears and its two beams pick it up. East-west (the
  same as the basement's): the y 99.5 wall bears nothing, and the **old bath wall (x 194.5)** bears
  instead, for the north strip (the joists would span 25'-11" without it); it then needs a beam on
  its line, 8', whose south end hangs on the kitchen beam at y 99.5 (no post in the kitchen). The
  tool shows this: set the First Floor's **Joists over this level** to 0 and the checks flag the
  wall. Confirm the Bunk's south wall upstairs carried no more than itself (the attic joists span
  11'-2" without it). Survey the basement under the posts.
- **While walls come out**: temporary shoring walls on both sides of a bearing wall before it is
  cut, carried down to the basement floor (onto the girders' lines) as well, not left on the
  first floor's joists.
- The headers noted HDR on the structure overlay: the wide opening in the partition, the two First Floor north windows and the stair hall's upper north window
  (and the bedroom's door and the Guest's window, which go in today's openings).

**MK, the engineer and the builder** (the Adirondack entry)
- The logs' sizes and species (cedar or spruce), the stone, and how the canopy's log posts are
  anchored to their piers (and the porch's to theirs); the logs are drawn, not designed.

**The trades and the makers' instructions**
- The stove and its chimney: the stove's listing and the chimney maker's instructions set the
  clearances (to the surround, to the furniture), the thimble, the supports and the top, and win
  over the plan's numbers. The chimney's 3' over the rake needs a roof brace; where it passes the
  foyer roof against the gable wall the flashing has to be worked into the wall's; and in the
  foyer it stands 2 1/2" from the house door's trim, so whether it needs a guard or an enclosure
  there (a chase would not fit without moving the door) is for the chimney maker. See
  `docs/history/PLAN-v7-exterior-flue.md`.
- The alarms: hard-wired and interconnected or not (exceptions in alterations), for the electrician
  and the inspector.
- The upstairs bath's pipes come down through the pantry under it (the old chase in the front
  room is gone with the stove): their route is for the plumber.
- The dryer vent's and the hood duct's products (a 4" rigid duct and a vent hood with a damper; an
  8" duct, the hood maker's size, and a wall cap 4' under the upstairs bath window, against the
  code's 3' from openings, M1504.3). A hood over 400 cfm needs makeup air (M1503.6): pick the hood
  with that in mind. Verify both against the 2025 RCNYS.
- The powder room's exhaust fan (it has no window): out through the north wall, its duct under
  the stair.

**The inspector**
- The powder room under the stair: its ceiling slopes from about 4'3" to 7'11", against the code's
  ceiling height for bathrooms (R305.1, with the exception for the space over fixtures, which only
  have to be usable); and its 24" x 76" door. Ask before framing it.
- The bedrooms' emergency escape openings (R310; to verify against the 2025 RCNYS: 5.7 sq ft
  clear, 20" wide, 24" high, sill at most 44"). The Guest's re-sashed south window and the
  Master's three 25" casements should pass; check the casements' clear openings when ordering.

**The tape measure** (before ordering anything)
- Every new size is from the plan, not measured.
- The joists: east-west over the basement (MK's markup), taken as north-south on the upper levels
  (MK), east-west in the wing's ceiling under its shed; the wing's floor over the crawl space is
  unknown.
- The basement girders: each one's distance from the west wall's outside face, its size (plies and
  depth, or steel), and where its posts stand and what they are.
- The retaining wall's line (the site sketch is not to scale) and the ground either side of it.

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
- **Staircases**: a turn is a landing; there are no winders, curved or flared flights. The handrail
  of each flight dies into a newel at a turn (no goosenecks or easings); the round rail is drawn as
  a 2" square bar; stringers are not drawn apart from the carcass (closed and open draw alike).
- **Not drawn yet**: a guard round the hole a flight cuts in the floor above (draw a floor opening
  round the stair well instead; it has one), handrails on a wall,
  exterior steps other than a flight (an outside stair is a flight on the lowest level, open and,
  down a slope, starting below its floor, as the starter's are), fences,
  the lot outline, porch floors and steps, foundations under additions and porches, gutters,
  ceilings, crown and baseboards, furniture outside (below a level's floor), and text or dimension notes
  you place yourself. Bathroom fixtures and a wood stove are labelled boxes. A retaining wall is a
  wall on the lowest level; its free end shows as an open wall end.
- **Cabinets** are boxes with simple fronts: no door swings on the plan, no backsplash, open
  shelves or corner cabinets (an inside corner is two cabinets whose counter is mitred), and a
  counter is only joined across cabinets turned by a quarter turn (a cabinet at 45° carries its
  own).
- **Walk mode has no collision**: you can walk through walls and the ground.
- The terrain is the triangulated surface through your grade points: straight between neighbouring
  points, level between points at one height, and level beyond the outermost ones. Under the lowest level's
  footprint (out to its walls' outside faces) it drops to 2" below that level's slab, so the
  basement is empty; the ground is not shaped any further around the house (no window wells,
  no foundation under a wing or porch that has no basement).
- A wall has one thickness; layered walls (siding, sheathing, studs, drywall) are not modeled.
  Both faces of an exterior wall show the siding unless a room on one side sets its own wall
  finish, and window and door reveals always show the wall's own finish. A room's wall finish runs
  the full height of the wall (there are no ceilings yet).
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
