import { describe, expect, it } from 'vitest';
import { backupFileName, readJsonFile } from '../io/file';
import { BACKUP_FORMAT, BACKUP_VERSION, contentHash, createLibrary, isBackup, LIBRARY_INDEX_KEY, memoryStore, planKey, unmodifiedExample } from '../io/library';
import { createEmptyPlan } from '../model/plan';
import type { Plan } from '../model/types';
import { optionToRestore, restoreSummary } from '../ui/fileActions';

const plan = (name: string, modifiedAt: string): Plan => ({ ...createEmptyPlan(name), modifiedAt });

describe('Backup all and Restore all', () => {
  it('backs up every stored plan in one versioned wrapper', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    const b = plan('B', '2026-02-01T00:00:00.000Z');
    await lib.save(a);
    await lib.save(b, 'data:image/png;base64,AAA');
    const backup = await lib.backup();
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(isBackup(backup)).toBe(true);
    expect(isBackup(a)).toBe(false);
    expect(isBackup(null)).toBe(false);
    expect((backup.plans as Plan[]).map((p) => p.name).sort()).toEqual(['A', 'B']);
    // It survives JSON, as the downloaded file does.
    expect(isBackup(JSON.parse(JSON.stringify(backup)))).toBe(true);
  });

  it('restores into an empty library under the same ids', async () => {
    const src = createLibrary(memoryStore());
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    await src.save(a);
    const backup = JSON.parse(JSON.stringify(await src.backup()));
    const lib = createLibrary(memoryStore());
    const r = await lib.restore(backup);
    expect(r.skipped).toBe(0);
    expect(r.added.map((p) => [p.id, p.name])).toEqual([[a.id, 'A']]);
    expect((await lib.load(a.id))?.name).toBe('A');
  });

  it('never overwrites: a plan whose id is there gets a new id and "(restored)"; a broken one is skipped and counted', async () => {
    const kv = memoryStore();
    const lib = createLibrary(kv);
    const a = plan('House', '2026-01-01T00:00:00.000Z');
    await lib.save(a);
    const backup = JSON.parse(JSON.stringify(await lib.backup()));
    // Changed here after the backup: the restore must leave this alone.
    await lib.save({ ...a, name: 'House now', modifiedAt: '2026-03-01T00:00:00.000Z' });
    backup.plans.push({ schemaVersion: 99 }, 'not a plan', plan('Shed', '2026-01-05T00:00:00.000Z'));
    const r = await lib.restore(backup);
    expect(r.skipped).toBe(2);
    expect(r.added.map((p) => p.name)).toEqual(['House (restored)', 'Shed']);
    expect(r.added[0].id).not.toBe(a.id);
    expect((await lib.load(a.id))?.name).toBe('House now');
    expect((await lib.list()).map((e) => e.name).sort()).toEqual(['House (restored)', 'House now', 'Shed']);
    expect((kv.data.get(LIBRARY_INDEX_KEY) as unknown[]).length).toBe(3);
    // Twice is two more copies, still nothing overwritten.
    const again = await lib.restore(backup);
    expect(new Set([...r.added, ...again.added].map((p) => p.id)).size).toBe(4);
    expect(restoreSummary(r)).toBe('Restored 2 properties; skipped 2 that could not be read.');
    expect(restoreSummary({ added: [a], skipped: 0 })).toBe('Restored 1 property.');
  });

  it('runs each plan through migrate (an old plan is upgraded)', async () => {
    const lib = createLibrary(memoryStore());
    const old = { schemaVersion: 0, id: 'old', name: 'Old one', levels: [] };
    const r = await lib.restore({ format: BACKUP_FORMAT, version: 1, createdAt: '', plans: [old] });
    expect(r.skipped + r.added.length).toBe(1);
    if (r.added.length) expect(r.added[0].schemaVersion).toBe(10);
  });

  it('refuses what is not a backup, or one from a newer version', async () => {
    const lib = createLibrary(memoryStore());
    await expect(lib.restore(plan('A', ''))).rejects.toThrow(/not a HomePlan backup/);
    await expect(lib.restore({ format: BACKUP_FORMAT, version: 2, plans: [] })).rejects.toThrow(/newer HomePlan/);
  });

  it('keeps the key as the id in the backup, as load does', async () => {
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    const lib = createLibrary(memoryStore({ [planKey('under-key')]: a }));
    const backup = await lib.backup();
    expect((backup.plans[0] as Plan).id).toBe('under-key');
  });

  it('reads a chosen file as JSON and names the backup by date', async () => {
    await expect(readJsonFile({ name: 'x.json', text: async () => '{"a":1}' })).resolves.toEqual({ a: 1 });
    await expect(readJsonFile({ name: 'x.json', text: async () => 'nope' })).rejects.toThrow(/not valid JSON/);
    expect(backupFileName(new Date(2026, 0, 5))).toBe('homeplan-backup-2026-01-05.json');
  });

  it('keeps an entry\'s thumbnail, example and option across saves; setMeta changes or removes them', async () => {
    const lib = createLibrary(memoryStore());
    const a = plan('A', '2026-01-01T00:00:00.000Z');
    await lib.add(a, { example: { which: 'starter', hash: 'h', modifiedAt: a.modifiedAt } });
    await lib.setMeta(a.id, { activeOptionId: 'opt-b', thumbnail: 'data:image/png;base64,QQ' });
    await lib.save({ ...a, modifiedAt: '2026-01-02T00:00:00.000Z' });
    let e = await lib.entry(a.id);
    expect(e).toMatchObject({ example: { which: 'starter' }, activeOptionId: 'opt-b', thumbnail: 'data:image/png;base64,QQ' });
    await lib.setMeta(a.id, { activeOptionId: undefined });
    e = await lib.entry(a.id);
    expect(e?.activeOptionId).toBeUndefined();
    expect(await lib.entry('missing')).toBeNull();
    // A malformed field in the index is dropped, not the entry.
    await lib.setMeta(a.id, { thumbnail: 'javascript:alert(1)' });
    expect((await lib.entry(a.id))?.thumbnail).toBeUndefined();
  });
});

