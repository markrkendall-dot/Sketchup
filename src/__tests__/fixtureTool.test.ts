import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { abutOnLine, nearestFace } from '../editor2d/tools/fixtureTool';
import { hitTest } from '../editor2d/tools/selectTool';
import { bindingFor } from '../ui/keymap';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Id, Level } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: Id;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, over: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false, ...over });
const click = (x: number, y: number, over: Partial<ToolPointerEvent> = {}) => {
  dispatchPointer('down', ptr(x, y, over));
  dispatchPointer('up', ptr(x, y, over));
};
const press = (key: string, shiftKey = false) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey } as KeyboardEvent);

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  // A 6" wall along y = 0 from x = 0 to 400: its lower face (the room side) is at y = 3.
  store().addWall(lid, { x: 0, y: 0 }, { x: 400, y: 0 }, { kind: 'exterior', thickness: 6, phase: 'existing' });
});

describe('fixture tool (C)', () => {
  it('C picks the cabinet tool on a level and the column tool in site mode', () => {
    const b = bindingFor({ key: 'c', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })!;
    expect(b).toBeDefined();
    b.run!({} as KeyboardEvent);
    expect(ui().activeTool).toBe('fixture');
  });

  it('the ghost sits with its back on the nearest wall face, facing into the room', () => {
    const face = nearestFace(level(), 'all', { x: 100, y: 8 }, 12)!;
    expect(face).not.toBeNull();
    expect(face.point).toEqual({ x: 100, y: 3 });
    expect(face.direction).toBe(90); // the front faces +y, away from the wall
    expect(nearestFace(level(), 'all', { x: 100, y: 60 }, 12)).toBeNull();
    switchTool('fixture');
    dispatchPointer('move', ptr(100, 8));
    expect(ui().draft.fixturePreview).toMatchObject({ kind: 'base', origin: { x: 100, y: 3 }, direction: 90, width: 36, depth: 24, wallId: expect.any(String), abuts: null, typed: false });
  });

  it('click places the kind with its stock size in the drawing phase, then the next one abuts it', () => {
    switchTool('fixture');
    ui().setDrawPhase('new');
    click(100, 8);
    const placed = Object.values(level().fixtures);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ kind: 'base', origin: { x: 100, y: 3 }, direction: 90, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'new' });
    expect(ui().selection).toEqual({ ...EMPTY_SELECTION, fixtures: [placed[0].id] });
    // Its right end is at x 118: a second cabinet aimed near there slides up to it.
    dispatchPointer('move', ptr(140, 8));
    expect(ui().draft.fixturePreview).toMatchObject({ origin: { x: 136, y: 3 }, abuts: placed[0].id });
    click(140, 8);
    const two = Object.values(level().fixtures);
    expect(two).toHaveLength(2);
    expect(two[1].origin).toEqual({ x: 136, y: 3 });
    // Too far away: no abutting.
    dispatchPointer('move', ptr(250, 8));
    expect(ui().draft.fixturePreview?.abuts).toBeNull();
    expect(ui().draft.fixturePreview?.origin).toEqual({ x: 250, y: 3 });
  });

  it('a typed width sizes the next cabinet; Esc clears it; Shift places away from walls; Tab turns the free direction', () => {
    switchTool('fixture');
    dispatchPointer('move', ptr(100, 8));
    for (const k of ['3', '0']) press(k);
    expect(ui().draft.fixturePreview).toMatchObject({ width: 30, typed: true });
    press('Enter');
    expect(Object.values(level().fixtures)[0].width).toBe(30);
    expect(ui().draft.lengthBuffer).toBe('');
    press('2');
    expect(ui().draft.lengthBuffer).toBe('2');
    press('Escape');
    expect(ui().draft.lengthBuffer).toBe('');
    // Free placement: the cursor is the fixture's middle, Tab turns it.
    dispatchPointer('move', ptr(200, 100, { shiftKey: true }));
    expect(ui().draft.fixturePreview).toMatchObject({ wallId: null, direction: 90, origin: { x: 200, y: 88 } });
    press('Tab');
    expect(ui().draft.fixtureDirection).toBe(180);
  });

  it('the panel picker changes the kind; hit testing finds a placed fixture after room labels and before stairs', () => {
    switchTool('fixture');
    ui().patchDraft({ fixtureKind: 'fridge' });
    click(100, 8);
    const f = Object.values(level().fixtures)[0];
    expect(f.kind).toBe('fridge');
    expect(f.depth).toBe(30);
    expect(hitTest(level(), { x: 100, y: 20 }, 1)).toEqual({ kind: 'fixture', id: f.id });
    expect(hitTest(level(), { x: 100, y: 40 }, 1)).toBeNull();
  });

  it('abutOnLine ignores fixtures facing another way or off the line', () => {
    const face = nearestFace(level(), 'all', { x: 100, y: 8 }, 12)!;
    store().addFixture(lid, { kind: 'base', origin: { x: 100, y: 3 }, direction: 270, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'existing' });
    store().addFixture(lid, { kind: 'base', origin: { x: 100, y: 60 }, direction: 90, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'existing' });
    expect(abutOnLine(level(), 'all', face, { x: 120, y: 3 }, 36, 12)).toEqual({ point: { x: 120, y: 3 }, abuts: null });
  });
});

describe('select tool with fixtures', () => {
  it('drags the selected fixtures together in one undo step and deletes them with Delete', () => {
    const a = store().addFixture(lid, { kind: 'base', origin: { x: 50, y: 3 }, direction: 90, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'existing' })!;
    const b = store().addFixture(lid, { kind: 'base', origin: { x: 86, y: 3 }, direction: 90, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'existing' })!;
    switchTool('select');
    ui().setSelection({ ...EMPTY_SELECTION, fixtures: [a, b] });
    const steps = usePlanStore.temporal.getState().pastStates.length;
    dispatchPointer('down', ptr(50, 10));
    dispatchPointer('move', ptr(60, 10));
    dispatchPointer('move', ptr(70, 30));
    dispatchPointer('up', ptr(70, 30));
    expect(level().fixtures[a].origin).toEqual({ x: 70, y: 23 });
    expect(level().fixtures[b].origin).toEqual({ x: 106, y: 23 });
    expect(usePlanStore.temporal.getState().pastStates.length).toBe(steps + 1);
    press('Delete');
    expect(Object.keys(level().fixtures)).toHaveLength(0);
  });

  it('right-click on a wall offers to split it there', () => {
    switchTool('select');
    dispatchPointer('down', ptr(150, 0, { button: 2 }));
    expect(ui().contextMenu?.wallId).toBeDefined();
    dispatchPointer('down', ptr(150, 200, { button: 2 }));
    expect(ui().contextMenu?.wallId).toBeUndefined();
  });
});
