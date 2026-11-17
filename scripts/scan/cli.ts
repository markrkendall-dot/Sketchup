// npm run scan -- <bundle dir> <name>
//
// Reads a room bundle (docs/scan/FORMAT.md: meta.json, room.json, frames.json, mesh.ply), tidies it
// into a draft and writes:
//   scripts/<name>-scan.ts         the draft as a generated data module (not to be edited by hand);
//   docs/scan/<name>/overlay.glb   the scan mesh (mesh.ply) moved onto the draft, decimated (only with a mesh.ply);
//   docs/scan/<name>/draft.json    the draft as a plan, to open in the app straight away, the overlay in it;
//   docs/scan/<name>/MEASURE.md    the tape list: what to measure, with the scanned numbers to check.
// Then prints the room's size, the counts and what was scanned below high confidence.
//
// An object bundle (meta.json kind "object") is only described: its size, and how to import it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MeshAsset } from '../../src/model/types';
import { overlayAsset } from './attachOverlay';
import { plyToOverlayGlb } from './overlay';
import { describeObject } from './objectBundle';
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

export async function main(): Promise<void> {
  const [bundle, name] = process.argv.slice(3);
  if (!bundle || !name) throw new Error('usage: npm run scan -- <room or object bundle dir> <name>   (name: lower case letters, digits and hyphens, as kitchen)');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`the name ${JSON.stringify(name)} must be lower case letters, digits and hyphens`);
  const dir = resolve(bundle);
  const meta = readJson(dir, 'meta.json', false);
  if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).kind === 'object') {
    const usdz = join(dir, 'object.usdz');
    for (const line of describeObject(meta as Record<string, unknown>, usdz, existsSync(usdz))) console.log(line);
    return;
  }
  const scan = parseRoom(readJson(dir, 'room.json', true), readJson(dir, 'frames.json', false), meta);
  const draft = scanToDraft(scan);

  const root = new URL('../../', import.meta.url);
  const moduleFile = new URL(`scripts/${name}-scan.ts`, root);
  const outDir = new URL(`docs/scan/${name}/`, root);
  mkdirSync(outDir, { recursive: true });
  const written = [moduleFile];
  const plyPath = join(dir, 'mesh.ply');
  let overlayNote: string;
  let asset: MeshAsset | undefined;
  if (existsSync(plyPath)) {
    const glb = await plyToOverlayGlb(new Uint8Array(readFileSync(plyPath)), draft.tidy);
    const glbFile = new URL('overlay.glb', outDir);
    writeFileSync(glbFile, glb.bytes);
    written.push(glbFile);
    asset = overlayAsset(glb.bytes, name, `${draft.name} scan`);
    const mb = (glb.bytes.byteLength / 1024 / 1024).toFixed(2);
    overlayNote = `Scan overlay: ${glb.triangles} triangles (of ${glb.sourceTriangles} in mesh.ply), ${mb} MB${glb.colours ? '' : ', no vertex colours'}; ${feetInches(glb.size[0])} x ${feetInches(glb.size[1])} x ${feetInches(glb.size[2])} high.`;
  } else {
    overlayNote = `No mesh.ply in ${dir}: the draft has no scan overlay.`;
  }
  const { json, skipped } = buildDraftPlan(draft, asset);
  writeFileSync(moduleFile, emitScanModule(draft, name));
  writeFileSync(new URL('draft.json', outDir), json);
  writeFileSync(new URL('MEASURE.md', outDir), tapeList(draft));
  written.push(new URL('draft.json', outDir), new URL('MEASURE.md', outDir));
  for (const f of written) console.log(`Wrote ${f.pathname}`);

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
  console.log(overlayNote);
  for (const s of skipped) console.log(`Not placed as scanned: ${s}`);
  for (const s of draft.notes) console.log(`Note: ${s}`);
}
