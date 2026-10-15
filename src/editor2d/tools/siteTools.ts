import { getFootprints } from '../../derive/footprint';
import { columnDefaults, defaultGradeElevation, distanceToFence, FENCE_DEFAULTS, fenceLength, pointInColumn, pointInSurface, siteGhostLevelId, surfaceArea } from '../../derive/site';
import { isVisible } from '../../derive/phase';
import { add, dist, sub } from '../../model/geometry';
import { SURFACE_MATERIALS } from '../../model/finish';
import type { Column, Id, Site, SurfaceMaterial, Vec2, ViewMode } from '../../model/types';
import { formatArea, formatLength, formatLengthCompact, tryParseLength } from '../../model/units';
import { pauseHistory, resumeHistory } from '../../store/planStore';
import { EMPTY_SELECTION, selectionSize, type Selection, type SnapResult } from '../../store/uiStore';
import { faceSnapSources, snapFaceCorner, snapFaceEdge, snapPoint } from '../snap';
import type { Tool, ToolContext, ToolPointerEvent } from './index';
import { applyBufferKey } from './lengthBuffer';
import { makeOutlineTool } from './outlineTool';

// The site tools (DESIGN.md "Site and terrain"): grade point (E), column (C), ground surface (A),
// fence (Q), and the select tool as it works in site mode. All of them work on plan.site, over the
// ghost of the first floor.

const DRAG_THRESHOLD_PX = 3;
/** Pick radius of a grade point's triangle, in screen px. */
export const GRADE_PICK_PX = 10;
/** A column is picked within this many screen px of its rectangle. */
export const COLUMN_PICK_PX = 4;
/** A fence is picked within this many screen px of its line. */
export const FENCE_PICK_PX = 5;

export type SiteHit = { kind: 'gradePoint'; id: Id } | { kind: 'column'; id: Id } | { kind: 'fence'; id: Id } | { kind: 'surface'; id: Id } | null;

/** The selection list of each kind of site hit. */
export const SITE_SELECTION_KEY = { gradePoint: 'gradePoints', column: 'columns', fence: 'fences', surface: 'surfaces' } as const;

/**
 * Grade points first (within GRADE_PICK_PX of the marker), then columns (inside the rectangle
 * grown by COLUMN_PICK_PX; the most recently added on top), then fences (within FENCE_PICK_PX of
 * the line; the nearest), then ground surfaces (p inside the outline; the smallest on top, so a pad
 * on a drive can be picked). Elements hidden in `viewMode` are never hit; grade points belong to no
 * phase.
 */
export function hitSite(site: Site, p: Vec2, k: number, viewMode: ViewMode = 'all'): SiteHit {
  let best: SiteHit = null;
  let bestD = GRADE_PICK_PX / k;
  for (const g of Object.values(site.gradePoints)) {
    const d = dist(g.at, p);
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'gradePoint', id: g.id };
    }
  }
  if (best) return best;
  const cols = Object.values(site.columns).reverse();
  const c = cols.find((col) => isVisible(col.phase, viewMode) && pointInColumn(col, p, COLUMN_PICK_PX / k));
  if (c) return { kind: 'column', id: c.id };
  let fenceD = FENCE_PICK_PX / k;
  for (const f of Object.values(site.fences)) {
    if (!isVisible(f.phase, viewMode)) continue;
    const d = distanceToFence(f, p);
    if (d <= fenceD) {
      fenceD = d;
      best = { kind: 'fence', id: f.id };
    }
  }
  if (best) return best;
  let smallest = Infinity;
  for (const sf of Object.values(site.surfaces)) {
    if (!isVisible(sf.phase, viewMode) || !pointInSurface(sf, p)) continue;
    const area = surfaceArea(sf);
    if (area < smallest) {
      smallest = area;
      best = { kind: 'surface', id: sf.id };
    }
  }
  return best;
}

/**
 * Snap for the site tools: corners and faces of the first floor's walls (the ghost under the site
 * layer), then that level's nodes, midpoints and wall lines, then alignment guides and the grid.
 * No ortho lock: there is nothing being drawn from.
 */
