import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Level } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

// The roof (K) and deck tools draw an outline the same way: click the corners, close on the first
// corner, Enter or a double-click; Backspace drops the last corner, Esc clears them.

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: string;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, button = 0): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button, shiftKey: false, altKey: false, modKey: false });
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const click = (x: number, y: number) => {
  dispatchPointer('move', ptr(x, y));
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
  ui().setDrawPhase('existing');
  // No ortho lock, so diagonal corners land where they are clicked.
  useUiStore.setState({ orthoLock: false });
});

describe('roof tool', () => {
  beforeEach(() => switchTool('roof'));

  it('closes on the first corner and adds a gable with its ridge along the longer side, selected', () => {
    for (const [x, y] of [
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
      [0, 0],
    ])
      click(x, y);
    const roofs = Object.values(level().roofs);
    expect(roofs).toHaveLength(1);
    expect(roofs[0]).toMatchObject({ shape: 'gable', ridgeAngle: 0, phase: 'existing' });
    expect(roofs[0].outline).toHaveLength(4);
    expect(ui().selection.roofs).toEqual([roofs[0].id]);
    expect(ui().draft.message).toMatch(/Gable roof added/);
  });

  it('Enter and a double-click close it too; Backspace drops a corner; Esc clears; two corners are refused', () => {
    click(0, 0);
    click(100, 0);
    press('Enter');
    expect(ui().draft.error).toBe(true);
    expect(Object.keys(level().roofs)).toHaveLength(0);
    click(100, 300);
    click(50, 50);
    press('Backspace');
    press('Enter');
    expect(Object.values(level().roofs)[0].outline).toHaveLength(3);
    undo();
    click(0, 0);
    click(100, 0);
    click(100, 100);
    dispatchPointer('dblclick', ptr(100, 100));
    expect(Object.keys(level().roofs)).toHaveLength(1);
    click(0, 0);
    press('Escape');
    press('Enter');
    expect(Object.keys(level().roofs)).toHaveLength(1);
  });

  it('refuses an outline that crosses itself', () => {
    for (const [x, y] of [
      [0, 0],
      [100, 100],
      [100, 0],
      [0, 100],
    ])
      click(x, y);
    press('Enter');
    expect(ui().draft.message).toMatch(/crosses itself/);
    expect(Object.keys(level().roofs)).toHaveLength(0);
  });
});

describe('deck tool', () => {
  beforeEach(() => switchTool('deck'));

  /** An exterior wall along y 0 (outside face y 3), then a 12' x 8' deck drawn south of it. */
  const drawDeck = () => {
    store().addWall(lid, { x: -60, y: 0 }, { x: 204, y: 0 }, { kind: 'exterior', thickness: 6, phase: 'existing' });
    for (const [x, y] of [
      [0, 3],
      [144, 3],
      [144, 99],
      [0, 99],
      [0, 3],
    ])
      click(x, y);
  };

  it('adds a deck 6" below the floor, no railing along the wall, in the drawing phase, selected', () => {
    ui().setDrawPhase('new');
    drawDeck();
    const decks = Object.values(level().decks);
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ elevation: -6, railings: [false, true, true, true], phase: 'new' });
    expect(decks[0].outline).toHaveLength(4);
    expect(ui().selection.decks).toEqual([decks[0].id]);
    expect(ui().draft.message).toMatch(/Deck added, 12' x 8', its top 6" below floor/);
    // Delete with no corners drawn removes it.
    press('Delete');
    expect(level().decks).toEqual({});
  });

  it('refuses two corners and a crossing outline', () => {
    click(0, 0);
    click(100, 0);
    press('Enter');
    expect(ui().draft.message).toMatch(/A deck needs at least 3 corners/);
    click(100, 100);
    click(0, 100);
    click(200, 50);
    press('Enter');
    expect(ui().draft.message).toMatch(/crosses itself/);
    expect(level().decks).toEqual({});
  });

  it('is picked with the select tool before a roof over it, and its corners drag (one undo step) but never cross', () => {
    drawDeck();
    const id = Object.keys(level().decks)[0];
    store().addRoof(lid, { shape: 'flat', outline: [{ x: -100, y: -100 }, { x: 300, y: -100 }, { x: 300, y: 300 }, { x: -100, y: 300 }], ridgeAngle: 0, pitch: 0, overhang: 0, bearingOffset: 0, thickness: 6, fascia: 0, phase: 'existing', finish: 'metal' });
    switchTool('select');
    ui().clearSelection();
    click(72, 50);
    expect(ui().selection.decks).toEqual([id]);
    // Drag the south-east corner 24" further south.
    dispatchPointer('move', ptr(144, 99));
    dispatchPointer('down', ptr(144, 99));
    dispatchPointer('move', ptr(144, 110));
    dispatchPointer('move', ptr(144, 123));
    dispatchPointer('up', ptr(144, 123));
    expect(level().decks[id].outline[2]).toEqual({ x: 144, y: 123 });
    undo();
    expect(level().decks[id].outline[2]).toEqual({ x: 144, y: 99 });
    // Dragged past the west edge, the outline would cross itself: it stays put.
    dispatchPointer('move', ptr(144, 99));
    dispatchPointer('down', ptr(144, 99));
    dispatchPointer('move', ptr(-40, 50));
    dispatchPointer('up', ptr(-40, 50));
    expect(level().decks[id].outline[2]).toEqual({ x: 144, y: 99 });
  });
});
