import { beforeEach, describe, expect, it } from 'vitest';
import { designOptions, stableIds, workIn } from '../../scripts/planLib';
import { viewPlanOf } from '../derive/optionView';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Phase } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const lid = () => defaultLevelId(plan());
const cabinet = (x: number, phase: Phase) => ({ kind: 'base', origin: { x, y: 0 }, direction: 90, width: 24, depth: 24, height: 34.5, elevation: 0, phase }) as const;
const fixturesIn = (optionId: string) => viewPlanOf(plan(), optionId).levels[lid()].fixtures;

beforeEach(() => {
  store().setPlan(createEmptyPlan('Kitchen', 'single'));
  clearHistory();
  useUiStore.getState().setActiveOption(null);
});

describe("an option's own casework finishes (Level.optionFinishes)", () => {
  it('fill the new cabinets of that option only; existing cabinets and other options keep the level\'s', () => {
    const old = store().addFixture(lid(), cabinet(0, 'existing'))!;
    const [a, b] = designOptions(['White', 'Walnut']);
    workIn(a);
    const inA = store().addFixture(lid(), cabinet(40, 'new'))!;
    workIn(b);
    const inB = store().addFixture(lid(), cabinet(80, 'new'))!;
    store().updateFinishes(lid(), { cabinetColor: '#333333' });
    store().updateOptionFinishes(lid(), a, { cabinetColor: '#FFFFFF', counterMaterial: 'stoneVeined', handles: 'bar' });

    const fa = fixturesIn(a);
    expect(fa[inA]).toMatchObject({ frontColor: '#ffffff', counterMaterial: 'stoneVeined', handles: 'bar' });
    expect(fa[old].frontColor).toBeUndefined();
    expect(fa[inB]).toBeUndefined();
    const fb = fixturesIn(b);
    expect(fb[inB].frontColor).toBeUndefined();
    // The stored fixture is untouched: the finish is the option's, not the cabinet's.
    expect(plan().levels[lid()].fixtures[inA].frontColor).toBeUndefined();
  });

  it("a cabinet's own value wins, and a kind that takes no field is not given it", () => {
    const [a] = designOptions(['One', 'Two']);
    workIn(a);
    const own = store().addFixture(lid(), { ...cabinet(0, 'new'), frontColor: '#123456' })!;
    const fridge = store().addFixture(lid(), { kind: 'fridge', origin: { x: 60, y: 0 }, direction: 90, width: 36, depth: 30, height: 70, elevation: 0, phase: 'new' })!;
    store().updateOptionFinishes(lid(), a, { cabinetColor: '#ffffff', counterMaterial: 'butcherBlock' });
    expect(fixturesIn(a)[own].frontColor).toBe('#123456');
    expect(fixturesIn(a)[fridge].counterMaterial).toBeUndefined();
  });

  it('bad values and ceiling fields are refused, clearing every field removes the record, and it is one undo step', () => {
    const [a] = designOptions(['One', 'Two']);
    store().updateOptionFinishes(lid(), a, { cabinetColor: 'red', ceilingColor: '#ffffff' });
    expect(plan().levels[lid()].optionFinishes).toBeUndefined();
    store().updateOptionFinishes(lid(), 'nope', { cabinetColor: '#ffffff' });
    expect(plan().levels[lid()].optionFinishes).toBeUndefined();
    store().updateOptionFinishes(lid(), a, { cabinetColor: '#ffffff' });
    expect(plan().levels[lid()].optionFinishes).toEqual({ [a]: { cabinetColor: '#ffffff' } });
    store().updateOptionFinishes(lid(), a, { cabinetColor: undefined });
    expect(plan().levels[lid()].optionFinishes).toBeUndefined();
  });

  it('follow a duplicated option, go with a deleted one, and survive a save and load', () => {
    const [a, b] = designOptions(['One', 'Two']);
    store().updateOptionFinishes(lid(), a, { cabinetColor: '#ffffff' });
    const c = store().duplicateOption(a)!;
    expect(plan().levels[lid()].optionFinishes![c]).toEqual({ cabinetColor: '#ffffff' });
    const loaded = migrate(JSON.parse(JSON.stringify(plan())));
    expect(loaded.levels[lid()].optionFinishes).toEqual(plan().levels[lid()].optionFinishes);
    store().deleteOption(a);
    store().deleteOption(c);
    expect(plan().levels[lid()].optionFinishes).toBeUndefined();
    expect(plan().options.map((o) => o.id)).toEqual([b]);
    // A file naming an option the plan does not have loses that record.
    const doc = JSON.parse(JSON.stringify(plan()));
    doc.levels[lid()].optionFinishes = { ghost: { cabinetColor: '#ffffff' } };
    expect(migrate(doc).levels[lid()].optionFinishes).toBeUndefined();
  });
});

describe('scripted design options (scripts/planLib.ts)', () => {
  it('designOptions names them in order, workIn tags new work, and stableIds gives every option a fixed id', () => {
    const build = () => {
      store().setPlan(createEmptyPlan('Kitchen', 'single'));
      const [a, b, c] = designOptions(['Galley', 'Island', 'Peninsula']);
      workIn(b);
      store().addFixture(lid(), cabinet(0, 'new'));
      workIn(c);
      store().addFixture(lid(), cabinet(40, 'new'));
      store().updateOptionFinishes(lid(), c, { cabinetColor: '#ffffff' });
      void a;
      return stableIds(plan(), 'kitchen');
    };
    const one = build();
    expect(build()).toBe(one);
    const doc = JSON.parse(one);
    expect(doc.options).toEqual([
      { id: 'option-a', name: 'Galley' },
      { id: 'option-b', name: 'Island' },
      { id: 'option-c', name: 'Peninsula' },
    ]);
    const level = Object.values(doc.levels)[0] as { fixtures: Record<string, { optionIds?: string[] }>; optionFinishes: Record<string, unknown> };
    expect(Object.values(level.fixtures).map((f) => f.optionIds)).toEqual([['option-b'], ['option-c']]);
    expect(Object.keys(level.optionFinishes)).toEqual(['option-c']);
    expect(() => workIn('nope')).toThrow();
  });
});
