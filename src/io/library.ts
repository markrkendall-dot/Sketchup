// The property library (DESIGN.md "Files and persistence"): every plan the user keeps in this
// browser, one IndexedDB key per plan plus an index of what is there, so the Properties dialog can
// list them without reading every plan.
import { del, get, keys, set } from 'idb-keyval';
import { migrate, newId } from '../model/plan';
import type { Plan } from '../model/types';

/** The single autosave slot from before the library; moved into the library on first run. */
export const LEGACY_AUTOSAVE_KEY = 'homeplan:autosave';
/** The index: LibraryEntry[] in no particular order. */
export const LIBRARY_INDEX_KEY = 'homeplan:library';
const PLAN_KEY_PREFIX = 'homeplan:plan:';
/** The IndexedDB key one plan is stored under. */
export const planKey = (id: string): string => `${PLAN_KEY_PREFIX}${id}`;

/** One property as the index lists it. */
export interface LibraryEntry {
  id: string;
  name: string;
  /** The plan's modifiedAt when it was last saved (ISO). */
  modifiedAt: string;
  /** A small data-URL image, when one was given at save time. */
  thumbnail?: string;
}

/** The key-value calls the library uses: idb-keyval's by default, a Map in tests. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const idbStore: KeyValueStore = {
  get: (key) => get(key),
  set: (key, value) => set(key, value),
  del: (key) => del(key),
  keys: async () => (await keys()).map(String),
};

/** A KeyValueStore in memory (tests, and a fallback when IndexedDB is missing). */
export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => void data.set(key, structuredClone(value)),
    del: async (key) => void data.delete(key),
    keys: async () => [...data.keys()],
  };
}

export interface Library {
  /** The entries, most recently modified first. */
  list(): Promise<LibraryEntry[]>;
  /** The plan stored under id, upgraded and checked by migrate(); null when there is none. Throws a readable Error when it is broken. */
  load(id: string): Promise<Plan | null>;
  /** Store the plan under its id and bring its index entry up to date. */
  save(plan: Plan, thumbnail?: string): Promise<LibraryEntry>;
  /** A copy of a stored plan under a new id, named "<name> copy". */
  duplicate(id: string): Promise<Plan>;
  /** Rename a stored plan (its file and its entry). */
  rename(id: string, name: string): Promise<void>;
  /** Remove a plan and its entry. */
  remove(id: string): Promise<void>;
  /** Add a plan from outside (a file, an example); a new id when the library already has its id. Returns what was stored. */
  add(plan: Plan): Promise<Plan>;
  /** Whether a plan with this id is stored. */
  has(id: string): Promise<boolean>;
  /**
   * First run after the library arrived: when the library is empty and the old autosave slot holds
   * a plan, store it in the library and remove the slot. Returns the moved plan's id, or null.
   */
  moveLegacyAutosave(): Promise<string | null>;
}

const isEntry = (v: unknown): v is LibraryEntry =>
  typeof v === 'object' && v !== null && typeof (v as LibraryEntry).id === 'string' && typeof (v as LibraryEntry).name === 'string' && typeof (v as LibraryEntry).modifiedAt === 'string';

const byModified = (a: LibraryEntry, b: LibraryEntry) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : a.name.localeCompare(b.name));

const entryOf = (plan: Plan, thumbnail?: string): LibraryEntry => ({
  id: plan.id,
  name: plan.name,
  modifiedAt: plan.modifiedAt,
  ...(thumbnail ? { thumbnail } : {}),
});

