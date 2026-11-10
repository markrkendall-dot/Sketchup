import { describe, expect, it } from 'vitest';
import { deleteHouse, listHouses, loadHouse, matchesHouse, saveHouse, searchHouses, type HouseEntry, type LibraryStore } from '../io/library';
import { createEmptyPlan, migrate } from '../model/plan';

function memoryStore(): LibraryStore {
  const map = new Map<string, unknown>();
  return {
    get: async (k) => structuredClone(map.get(k)),
    set: async (k, v) => void map.set(k, structuredClone(v)),
    del: async (k) => void map.delete(k),
  };
}

const wesley = { name: 'Our house', address: '2926 Wesley Road, Springfield' };

describe('finding a house by address', () => {
  it('matches part of the address, in any case and order', () => {
    expect(matchesHouse(wesley, '2926')).toBe(true);
    expect(matchesHouse(wesley, 'wes')).toBe(true);
    expect(matchesHouse(wesley, 'WESLEY 2926')).toBe(true);
    expect(matchesHouse(wesley, '')).toBe(true);
    expect(matchesHouse(wesley, '5130')).toBe(false);
    expect(matchesHouse(wesley, '2926 larewood')).toBe(false);
  });
  it('treats street words and their abbreviations as the same', () => {
    expect(matchesHouse(wesley, '2926 wesley rd.')).toBe(true);
    expect(matchesHouse({ name: 'Parents', address: '5130 Larewood Dr' }, 'larewood drive')).toBe(true);
    expect(matchesHouse({ name: 'Parents', address: '5130 West Larewood Dr' }, 'larewood street')).toBe(false);
  });
  it('falls back to the plan name when there is no address', () => {
    expect(matchesHouse({ name: '146 Mick Road (starter, estimates flagged)' }, '146 mick')).toBe(true);
  });
  it('lists houses with an address first, then the latest change', () => {
    const e = (id: string, modifiedAt: string, address?: string): HouseEntry => ({ id, name: id, modifiedAt, address });
    const found = searchHouses([e('a', '2026-01-01'), e('b', '2026-03-01'), e('c', '2026-02-01', '1 Elm St')], '');
    expect(found.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('the library', () => {
  it('keeps plans by id and lists them with their address', async () => {
    const store = memoryStore();
    const a = { ...createEmptyPlan('Ours'), address: '2926 Wesley Rd' };
    const b = createEmptyPlan('Parents');
    await Promise.all([saveHouse(a, store), saveHouse(b, store)]);
    const list = await listHouses(store);
    expect(list.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.find((e) => e.id === a.id)?.address).toBe('2926 Wesley Rd');
    expect((await loadHouse(a.id, store))?.address).toBe('2926 Wesley Rd');
    await saveHouse({ ...a, address: '2926 Wesley Road' }, store);
    expect((await listHouses(store)).length).toBe(2);
    await deleteHouse(a.id, store);
    expect((await listHouses(store)).map((e) => e.id)).toEqual([b.id]);
    expect(await loadHouse(a.id, store)).toBeNull();
  });
  it('keeps the address through a save and open, and drops an empty one', () => {
    const plan = { ...createEmptyPlan('Ours'), address: ' 2926 Wesley Rd ' };
    expect(migrate(JSON.parse(JSON.stringify(plan))).address).toBe('2926 Wesley Rd');
    expect('address' in migrate(JSON.parse(JSON.stringify({ ...plan, address: '  ' })))).toBe(false);
  });
});