export function siteSnap(ctx: ToolContext, raw: Vec2): SnapResult {
  const plan = ctx.plan();
  const ui = ctx.ui();
  const level = plan.levels[siteGhostLevelId(plan) ?? ctx.levelId] ?? ctx.level();
  const k = ui.viewport.k;
  const src = faceSnapSources(getFootprints(level, ui.viewMode), level.walls);
  const corner = snapFaceCorner(raw, src, k);
  if (corner) return corner;
  const std = snapPoint(raw, { level, k, snapGrid: plan.settings.snapGrid, orthoLock: false, shift: false, viewMode: ui.viewMode });
  if (std.kind === 'node') return { ...std, nodeId: undefined, wallId: undefined };
  return snapFaceEdge(raw, src, k) ?? { ...std, nodeId: undefined, wallId: undefined };
}

// ---------------------------------------------------------------------------------------------
// Grade point tool

function elevationText(ctx: ToolContext, elevation: number): string {
  return formatLength(elevation, ctx.plan().settings.precisionDenominator);
}

function placeGradePoint(ctx: ToolContext): void {
  const ui = ctx.ui();
  const d = ui.draft;
  const at = d.gradePending;
  if (!at) return;
  let elevation = defaultGradeElevation(ctx.plan());
  if (d.lengthBuffer.trim() !== '') {
    const typed = tryParseLength(d.lengthBuffer);
    if (typed === null) {
      ui.patchDraft({ error: true, message: `Can't read "${d.lengthBuffer}" as an elevation.` });
      return;
    }
    elevation = typed;
  }
  const id = ctx.actions.addGradePoint({ at, elevation });
  if (!id) {
    ui.patchDraft({ error: true, message: 'Could not place a grade point here.' });
    return;
  }
  ui.setSelection({ ...EMPTY_SELECTION, gradePoints: [id] });
  ui.patchDraft({ gradePending: null, lengthBuffer: '', error: false, message: `Grade point at ${elevationText(ctx, elevation)}.` });
}

/**
 * Grade point tool (E in site mode): click the spot, then type its elevation in feet and inches
 * (a minus sign is allowed; below the first floor is negative) and press Enter. With nothing typed
 * Enter uses the first floor's floor top. Esc clears the typed elevation, then the spot.
 */
export const gradePointTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const snap = siteSnap(ctx, e.world);
    ui.patchDraft({ cursor: e.world, snap, gradePending: snap.point, lengthBuffer: '', error: false, message: null });
  },

  onPointerMove(e, ctx) {
    const ui = ctx.ui();
    // While an elevation is being typed the marker stays on the clicked spot.
    ui.patchDraft({ cursor: e.world, snap: ui.draft.gradePending ? null : siteSnap(ctx, e.world) });
  },

  onPointerUp() {},
  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const d = ui.draft;
    if (e.key === 'Escape') {
      if (d.lengthBuffer) ui.patchDraft({ lengthBuffer: '', error: false, message: null });
      else if (d.gradePending) ui.patchDraft({ gradePending: null, error: false, message: null });
      else return false;
      return true;
    }
    if (!d.gradePending) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection.gradePoints.length) {
        ctx.actions.deleteGradePoints(ui.selection.gradePoints);
        ui.clearSelection();
        return true;
      }
      return false;
    }
    if (e.key === 'Enter') {
      placeGradePoint(ctx);
      return true;
    }
    const next = applyBufferKey(d.lengthBuffer, e.key);
    if (next !== null) {
      ui.patchDraft({ lengthBuffer: next, error: false, message: null });
      return true;
    }
    return e.key === 'Backspace';
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ gradePending: null, lengthBuffer: '', snap: null, error: false });
  },
};

// ---------------------------------------------------------------------------------------------
// Column tool

