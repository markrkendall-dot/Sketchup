import { beforeEach, describe, expect, it } from 'vitest';
import { hiddenStructureIds, structureOnlyInOtherOptions } from '../derive/optionView';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { getHiddenStructures, getViewPlan } from '../store/viewStore';
import { visible3dLevels } from '../view3d/visibility';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const ui = () => useUiStore.getState();

let a = '';
let b = '';
beforeEach(() => {
  store().setPlan(createEmptyPlan('Options', 'single'));
  clearHistory();
  ui().setActiveLevel(defaultLevelId(plan()));
  ui().setViewMode('proposed');
  a = plan().options[0].id;
  b = store().addOption('Option B')!;
  ui().setActiveOption(b);
});

describe('a building only other options build', () => {
  it('is hidden in the Proposed and All views of the other options, shown in its own', () => {
    // Added while B is active, in the new phase: everything on it is B's new work.
    const gid = store().addStructure({ kind: 'garage', origin: { x: 600, y: 0 }, phase: 'new' });
    const garageLevel = plan().structures[gid].levelOrder[0];
    expect(Object.values(plan().levels[garageLevel].walls).every((w) => w.optionIds?.includes(b))).toBe(true);
    expect(structureOnlyInOtherOptions(plan(), gid, a)).toBe(true);
    expect(structureOnlyInOtherOptions(plan(), gid, b)).toBe(false);
    expect([...hiddenStructureIds(plan(), b, 'proposed')]).toEqual([]);
    expect([...hiddenStructureIds(plan(), a, 'proposed')]).toEqual([gid]);
    expect([...hiddenStructureIds(plan(), a, 'all')]).toEqual([gid]);
    expect([...hiddenStructureIds(plan(), a, 'existing')]).toEqual([]);
    // Through the view store: in A its levels leave the 3D view.
    ui().setActiveOption(a);
    expect([...getHiddenStructures()]).toEqual([gid]);
    const shown = visible3dLevels(getViewPlan(), { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: ui().activeLevelId });
    expect(shown).not.toContain(garageLevel);
    expect(shown.length).toBeGreaterThan(0);
    ui().setActiveOption(b);
    expect(visible3dLevels(getViewPlan(), { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: ui().activeLevelId })).toContain(garageLevel);
  });

  it('is not hidden when it is empty, has existing work, or work of every option', () => {
    const empty = store().addStructure({ kind: 'other', origin: { x: 600, y: 0 } });
    expect(structureOnlyInOtherOptions(plan(), empty, a)).toBe(false);
    const shed = store().addStructure({ kind: 'shed', origin: { x: 900, y: 0 }, phase: 'existing' });
    expect(structureOnlyInOtherOptions(plan(), shed, a)).toBe(false);
    // One wall of B's new garage made every option's: the garage is in A too.
    const gid = store().addStructure({ kind: 'garage', origin: { x: 1300, y: 0 }, phase: 'new' });
    const level = plan().structures[gid].levelOrder[0];
    const wall = Object.values(plan().levels[level].walls)[0];
    store().setEntityOption(level, { nodes: [], walls: [wall.id] }, undefined);
    expect(structureOnlyInOtherOptions(plan(), gid, a)).toBe(false);
  });
});
