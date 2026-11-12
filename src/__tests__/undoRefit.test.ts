import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import { clearHistory, redo, setHistoryRefit, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const ui = () => useUiStore.getState();

describe('undo and redo landing in another building', () => {
  const refit = vi.fn();
  beforeEach(() => {
    store().setPlan(createEmptyPlan('Refit', 'single'));
    ui().setActiveLevel(defaultLevelId(plan()));
    clearHistory();
    refit.mockClear();
    setHistoryRefit(refit);
  });

  it('switches to the level in the other building and refits the view to it', () => {
    const house = ui().activeLevelId;
    const gid = store().addStructure({ kind: 'garage', origin: { x: 600, y: 0 } });
    const garageLevel = plan().structures[gid].levelOrder[0];
    ui().setActiveLevel(garageLevel);
    store().addRoom(garageLevel, { name: 'Bay', anchor: { x: 100, y: 100 } });
    ui().setActiveLevel(house);
    undo();
    expect(ui().activeLevelId).toBe(garageLevel);
    expect(refit).toHaveBeenCalledTimes(1);
    // Back in the house by hand, then a redo of the garage's change: refit again.
    ui().setActiveLevel(house);
    redo();
    expect(ui().activeLevelId).toBe(garageLevel);
    expect(refit).toHaveBeenCalledTimes(2);
  });

  it('does not refit when the change is on another level of the same building', () => {
    const [ground] = plan().structures[plan().structureOrder[0]].levelOrder;
    const upper = store().addLevel('top', 'Upper')!;
    ui().setActiveLevel(upper.id);
    store().addRoom(upper.id, { name: 'Loft', anchor: { x: 10, y: 10 } });
    ui().setActiveLevel(ground);
    undo();
    expect(ui().activeLevelId).toBe(upper.id);
    expect(refit).not.toHaveBeenCalled();
  });
});
