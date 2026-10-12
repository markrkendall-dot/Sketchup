// Export the 2D plan of a level (docs/history/REVIEW-2.md B4) as a stand-alone SVG drawing at 1/4" = 1'-0",
// with a title block, or as a PNG of it at 2x. The plan is the screen's own layers (PlanLayers),
// rendered with renderToStaticMarkup inside a provider of snapshot stores (editor2d/layerStores.ts)
// with nothing hovered, selected or being drawn, and the image underlay hidden. The layers' CSS
// (editor2d/planStyles.ts) is inlined, so the file needs nothing else.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getFootprints } from '../derive/footprint';
import { isVisible, VIEW_MODE_LABEL } from '../derive/phase';
import { roofOutlineWithOverhang } from '../derive/roofs';
import { stairsSymbol } from '../derive/stairs';
import { LayerStoresContext, snapshotStores } from '../editor2d/layerStores';
import { PlanLayers } from '../editor2d/PlanLayers';
import { PLAN_STYLES } from '../editor2d/planStyles';
import { boundsOf, type Bounds } from '../model/geometry';
import type { Id, Level, Plan, Vec2, ViewMode } from '../model/types';
import { EMPTY_SELECTION, emptyDraft, useUiStore, type UiState } from '../store/uiStore';
import { downloadBlob, planFileName } from './file';

/** Screen and print resolution the drawing is laid out for. */
export const EXPORT_DPI = 96;
/** The drawing's scale: a foot of plan is a quarter inch of paper. */
export const SCALE_NOTE = '1/4" = 1\'-0"';
/** Pixels per inch of plan at 1/4" = 1'-0" and 96 dpi: 1 ft = 0.25 in = 24 px, so 2 px per inch. */
export const EXPORT_PX_PER_INCH = (EXPORT_DPI * 0.25) / 12;
/** The PNG is drawn at twice that (48 px per foot of plan). */
export const PNG_SCALE = 2;
/** Space round the level's drawing, in inches of plan. */
export const EXPORT_MARGIN = 24;
/** Height of the title block under the plan, and the narrowest drawing that still fits it, in px. */
const TITLE_BLOCK_PX = 96;
const MIN_WIDTH_PX = 560;

/** The drawing's frame: the viewBox in plan inches, its size in px at 96 dpi, and where the title block starts. */
export interface PlanFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  widthPx: number;
  heightPx: number;
  /** Plan y of the top of the title block. */
  titleY: number;
}

/**
 * What the level shows in a view mode, for fitting the drawing: the visible walls' outlines, the
 * roofs with their overhangs, the stairs. Null when there is nothing.
 */
export function levelDrawingBounds(level: Level, viewMode: ViewMode): Bounds | null {
  const pts: Vec2[] = [];
  for (const fp of getFootprints(level, viewMode).values()) pts.push(...fp.poly);
  for (const r of Object.values(level.roofs ?? {})) if (isVisible(r.phase, viewMode)) pts.push(...roofOutlineWithOverhang(r));
  for (const st of Object.values(level.stairs)) if (isVisible(st.phase, viewMode)) pts.push(...stairsSymbol(st, 1).outline);
  return boundsOf(pts);
}

/**
 * The frame round `bounds` (plan inches): EXPORT_MARGIN on every side, the title block below, at
 * least MIN_WIDTH_PX wide, sized in whole pixels at EXPORT_PX_PER_INCH (the viewBox grows to match,
 * so the scale stays exact).
 */
