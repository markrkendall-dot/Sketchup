import { beforeEach, describe, expect, it } from 'vitest';
import { applyBufferKey } from '../editor2d/tools/lengthBuffer';
import { dispatchKey, dispatchPointer, type ToolPointerEvent } from '../editor2d/tools';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const plan = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
const level = () => plan().plan.levels[ui().activeLevelId];
const walls = () => Object.values(level().walls);
const len = (w: ReturnType<typeof walls>[number]) => {
  const a = level().nodes[w.a];
  const b = level().nodes[w.b];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const ptr = (x: number, y: number, button = 0): ToolPointerEvent => ({
  world: { x, y },
  screen: { x, y },
  button,
  shiftKey: false,
  altKey: false,
  modKey: false,
});
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const type = (text: string) => {
  for (const ch of text) press(ch);
};

beforeEach(() => {
  plan().setPlan(createEmptyPlan());
  clearHistory();
  ui().setOrthoLock(true);
  ui().setMeasureTo('center');
  ui().setActiveLevel(defaultLevelId(plan().plan));
  ui().setTool('wall');
});

describe('wall tool: undo mid-chain', () => {
  it('ends the chain when undo removes the wall it continues from', () => {
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('move', ptr(100, 0));
    dispatchPointer('down', ptr(100, 0));
    expect(walls()).toHaveLength(1);
    expect(ui().draft.wallStart).not.toBeNull();
    undo();
    expect(walls()).toHaveLength(0);
    expect(ui().draft.wallStart).toBeNull();
    expect(ui().draft.wallPreview).toBeNull();
    expect(ui().draft.message).toBe('Undid the last wall. Click to start again.');
  });

  it('also notices on the next pointer move or key when the history was stepped directly', () => {
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('down', ptr(100, 0));
    usePlanStore.temporal.getState().undo();
    expect(ui().draft.wallStart).not.toBeNull();
    dispatchPointer('move', ptr(50, 50));
    expect(ui().draft.wallStart).toBeNull();
    expect(ui().draft.message).toBe('Undid the last wall. Click to start again.');
  });

  it('ends the chain after undoing the latest of several walls', () => {
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('down', ptr(100, 0));
    dispatchPointer('down', ptr(100, 100));
    expect(walls()).toHaveLength(2);
    undo();
    expect(ui().draft.wallStart).toBeNull();
  });
});

describe('wall tool: typed lengths', () => {
  const typedWall = (text: string) => {
    ui().resetDraft();
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('move', ptr(100, 0));
    type(text);
    press('Enter');
  };

  it('"12 6" is 12 feet 6 inches', () => {
    typedWall('12 6');
    expect(walls().map(len)).toEqual([150]);
    expect(ui().draft.error).toBe(false);
  });

  it.each(['-5', '0', '-0'])('rejects %s as not greater than 0', (text) => {
    typedWall(text);
    expect(walls()).toHaveLength(0);
    expect(ui().draft.error).toBe(true);
    expect(ui().draft.message).toBe('Must be greater than 0.');
  });

  it.each(['1e3', '12,5', '12 13'])('rejects %s instead of reading part of it', (text) => {
    typedWall(text);
    expect(walls()).toHaveLength(0);
    expect(ui().draft.error).toBe(true);
    expect(ui().draft.lengthBuffer).toBe(text);
    expect(ui().draft.message).toBe(`Can't read "${text}" as a length.`);
  });
});

describe('length buffer keys', () => {
  it('starts only on length characters but then keeps whatever is typed', () => {
    expect(applyBufferKey('', 'e')).toBeNull();
    expect(applyBufferKey('', 'Shift')).toBeNull();
    expect(applyBufferKey('', '1')).toBe('1');
    expect(applyBufferKey('1', 'e')).toBe('1e');
    expect(applyBufferKey('12', ',')).toBe('12,');
    expect(applyBufferKey('12', 'X')).toBe('12x');
    expect(applyBufferKey('12', 'Enter')).toBeNull();
  });

  it('turns typographic quotes into feet and inch marks', () => {
    expect(applyBufferKey('12', '’')).toBe("12'");
    expect(applyBufferKey("12'6", '”')).toBe('12\'6"');
    expect(applyBufferKey('', '−')).toBe('-');
  });

  it('Backspace edits the buffer and is ignored on an empty one', () => {
    expect(applyBufferKey('12', 'Backspace')).toBe('1');
    expect(applyBufferKey('', 'Backspace')).toBeNull();
  });
});
