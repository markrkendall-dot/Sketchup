import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchKey, dispatchPointer, enterSiteMode, type ToolPointerEvent } from '../editor2d/tools';
import { snapStructureOrigin, structureAt } from '../editor2d/tools/structureDrag';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = (): Plan => store().plan;
const ui = () => useUiStore.getState();
const ptr = (x: number, y: number, shiftKey = false): ToolPointerEvent => ({ world: { x, y }, screen: { x, y }, button: 0, shiftKey, altKey: false, modKey: false });

beforeEach(() => {
  // A shed (12' x 10') at the origin and a garage (24' x 24') 400" to its right.
  const p = createEmptyPlan('Drag', 'outbuilding');
  store().setPlan(p);
  clearHistory();
  ui().setActiveLevel(defaultLevelId(plan()));
  ui().setTool('select');
  ui().setViewMode('all');
  ui().setViewport({ tx: 0, ty: 0, k: 1 });
  store().addStructure({ kind: 'shed', origin: { x: 0, y: 0 } });
  store().addStructure({ kind: 'garage', origin: { x: 400, y: 0 } });
  clearHistory();
});

const garage = () => Object.values(plan().structures).find((s) => s.kind === 'garage')!;
const shed = () => Object.values(plan().structures).find((s) => s.kind === 'shed')!;

describe('dragging a building in site mode', () => {
  it('picks the building whose ground floor holds the point', () => {
    expect(structureAt(plan(), { x: 500, y: 100 }, 'all')?.id).toBe(garage().id);
    expect(structureAt(plan(), { x: 60, y: 50 }, 'all')?.id).toBe(shed().id);
    expect(structureAt(plan(), { x: 300, y: 50 }, 'all')).toBeNull();
    expect(structureAt(plan(), { x: 500, y: 100 }, 'all', new Set([garage().id]))).toBeNull();
  });

  it('snaps a face corner to another building\'s face corner, else to the grid', () => {
    const g = garage();
    // The shed's outside face is at x = 144 + 3.25; the garage's own outside corner is 3.25 left of its origin.
    const t = plan().settings.defaultExteriorThickness / 2;
    const near = snapStructureOrigin(plan(), g.id, { x: 144 + 2 * t + 3, y: 2 }, 1, 'all');
    expect(near.snap?.kind).toBe('face-corner');
    expect(near.origin.x).toBeCloseTo(144 + 2 * t, 6);
    expect(near.origin.y).toBeCloseTo(0, 6);
    const far = snapStructureOrigin(plan(), g.id, { x: 600.4, y: 33.6 }, 1, 'all');
    expect(far.snap).toBeNull();
    expect(far.origin).toEqual({ x: 600, y: 34 });
  });

  it('moves the building with the pointer as one undo step; other drags are unchanged', () => {
    enterSiteMode();
    const g = garage();
    dispatchPointer('move', ptr(500, 100));
    dispatchPointer('down', ptr(500, 100));
    dispatchPointer('move', ptr(520, 140));
    dispatchPointer('move', ptr(560.2, 180.2));
    dispatchPointer('up', ptr(560.2, 180.2));
    expect(garage().origin).toEqual({ x: g.origin.x + 60, y: g.origin.y + 80 });
    // One undo step for the whole drag.
    undo();
    expect(garage().origin).toEqual(g.origin);
  });

  it('Esc mid-drag puts it back', () => {
    enterSiteMode();
    const g = garage();
    dispatchPointer('down', ptr(500, 100));
    dispatchPointer('move', ptr(560, 180));
    expect(garage().origin.x).toBe(g.origin.x + 60);
    dispatchKey({ key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);
    dispatchPointer('up', ptr(560, 180));
    expect(garage().origin).toEqual(g.origin);
  });

  it('a press on a grade point inside a building still moves the grade point', () => {
    store().addGradePoint({ at: { x: 500, y: 100 }, elevation: 0 });
    clearHistory();
    enterSiteMode();
    const g = garage();
    dispatchPointer('down', ptr(500, 100));
    dispatchPointer('move', ptr(530, 100));
    dispatchPointer('up', ptr(530, 100));
    expect(garage().origin).toEqual(g.origin);
    expect(Object.values(plan().site.gradePoints)[0].at).toEqual({ x: 530, y: 100 });
  });
});
