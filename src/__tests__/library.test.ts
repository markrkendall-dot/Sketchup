import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutosave } from '../io/file';
import { createLibrary, LEGACY_AUTOSAVE_KEY, LIBRARY_INDEX_KEY, memoryStore, planKey, startupPlan } from '../io/library';
import { createEmptyPlan } from '../model/plan';
import type { Plan } from '../model/types';
import { clearHistory, usePlanStore } from '../store/planStore';
import { firstStructure } from '../model/structures';

const plan = (name: string, modifiedAt: string): Plan => ({ ...createEmptyPlan(name), modifiedAt });

describe('property library', () => {
  it('saves, lists most recent first, loads and keeps one index entry per plan', async () => {
    const kv = memoryStore();
    const lib = createLibrary(kv);
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    const b = plan('B', '2026-02-01T00:00:00.000Z');
    await lib.save(a);
    await lib.save(b);
    expect((await lib.list()).map((e) => e.name)).toEqual(['B', 'A']);
    // Saving again updates the entry in place.
    await lib.save({ ...a, name: 'A2', modifiedAt: '2026-03-01T00:00:00.000Z' });
    const list = await lib.list();
    expect(list.map((e) => [e.id, e.name])).toEqual([
      [a.id, 'A2'],
      [b.id, 'B'],
    ]);
    expect((kv.data.get(LIBRARY_INDEX_KEY) as unknown[]).length).toBe(2);
    expect(kv.data.has(planKey(a.id))).toBe(true);
    const loaded = await lib.load(a.id);
    expect(loaded?.name).toBe('A2');
    expect(firstStructure(loaded!).levelOrder).toEqual(firstStructure(a).levelOrder);
    expect(await lib.load('missing')).toBeNull();
  });

  it('loads through migrate: a broken stored plan throws a readable error', async () => {
    const kv = memoryStore({ [planKey('bad')]: { schemaVersion: 99 } });
    const lib = createLibrary(kv);
    await expect(lib.load('bad')).rejects.toThrow(/schemaVersion/);
  });

  it('duplicates under a new id named "<name> copy", leaving the original', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('House', '2026-01-01T00:00:00.000Z');
    await lib.save(a);
    const copy = await lib.duplicate(a.id);
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe('House copy');
    expect(firstStructure(copy).levelOrder).toEqual(firstStructure(a).levelOrder);
    expect((await lib.list()).map((e) => e.name).sort()).toEqual(['House', 'House copy']);
    expect((await lib.load(a.id))?.name).toBe('House');
  });

  it('renames the stored plan and its entry', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('Old', '2026-01-01T00:00:00.000Z');
    await lib.save(a);
    await lib.rename(a.id, '  New name ');
    expect((await lib.load(a.id))?.name).toBe('New name');
    expect((await lib.list())[0].name).toBe('New name');
  });

  it('deletes the plan and its entry', async () => {
    const kv = memoryStore();
    const lib = createLibrary(kv);
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    const b = plan('B', '2026-01-02T00:00:00.000Z');
    await lib.save(a);
    await lib.save(b);
    await lib.remove(a.id);
    expect((await lib.list()).map((e) => e.id)).toEqual([b.id]);
    expect(kv.data.has(planKey(a.id))).toBe(false);
    expect(await lib.has(a.id)).toBe(false);
  });

  it('keeps the index consistent when saves and renames overlap', async () => {
    const lib = createLibrary(memoryStore());
    const plans = Array.from({ length: 6 }, (_, i) => plan(`P${i}`, `2026-01-0${i + 1}T00:00:00.000Z`));
    await Promise.all(plans.map((p) => lib.save(p)));
    await Promise.all([lib.rename(plans[0].id, 'Renamed'), lib.save({ ...plans[1], name: 'Saved' }), lib.remove(plans[2].id)]);
    const names = (await lib.list()).map((e) => e.name).sort();
    expect(names).toEqual(['P3', 'P4', 'P5', 'Renamed', 'Saved']);
  });

  it('rebuilds a missing index from the stored plans', async () => {
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    const lib = createLibrary(memoryStore({ [planKey(a.id)]: a, other: 1 }));
    expect((await lib.list()).map((e) => [e.id, e.name])).toEqual([[a.id, 'A']]);
  });

  it('imports under the file id, or a new id when the library already has it', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('Mine', '2026-01-01T00:00:00.000Z');
    await lib.save(a);
    const fresh = plan('Other', '2026-01-02T00:00:00.000Z');
    expect((await lib.add(fresh)).id).toBe(fresh.id);
    const clash = await lib.add({ ...a, name: 'Imported' });
    expect(clash.id).not.toBe(a.id);
    expect((await lib.load(a.id))?.name).toBe('Mine');
    expect((await lib.load(clash.id))?.name).toBe('Imported');
    expect(await lib.list()).toHaveLength(3);
  });

  it('keeps a thumbnail given once until another is given', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    await lib.save(a, 'data:image/png;base64,AAA');
    await lib.save({ ...a, name: 'A again' });
    expect((await lib.list())[0].thumbnail).toBe('data:image/png;base64,AAA');
  });
});

