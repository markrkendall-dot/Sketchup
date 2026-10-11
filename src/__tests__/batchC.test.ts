import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { facesBesideWall, getFaces } from '../derive/rooms';
import { wallPreviewText } from '../editor2d/previewLabel';
import { dispatchKey, dispatchPointer, type ToolPointerEvent } from '../editor2d/tools';
import { centerlineToFace } from '../editor2d/tools/wallTool';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Vec2 } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { isNarrow, useUiStore } from '../store/uiStore';
import { noteDuplicateRoomName, openPlanFile, showNotice } from '../ui/fileActions';
import { bindingFor } from '../ui/keymap';

const plan = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
const ptr = (x: number, y: number): ToolPointerEvent => ({
  world: { x, y },
  screen: { x, y },
  button: 0,
  shiftKey: false,
  altKey: false,
  modKey: false,
});
const press = (key: string) => dispatchKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
const type = (text: string) => {
  for (const ch of text) press(ch);
};
const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;

function box(levelId: string, x0: number, y0: number, x1: number, y1: number): void {
  const pts: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  pts.forEach((p, i) => plan().addWall(levelId, p, pts[(i + 1) % 4], ext));
}

let lower: string;
let upper: string;

beforeEach(() => {
  plan().setPlan(createEmptyPlan());
  clearHistory();
  lower = defaultLevelId(plan().plan);
  upper = plan().plan.levelOrder[plan().plan.levelOrder.indexOf(lower) + 1];
  ui().setOrthoLock(true);
  ui().setMeasureTo('center');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  ui().setNotice(null);
  ui().setTool('wall');
  useUiStore.setState({ showLevelBelow: false });
});

describe('item 8: ghost snapping with the wall tool', () => {
  beforeEach(() => {
    box(lower, 100, 100, 400, 300);
    ui().setActiveLevel(upper);
    ui().setTool('wall');
  });

  it('snaps to a corner of the level below and starts a new node there', () => {
    ui().toggleShowLevelBelow();
    dispatchPointer('move', ptr(104, 97));
    expect(ui().draft.snap?.kind).toBe('ghost-node');
    expect(ui().draft.snap?.nodeId).toBeUndefined();
    dispatchPointer('down', ptr(104, 97));
    type('12');
    press('Enter');
    const nodes = Object.values(plan().plan.levels[upper].nodes);
    expect(nodes).toHaveLength(2);
    expect(nodes.some((n) => n.x === 100 && n.y === 100)).toBe(true);
    // Never a reference to the lower level's ids.
    const lowerIds = new Set(Object.keys(plan().plan.levels[lower].nodes));
    expect(nodes.every((n) => !lowerIds.has(n.id))).toBe(true);
  });

  it('snaps onto a wall of the level below, and not at all with the ghost off', () => {
    ui().toggleShowLevelBelow();
    dispatchPointer('move', ptr(250, 104));
    expect(ui().draft.snap?.kind).toBe('ghost-wall');
    expect(ui().draft.snap?.point).toEqual({ x: 250, y: 100 });
    ui().toggleShowLevelBelow();
    dispatchPointer('move', ptr(104, 97));
    expect(ui().draft.snap?.kind).toBe('grid');
  });

  it('respects the view mode: a hidden wall of the level below does not snap', () => {
    ui().toggleShowLevelBelow();
    ui().setViewMode('proposed');
    plan().setPhase(lower, { walls: Object.keys(plan().plan.levels[lower].walls), openings: [], stairs: [] }, 'demo');
    ui().setViewMode('proposed');
    dispatchPointer('move', ptr(104, 97));
    expect(ui().draft.snap?.kind).toBe('grid');
    ui().setViewMode('all');
  });
});

describe('item 10: face-to-face feedback', () => {
  it('centerlineToFace inverts the typed-length rule', () => {
    // Inside: 6.5" walls turning a square corner add 6.5" to the typed length.
    const dir = { x: 1, y: 0 };
    const prev = { x: 0, y: 1 };
    expect(centerlineToFace(377, 'inside', 6.5, dir, prev, 6.5)).toBeCloseTo(370.5);
    expect(centerlineToFace(377, 'outside', 6.5, dir, prev, 6.5)).toBeCloseTo(383.5);
    expect(centerlineToFace(377, 'center', 6.5, dir, prev, 6.5)).toBe(377);
    // Not square: unchanged.
    expect(centerlineToFace(377, 'inside', 6.5, dir, { x: 0.6, y: 0.8 }, 6.5)).toBe(377);
  });

  it('the typed preview carries both lengths while a face is measured', () => {
    ui().setActiveLevel(lower);
    ui().setMeasureTo('inside');
    dispatchPointer('down', ptr(0, 0));
    type('370.5');
    const pv = ui().draft.wallPreview!;
    expect(pv.typed).toBe(true);
    expect(pv.face).toEqual({ measureTo: 'inside', length: 370.5 });
    expect(pv.length).toBeCloseTo(377); // 6.5" new wall: half + half
    expect(wallPreviewText(pv, 16)).toBe(`30'-10 1/2" inside (31'-5" centerline)`);
    ui().setMeasureTo('center');
    press('Escape');
    type('36');
    expect(ui().draft.wallPreview!.face).toBeUndefined();
  });

  it('the cursor preview shows the face length too', () => {
    ui().setActiveLevel(lower);
    ui().setMeasureTo('outside');
    dispatchPointer('down', ptr(0, 0));
    dispatchPointer('move', ptr(120, 0));
    const pv = ui().draft.wallPreview!;
    expect(pv.typed).toBe(false);
    expect(pv.face?.measureTo).toBe('outside');
    // Outside faces are further apart than the centerlines by half of each wall.
    expect(pv.face!.length).toBeCloseTo(126.5);
    expect(wallPreviewText(pv, 16)).toBe(`10'-6 1/2" outside (10'-0" centerline)`);
  });
});

