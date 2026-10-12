// Turns the viewer build (dist-viewer/viewer.html plus its one script and one stylesheet, from
// `vite build --config vite.viewer.config.ts`) into a single self-contained HTML file with a plan
// baked in, so it can be sent as a file or put on any static host and opened on an iPad.
//   node scripts/build-viewer.mjs docs/examples/146-mick-road.json [dist-viewer/out.html]
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [planPath, outArg] = process.argv.slice(2);
if (!planPath) {
  console.error('usage: node scripts/build-viewer.mjs <plan.json> [out.html]');
  process.exit(2);
}
const dir = 'dist-viewer';
let html = readFileSync(join(dir, 'viewer.html'), 'utf8');
const planText = readFileSync(planPath, 'utf8');
const plan = JSON.parse(planText); // validates the file is JSON
const out = outArg ?? join(dir, `${basename(planPath, '.json')}-viewer.html`);

// A JSON text is safe inside a <script> once `</` and `<!--` cannot close or comment the element;
// both replacements are valid JSON escapes (they decode to the same characters). U+2028/2029 are
// legal in JSON strings but not in older script parsers; escape them too.
const safeJson = (text) =>
  text
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '\\u003c!--')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');

/** Inline a built asset; `end` is the tag that must not appear inside it (escaped if it does). */
function inline(file, end) {
  let text = readFileSync(join(dir, file), 'utf8');
  const re = new RegExp(end.replace('/', '\\/'), 'gi');
  if (re.test(text)) {
    console.warn(`warning: ${file} contains ${end}; escaped`);
    text = text.replace(re, (m) => m.replace('/', '\\/'));
  }
  return text;
}

let scripts = 0;
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_m, file) => {
  scripts++;
  return `<script type="module">${inline(file, '</script')}</script>`;
});
let styles = 0;
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
  styles++;
  return `<style>${inline(file, '</style')}</style>`;
});
if (scripts !== 1 || styles !== 1) throw new Error(`expected one script and one stylesheet to inline, found ${scripts} and ${styles}`);
if (/(src|href)="\.\/assets/.test(html)) throw new Error('an asset reference was left in the page');

// The plan, before the module script so it is in the DOM when the script runs.
html = html.replace('<script type="module">', () => `<script type="application/json" id="homeplan-plan">${safeJson(planText)}</script>\n    <script type="module">`);
const title = String(plan.name ?? 'HomePlan').replace(/\s*\(.*\)\s*$/, '');
html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))} Viewer</title>`);

writeFileSync(out, html);
console.log(`Wrote ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