/** The column kinds the tool's Tab steps through, in order. */
const COLUMN_KINDS: Column['kind'][] = ['chimney', 'post', 'flue', 'pier'];
export const COLUMN_KIND_NAME: Record<Column['kind'], string> = { chimney: 'Chimney', post: 'Post', flue: 'Flue', pier: 'Pier' };
/** The kind Tab switches to after `kind`. */
export const nextColumnKind = (kind: Column['kind']): Column['kind'] => COLUMN_KINDS[(COLUMN_KINDS.indexOf(kind) + 1) % COLUMN_KINDS.length];

function columnPreview(ctx: ToolContext, at: Vec2, kind: Column['kind']) {
  const ui = ctx.ui();
  const def = columnDefaults(ctx.plan(), kind, at, ui.drawPhase);
  ui.patchDraft({ columnKind: kind, columnPreview: { at, kind, width: def.width, depth: def.depth } });
}

/**
 * Column tool (C in site mode): the column follows the snapped cursor; click places it with the
 * defaults of its kind in the toolbar's "Draw as" phase, Tab steps chimney, post, flue, pier before the
 * click. Size, heights and rotation are then edited in the properties panel.
 */
export const columnTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const snap = siteSnap(ctx, e.world);
    const kind = ui.draft.columnKind;
    const def = columnDefaults(ctx.plan(), kind, snap.point, ui.drawPhase);
    const id = ctx.actions.addColumn({ at: snap.point, kind, phase: ui.drawPhase, ...def });
    if (!id) {
      ui.patchDraft({ error: true, message: 'Could not place a column here.' });
      return;
    }
    ui.setSelection({ ...EMPTY_SELECTION, columns: [id] });
    ui.patchDraft({ cursor: e.world, snap, error: false, message: `${COLUMN_KIND_NAME[kind]} placed. Set its size and heights in the properties panel.` });
    columnPreview(ctx, snap.point, kind);
  },

  onPointerMove(e, ctx) {
    const snap = siteSnap(ctx, e.world);
    ctx.ui().patchDraft({ cursor: e.world, snap });
    columnPreview(ctx, snap.point, ctx.ui().draft.columnKind);
  },

  onPointerUp() {},
  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    if (e.key === 'Tab') {
      const kind = nextColumnKind(ui.draft.columnKind);
      const at = ui.draft.columnPreview?.at ?? ui.draft.snap?.point ?? ui.draft.cursor ?? { x: 0, y: 0 };
      ui.patchDraft({ message: `Next: ${COLUMN_KIND_NAME[kind].toLowerCase()}. Click to place it.`, error: false });
      columnPreview(ctx, at, kind);
      return true;
    }
    if (e.key === 'Escape' && ui.draft.message) {
      ui.patchDraft({ error: false, message: null });
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection.columns.length) {
      ctx.actions.deleteColumns(ui.selection.columns);
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    ctx.ui().patchDraft({ columnPreview: null, snap: null });
  },
};

// ---------------------------------------------------------------------------------------------
// Ground surface and fence tools

export const SURFACE_MATERIAL_NAME: Record<SurfaceMaterial, string> = { gravel: 'Gravel', asphalt: 'Asphalt', concrete: 'Concrete', stone: 'Stone' };
/** The material Tab switches to after `m`. */
export const nextSurfaceMaterial = (m: SurfaceMaterial): SurfaceMaterial => SURFACE_MATERIALS[(SURFACE_MATERIALS.indexOf(m) + 1) % SURFACE_MATERIALS.length];

/**
 * Surface tool (A in site mode): click the corners of a gravel drive, an asphalt road, a concrete
 * pad or flagstones (they snap like the other site tools, siteSnap), close it on the first corner,
 * with a double-click or Enter (makeOutlineTool). Tab steps gravel, asphalt, concrete, stone; the
 * surface takes the toolbar's "Draw as" phase and lies on the ground in 3D.
 */
