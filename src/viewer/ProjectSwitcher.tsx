import { useEffect, useRef, useState } from 'react';
import { grouped, HUB_HREF, neighbours, projectHref, projectLabel, type ProjectList } from './projects';

/**
 * The bar's title as a way round the projects: a button with the project's name that opens the
 * list (by house, the current one marked, then "All projects" for the front page), and arrows to
 * the previous and next project. Every entry is a plain relative link, so it works wherever the
 * viewers are hosted side by side (GitHub Pages, githack, any static host).
 */
export function ProjectSwitcher({ list }: { list: ProjectList }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = list.projects.find((p) => p.slug === list.current)!;
  const near = neighbours(list);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="viewer-projects" ref={ref}>
      <button className="viewer-projects-button" aria-haspopup="true" aria-expanded={open} title="Switch project" onClick={() => setOpen((o) => !o)}>
        <span className="viewer-projects-name">{projectLabel(current)}</span>
        <span className="viewer-projects-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {near && (
        <span className="viewer-projects-arrows">
          <a href={projectHref(near.prev.slug)} title={`Previous: ${projectLabel(near.prev)}`} aria-label={`Previous project: ${projectLabel(near.prev)}`}>
            ‹
          </a>
          <a href={projectHref(near.next.slug)} title={`Next: ${projectLabel(near.next)}`} aria-label={`Next project: ${projectLabel(near.next)}`}>
            ›
          </a>
        </span>
      )}
      {open && (
        <nav className="viewer-projects-menu" aria-label="Projects">
          {grouped(list.projects).map(({ group, items }) => (
            <div key={group} className="viewer-projects-group">
              <div className="viewer-projects-house">{group}</div>
              {items.map((p) => (
                <a key={p.slug} href={projectHref(p.slug)} className={p.slug === list.current ? 'current' : ''} aria-current={p.slug === list.current ? 'page' : undefined}>
                  {p.title}
                </a>
              ))}
            </div>
          ))}
          <a className="viewer-projects-all" href={HUB_HREF}>
            All projects
          </a>
        </nav>
      )}
    </div>
  );
}
