// Writes the front page's cards (docs/index.html, between its projects:start and projects:end
// comments) from scripts/projects.json: a heading per house and a link per plan. The rest of the
// page is written by hand. Run with `npm run build:index` (`npm run build:viewer` runs it too).
import { readFileSync, writeFileSync } from 'node:fs';
import { withProjectCards, type Project } from '../src/viewer/projects';

export function main(): void {
  const projects = JSON.parse(readFileSync(new URL('./projects.json', import.meta.url), 'utf8')) as Project[];
  const target = new URL('../docs/index.html', import.meta.url);
  writeFileSync(target, withProjectCards(readFileSync(target, 'utf8'), projects));
  console.log(`Wrote ${target.pathname} (${projects.length} projects)`);
}
