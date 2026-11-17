// npm run scan -- <bundle dir> <name>
//
// Reads a room bundle (docs/scan/FORMAT.md: meta.json, room.json, frames.json), tidies it into a
// draft and writes three files:
//   scripts/<name>-scan.ts       the draft as a generated data module (not to be edited by hand);
//   docs/scan/<name>/draft.json  the draft as a plan, to open in the app straight away;
//   docs/scan/<name>/MEASURE.md  the tape list: what to measure, with the scanned numbers to check.
// Then prints the room's size, the counts and what was scanned below high confidence.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRoom } from './roomplan';
import { buildDraftPlan, emitScanModule, scanToDraft } from './scanToPlan';
import { feetInches, tapeList } from './tapeList';

const readJson = (dir: string, file: string, required: boolean): unknown => {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (required) throw new Error(`${path} is missing: is ${dir} a room bundle?`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
  }
};

export function main(): void {
  const [bundle, name] = process.argv.slice(3);
  if (!bundle || !name) throw new Error('usage: npm run scan -- <bundle dir> <name>   (name: lower case letters, digits and hyphens, as kitchen)');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`the name ${JSON.stringify(name)} must be lower case letters, digits and hyphens`);
  const dir = resolve(bundle);
  const scan = parseRoom(readJson(dir, 'room.json', true), readJson(dir, 'frames.json', false), readJson(dir, 'meta.json', false));
  const draft = scanToDraft(scan);
  const { json, skipped } = buildDraftPlan(draft);

  const root = new URL('../../', import.meta.url);
  const moduleFile = new URL(`scripts/${name}-scan.ts`, root);
  const outDir = new URL(`docs/scan/${name}/`, root);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(moduleFile, emitScanModule(draft, name));
  writeFileSync(new URL('draft.json', outDir), json);
  writeFileSync(new URL('MEASURE.md', outDir), tapeList(draft));
  for (const f of [moduleFile, new URL('draft.json', outDir), new URL('MEASURE.md', outDir)]) console.log(`Wrote ${f.pathname}`);

  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const byType = (t: string) => draft.openings.filter((o) => o.type === t).length;
  console.log('');
  console.log(`${draft.name}: ${feetInches(draft.room.width)} x ${feetInches(draft.room.depth)}, ceiling ${feetInches(draft.room.ceiling)}${draft.room.closed ? '' : ' (the walls do not close)'}`);
  console.log(
    `${count(draft.walls.length, 'wall')}, ${count(draft.corners.length, 'corner')}, ${count(byType('door'), 'door')}, ${count(byType('window'), 'window')}, ${count(byType('passage'), 'opening')}, ${count(draft.fixtures.length, 'fixture')} (${draft.fixtures.filter((f) => f.wallId).length} against a wall), ${count(draft.runs.length, 'cabinet run')}, ${count(draft.views.length, 'saved view')}`,
  );
  const low = [...draft.walls, ...draft.openings, ...draft.fixtures].filter((x) => x.confidence !== 'high');
  if (low.length) {
    console.log('Below high confidence:');
    for (const x of low) console.log(`  ${x.id} (${x.confidence})`);
  }
  for (const s of skipped) console.log(`Not placed as scanned: ${s}`);
  for (const s of draft.notes) console.log(`Note: ${s}`);
}
