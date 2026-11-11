// Copies each project's built viewer (dist-viewer/<slug>-viewer.html, from `npm run build:viewer`)
// to docs/viewer/, the copies the web site and githack serve. Run with `npm run publish:viewer`.
import { copyFileSync, readFileSync } from 'node:fs';

for (const { slug } of JSON.parse(readFileSync('scripts/projects.json', 'utf8'))) {
  const file = `${slug}-viewer.html`;
  copyFileSync(`dist-viewer/${file}`, `docs/viewer/${file}`);
  console.log(`Copied dist-viewer/${file} to docs/viewer/${file}`);
}
