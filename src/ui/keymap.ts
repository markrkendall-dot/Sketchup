// The keyboard map: one table that the global hotkey handler (App.tsx) runs and the help overlay
// (HelpOverlay.tsx) lists, so the two cannot drift apart. Rows without `combos` are keys the active
// tool or the 3D walk view handles itself; they are here so the help lists them.
import { activateUnderlayTool, cycleViewMode, switchLevelByIndex, switchTool } from '../editor2d/tools';
import { redo, undo } from '../store/planStore';
import { isNarrow, LAYOUTS, useUiStore, type ToolName } from '../store/uiStore';
import { choosePlanFile, savePlan, zoomToFit } from './fileActions';

export type KeyGroup = 'Tools' | 'While drawing' | 'View' | 'Edit and file' | '3D and walk';

export const KEY_GROUPS: readonly KeyGroup[] = ['Tools', 'While drawing', 'View', 'Edit and file', '3D and walk'];

export interface KeyBinding {
  /** How the help shows the keys, e.g. "Ctrl/Cmd+Z". */
  keys: string;
  label: string;
  group: KeyGroup;
  /**
   * Normalized key combos (see comboOf) the global handler runs this binding for. Omitted for
   * keys the tools or the walk view handle themselves.
   */
  combos?: readonly string[];
  /** Return false when the key did nothing (the browser then keeps its default). */
  run?: (e: KeyboardEvent) => void | boolean;
  /** Also runs while a wall chain or an underlay calibration is in progress. */
  whileDrawing?: boolean;
  /** Also runs for auto-repeated key presses (held keys). */
  repeat?: boolean;
}

/**
 * A key event as a combo string: "mod+" for Ctrl or Cmd, then "alt+", then "shift+" (letters and
 * named keys only; a symbol such as "?" already says Shift), then the key, letters lowercased.
 * Examples: "w", "mod+z", "mod+shift+z", "?", "Home", "`".
 */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && (/^[a-z]$/.test(key) || key.length > 1)) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const tool = (key: string, name: ToolName, label: string): KeyBinding => ({
  keys: key.toUpperCase(),
  label,
  group: 'Tools',
  combos: [key],
  // The underlay tool opens the image picker when the level has no image yet.
  run: () => (name === 'underlay' ? activateUnderlayTool() : switchTool(name)),
  whileDrawing: true,
});

