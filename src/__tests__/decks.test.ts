import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlan, defaultLevelId, migrate, MIGRATIONS, normalizeRailings, SCHEMA_VERSION } from '../model/plan';
import type { Deck, Vec2 } from '../model/types';
import { clearHistory, undo, usePlanStore, type NewDeck } from '../store/planStore';
import { EMPTY_SELECTION } from '../store/uiStore';

const store = () => usePlanStore.getState();

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 12' x 8' deck south of a wall along y 0, its top 6" below the floor. */
const deckInput = (over: Partial<NewDeck> = {}): NewDeck => ({ outline: rect(0, 0, 144, 96), elevation: -6, railings: [false, true, true, true], phase: 'new', ...over });

describe('deck store actions', () => {
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
  });
  const lid = () => defaultLevelId(store().plan);
  const deck = (id: string) => store().plan.levels[lid()].decks[id];

  it('adds, patches (one undo step each), phases and deletes decks', () => {
    const id = store().addDeck(lid(), deckInput({ color: '#9C7650' }))!;
    expect(id).toBeTruthy();
    expect(deck(id)).toMatchObject({ elevation: -6, railings: [false, true, true, true], phase: 'new', color: '#9c7650' });
    const before = store().plan;
    store().updateDeck(lid(), id, { elevation: -6 }); // unchanged: no new state
    expect(store().plan).toBe(before);
    store().updateDeck(lid(), id, { railings: [false, true, true, true] });
    expect(store().plan).toBe(before);
    store().updateDeck(lid(), id, { elevation: -4, railings: [false, false, true, true] });
    expect(deck(id)).toMatchObject({ elevation: -4, railings: [false, false, true, true] });
    undo();
    expect(deck(id)).toMatchObject({ elevation: -6, railings: [false, true, true, true] });
    store().updateDeck(lid(), id, { color: undefined });
    expect('color' in deck(id)).toBe(false);
    store().setPhase(lid(), { walls: [], openings: [], decks: [id] }, 'demo');
    expect(deck(id).phase).toBe('demo');
    store().deleteEntities(lid(), { ...EMPTY_SELECTION, decks: [id] });
    expect(store().plan.levels[lid()].decks).toEqual({});
  });

  it('refuses an outline of two points or no area, a top out of range, a bad colour', () => {
    expect(store().addDeck(lid(), deckInput({ outline: rect(0, 0, 144, 96).slice(0, 2) }))).toBeNull();
    expect(store().addDeck(lid(), deckInput({ outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] }))).toBeNull();
    expect(store().addDeck(lid(), deckInput({ elevation: NaN }))).toBeNull();
    expect(store().addDeck(lid(), deckInput({ elevation: 601 }))).toBeNull();
    expect(store().addDeck(lid(), deckInput({ color: 'cedar' }))).toBeNull();
    const id = store().addDeck(lid(), deckInput())!;
    const before = store().plan;
    for (const patch of [{ elevation: -1000 }, { color: '#12345' }, { outline: rect(0, 0, 144, 96).slice(0, 2) }]) {
      store().updateDeck(lid(), id, patch);
      expect(store().plan).toBe(before);
    }
  });

  it('fits the railings to the outline: missing ones on, extra ones dropped, kept through an outline change', () => {
    const id = store().addDeck(lid(), deckInput({ railings: undefined }))!;
    expect(deck(id).railings).toEqual([true, true, true, true]);
    store().updateDeck(lid(), id, { railings: [false, false] });
    expect(deck(id).railings).toEqual([false, false, true, true]);
    // A fifth corner: the first four edges keep theirs, the new one gets a railing.
    store().updateDeck(lid(), id, { outline: [...rect(0, 0, 144, 96), { x: -24, y: 48 }] });
    expect(deck(id).railings).toEqual([false, false, true, true, true]);
    store().updateDeck(lid(), id, { outline: [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 72, y: 96 }] });
    expect(deck(id).railings).toEqual([false, false, true]);
    expect(normalizeRailings([true, 'no', false], 4)).toEqual([true, true, false, true]);
    expect(normalizeRailings(undefined, 3)).toEqual([true, true, true]);
  });
});

describe('decks in files', () => {
  it('schema 4 adds decks to every level; a v3 file gains empty records', () => {
    expect(SCHEMA_VERSION).toBe(4);
    const v3 = JSON.parse(JSON.stringify({ ...createEmptyPlan(), schemaVersion: 3 }));
    for (const l of Object.values(v3.levels) as Record<string, unknown>[]) delete l.decks;
    const up = MIGRATIONS[3](v3);
    expect(up.schemaVersion).toBe(4);
    for (const l of Object.values(up.levels as Record<string, Record<string, unknown>>)) expect(l.decks).toEqual({});
    const plan = migrate(v3);
    expect(plan.schemaVersion).toBe(4);
    for (const id of plan.levelOrder) expect(plan.levels[id].decks).toEqual({});
  });

  /** A v4 file with the given decks on its one level. */
  const file = (decks: Record<string, unknown>) => {
    const p = createEmptyPlan();
    const lid = p.levelOrder[1];
    const doc = JSON.parse(JSON.stringify(p));
    doc.levels[lid].decks = decks;
    return { doc, lid };
  };
  const good: Deck = { id: 'd1', outline: rect(0, 0, 144, 96), elevation: -6, railings: [false, true, true, true], phase: 'new', color: '#9c7650' };

  it('keeps a good deck, fits its railings, drops broken ones with a warning, and round-trips byte for byte', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { doc, lid } = file({
      d1: good,
      d2: { ...good, id: 'd2', railings: [false], phase: 'bogus', color: 'cedar' },
      bad1: { ...good, outline: good.outline.slice(0, 2) },
      bad2: { ...good, elevation: 'low' },
      bad3: 7,
    });
    const plan = migrate(doc);
    const decks = plan.levels[lid].decks;
    expect(Object.keys(decks)).toEqual(['d1', 'd2']);
    expect(decks.d1).toEqual(good);
    expect(decks.d2).toEqual({ ...good, id: 'd2', railings: [false, true, true, true], phase: 'existing', color: undefined });
    expect('color' in decks.d2).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0][0])).toMatch(/dropped deck bad1/);
    warn.mockRestore();
    const text = JSON.stringify(plan, null, 2);
    expect(JSON.stringify(migrate(JSON.parse(text)), null, 2)).toBe(text);
  });
});
