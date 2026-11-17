// Writes the synthetic scan bundle (syntheticRoom.ts) to scripts/scan/fixtures/synthetic-room/:
// meta.json, room.json, frames.json and mesh.ply (no photos). Running it twice gives the same files.
//   node scripts/run-ts.mjs scripts/scan/fixtures/makeSynthetic.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSyntheticBundle, makeSyntheticPly } from './syntheticRoom';

export function main(): void {
  const dir = new URL('./synthetic-room/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const bundle = makeSyntheticBundle();
  for (const [file, data] of [
    ['meta.json', bundle.meta],
    ['room.json', bundle.room],
    ['frames.json', bundle.frames],
  ] as const) {
    const target = new URL(file, dir);
    writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
    console.log(`Wrote ${target.pathname}`);
  }
  const ply = new URL('mesh.ply', dir);
  writeFileSync(ply, makeSyntheticPly());
  console.log(`Wrote ${ply.pathname}`);
}
