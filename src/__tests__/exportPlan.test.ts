import { describe, expect, it } from 'vitest';
import example from '../../docs/examples/146-mick-road.json';
import { PLAN_RULES, PLAN_STYLES, PLAN_VARS } from '../editor2d/planStyles';
import { EXPORT_MARGIN, EXPORT_PX_PER_INCH, levelDrawingBounds, planExport, planFrame, planSvg, pngSize, PNG_SCALE, SCALE_NOTE } from '../io/exportPlan';
import { migrate } from '../model/plan';
import { EMPTY_SELECTION, useUiStore } from '../store/uiStore';

const plan = migrate(example);
const first = plan.levelOrder[1];

describe('plan export scale and frame (REVIEW-2 B4)', () => {
  it('draws 1/4" = 1\'-0" at 96 dpi: a foot of plan is 24 px, an inch 2 px; the PNG doubles it', () => {
    expect(EXPORT_PX_PER_INCH * 12).toBe(24);
    expect(EXPORT_PX_PER_INCH).toBe(2);
    expect(PNG_SCALE).toBe(2);
    expect(SCALE_NOTE).toBe('1/4" = 1\'-0"');
  });

  it('fits the level with a 24" margin and the title block below, in whole pixels', () => {
    const f = planFrame({ minX: 0, minY: 0, maxX: 480, maxY: 300 });
    expect(EXPORT_MARGIN).toBe(24);
    expect(f.x).toBe(-24);
    expect(f.y).toBe(-24);
    expect(f.width).toBe(528);
    expect(f.widthPx).toBe(1056);
    expect(f.titleY).toBe(324);
    expect(f.heightPx).toBe(348 * 2 + 96);
    expect(f.height).toBe(f.heightPx / 2);
    expect(pngSize(f)).toEqual({ width: 2112, height: 1584 });
  });

  it('keeps a small plan wide enough for the title block, centred', () => {
    const f = planFrame({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(f.widthPx).toBe(560);
    expect(f.x + f.width / 2).toBeCloseTo(50);
  });

  it('frames the example First Floor round its walls and roofs', () => {
    const b = levelDrawingBounds(plan.levels[first], 'all')!;
    // Walls run x -62.5..459.5 and y 3.5..311.5 on centerlines; the roofs overhang further.
    expect(b.minX).toBeLessThan(-66);
    expect(b.maxX).toBeGreaterThan(463);
    const f = planExport(plan, first, 'all').frame;
    expect(f.x).toBeCloseTo(b.minX - 24);
    expect(f.widthPx).toBe(Math.ceil((b.maxX - b.minX + 48) * 2));
  });
});

describe('planSvg', () => {
  const date = new Date(2026, 9, 11);

  it('is a stand-alone drawing with the room names, a title and the title block', () => {
    // Whatever is selected or hovered on screen is not drawn.
    useUiStore.setState({ selection: { ...EMPTY_SELECTION, walls: ['f-w16'] }, hover: { nodeId: null, wallId: 'f-w1', openingId: null } });
    const svg = planSvg(plan, first, 'all', { date });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>146 Mick Road (starter, estimates flagged) - First Floor</title>');
    for (const name of ['Kitchen', 'Living', 'Front room', 'Utility']) expect(svg).toContain(name);
    expect(svg).toContain('First Floor, All view');
    expect(svg).toContain(`Scale 1/4&quot; = 1'-0&quot; at 96 dpi`);
    expect(svg).toContain('2026-10-11');
    expect(svg).toContain('data-north-angle="0"');
    const markup = svg.slice(svg.indexOf('</style>'));
    expect(markup).not.toContain('is-selected');
    expect(markup).not.toContain('is-hovered');
    // The layers' CSS travels with it.
    expect(svg).toContain(PLAN_RULES.slice(0, 40));
    expect(svg).toContain('--wall-exterior');
    // Dimension labels are drawn.
    expect(svg).toMatch(/class="dim-label"[^>]*>12&#x27;/);
    useUiStore.setState({ selection: EMPTY_SELECTION, hover: { nodeId: null, wallId: null, openingId: null } });
  });

  it('follows the view mode and the north angle', () => {
    const turned = { ...plan, site: { ...plan.site, northAngle: 30 } };
    const svg = planSvg(turned, first, 'existing', { date });
    expect(svg).toContain('First Floor, Existing view');
    expect(svg).toContain('data-north-angle="30"');
    expect(svg).toContain('rotate(30)');
  });

  it('the plan styles are one string: colours then rules', () => {
    expect(PLAN_STYLES.startsWith(PLAN_VARS)).toBe(true);
    expect(PLAN_STYLES).toContain(PLAN_RULES);
    expect(PLAN_RULES).toContain('.wall-fill');
    expect(PLAN_RULES).toContain('.room-name');
    expect(PLAN_RULES).not.toContain('.snap-marker');
  });
});

describe('phase styling on the plan', () => {
  // Red and green only where the two layouts overlay (All); Existing draws the house as it stands
  // and Proposed the finished house, every element as existing (phase.ts shownPhase).
  const date = new Date(2026, 0, 1);
  // The phases on the drawn elements' class attributes (the embedded stylesheet names them all).
  const classes = (svg: string) => new Set([...svg.matchAll(/class="[^"]*\bphase-(existing|demo|new)\b[^"]*"/g)].map((m) => m[1]));
  it('draws demolished work red and new work green only in All', () => {
    expect(classes(planSvg(plan, first, 'all', { date }))).toEqual(new Set(['existing', 'demo', 'new']));
    expect(classes(planSvg(plan, first, 'existing', { date }))).toEqual(new Set(['existing']));
    expect(classes(planSvg(plan, first, 'proposed', { date }))).toEqual(new Set(['existing']));
  });
});