describe('Open example reuses an unmodified copy', () => {
  it('finds the copy added from the same example file whose modifiedAt has not moved', async () => {
    const lib = createLibrary(memoryStore());
    const example = plan('146 Mick Road', '2026-01-01T00:00:00.000Z');
    const hash = contentHash(example);
    expect(contentHash(JSON.parse(JSON.stringify(example)))).toBe(hash);
    expect(contentHash({ ...example, name: 'other' })).not.toBe(hash);
    const meta = { example: { which: 'starter', hash, modifiedAt: example.modifiedAt } };
    const copy = await lib.add(example, meta);
    expect(unmodifiedExample(await lib.list(), 'starter', hash)?.id).toBe(copy.id);
    // Another example, or a newer version of this one's file, is not this copy.
    expect(unmodifiedExample(await lib.list(), 'rebuild', hash)).toBeUndefined();
    expect(unmodifiedExample(await lib.list(), 'starter', 'newer')).toBeUndefined();
    // Edited (the save moves modifiedAt on): no longer unmodified; a fresh copy is added beside it.
    await lib.save({ ...copy, modifiedAt: '2026-05-01T00:00:00.000Z' });
    expect(unmodifiedExample(await lib.list(), 'starter', hash)).toBeUndefined();
    const fresh = await lib.add(example, meta);
    expect(fresh.id).not.toBe(copy.id);
    expect(unmodifiedExample(await lib.list(), 'starter', hash)?.id).toBe(fresh.id);
    // A duplicate or a restore of the copy is not taken for the example.
    const dup = await lib.duplicate(fresh.id);
    expect((await lib.entry(dup.id))?.example).toBeUndefined();
  });
});

describe('the active design option per property', () => {
  it('reopens on the option it was left on while the plan has it, else the first', async () => {
    const p = plan('Options', '2026-01-01T00:00:00.000Z');
    p.options.push({ id: 'b', name: 'Option B' });
    expect(optionToRestore(p, 'b')).toBe('b');
    expect(optionToRestore(p, 'gone')).toBeNull();
    expect(optionToRestore(p, null)).toBeNull();
    // Kept in the library entry across saves of the plan.
    const lib = createLibrary(memoryStore());
    await lib.save(p);
    await lib.setMeta(p.id, { activeOptionId: 'b' });
    await lib.save({ ...p, modifiedAt: '2026-02-01T00:00:00.000Z' });
    expect((await lib.entry(p.id))?.activeOptionId).toBe('b');
  });
});
