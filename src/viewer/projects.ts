// The list of projects (scripts/projects.json): one entry per plan that has a viewer. It drives
// the front page's cards (docs/index.html, written by scripts/build-index.ts) and the switcher in
// each viewer's bar (ProjectSwitcher.tsx), which scripts/build-viewer.mjs bakes into the page as
// <script type="application/json" id="homeplan-projects">. Nothing here touches the DOM.

export interface Project {
  /** The viewer's file is `<slug>-viewer.html`. */
  slug: string;
  /** The house; plans of the same house are listed together under it. */
  group: string;
  title: string;
  blurb?: string;
  /** The plan's JSON, from the repository's root (used by the build only). */
  plan?: string;
}

export interface ProjectList {
  /** The slug of the project this page shows. */
  current: string;
  projects: Project[];
}

const isProject = (p: unknown): p is Project => {
  const o = p as Partial<Project> | null;
  return !!o && typeof o.slug === 'string' && typeof o.group === 'string' && typeof o.title === 'string';
};

/** The baked list, or null when there is none worth a switcher (absent, malformed, or not listing this page). */
export function parseProjectList(text: string | null | undefined): ProjectList | null {
  if (!text?.trim()) return null;
  try {
    const data = JSON.parse(text) as Partial<ProjectList> | null;
    if (!data || typeof data.current !== 'string' || !Array.isArray(data.projects)) return null;
    const projects = data.projects.filter(isProject);
    return projects.some((p) => p.slug === data.current) ? { current: data.current, projects } : null;
  } catch {
    return null;
  }
}

/** A viewer's address from another viewer: they sit side by side on the host. */
export const projectHref = (slug: string): string => `./${encodeURIComponent(slug)}-viewer.html`;

/** The front page's address from a viewer (docs/index.html, one folder up). */
export const HUB_HREF = '../index.html';

export const projectLabel = (p: Project): string => `${p.group}: ${p.title}`;

/** The projects before and after the current one, wrapping round; null with fewer than two. */
export function neighbours(list: ProjectList): { prev: Project; next: Project } | null {
  const n = list.projects.length;
  const i = list.projects.findIndex((p) => p.slug === list.current);
  if (n < 2 || i < 0) return null;
  return { prev: list.projects[(i + n - 1) % n], next: list.projects[(i + 1) % n] };
}

/** The projects under their houses, both in the list's order. */
export function grouped(projects: readonly Project[]): { group: string; items: Project[] }[] {
  const out: { group: string; items: Project[] }[] = [];
  for (const p of projects) {
    const g = out.find((x) => x.group === p.group);
    if (g) g.items.push(p);
    else out.push({ group: p.group, items: [p] });
  }
  return out;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const CARDS_START = '<!-- projects:start (written by npm run build:index from scripts/projects.json) -->';
export const CARDS_END = '<!-- projects:end -->';

/** The front page's cards: a heading per house, a link per plan. */
export function projectCards(projects: readonly Project[]): string {
  const lines: string[] = [];
  for (const { group, items } of grouped(projects)) {
    lines.push(`      <h2 class="house">${esc(group)}</h2>`);
    for (const p of items) {
      lines.push(`      <a class="plan" href="viewer/${esc(encodeURIComponent(p.slug))}-viewer.html">`);
      lines.push(`        <strong>${esc(p.title)}</strong>`);
      if (p.blurb) lines.push(`        <span>${esc(p.blurb)}</span>`);
      lines.push('      </a>');
    }
  }
  return lines.join('\n');
}

/** The front page with its cards replaced by the list's. */
export function withProjectCards(html: string, projects: readonly Project[]): string {
  const a = html.indexOf(CARDS_START);
  const b = html.indexOf(CARDS_END);
  if (a < 0 || b < a) throw new Error('docs/index.html has lost its projects:start / projects:end markers');
  return `${html.slice(0, a)}${CARDS_START}\n${projectCards(projects)}\n      ${html.slice(b)}`;
}