describe('item 10 and 11: the room on each side of a wall', () => {
  it('finds the faces on the left and right of a wall', () => {
    box(lower, 0, 0, 200, 100);
    const level = plan().plan.levels[lower];
    plan().addRoom(lower, { name: 'Kitchen', anchor: { x: 100, y: 50 } });
    const set = getFaces(plan().plan.levels[lower], 'all');
    expect(set.faces).toHaveLength(1);
    // The top wall runs left to right on the y-down plan; its left (+normal) side is up, outside.
    const top = Object.values(level.walls).find((w) => level.nodes[w.a].y === 0 && level.nodes[w.b].y === 0)!;
    const forward = level.nodes[top.a].x < level.nodes[top.b].x;
    const sides = facesBesideWall(set, top);
    // Interior is below the top wall: on its right when drawn left to right, otherwise its left.
    expect(forward ? sides.right : sides.left).toBe(set.faces[0]);
    expect(forward ? sides.left : sides.right).toBeNull();
  });
});

describe('item 17: duplicate room names', () => {
  it('says so in the status bar and still allows the name', () => {
    plan().addRoom(lower, { name: 'Kitchen', anchor: { x: 10, y: 10 } });
    expect(noteDuplicateRoomName(lower, ' kitchen ')).toBe(true);
    expect(ui().notice).toEqual({ text: 'There is already a Kitchen on this level', error: false });
    ui().setNotice(null);
    expect(noteDuplicateRoomName(lower, 'Hallway')).toBe(false);
    expect(ui().notice).toBeNull();
    // Renaming a room to its own name is not a duplicate.
    const id = Object.values(plan().plan.levels[lower].rooms)[0].id;
    expect(noteDuplicateRoomName(lower, 'Kitchen', id)).toBe(false);
  });
});

describe('item 20: opening placement names a partition', () => {
  it('says "partition face" when the reference end is a T', () => {
    ui().setActiveLevel(lower);
    box(lower, 0, 0, 240, 240);
    // A partition from the middle of the left wall to the middle of the right wall.
    plan().addWall(lower, { x: 0, y: 120 }, { x: 240, y: 120 }, { kind: 'interior', thickness: 4.5, phase: 'existing' });
    // Hover the top wall near its start corner (a plain corner): corner wording.
    ui().setTool('door');
    dispatchPointer('move', ptr(40, 2));
    dispatchPointer('down', ptr(40, 2));
    expect(ui().draft.message).toMatch(/placed .* from the inside corner at the start of the wall/);
    // The left wall is now two walls split at the T; hover the lower half near the T.
    dispatchPointer('move', ptr(2, 150));
    dispatchPointer('down', ptr(2, 150));
    expect(ui().draft.message).toMatch(/placed .* from the partition face\./);
  });
});

describe('item 22: a rejected file replaces the earlier notice', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });

  it('shows the rejection as an error notice as well as the alert', async () => {
    const alert = vi.fn();
    (globalThis as { window?: unknown }).window = { alert };
    showNotice('Saved a copy as plan.json (your browser\'s downloads).');
    expect(ui().notice?.error).toBe(false);
    await openPlanFile(new File(['not json'], 'junk.json'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(ui().notice?.error).toBe(true);
    expect(ui().notice?.text).toMatch(/^Could not open junk\.json: /);
    expect(ui().notice?.text).not.toMatch(/Saved a copy/);
    showNotice(null);
  });
});

describe('item 12: panel keys', () => {
  it('[ and ] do nothing (and say so) in a wide window', () => {
    expect(isNarrow()).toBe(false);
    const open = ui().levelBarOpen;
    expect(bindingFor({ key: '[', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })!.run!({} as KeyboardEvent)).toBe(false);
    expect(bindingFor({ key: ']', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })!.run!({} as KeyboardEvent)).toBe(false);
    expect(ui().levelBarOpen).toBe(open);
  });

  it('the store toggles the two panels independently', () => {
    const { levelBarOpen, propertiesOpen } = ui();
    ui().toggleProperties();
    expect(ui().propertiesOpen).toBe(!propertiesOpen);
    expect(ui().levelBarOpen).toBe(levelBarOpen);
    ui().toggleLevelBar();
    expect(ui().levelBarOpen).toBe(!levelBarOpen);
  });
});
