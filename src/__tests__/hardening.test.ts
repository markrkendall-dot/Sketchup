import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { footprintLevelCount, getFootprints } from '../derive/footprint';
import { getOpeningsByWall, openingLevelCount, pruneDerivedCaches } from '../derive/openings';
import { autosaveFailureReason, startAutosave } from '../io/file';
import { createEmptyPlan, defaultLevelId } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const ext = { kind: 'exterior', thickness: 6.5, phase: 'existing' } as const;

beforeEach(() => {
  store().setPlan(createEmptyPlan());
  clearHistory();
});

describe('derive caches keyed by level id', () => {
  it('forget levels that are no longer in the plan (New / Open)', () => {
    const touch = (plan: Plan) => {
      for (const id of plan.levelOrder) {
        getFootprints(plan.levels[id], 'all');
        getFootprints(plan.levels[id], 'proposed');
        getOpeningsByWall(plan.levels[id]);
      }
    };
    pruneDerivedCaches({ levelOrder: [] });
    for (let i = 0; i < 5; i++) {
      const plan = createEmptyPlan();
      store().setPlan(plan);
      store().addWall(defaultLevelId(plan), { x: 0, y: 0 }, { x: 120, y: 0 }, ext);
      touch(store().plan);
      pruneDerivedCaches(store().plan);
    }
    expect(footprintLevelCount()).toBe(3);
    expect(openingLevelCount()).toBe(3);
    pruneDerivedCaches({ levelOrder: [] });
    expect(footprintLevelCount()).toBe(0);
    expect(openingLevelCount()).toBe(0);
  });
});

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Node has no DOM: startAutosave only registers page-hide listeners on these.
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports a full storage instead of throwing, then recovers', async () => {
    const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    let fail = true;
    const saved: Plan[] = [];
    const save = vi.fn(async (_key: string, plan: Plan) => {
      if (fail) throw quota;
      saved.push(plan);
    });
    const statuses: (string | null)[] = [];
    const stop = startAutosave(usePlanStore, { save, onStatus: (s) => statuses.push(s) });
    store().renamePlan('One');
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatch(/^Autosave failed: the browser storage for this site is full/);
    fail = false;
    store().renamePlan('Two');
    await vi.advanceTimersByTimeAsync(400);
    expect(saved.map((p) => p.name)).toEqual(['Two']);
    expect(statuses).toEqual([statuses[0], null]);
    stop();
  });

  it('survives a save function that throws synchronously', async () => {
    const statuses: (string | null)[] = [];
    const stop = startAutosave(usePlanStore, {
      save: () => {
        throw new Error('IndexedDB is not available');
      },
      onStatus: (s) => statuses.push(s),
    });
    store().renamePlan('Three');
    await vi.advanceTimersByTimeAsync(400);
    expect(statuses).toEqual(['Autosave failed: IndexedDB is not available.']);
    stop();
  });

  it('words failure reasons', () => {
    expect(autosaveFailureReason(new Error('boom'))).toBe('boom');
    expect(autosaveFailureReason('odd')).toBe('odd');
  });
});