function cycleLayout(): void {
  const ui = useUiStore.getState();
  ui.setLayout(LAYOUTS[(LAYOUTS.indexOf(ui.layout) + 1) % LAYOUTS.length]);
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  tool('s', 'select', 'Select, move and delete: click a wall, corner, opening or room label; drag to move; drag empty space to box-select'),
  tool('w', 'wall', 'Draw walls: click to start, click or type a length for each wall; Esc, double-click or right-click ends the chain'),
  tool('r', 'room', 'Name a room: click inside a closed area; click a label to select it, drag to move it, double-click to rename'),
  tool('d', 'door', 'Place a door: point at a wall, click to place, or type the distance from the nearer corner and press Enter'),
  tool('n', 'window', 'Place a window: point at a wall, click to place, or type the distance from the nearer corner and press Enter'),
  tool('p', 'passage', 'Place a passage (an opening without a door), the same way as a door'),
  tool('t', 'stairs', 'Place stairs: move the mouse the way they go up, click to place the bottom step; edit the size in the properties panel'),
  tool('k', 'roof', 'Draw a roof: click the outline corners (they snap to the outside wall faces), click the first corner or press Enter to close; set the shape, ridge and slope in the properties panel'),
  tool('u', 'underlay', 'Image underlay: load, move, scale by two points; lock it, then trace walls with W'),

  { keys: "12'6  150  6 1/2\"", label: "Type a length (walls), or the distance from the nearer corner's inside face to the near edge (doors, windows, passages); Enter commits", group: 'While drawing' },
  { keys: 'Enter or click', label: 'Walls: with nothing typed, commit the wall at the cursor', group: 'While drawing' },
  { keys: 'Backspace', label: 'Edit the typed length; roof: remove the last corner', group: 'While drawing' },
  { keys: 'Esc', label: 'Clear the typed length, then finish the wall chain; roof: cancel the outline; with Select, clear the selection', group: 'While drawing' },
  {
    keys: 'X',
    label: 'Next wall: exterior or interior',
    group: 'While drawing',
    combos: ['x'],
    run: () => useUiStore.getState().toggleWallKind(),
    whileDrawing: true,
  },
  { keys: 'Shift (hold)', label: 'Invert ortho lock; with ortho off, 15° steps', group: 'While drawing' },
  { keys: 'Tab / Shift+Tab', label: 'Door: flip the swing side / the hinge; stairs: turn 90°', group: 'While drawing' },
  { keys: 'Delete', label: 'Delete the selection', group: 'While drawing' },
  { keys: 'Enter / F2', label: 'Rename the selected room', group: 'While drawing' },
  { keys: 'Arrows (Shift)', label: 'Nudge the selected underlay 1" (1\')', group: 'While drawing' },

  {
    keys: '1 2 3',
    label: 'Switch level, bottom to top',
    group: 'View',
    combos: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    run: (e) => switchLevelByIndex(Number(e.key) - 1),
  },
  { keys: 'V', label: 'Cycle view: Existing, Proposed, All', group: 'View', combos: ['v'], run: () => cycleViewMode() },
  {
    keys: 'O',
    label: 'Ortho lock on or off',
    group: 'View',
    combos: ['o'],
    run: () => {
      const ui = useUiStore.getState();
      ui.setOrthoLock(!ui.orthoLock);
    },
  },
  { keys: 'G', label: 'Grid on or off', group: 'View', combos: ['g'], run: () => useUiStore.getState().toggleGrid() },
  {
    keys: '[',
    label: 'Narrow window (under 900 px): show or hide the level bar',
    group: 'View',
    combos: ['['],
    run: () => {
      if (!isNarrow()) return false;
      useUiStore.getState().toggleLevelBar();
    },
    whileDrawing: true,
  },
  {
    keys: ']',
    label: 'Narrow window (under 900 px): show or hide the properties panel',
    group: 'View',
    combos: [']'],
    run: () => {
      if (!isNarrow()) return false;
      useUiStore.getState().toggleProperties();
    },
    whileDrawing: true,
  },
  { keys: 'Z / Home', label: 'Zoom the plan to fit', group: 'View', combos: ['z', 'Home'], run: () => zoomToFit(), whileDrawing: true },
  { keys: '`', label: 'Cycle layout: 2D, Split, 3D', group: 'View', combos: ['`'], run: () => cycleLayout(), whileDrawing: true },
  { keys: 'Space + drag, middle drag', label: 'Pan the plan', group: 'View' },
  { keys: 'Mouse wheel', label: 'Zoom the plan about the cursor', group: 'View' },
  {
    keys: '?',
    label: 'Show or hide this help',
    group: 'View',
    combos: ['?'],
    run: () => {
      const ui = useUiStore.getState();
      ui.setHelpOpen(!ui.helpOpen);
    },
    whileDrawing: true,
  },

  { keys: 'Ctrl/Cmd+Z', label: 'Undo', group: 'Edit and file', combos: ['mod+z'], run: () => undo(), whileDrawing: true, repeat: true },
  {
    keys: 'Ctrl/Cmd+Shift+Z, Ctrl+Y',
    label: 'Redo',
    group: 'Edit and file',
    combos: ['mod+shift+z', 'mod+y'],
    run: () => redo(),
    whileDrawing: true,
    repeat: true,
  },
  { keys: 'Ctrl/Cmd+S', label: 'Save the plan as a JSON file', group: 'Edit and file', combos: ['mod+s'], run: () => savePlan(), whileDrawing: true },
  { keys: 'Ctrl/Cmd+O', label: 'Open a plan file (replaces this plan)', group: 'Edit and file', combos: ['mod+o'], run: () => choosePlanFile(), whileDrawing: true },

  {
    keys: 'F',
    label: 'Walk through the model (in the Split or 3D layout)',
    group: '3D and walk',
    combos: ['f'],
    run: () => {
      const ui = useUiStore.getState();
      // No 3D view to walk in: the 2D layout, or the split layout in a window too narrow for its 3D pane.
      if (ui.layout === '2d' || (ui.layout === 'split' && isNarrow())) return false;
      ui.setCameraMode('walk');
    },
  },
  { keys: 'W A S D / arrows', label: 'Walk: move (Shift: faster); drag or click to look around', group: '3D and walk' },
  { keys: 'Q / E, PageDown / PageUp', label: 'Walk: level down / up', group: '3D and walk' },
  { keys: 'Esc / F', label: 'Walk: back to orbit', group: '3D and walk' },
];

const byCombo = new Map<string, KeyBinding>();
for (const b of KEY_BINDINGS) for (const c of b.combos ?? []) byCombo.set(c, b);

/** The binding the global handler runs for a key event, if any. */
export const bindingFor = (e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): KeyBinding | undefined =>
  byCombo.get(comboOf(e));
