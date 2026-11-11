// Turns the viewer build (dist-viewer/viewer.html plus its one script and one stylesheet, from
// `vite build --config vite.viewer.config.ts`) into single self-contained HTML files with a plan
// baked in, so each can be sent as a file or put on any static host and opened on an iPad.
//   node scripts/build-viewer.mjs
//     every project in scripts/projects.json, each with the list of projects baked in for the
//     switcher in its bar (`npm run build:viewer` does this)
//   node scripts/build-viewer.mjs that-plan.json [dist-viewer/out.html]
//     one plan saved from the editor, on its own (no switcher)
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const [planArg, outArg] = process.argv.slice(2);
const dir = 'dist-viewer';
const template = readFileSync(join(dir, 'viewer.html'), 'utf8');

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
let page = template.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_m, file) => {
  scripts++;
  return `<script type="module">${inline(file, '</script')}</script>`;
});
let styles = 0;
page = page.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
  styles++;
  return `<style>${inline(file, '</style')}</style>`;
});
if (scripts !== 1 || styles !== 1) throw new Error(`expected one script and one stylesheet to inline, found ${scripts} and ${styles}`);
if (/(src|href)="\.\/assets/.test(page)) throw new Error('an asset reference was left in the page');

/**
 * One viewer: the plan, and the list of projects when it is one of them, go in before the module
 * script so they are in the DOM when the script runs.
 */
function build(planPath, out, projectList) {
  const planText = readFileSync(planPath, 'utf8');
  const plan = JSON.parse(planText); // validates the file is JSON
  const data = [`<script type="application/json" id="homeplan-plan">${safeJson(planText)}</script>`];
  if (projectList) data.push(`<script type="application/json" id="homeplan-projects">${safeJson(JSON.stringify(projectList))}</script>`);
  let html = page.replace('<script type="module">', () => `${data.join('\n    ')}\n    <script type="module">`);
  const title = String(plan.name ?? 'HomePlan').replace(/\s*\(.*\)\s*$/, '');
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))} Viewer</title>`);
  writeFileSync(out, html);
  console.log(`Wrote ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
}

if (planArg) {
  build(planArg, outArg ?? join(dir, `${basename(planArg, '.json')}-viewer.html`));
} else {
  const all = JSON.parse(readFileSync('scripts/projects.json', 'utf8'));
  const projects = all.map(({ slug, group, title }) => ({ slug, group, title }));
  for (const p of all) build(p.plan, join(dir, `${p.slug}-viewer.html`), { current: p.slug, projects });
}