describe('legacy autosave', () => {
  it('moves into an empty library and is removed', async () => {
    const legacy = plan('Before the library', '2026-01-01T00:00:00.000Z');
    const kv = memoryStore({ [LEGACY_AUTOSAVE_KEY]: legacy });
    const lib = createLibrary(kv);
    expect(await lib.moveLegacyAutosave()).toBe(legacy.id);
    expect(kv.data.has(LEGACY_AUTOSAVE_KEY)).toBe(false);
    expect((await lib.list()).map((e) => e.name)).toEqual(['Before the library']);
    expect(await lib.moveLegacyAutosave()).toBeNull();
  });

  it('is left alone when the library already has plans, or is unreadable', async () => {
    const legacy = plan('Old slot', '2026-01-01T00:00:00.000Z');
    const kv = memoryStore({ [LEGACY_AUTOSAVE_KEY]: legacy });
    const lib = createLibrary(kv);
    await lib.save(plan('Already here', '2026-01-02T00:00:00.000Z'));
    expect(await lib.moveLegacyAutosave()).toBeNull();
    expect(kv.data.has(LEGACY_AUTOSAVE_KEY)).toBe(true);
    expect(await lib.list()).toHaveLength(1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = memoryStore({ [LEGACY_AUTOSAVE_KEY]: { junk: true } });
    expect(await createLibrary(broken).moveLegacyAutosave()).toBeNull();
    expect(broken.data.has(LEGACY_AUTOSAVE_KEY)).toBe(true);
    warn.mockRestore();
  });

  it('startup opens the moved plan, then the last-open one, then the most recent', async () => {
    const legacy = plan('Legacy', '2026-01-01T00:00:00.000Z');
    const lib = createLibrary(memoryStore({ [LEGACY_AUTOSAVE_KEY]: legacy }));
    expect((await startupPlan(lib, null))?.id).toBe(legacy.id);
    const later = plan('Later', '2026-05-01T00:00:00.000Z');
    await lib.save(later);
    expect((await startupPlan(lib, legacy.id))?.id).toBe(legacy.id);
    expect((await startupPlan(lib, 'gone'))?.id).toBe(later.id);
    expect(await startupPlan(createLibrary(memoryStore()), null)).toBeNull();
  });
});

describe('autosave into the library', () => {
  const store = () => usePlanStore.getState();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    store().setPlan(createEmptyPlan('A'));
    clearHistory();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves under the plan's key, and a switch saves the outgoing plan's pending edit, not the incoming plan", async () => {
    const lib = createLibrary(memoryStore());
    const keys: string[] = [];
    const stop = startAutosave(usePlanStore, {
      save: (key, p) => {
        keys.push(key);
        return lib.save(p);
      },
    });
    const a = store().plan;
    store().renamePlan('A edited');
    // Switch before the debounce fires.
    const b = createEmptyPlan('B');
    await lib.save(b);
    store().setPlan(b);
    await vi.advanceTimersByTimeAsync(1000);
    expect(keys).toEqual([planKey(a.id)]);
    expect((await lib.load(a.id))?.name).toBe('A edited');
    expect((await lib.load(b.id))?.name).toBe('B');
    // Edits to B go to B's key.
    store().renamePlan('B edited');
    await stop.flush();
    expect(keys).toEqual([planKey(a.id), planKey(b.id)]);
    expect((await lib.list()).map((e) => e.name).sort()).toEqual(['A edited', 'B edited']);
    stop();
  });
});
