import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchKey, dispatchPointer, switchTool, type ToolPointerEvent } from '../editor2d/tools';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Id, Level, Vec2, Wall } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';
import { resolveWallMove } from '../ui/wallMove';

const store = () => usePlanStore.getState();
const ui = () => useUiStore.getState();
let lid: Id;
const level = (): Level => store().plan.levels[lid];
const ptr = (x: number, y: number, over: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey: false, altKey: false, modKey: false, ...over });
const wallAt = (lv: Level, a: Vec2, b: Vec2): Wall | undefined =>
  Object.values(lv.walls).find((w) => {
    const p = lv.nodes[w.a];
    const q = lv.nodes[w.b];
    return (p.x === a.x && p.y === a.y && q.x === b.x && q.y === b.y) || (p.x === b.x && p.y === b.y && q.x === a.x && q.y === a.y);
  });
/** Drag the wall under (x0, y0) by (dx, dy), in steps. */
const drag = (x0: number, y0: number, dx: number, dy: number) => {
  dispatchPointer('down', ptr(x0, y0));
  dispatchPointer('move', ptr(x0 + dx / 2, y0 + dy / 2));
  dispatchPointer('move', ptr(x0 + dx, y0 + dy));
  dispatchPointer('up', ptr(x0 + dx, y0 + dy));
};

// A 20' box with an existing partition down x 120 (a T on the north and south walls), drawing new
// work in the proposed view.
let part: Id;
beforeEach(() => {
  store().setPlan(createEmptyPlan());
  lid = defaultLevelId(store().plan);
  ui().setActiveLevel(lid);
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  const c = [
    { x: 0, y: 0 },
    { x: 240, y: 0 },
    { x: 240, y: 240 },
    { x: 0, y: 240 },
  ];
  for (let i = 0; i < 4; i++) store().addWall(lid, c[i], c[(i + 1) % 4], { kind: 'exterior', thickness: 6, phase: 'existing' });
  store().addWall(lid, { x: 120, y: 0 }, { x: 120, y: 240 }, { kind: 'interior', thickness: 4, phase: 'existing' });
  part = wallAt(level(), { x: 120, y: 0 }, { x: 120, y: 240 })!.id;
  clearHistory();
  switchTool('select');
  ui().setDrawPhase('new');
  ui().setViewMode('proposed');
  ui().setWallMovePrompt(null);
  ui().setWallMoveChoice(null);
  ui().setSelection(EMPTY_SELECTION);
});

describe('moving an existing wall while drawing new work', () => {
  it('a drag changes nothing until it is answered, and leave-it keeps the plan as it was', () => {
    const before = store().plan;
    drag(120, 100, 12, 0);
    expect(store().plan).toBe(before);
    expect(ui().wallMovePrompt).toMatchObject({ levelId: lid, shifts: { [part]: { x: 12, y: 0 } } });
    resolveWallMove('cancel');
    expect(ui().wallMovePrompt).toBeNull();
    expect(store().plan).toBe(before);
  });

  it('rebuild it there: the old wall demolished, a new one 12" over, selected; one undo step', () => {
    const before = store().plan;
    drag(120, 100, 12, 0);
    resolveWallMove('renovate');
    expect(level().walls[part].phase).toBe('demo');
    const built = wallAt(level(), { x: 132, y: 0 }, { x: 132, y: 240 })!;
    expect(built.phase).toBe('new');
    expect(ui().selection.walls).toEqual([built.id]);
    undo();
    expect(store().plan).toEqual(before);
  });

  it('correct the drawing: moved in every view, as today; one undo step', () => {
    drag(120, 100, 12, 0);
    resolveWallMove('correct');
    const w = level().walls[part];
    expect([level().nodes[w.a].x, level().nodes[w.b].x, w.phase]).toEqual([132, 132, 'existing']);
    undo();
    expect(level().nodes[level().walls[part].a].x).toBe(120);
  });

  it('Shift+arrow asks too, and remembers "correct" for the same walls', () => {
    ui().setSelection({ ...EMPTY_SELECTION, walls: [part] });
    const press = () => dispatchKey({ key: 'ArrowRight', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent);
    press();
    expect(ui().wallMovePrompt).not.toBeNull();
    resolveWallMove('correct');
    expect(level().nodes[level().walls[part].a].x).toBe(121);
    press();
    expect(ui().wallMovePrompt).toBeNull();
    expect(level().nodes[level().walls[part].a].x).toBe(122);
  });

  it('drawing the house as it stands, or moving new work, does not ask', () => {
    ui().setDrawPhase('existing');
    drag(120, 100, 12, 0);
    expect(ui().wallMovePrompt).toBeNull();
    expect(level().nodes[level().walls[part].a].x).toBe(132);
    ui().setDrawPhase('new');
    store().setPhase(lid, { walls: [part], openings: [] }, 'new');
    drag(132, 100, 12, 0);
    expect(ui().wallMovePrompt).toBeNull();
    expect(level().nodes[level().walls[part].a].x).toBe(144);
  });
});
