// The Houses library: every plan with something drawn in it is kept in this browser (IndexedDB),
// one record per plan id, and found again by its address or name. Nothing leaves the browser.
import { del, get, set } from 'idb-keyval';
import { migrate } from '../model/plan';
import type { Id, Plan } from '../model/types';

export const LIBRARY_INDEX_KEY = 'homeplan:library:index';
export const libraryKey = (id: Id): string => `homeplan:library:${id}`;

/** What the Houses list shows for a plan, kept apart from the plan so listing never loads one. */
export interface HouseEntry {
  id: Id;
  name: string;
  address?: string;
  modifiedAt: string;
  /** A plan that ships with the app (docs/examples) and has no copy in the library yet. */
  bundled?: 'starter' | 'rebuild';
}

/** The key-value store the library sits on (idb-keyval in the app; tests pass a Map). */
export interface LibraryStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  del: (key: string) => Promise<void>;
}

const IDB: LibraryStore = { get: (k) => get(k), set: (k, v) => set(k, v), del: (k) => del(k) };

export function entryOf(plan: Plan): HouseEntry {
  const entry: HouseEntry = { id: plan.id, name: plan.name, modifiedAt: plan.modifiedAt };
  if (plan.address) entry.address = plan.address;
  return entry;
}

/** The line a house is listed under: its address, or its name when it has none. */
export function houseLabel(entry: Pick<HouseEntry, 'name' | 'address'>): string {
  return entry.address?.trim() || entry.name;
}

// Street words as people type them, so "2926 Wesley Rd" finds "2926 Wesley Road" and back.
const STREET_WORDS: Record<string, string> = {
  road: 'rd',
  street: 'st',
  avenue: 'ave',
  drive: 'dr',
  lane: 'ln',
  court: 'ct',
  boulevard: 'blvd',
  place: 'pl',
  circle: 'cir',
  highway: 'hwy',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * True when every word of the query is found in the entry's address or name, ignoring case and
 * punctuation, with street words matching their abbreviations. A word may be a beginning ("wes"
 * finds Wesley); an empty query matches everything.
 */
export function matchesHouse(entry: Pick<HouseEntry, 'name' | 'address'>, query: string): boolean {
  const have = words(`${entry.address ?? ''} ${entry.name}`);
  const hay = ` ${have.join(' ')} ${have.map((w) => STREET_WORDS[w] ?? w).join(' ')} `;
  return words(query).every((w) => hay.includes(` ${w}`) || hay.includes(` ${STREET_WORDS[w] ?? w} `));
}

/** The entries matching the query, a house with an address first, then the latest change first. */
export function searchHouses<T extends HouseEntry>(entries: readonly T[], query: string): T[] {
  return entries
    .filter((e) => matchesHouse(e, query))
    .sort((a, b) => Number(!!b.address) - Number(!!a.address) || b.modifiedAt.localeCompare(a.modifiedAt));
}

async function readIndex(store: LibraryStore): Promise<Record<Id, HouseEntry>> {
  const raw = await store.get(LIBRARY_INDEX_KEY);
  return raw && typeof raw === 'object' ? { ...(raw as Record<Id, HouseEntry>) } : {};
}

// One write at a time: two saves must not both read the index before either writes it.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Keep the plan in the library under its id, replacing the copy it had. */
export function saveHouse(plan: Plan, store: LibraryStore = IDB): Promise<void> {
  return inTurn(async () => {
    await store.set(libraryKey(plan.id), plan);
    const index = await readIndex(store);
    index[plan.id] = entryOf(plan);
    await store.set(LIBRARY_INDEX_KEY, index);
  });
}

/** Every house kept in this browser (empty when storage is unavailable). */
export async function listHouses(store: LibraryStore = IDB): Promise<HouseEntry[]> {
  try {
    return Object.values(await readIndex(store));
  } catch (err) {
    console.warn('Could not read the Houses list', err);
    return [];
  }
}

/** The plan kept under the id, upgraded to the current schema; null when there is none. */
export async function loadHouse(id: Id, store: LibraryStore = IDB): Promise<Plan | null> {
  const raw = await store.get(libraryKey(id));
  return raw === undefined || raw === null ? null : migrate(raw);
}

/** Remove a house from the library. */
export function deleteHouse(id: Id, store: LibraryStore = IDB): Promise<void> {
  return inTurn(async () => {
    const index = await readIndex(store);
    delete index[id];
    await store.set(LIBRARY_INDEX_KEY, index);
    await store.del(libraryKey(id));
  });
}
