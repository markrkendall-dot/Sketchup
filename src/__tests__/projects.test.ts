import { describe, expect, it } from 'vitest';
import manifest from '../../scripts/projects.json';
import { grouped, neighbours, parseProjectList, projectCards, projectHref, withProjectCards, type Project } from '../viewer/projects';

import indexHtml from '../../docs/index.html?raw';

const viewers = import.meta.glob<string>('../../docs/viewer/*-viewer.html', { query: '?raw', import: 'default', eager: true });
const planFiles = Object.keys(import.meta.glob('../../docs/examples/*.json'));
const projects: Project[] = manifest;

describe('scripts/projects.json', () => {
  it('has a unique slug, a house, a title and a plan file for every project', () => {
    expect(new Set(projects.map((p) => p.slug)).size).toBe(projects.length);
    for (const p of projects) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      expect(p.group && p.title).toBeTruthy();
      expect(planFiles, p.plan).toContain(`../../${p.plan}`);
    }
  });

  it('has a published viewer for every project, with the same list baked in (run npm run build:viewer and npm run publish:viewer)', () => {
    const baked = projects.map(({ slug, group, title }) => ({ slug, group, title }));
    for (const p of projects) {
      const html = viewers[`../../docs/viewer/${p.slug}-viewer.html`] ?? '';
      const text = /<script type="application\/json" id="homeplan-projects">([^]*?)<\/script>/.exec(html)?.[1];
      expect(parseProjectList(text), p.slug).toEqual({ current: p.slug, projects: baked });
    }
  });

  it('is what the front page lists (run npm run build:index after changing it)', () => {
    const html = indexHtml;
    expect(withProjectCards(html, projects)).toBe(html);
    for (const p of projects) expect(html).toContain(`href="viewer/${p.slug}-viewer.html"`);
  });
});

describe('the project list', () => {
  const list = [
    { slug: 'a', group: 'One', title: 'A' },
    { slug: 'b', group: 'Two', title: 'B' },
    { slug: 'c', group: 'One', title: 'C & <more>' },
  ];

  it('parses the baked list and refuses one that is missing, malformed or does not list the page', () => {
    expect(parseProjectList(JSON.stringify({ current: 'b', projects: list }))).toEqual({ current: 'b', projects: list });
    expect(parseProjectList(undefined)).toBeNull();
    expect(parseProjectList('  ')).toBeNull();
    expect(parseProjectList('{not json')).toBeNull();
    expect(parseProjectList(JSON.stringify({ current: 'z', projects: list }))).toBeNull();
    expect(parseProjectList(JSON.stringify({ current: 'a', projects: [{ slug: 'a' }] }))).toBeNull();
  });

  it('steps to the previous and next project, wrapping round', () => {
    expect(neighbours({ current: 'a', projects: list })).toEqual({ prev: list[2], next: list[1] });
    expect(neighbours({ current: 'c', projects: list })).toEqual({ prev: list[1], next: list[0] });
    expect(neighbours({ current: 'a', projects: [list[0]] })).toBeNull();
  });

  it('groups plans under their house in the list order', () => {
    expect(grouped(list).map((g) => [g.group, g.items.map((p) => p.slug)])).toEqual([
      ['One', ['a', 'c']],
      ['Two', ['b']],
    ]);
  });

  it('links viewers side by side and escapes the card text', () => {
    expect(projectHref('146-mick-road')).toBe('./146-mick-road-viewer.html');
    expect(projectCards(list)).toContain('<strong>C &amp; &lt;more&gt;</strong>');
  });
});