export function planFrame(bounds: Bounds | null): PlanFrame {
  const b = bounds ?? { minX: 0, minY: 0, maxX: 240, maxY: 240 };
  const k = EXPORT_PX_PER_INCH;
  const plainW = b.maxX - b.minX + 2 * EXPORT_MARGIN;
  const widthPx = Math.ceil(Math.max(plainW * k, MIN_WIDTH_PX));
  const width = widthPx / k;
  const x = b.minX - EXPORT_MARGIN - (width - plainW) / 2;
  const y = b.minY - EXPORT_MARGIN;
  const titleY = b.maxY + EXPORT_MARGIN;
  const heightPx = Math.ceil((titleY - y) * k + TITLE_BLOCK_PX);
  return { x, y, width, height: heightPx / k, widthPx, heightPx, titleY };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** The export's own CSS after the layers': white paper, the font, the title block. */
const EXPORT_CSS = `:root { --canvas: #ffffff; }
svg { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.plan-paper { fill: var(--canvas); }
.title-rule { stroke: #27272a; stroke-width: 1; }
.title-name { font-size: 17px; font-weight: 650; fill: #18181b; }
.title-level { font-size: 13px; fill: #27272a; }
.title-meta { font-size: 12px; fill: #52525b; font-variant-numeric: tabular-nums; }
.scale-bar rect { stroke: #27272a; stroke-width: 1; }
.scale-bar .dark { fill: #27272a; }
.scale-bar .light { fill: #ffffff; }
.scale-bar text { font-size: 10.5px; fill: #3f3f46; }
.north-ring { fill: none; stroke: #a1a1aa; stroke-width: 1; }
.north-head { fill: #27272a; }
.north-label { font-size: 13px; font-weight: 650; fill: #27272a; }`;

/** Local date as YYYY-MM-DD. */
function dateText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The title block, in px from the top-left of the strip under the plan: plan name, level and view,
 * scale and date on the left, a scale bar (0 to 8') in the middle, the north arrow on the right.
 */
function titleBlock(plan: Plan, level: Level, viewMode: ViewMode, frame: PlanFrame, date: Date): string {
  const k = EXPORT_PX_PER_INCH;
  const w = frame.widthPx;
  const left = 24;
  const bar: string[] = [];
  const seg = 24 * k; // 2 ft
  const barX = Math.max(left + 250, w / 2 - 2 * seg);
  for (let i = 0; i < 4; i++) bar.push(`<rect class="${i % 2 ? 'light' : 'dark'}" x="${num(barX + i * seg)}" y="40" width="${num(seg)}" height="6"/>`);
  const ticks = [0, 4, 8].map((ft) => `<text x="${num(barX + ft * 12 * k)}" y="62" text-anchor="middle">${ft}'</text>`).join('');
  const angle = plan.site.northAngle;
  const r = (angle * Math.PI) / 180;
  const nx = w - 48;
  const ny = 46;
  const tip = { x: Math.sin(r) * 34, y: -Math.cos(r) * 34 };
  return [
    `<g class="title-block" transform="translate(${num(frame.x)} ${num(frame.titleY)}) scale(${num(1 / k)})">`,
    `<line class="title-rule" x1="${left}" y1="6" x2="${num(w - left)}" y2="6"/>`,
    `<text class="title-name" x="${left}" y="32">${esc(plan.name)}</text>`,
    `<text class="title-level" x="${left}" y="52">${esc(level.name)}, ${esc(VIEW_MODE_LABEL[viewMode])} view</text>`,
    `<text class="title-meta" x="${left}" y="72">Scale ${esc(SCALE_NOTE)} at ${EXPORT_DPI} dpi · ${dateText(date)}</text>`,
    `<g class="scale-bar">${bar.join('')}${ticks}</g>`,
    `<g class="north-arrow" transform="translate(${num(nx)} ${ny})" data-north-angle="${num(angle)}">`,
    `<circle class="north-ring" r="24"/>`,
    `<g transform="rotate(${num(angle)})"><path class="north-head" d="M0 -20L7 9L0 4L-7 9Z"/></g>`,
    `<text class="north-label" x="${num(tip.x)}" y="${num(tip.y)}" text-anchor="middle" dominant-baseline="central">N</text>`,
    `</g>`,
    `</g>`,
  ].join('');
}

/** The UI state the layers draw an export with: the view mode, the export scale, nothing selected or hovered. */
function exportUiState(levelId: Id, viewMode: ViewMode): UiState {
  return {
    ...useUiStore.getState(),
    activeLevelId: levelId,
    siteMode: false,
    viewMode,
    viewport: { tx: 0, ty: 0, k: EXPORT_PX_PER_INCH },
    selection: EMPTY_SELECTION,
    hover: { nodeId: null, wallId: null, openingId: null },
    draft: emptyDraft(),
    roomEdit: null,
    activeTool: 'wall',
    showUnderlay: false,
    underlaySelected: false,
  };
}

export interface PlanExport {
  svg: string;
  frame: PlanFrame;
}

/** The level's plan as a stand-alone SVG document and its frame. Throws when the level is missing. */
export function planExport(plan: Plan, levelId: Id, viewMode: ViewMode, opts: { date?: Date } = {}): PlanExport {
  const level = plan.levels[levelId];
  if (!level) throw new Error('No level to export.');
  const frame = planFrame(levelDrawingBounds(level, viewMode));
  const stores = snapshotStores(plan, exportUiState(levelId, viewMode));
  const layers = renderToStaticMarkup(createElement(LayerStoresContext.Provider, { value: stores }, createElement(PlanLayers, { levelId })));
  const title = `${plan.name} - ${level.name}`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="plan-export" width="${num(frame.widthPx / EXPORT_DPI)}in" height="${num(frame.heightPx / EXPORT_DPI)}in"`,
    ` viewBox="${num(frame.x)} ${num(frame.y)} ${num(frame.width)} ${num(frame.height)}" data-px-width="${frame.widthPx}" data-px-height="${frame.heightPx}">`,
    `<title>${esc(title)}</title>`,
    `<style><![CDATA[\n${PLAN_STYLES}\n${EXPORT_CSS}\n]]></style>`,
    `<rect class="plan-paper" x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.width)}" height="${num(frame.height)}"/>`,
    `<g class="plan-layers">${layers}</g>`,
    titleBlock(plan, level, viewMode, frame, opts.date ?? new Date()),
    `</svg>\n`,
  ].join('');
  return { svg, frame };
}

