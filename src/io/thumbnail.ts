// The small picture of a property in the Properties dialog (DESIGN.md "Persistence and export"):
// the walls of each building's ground floor at their site place, as the Proposed view of the
// active option shows them, drawn as lines on a small offscreen canvas. Made from the model, not
// from the screen, so it is cheap and the same whatever the editor shows.
import { isVisible } from '../derive/phase';
import { viewPlanOf } from '../derive/optionView';
import { groundLevelId } from '../model/plan';
import { structuresOf, toSite } from '../model/structures';
import type { Id, Plan, Vec2 } from '../model/types';

export const THUMB_WIDTH = 96;
export const THUMB_HEIGHT = 64;
const MARGIN = 5;

/** One wall as a line in thumbnail pixels: its ends and its drawn width. */
export interface ThumbLine {
  a: Vec2;
  b: Vec2;
  width: number;
}

/**
 * The lines of a plan's thumbnail, fitted (aspect kept, centred) into width x height pixels less a
 * margin; [] when no building has a wall.
 */
export function thumbnailLines(plan: Plan, optionId?: Id | null, width = THUMB_WIDTH, height = THUMB_HEIGHT): ThumbLine[] {
  const view = viewPlanOf(plan, optionId);
  const segs: { a: Vec2; b: Vec2; t: number }[] = [];
  for (const s of structuresOf(view)) {
    const id = groundLevelId(s);
    const level = id ? view.levels[id] : undefined;
    if (!level) continue;
    for (const w of Object.values(level.walls)) {
      if (!isVisible(w.phase, 'proposed')) continue;
      const na = level.nodes[w.a];
      const nb = level.nodes[w.b];
      if (!na || !nb) continue;
      segs.push({ a: toSite(s, na), b: toSite(s, nb), t: w.thickness });
    }
  }
  if (segs.length === 0) return [];
  const xs = segs.flatMap((g) => [g.a.x, g.b.x]);
  const ys = segs.flatMap((g) => [g.a.y, g.b.y]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 1);
  const spanY = Math.max(Math.max(...ys) - minY, 1);
  const k = Math.min((width - 2 * MARGIN) / spanX, (height - 2 * MARGIN) / spanY);
  const ox = (width - spanX * k) / 2;
  const oy = (height - spanY * k) / 2;
  const px = (p: Vec2): Vec2 => ({ x: ox + (p.x - minX) * k, y: oy + (p.y - minY) * k });
  return segs.map((g) => ({ a: px(g.a), b: px(g.b), width: Math.max(1, Math.min(3, g.t * k)) }));
}

/** A detached <canvas> to draw on (never put in the page); null outside a browser. */
function makeCanvas(width: number, height: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; toUrl: () => Promise<string> } | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    return ctx ? { ctx, toUrl: async () => c.toDataURL('image/png') } : null;
  }
  return null;
}

const made = new WeakMap<Plan, Map<string, string | null>>();

/**
 * The thumbnail of a plan as a PNG data URL (about 1 to 3 KB), or null when it has no walls or
 * there is no canvas. Memoized per plan object and option.
 */
export async function makeThumbnail(plan: Plan, optionId?: Id | null): Promise<string | null> {
  const key = optionId ?? '';
  const cached = made.get(plan)?.get(key);
  if (cached !== undefined) return cached;
  const lines = thumbnailLines(plan, optionId);
  let url: string | null = null;
  if (lines.length > 0) {
    const canvas = makeCanvas(THUMB_WIDTH, THUMB_HEIGHT);
    if (canvas) {
      const { ctx } = canvas;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      ctx.strokeStyle = '#3f3f46';
      ctx.lineCap = 'square';
      for (const l of lines) {
        ctx.lineWidth = l.width;
        ctx.beginPath();
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
        ctx.stroke();
      }
      url = await canvas.toUrl();
    }
  }
  let m = made.get(plan);
  if (!m) made.set(plan, (m = new Map()));
  m.set(key, url);
  return url;
}
