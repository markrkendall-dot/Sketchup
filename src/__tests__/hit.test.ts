import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { measureText } from '../editor2d/tools/measureTool';
import { displacementText, hitTest } from '../editor2d/tools/selectTool';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Id, Level } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: Id;
let wallId: Id;
let windowId: Id;
let doorId: Id;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, button = 0): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button, shiftKey: false, altKey: false, modKey: false });
const click = (x: number, y: number) => {
  dispatchPointer('down', ptr(x, y));
  dispatchPointer('up', ptr(x, y));
};

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  // One 6" wall along y = 0 from x = 0 to 400: a 60" window centred at 100, a 36" door at 300.
  const r = store().addWall(lid, { x: 0, y: 0 }, { x: 400, y: 0 }, { kind: 'exterior', thickness: 6, phase: 'existing' })!;
  wallId = r.wallIds[0];
  windowId = store().addOpening(lid, { wallId, type: 'window', offset: 100, width: 60, height: 48, sill: 30, phase: 'existing' })!;
  doorId = store().addOpening(lid, { wallId, type: 'door', offset: 300, width: 36, height: 80, sill: 0, phase: 'existing', swing: { hinge: 'a', side: 'left' } })!;
});

describe('hit priority (REVIEW-2 B5)', () => {
  it('hits an opening only inside its own rectangle (plus 2 px); the wall beside it is the wall', () => {
    const l = level();
    expect(hitTest(l, { x: 100, y: 0 }, 1)).toEqual({ kind: 'opening', id: windowId });
    expect(hitTest(l, { x: 71, y: 2.9 }, 1)).toEqual({ kind: 'opening', id: windowId }); // jamb at 70, +2 px
    expect(hitTest(l, { x: 100, y: 4.9 }, 1)).toEqual({ kind: 'opening', id: windowId }); // face at 3, +2 px
    expect(hitTest(l, { x: 67, y: 0 }, 1)).toEqual({ kind: 'wall', id: wallId }); // 3" short of the jamb
    expect(hitTest(l, { x: 135, y: 0 }, 1)).toEqual({ kind: 'wall', id: wallId });
    // The margin is in screen px: zoomed out to 0.25 px/in it is 8".
    expect(hitTest(l, { x: 63, y: 0 }, 0.25)).toEqual({ kind: 'opening', id: windowId });
  });

  it("still picks a door by its leaf or swing out in the room, after the walls", () => {
    // Hinge at the a-side jamb (282), leaf 36" long on the left (-y) side.
    expect(hitTest(level(), { x: 282, y: -30 }, 1)).toEqual({ kind: 'opening', id: doorId });
    expect(hitTest(level(), { x: 277, y: -2 }, 1)).toEqual({ kind: 'wall', id: wallId }); // by the jamb, outside the rectangle
  });

  it('a second click on the selected opening selects its wall; the next click the opening again', () => {
    switchTool('select');
    click(100, 0);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, openings: [windowId] });
    click(100, 0);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, walls: [wallId] });
    click(100, 0);
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, openings: [windowId] });
  });

  it('dragging the selected opening still slides it along the wall', () => {
    switchTool('select');
    click(100, 0);
    dispatchPointer('down', ptr(100, 0));
    dispatchPointer('move', ptr(120, 0));
    dispatchPointer('up', ptr(120, 0));
    expect(ui().selection.openings).toEqual([windowId]);
    expect(level().openings[windowId].offset).toBe(120);
  });
});

describe('live drag displacement (REVIEW-2 B3)', () => {
  it('words a displacement', () => {
    expect(displacementText({ x: 6.5, y: 0 }, 16)).toBe('moved 6 1/2" east');
    expect(displacementText({ x: -2, y: 12 }, 16)).toBe(`moved 2" west, 1'-0" south`);
    expect(displacementText({ x: 0, y: -1 }, 16)).toBe('moved 1" north');
    expect(displacementText({ x: 0, y: 0 }, 16)).toBe('moved 0"');
  });

  it('shows in the draft while a wall is dragged, and goes on release', () => {
    switchTool('select');
    dispatchPointer('down', ptr(200, 0));
    dispatchPointer('move', ptr(200, 10));
    expect(ui().draft.dragReadout).toBe('moved 10" south');
    dispatchPointer('up', ptr(200, 10));
    expect(ui().draft.dragReadout).toBeNull();
  });
});

describe('measure tool (REVIEW-2 B3)', () => {
  const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);

  it('measures between two snapped clicks and keeps the result until Esc; the plan is untouched', () => {
    switchTool('measure');
    const plan = store().plan;
    const steps = usePlanStore.temporal.getState().pastStates.length;
    click(0, 40);
    dispatchPointer('move', ptr(120, 130));
    expect(ui().draft.measure).toEqual({ a: { x: 0, y: 40 }, b: null });
    click(120, 130);
    expect(ui().draft.message).toBe(`Measured 12'-6" (dx 10'-0", dy 7'-6")`);
    dispatchPointer('move', ptr(300, 300));
    expect(ui().draft.message).toBe(`Measured 12'-6" (dx 10'-0", dy 7'-6")`);
    // A third click starts again.
    click(10, 40);
    expect(ui().draft.measure).toEqual({ a: { x: 10, y: 40 }, b: null });
    expect(ui().draft.message).toBeNull();
    click(10, 100);
    expect(press('Escape')).toBe(true);
    expect(ui().draft.measure).toBeNull();
    expect(ui().draft.message).toBeNull();
    expect(store().plan).toBe(plan);
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(steps);
  });

  it('snaps to the inside corner of wall faces', () => {
    store().addWall(lid, { x: 400, y: 0 }, { x: 400, y: 200 }, { kind: 'exterior', thickness: 6, phase: 'existing' });
    switchTool('measure');
    dispatchPointer('move', ptr(395, 5));
    expect(ui().draft.snap?.kind).toBe('face-corner');
    expect(ui().draft.snap?.point).toEqual({ x: 397, y: 3 });
  });

  it('formats the readout', () => {
    expect(measureText({ x: 0, y: 0 }, { x: -120, y: 90 }, 16)).toBe(`12'-6" (dx 10'-0", dy 7'-6")`);
  });
});