/** The level's plan as a stand-alone SVG document (see planExport). */
export function planSvg(plan: Plan, levelId: Id, viewMode: ViewMode, opts: { date?: Date } = {}): string {
  return planExport(plan, levelId, viewMode, opts).svg;
}

/** Pixel size of the PNG of a frame: PNG_SCALE times its size at 96 dpi. */
export const pngSize = (frame: Pick<PlanFrame, 'widthPx' | 'heightPx'>): { width: number; height: number } => ({
  width: frame.widthPx * PNG_SCALE,
  height: frame.heightPx * PNG_SCALE,
});

/** Draw an exported SVG onto a canvas at PNG_SCALE and encode it as PNG (browser only). */
export async function planPng(exp: PlanExport): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([exp.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not draw the plan as an image.'));
      img.src = url;
    });
    const size = pngSize(exp.frame);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not draw the plan as an image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the plan as PNG.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Export the active level's plan and download it as `<plan>-<level>.svg` or `.png`. */
export async function downloadPlanExport(format: 'svg' | 'png', plan: Plan, levelId: Id, viewMode: ViewMode): Promise<void> {
  const level = plan.levels[levelId];
  if (!level) throw new Error('No level to export.');
  if (!levelDrawingBounds(level, viewMode)) throw new Error(`Nothing to export: ${level.name} has no walls, stairs or roofs in the ${VIEW_MODE_LABEL[viewMode]} view.`);
  const exp = planExport(plan, levelId, viewMode);
  const name = planFileName({ name: `${plan.name} ${level.name}` }, format);
  if (format === 'svg') downloadBlob(new Blob([exp.svg], { type: 'image/svg+xml' }), name);
  else downloadBlob(await planPng(exp), name);
}
