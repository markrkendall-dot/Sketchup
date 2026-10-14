import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan } from '../model/plan';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { bindingFor, comboOf, KEY_BINDINGS, KEY_GROUPS } from '../ui/keymap';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

beforeEach(() => {
  usePlanStore.getState().setPlan(createEmptyPlan());
  clearHistory();
});

describe('comboOf', () => {
  it('normalizes modifiers and case', () => {
    expect(comboOf(key('w'))).toBe('w');
    expect(comboOf(key('W', { shiftKey: true }))).toBe('shift+w');
    expect(comboOf(key('z', { ctrlKey: true }))).toBe('mod+z');
    expect(comboOf(key('z', { metaKey: true }))).toBe('mod+z');
    expect(comboOf(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('mod+shift+z');
    expect(comboOf(key('?', { shiftKey: true }))).toBe('?');
    expect(comboOf(key('Home'))).toBe('Home');
    expect(comboOf(key('`'))).toBe('`');
  });
});

describe('KEY_BINDINGS', () => {
  it('maps every combo to one binding, in a known group, with a runner', () => {
    const seen = new Set<string>();
    for (const b of KEY_BINDINGS) {
      expect(KEY_GROUPS).toContain(b.group);
      expect(b.keys.length).toBeGreaterThan(0);
      expect(b.label.length).toBeGreaterThan(0);
      for (const c of b.combos ?? []) {
        expect(seen.has(c), `duplicate combo ${c}`).toBe(false);
        seen.add(c);
        expect(typeof b.run).toBe('function');
      }
    }
  });

  it('has the documented keys', () => {
    const expected: [ReturnType<typeof key>, string][] = [
      [key('s'), 'Select'],
      [key('w'), 'walls'],
      [key('r'), 'room'],
      [key('d'), 'door'],
      [key('n'), 'window'],
      [key('p'), 'passage'],
      [key('t'), 'stairs'],
      [key('k'), 'roof'],
      [key('j'), 'deck'],
      [key('b'), 'box'],
      [key('m'), 'measure'],
      [key('u'), 'underlay'],
      [key('i'), 'beam'],
      [key('l'), 'post'],
      [key('y'), 'Structure'],
      [key('1'), 'level'],
      [key('3'), 'level'],
      [key('v'), 'view'],
      [key('o'), 'Ortho'],
      [key('g'), 'Grid'],
      [key('x'), 'wall'],
      [key('`'), 'layout'],
      [key('f'), 'Walk'],
      [key('z'), 'fit'],
      [key('Home'), 'fit'],
      [key('?', { shiftKey: true }), 'help'],
      [key('z', { ctrlKey: true }), 'Undo'],
      [key('Z', { ctrlKey: true, shiftKey: true }), 'Redo'],
      [key('y', { ctrlKey: true }), 'Redo'],
      [key('s', { metaKey: true }), 'Save'],
      [key('o', { ctrlKey: true }), 'Open'],
    ];
    for (const [e, word] of expected) {
      const b = bindingFor(e);
      expect(b, comboOf(e)).toBeDefined();
      expect(b!.label.toLowerCase()).toContain(word.toLowerCase());
    }
  });

  it('runs tool, level and toggle bindings', () => {
    const ui = useUiStore.getState;
    ui().setActiveLevel(usePlanStore.getState().plan.levelOrder[1]);
    bindingFor(key('b'))!.run!(new KeyboardEventLike('b') as unknown as KeyboardEvent);
    expect(ui().activeTool).toBe('rect');
    bindingFor(key('m'))!.run!(new KeyboardEventLike('m') as unknown as KeyboardEvent);
    expect(ui().activeTool).toBe('measure');
    bindingFor(key('s'))!.run!(new KeyboardEventLike('s') as unknown as KeyboardEvent);
    expect(ui().activeTool).toBe('select');
    bindingFor(key('1'))!.run!(new KeyboardEventLike('1') as unknown as KeyboardEvent);
    expect(ui().activeLevelId).toBe(usePlanStore.getState().plan.levelOrder[0]);
    const before = ui().nextWallKind;
    bindingFor(key('x'))!.run!(new KeyboardEventLike('x') as unknown as KeyboardEvent);
    expect(ui().nextWallKind).not.toBe(before);
    bindingFor(key('?', { shiftKey: true }))!.run!(new KeyboardEventLike('?') as unknown as KeyboardEvent);
    expect(ui().helpOpen).toBe(true);
    // F does nothing (and reports so) in the 2D layout.
    expect(bindingFor(key('f'))!.run!(new KeyboardEventLike('f') as unknown as KeyboardEvent)).toBe(false);
  });
});

/** Just enough of a KeyboardEvent for the runners (node has no DOM). */
class KeyboardEventLike {
  constructor(public key: string) {}
}
