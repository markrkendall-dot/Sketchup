# HomePlan

HomePlan is a browser floor-plan editor for one job: getting the house you live in onto the
screen from tape measurements, then drawing the changes you want (moved walls, an addition) and
seeing them in 3D. You type wall lengths the way a tape gives them (`12'6`, `150`, `6 1/2"`),
walls join and split themselves, rooms are found and measured automatically, and the 3D model
exports to SketchUp. It is a focused tool, not a Home Designer Pro clone: no roofs, cabinets,
furniture or construction drawings. Everything runs in your browser; nothing is uploaded.

## Quick start

```sh
npm install
npm run dev        # then open the URL it prints (http://localhost:5173)
```

`npm run build` makes a static site in `dist/` that runs from any static web host (also from a
subfolder): copy the folder up, or try it locally with `npm run preview`. `npm test` runs the
unit tests.

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

## Planning the renovation

1. Switch the view to **All** (the toolbar, or `V` to cycle). All shows existing walls in grey,
   walls to demolish in dashed red and new walls in green.
2. Set **Draw as: new**. Everything you draw from now on is new work: new walls, the addition
   (start its walls on the existing exterior wall so they join as T junctions), new doors.
3. To remove something, select it and click **Mark demolish**. That works for walls, doors,
   windows and stairs; a window that becomes a door is a demolished window plus a new door.
4. Flip between **Existing** (what is there, with the demolition shown) and **Proposed** (what
   it will be). Rooms are found per view, so in Proposed two rooms whose dividing wall is
   demolished become one, with its new net area.

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
  a group; walls are named by kind and phase.
- **OBJ (.obj)**, in inches: when importing, set the units to inches.

## Keyboard shortcuts

Press `?` in the app for the full list (it is generated from the same table the shortcuts run
from). Shortcuts do nothing while you type in a field; Enter in a field commits it and hands the
keyboard back to the plan.

| Keys | Action |
| --- | --- |
| `S` `W` `R` `D` `N` `P` `T` `U` | Select, Wall, Room, Door, Window, Passage, Stairs, Underlay |
| digits, `'`, `"`, space, `/`, then Enter | Type a length or a distance while drawing |
| `Esc` | Clear the typed length, then end the wall chain / clear the selection |
| `X` | Next wall exterior or interior |
| `Shift` (hold) | Invert ortho lock; with ortho off, 15° steps |
| `Tab` / `Shift+Tab` | Door swing side / hinge; stairs turn 90° |
| `Delete` | Delete the selection |
| `1` `2` `3` | Levels, bottom to top |
| `V` | Cycle view: Existing, Proposed, All |
| `O` / `G` | Ortho lock / grid |
| `Z` or `Home` | Zoom the plan to fit (also the Fit button) |
| `` ` `` | Cycle layout: 2D, Split, 3D |
| `F` | Walk mode (Split or 3D layout) |
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
history). **New** asks before discarding a plan that has walls.

The file is plain JSON with a `schemaVersion`; lengths are inches. Older files are upgraded on
open, and unknown fields are dropped. Underlay images are stored inside the file (downscaled),
so a plan with photos can be a few megabytes.

## Known limitations

- No roofs, ceilings or gables; the 3D model is walls, floors and stairs.
- No collision in walk mode: you can walk through walls.
- No cabinets, fixtures, furniture, or text and dimension annotations you place yourself.
- A wall has one thickness; layered walls (siding, sheathing, studs, drywall) are not modeled.
- At most one wall between two corners, and walls are straight (no curved walls).
- "Lengths to" inside/outside assumes square corners; at other angles a typed length is
  measured along the centerline.
- Dimensions on the plan are centerline lengths of each wall piece; face-to-face sizes are in
  the room's properties.
- Openings are rectangular holes; window and door frames are not modeled in 3D.