export const surfaceTool = makeOutlineTool({
  noun: 'surface',
  selectionKey: 'surfaces',
  snap: (ctx, raw) => siteSnap(ctx, raw),
  create: (ctx, outline) => {
    const ui = ctx.ui();
    return ctx.actions.addSurface({ outline, material: ui.draft.surfaceMaterial, phase: ui.drawPhase });
  },
  added: (ctx, outline) => `${SURFACE_MATERIAL_NAME[ctx.ui().draft.surfaceMaterial]} surface added, ${formatArea(surfaceArea({ outline }))}. Tab changes the next one's material.`,
  remove: (ctx, ids) => ctx.actions.deleteSurfaces(ids),
  onKey: (e, ctx) => {
    if (e.key !== 'Tab') return false;
    const ui = ctx.ui();
    const material = nextSurfaceMaterial(ui.draft.surfaceMaterial);
    ui.patchDraft({ surfaceMaterial: material, error: false, message: `Drawing ${SURFACE_MATERIAL_NAME[material].toLowerCase()} (Tab: ${SURFACE_MATERIAL_NAME[nextSurfaceMaterial(material)].toLowerCase()}).` });
    return true;
  },
});

/**
 * Fence tool (Q in site mode): click the fence's points (siteSnap), finish with a double-click or
 * Enter; Backspace removes the last point, Esc cancels (makeOutlineTool, open). A split-rail fence
 * with the defaults (FENCE_DEFAULTS: 42" high, 2 rails, posts at most 10' apart) in the "Draw as"
 * phase; the panel edits them.
 */
export const fenceTool = makeOutlineTool({
  noun: 'fence',
  selectionKey: 'fences',
  open: true,
  snap: (ctx, raw) => siteSnap(ctx, raw),
  create: (ctx, points) => {
    const { height, rails, postSpacing } = FENCE_DEFAULTS;
    return ctx.actions.addFence({ points, height, rails, postSpacing, phase: ctx.ui().drawPhase });
  },
  added: (ctx, points) => `Fence added, ${formatLengthCompact(fenceLength({ points }), ctx.plan().settings.precisionDenominator)} long. Set its height, rails and post spacing in the properties panel.`,
  remove: (ctx, ids) => ctx.actions.deleteFences(ids),
});

// ---------------------------------------------------------------------------------------------
// Select tool in site mode

type SiteDrag =
  | {
      kind: 'move';
      startScreen: Vec2;
      grab: Vec2;
      points: Record<Id, Vec2>;
      columns: Record<Id, Vec2>;
      surfaces: Record<Id, Vec2[]>;
      fences: Record<Id, Vec2[]>;
      started: boolean;
    }
  | { kind: 'box'; a: Vec2; additive: boolean };

let drag: SiteDrag | null = null;

