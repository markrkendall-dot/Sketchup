// Writes docs/examples/146-mick-road.json (the starter: the house as it stands with its proposed
// renovation) and docs/examples/146-mick-road-rebuild.json (the house rebuilt on its foundation).
// Run with `npm run build:example`; running it twice gives the same files (ids are renamed to stable
// ones and the date is fixed).
import { writeFileSync } from 'node:fs';
import { buildExampleJson } from './example-plan';
import { buildRebuildJson } from './rebuild-plan';

export function main(): void {
  for (const [file, build] of [
    ['146-mick-road.json', buildExampleJson],
    ['146-mick-road-rebuild.json', buildRebuildJson],
  ] as const) {
    const target = new URL(`../docs/examples/${file}`, import.meta.url);
    writeFileSync(target, build());
    console.log(`Wrote ${target.pathname}`);
  }
}
