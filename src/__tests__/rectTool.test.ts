import { beforeEach, describe, expect, it } from 'vitest';
import { getFaces, roomDimensions } from '../derive/rooms';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { splitSizePair } from '../editor2d/tools/lengthBuffer';
import { BOTH_SIZES_MESSAGE } from '../editor2d/tools/rectTool';
import { createEmptyPlan, defaultLevelId, WALL_OVERLAP_MESSAGE } from '../model/plan';
import type { Level } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: string;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, button = 0): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button, shiftKey: false, altKey: false, modKey: false });
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const type = (text: string) => {
  for (const ch of text) press(ch);
};
const nets = () =>
  getFaces(level(), ui().viewMode)
    .faces.map((f) => roomDimensions(f.netPolygon).rect)
    .filter(Boolean);
/** Corners of the walls' bounding box (centerlines). */
const extent = () => {
  const ns = Object.values(level().nodes);
  return { minX: Math.min(...ns.map((n) => n.x)), minY: Math.min(...ns.map((n) => n.y)), maxX: Math.max(...ns.map((n) => n.x)), maxY: Math.max(...ns.map((n) => n.y)) };
};

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  ui().setMeasureTo('center');
  ui().setDrawPhase('existing');
  useUiStore.setState({ nextWallKind: 'exterior', showLevelBelow: false });
  switchTool('rect');
});

/** Click the first corner at (x, y), point toward (cx, cy), type the sizes and press Enter. */
function typedBox(x: number, y: number, cx: number, cy: number, text: string): void {
  dispatchPointer('move', ptr(x, y));
  dispatchPointer('down', ptr(x, y));
  dispatchPointer('move', ptr(cx, cy));
  type(text);
  press('Enter');
}

describe('size pairs', () => {
  it.each([
    ["12' x 10'", "12'", "10'"],
    ["12'x10'", "12'", "10'"],
    ["12' × 10'", "12'", "10'"],
    ["12' by 10'", "12'", "10'"],
    ["12'1 x 9'5", "12'1", "9'5"],
  ])('%s splits into its two lengths', (text, a, b) => {
    expect(splitSizePair(text)).toEqual({ first: a, second: b });
  });

  it('has no second size before a separator', () => {
    expect(splitSizePair("12'")).toEqual({ first: "12'", second: null });
    expect(splitSizePair("12' x")).toEqual({ first: "12'", second: '' });
  });
});

describe('rectangle tool (REVIEW-2 B2)', () => {
  it('inside face: 12\' x 10\' gives a room with a net 144 x 120, in one undo step', () => {
    ui().setMeasureTo('inside');
    const steps = usePlanStore.temporal.getState().pastStates.length;
    typedBox(0, 0, 50, 50, "12' x 10'");
    expect(Object.keys(level().walls)).toHaveLength(4);
    expect(nets()).toEqual([{ width: 144, depth: 120 }]);
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(steps + 1);
    expect(ui().draft.rectStart).toBeNull();
    expect(ui().draft.message).toMatch(/^Drew a 12'-0" x 10'-0" inside box\./);
    undo();
    expect(Object.keys(level().walls)).toHaveLength(0);
  });

  it('outside face and centerline sizes', () => {
    ui().setMeasureTo('outside');
    typedBox(0, 0, 50, 50, "12' x 10'");
    // The outside size less a wall thickness each way (the default exterior thickness).
    const t = store().plan.settings.defaultExteriorThickness;
    expect(nets()).toEqual([{ width: 144 - 2 * t, depth: 120 - 2 * t }]);
    store().setPlan(createEmptyPlan());
    lid = defaultLevelId(store().plan);
    ui().setActiveLevel(lid);
    ui().setMeasureTo('center');
    typedBox(0, 0, 50, 50, "12'x10'");
    expect(extent()).toEqual({ minX: 0, minY: 0, maxX: 144, maxY: 120 });
  });

  it('draws toward the cursor quadrant, and takes Tab between the sizes', () => {
    dispatchPointer('down', ptr(100, 100));
    dispatchPointer('move', ptr(40, 60)); // up and to the left
    type("10'");
    press('Tab');
    expect(ui().draft.lengthBuffer).toBe("10' x ");
    type("5'");
    expect(ui().draft.rectPreview?.typed).toBe(true);
    press('Enter');
    expect(extent()).toEqual({ minX: -20, minY: 40, maxX: 100, maxY: 100 });
  });

  it('"by" works as the separator', () => {
    typedBox(0, 0, 10, -10, "8' by 6'");
    expect(extent()).toEqual({ minX: 0, minY: -72, maxX: 96, maxY: 0 });
  });

  it('a click commits at the cursor corner', () => {
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('move', ptr(120, 96));
    dispatchPointer('down', ptr(120, 96));
    expect(Object.keys(level().walls)).toHaveLength(4);
    expect(extent()).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 96 });
  });

  it('needs both sizes; Esc clears the typing, then the corner', () => {
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('move', ptr(20, 20));
    type("12'");
    press('Enter');
    expect(ui().draft.message).toBe(BOTH_SIZES_MESSAGE);
    expect(ui().draft.error).toBe(true);
    expect(Object.keys(level().walls)).toHaveLength(0);
    press('Escape');
    expect(ui().draft.lengthBuffer).toBe('');
    expect(ui().draft.rectStart).not.toBeNull();
    press('Escape');
    expect(ui().draft.rectStart).toBeNull();
  });

  it('reuses a wall already along one side, with its thickness for the inside size', () => {
    // An existing 9" wall along x = 0 from y = -50 to 300.
    store().addWall(lid, { x: 0, y: -50 }, { x: 0, y: 300 }, { kind: 'exterior', thickness: 9, phase: 'existing' });
    ui().setMeasureTo('inside');
    ui().setDrawPhase('new');
    typedBox(0, 0, 50, 50, "12'1 x 9'5");
    const walls = Object.values(level().walls);
    // The old wall split at the two corners (3 pieces, all existing) plus three new walls.
    expect(walls.filter((w) => w.phase === 'new')).toHaveLength(3);
    expect(walls.filter((w) => w.phase === 'existing')).toHaveLength(3);
    expect(nets()).toEqual([{ width: 145, depth: 113 }]);
    expect(ui().draft.message).toMatch(/reusing the wall already there/);
  });

  it('refuses the whole box when a side would lie on a hidden wall, and keeps the corner', () => {
    store().addWall(lid, { x: 0, y: 0 }, { x: 200, y: 0 }, { kind: 'exterior', thickness: 6.5, phase: 'existing' });
    store().setPhase(lid, { walls: Object.keys(level().walls), openings: [] }, 'demo');
    ui().setViewMode('proposed');
    const before = store().plan;
    typedBox(0, 0, 50, 50, "10' x 10'");
    expect(store().plan).toBe(before);
    expect(ui().draft.message).toBe(WALL_OVERLAP_MESSAGE);
    expect(ui().draft.rectStart).not.toBeNull();
  });
});