export function createLibrary(kv: KeyValueStore = idbStore): Library {
  // Every call runs after the one before it has finished, so the index's read-modify-write never
  // interleaves (an autosave and a rename at the same moment).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  /** The index; rebuilt from the plan keys when it is missing or unreadable. */
  const readIndex = async (): Promise<LibraryEntry[]> => {
    const raw = await kv.get(LIBRARY_INDEX_KEY);
    if (Array.isArray(raw)) return raw.filter(isEntry);
    const entries: LibraryEntry[] = [];
    for (const key of await kv.keys()) {
      if (!key.startsWith(PLAN_KEY_PREFIX)) continue;
      const doc = (await kv.get(key)) as Partial<Plan> | undefined;
      if (!doc || typeof doc !== 'object') continue;
      entries.push({
        id: key.slice(PLAN_KEY_PREFIX.length),
        name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : 'Untitled plan',
        modifiedAt: typeof doc.modifiedAt === 'string' ? doc.modifiedAt : new Date(0).toISOString(),
      });
    }
    if (entries.length > 0) await kv.set(LIBRARY_INDEX_KEY, entries);
    return entries;
  };

  const writeEntry = async (entry: LibraryEntry): Promise<void> => {
    const index = (await readIndex()).filter((e) => e.id !== entry.id);
    index.push(entry);
    await kv.set(LIBRARY_INDEX_KEY, index);
  };

  const loadRaw = async (id: string): Promise<Plan | null> => {
    const raw = await kv.get(planKey(id));
    if (raw === undefined) return null;
    const plan = migrate(raw);
    // The key is the truth: a stored plan whose id field differs is the plan under this key.
    plan.id = id;
    return plan;
  };

  const saveRaw = async (plan: Plan, thumbnail?: string): Promise<LibraryEntry> => {
    await kv.set(planKey(plan.id), plan);
    const old = thumbnail === undefined ? (await readIndex()).find((e) => e.id === plan.id) : undefined;
    const entry = entryOf(plan, thumbnail ?? old?.thumbnail);
    await writeEntry(entry);
    return entry;
  };

  const freeId = async (id: string): Promise<string> => {
    if ((await kv.get(planKey(id))) === undefined && !(await readIndex()).some((e) => e.id === id)) return id;
    let fresh = newId();
    while ((await kv.get(planKey(fresh))) !== undefined) fresh = newId();
    return fresh;
  };

  return {
    list: () => serial(async () => [...(await readIndex())].sort(byModified)),
    load: (id) => serial(() => loadRaw(id)),
    save: (plan, thumbnail) => serial(() => saveRaw(plan, thumbnail)),
    has: (id) => serial(async () => (await kv.get(planKey(id))) !== undefined),
    duplicate: (id) =>
      serial(async () => {
        const plan = await loadRaw(id);
        if (!plan) throw new Error('That property is no longer in the library.');
        const copy: Plan = { ...plan, id: await freeId(newId()), name: `${plan.name} copy`, modifiedAt: new Date().toISOString() };
        await saveRaw(copy);
        return copy;
      }),
    rename: (id, name) =>
      serial(async () => {
        const plan = await loadRaw(id);
        if (!plan) throw new Error('That property is no longer in the library.');
        const v = name.trim();
        if (!v) return;
        await saveRaw({ ...plan, name: v, modifiedAt: new Date().toISOString() });
      }),
    remove: (id) =>
      serial(async () => {
        await kv.del(planKey(id));
        const index = await readIndex();
        await kv.set(
          LIBRARY_INDEX_KEY,
          index.filter((e) => e.id !== id),
        );
      }),
    add: (plan) =>
      serial(async () => {
        const stored: Plan = { ...plan, id: await freeId(plan.id) };
        await saveRaw(stored);
        return stored;
      }),
    moveLegacyAutosave: () =>
      serial(async () => {
        const legacy = await kv.get(LEGACY_AUTOSAVE_KEY);
        if (legacy === undefined) return null;
        if ((await readIndex()).length > 0) return null;
        let plan: Plan;
        try {
          plan = migrate(legacy);
        } catch (err) {
          // Kept where it is: nothing reads it any more, but it is not thrown away either.
          console.warn('Not moving an unreadable autosave into the library', err);
          return null;
        }
        await saveRaw(plan);
        await kv.del(LEGACY_AUTOSAVE_KEY);
        return plan.id;
      }),
  };
}

/** The app's library, in IndexedDB. */
export const library: Library = /* @__PURE__ */ createLibrary();

/** localStorage key of the id of the property that was open last. */
export const LAST_PLAN_KEY = 'homeplan:lastPlanId';

export function readLastPlanId(): string | null {
  try {
    return localStorage.getItem(LAST_PLAN_KEY);
  } catch {
    return null;
  }
}

export function writeLastPlanId(id: string): void {
  try {
    localStorage.setItem(LAST_PLAN_KEY, id);
  } catch {
    // Blocked storage: the most recently modified property opens instead.
  }
}

/**
 * The plan to open at startup: the last one open, else the most recently modified, else null.
 * Moves the old autosave slot into the library first. A broken entry is skipped (with a warning).
 */
export async function startupPlan(lib: Library = library, lastId: string | null = readLastPlanId()): Promise<Plan | null> {
  await lib.moveLegacyAutosave();
  const tryLoad = async (id: string) => {
    try {
      return await lib.load(id);
    } catch (err) {
      console.warn(`Skipping unreadable property ${id}`, err);
      return null;
    }
  };
  if (lastId) {
    const plan = await tryLoad(lastId);
    if (plan) return plan;
  }
  for (const entry of await lib.list()) {
    const plan = await tryLoad(entry.id);
    if (plan) return plan;
  }
  return null;
}
