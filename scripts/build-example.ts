// Writes docs/examples/146-mick-road.json. Run with `npm run build:example`; running it twice gives
// the same file (ids are renamed to stable ones and the date is fixed).
import { writeFileSync } from 'node:fs';
import { buildExampleJson } from './example-plan';

export function main(): void {
  const target = new URL('../docs/examples/146-mick-road.json', import.meta.url);
  writeFileSync(target, buildExampleJson());
  console.log(`Wrote ${target.pathname}`);
}