const toggle = (list: Id[], id: Id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function finishDrag(): void {
  if (drag?.kind === 'move' && drag.started) resumeHistory();
}

/** Select, move and delete grade points, columns, fences and surfaces. The wall, opening, room, stairs and roof picking is off. */
export const siteSelectTool: Tool = {
  onPointerDown(e: ToolPointerEvent, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const site = ctx.plan().site;
    const sel = ui.selection;
    const hit = hitSite(site, e.world, ui.viewport.k, ui.viewMode);
    if (!hit) {
      if (!e.shiftKey) ui.clearSelection();
      drag = { kind: 'box', a: e.world, additive: e.shiftKey };
      return;
    }
    const key = SITE_SELECTION_KEY[hit.kind];
    if (e.shiftKey) {
      ui.setSelection({ ...sel, [key]: toggle(sel[key], hit.id) });
      drag = null;
      return;
    }
    const next: Selection = sel[key].includes(hit.id) ? sel : { ...EMPTY_SELECTION, [key]: [hit.id] };
    if (next !== sel) ui.setSelection(next);
    const points: Record<Id, Vec2> = {};
    const columns: Record<Id, Vec2> = {};
    for (const id of next.gradePoints) if (site.gradePoints[id]) points[id] = { ...site.gradePoints[id].at };
    for (const id of next.columns) if (site.columns[id]) columns[id] = { ...site.columns[id].at };
    const surfaces: Record<Id, Vec2[]> = {};
    const fences: Record<Id, Vec2[]> = {};
    for (const id of next.surfaces) if (site.surfaces[id]) surfaces[id] = site.surfaces[id].outline.map((p) => ({ ...p }));
    for (const id of next.fences) if (site.fences[id]) fences[id] = site.fences[id].points.map((p) => ({ ...p }));
    drag = { kind: 'move', startScreen: e.screen, grab: e.world, points, columns, surfaces, fences, started: false };
  },

  onPointerMove(e, ctx) {
    const ui = ctx.ui();
    if (!drag) {
      ui.patchDraft({ cursor: e.world, snap: null });
      return;
    }
    if (drag.kind === 'box') {
      ui.patchDraft({ cursor: e.world, box: { a: drag.a, b: e.world } });
      return;
    }
    if (!drag.started && dist(e.screen, drag.startScreen) < DRAG_THRESHOLD_PX) return;
    const grid = ctx.plan().settings.snapGrid;
    const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
    const d = sub(e.world, drag.grab);
    const step = { x: round(d.x), y: round(d.y) };
    const moved = (o: Record<Id, Vec2>) => Object.fromEntries(Object.entries(o).map(([id, p]) => [id, add(p, step)]));
    const movedAll = (o: Record<Id, Vec2[]>) => Object.fromEntries(Object.entries(o).map(([id, ps]) => [id, ps.map((p) => add(p, step))]));
    ui.patchDraft({ cursor: e.world, snap: null });
    const before = ctx.plan();
    ctx.actions.moveSiteItems(moved(drag.points), moved(drag.columns), { surfaces: movedAll(drag.surfaces), fences: movedAll(drag.fences) });
    if (!drag.started && ctx.plan() !== before) {
      // The first set that changes the plan is tracked; the rest fold into it (one undo step).
      drag.started = true;
      pauseHistory();
    }
  },

  onPointerUp(e, ctx) {
    const ui = ctx.ui();
    if (drag?.kind === 'box') {
      const { a } = drag;
      const b = e.world;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (Math.max(maxX - minX, maxY - minY) * ui.viewport.k > DRAG_THRESHOLD_PX) {
        const inside = (p: Vec2) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        const site = ctx.plan().site;
        const gradePoints = Object.values(site.gradePoints).filter((g) => inside(g.at)).map((g) => g.id);
        const columns = Object.values(site.columns).filter((c) => isVisible(c.phase, ui.viewMode) && inside(c.at)).map((c) => c.id);
        // A surface or fence is taken in when all its points are in the box.
        const surfaces = Object.values(site.surfaces).filter((sf) => isVisible(sf.phase, ui.viewMode) && sf.outline.every(inside)).map((sf) => sf.id);
        const fences = Object.values(site.fences).filter((f) => isVisible(f.phase, ui.viewMode) && f.points.every(inside)).map((f) => f.id);
        const sel = ui.selection;
        const union = (a: Id[], b: Id[]) => [...new Set([...a, ...b])];
        ui.setSelection(
          drag.additive
            ? { ...sel, gradePoints: union(sel.gradePoints, gradePoints), columns: union(sel.columns, columns), surfaces: union(sel.surfaces, surfaces), fences: union(sel.fences, fences) }
            : { ...EMPTY_SELECTION, gradePoints, columns, surfaces, fences },
        );
      }
      ui.patchDraft({ box: null });
    } else finishDrag();
    drag = null;
  },

  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const sel = ui.selection;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selectionSize(sel)) return false;
      ctx.actions.deleteEntities(ctx.levelId, { nodes: [], walls: [], gradePoints: sel.gradePoints, columns: sel.columns, surfaces: sel.surfaces, fences: sel.fences });
      ui.clearSelection();
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        siteSelectTool.cancel(ctx);
        return true;
      }
      if (!selectionSize(sel)) return false;
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    finishDrag();
    drag = null;
    ctx.ui().patchDraft({ box: null, snap: null });
  },
};
