import { add, dist, projectPointToSegment, sub } from '../../model/geometry';
import type { Id, Level, Vec2 } from '../../model/types';
import { pauseHistory, resumeHistory } from '../../store/planStore';
import type { Selection } from '../../store/uiStore';
import { SNAP_RADIUS_PX } from '../snap';
import type { Tool, ToolContext } from './index';

const DRAG_THRESHOLD_PX = 3;
/** Minimum half-width of a wall's pick area, in screen px. */
const WALL_PICK_PX = 4;

export type Hit = { kind: 'node'; id: Id } | { kind: 'wall'; id: Id } | null;

/** Nodes within 10px take priority over walls. */
export function hitTest(level: Level, p: Vec2, k: number): Hit {
  let best: Hit = null;
  let bestD = SNAP_RADIUS_PX.node / k;
  for (const n of Object.values(level.nodes)) {
    const d = dist(n, p);
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'node', id: n.id };
    }
  }
  if (best) return best;
  bestD = Infinity;
  for (const w of Object.values(level.walls)) {
    const a = level.nodes[w.a];
    const b = level.nodes[w.b];
    if (!a || !b) continue;
    const pr = projectPointToSegment(p, a, b);
    const reach = Math.max(w.thickness / 2, WALL_PICK_PX / k);
    if (pr.distance <= reach && pr.distance < bestD) {
      bestD = pr.distance;
      best = { kind: 'wall', id: w.id };
    }
  }
  return best;
}

type DragState =
  | {
      kind: 'move';
      startScreen: Vec2;
      grab: Vec2;
      origins: Record<Id, Vec2>;
      /** When dragging one node directly, it snaps like a cursor. */
      single: Id | null;
      started: boolean;
    }
  | { kind: 'box'; a: Vec2; additive: boolean };

let drag: DragState | null = null;

const toggle = (list: Id[], id: Id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function nodesToMove(level: Level, sel: Selection): Record<Id, Vec2> {
  const ids = new Set(sel.nodes);
  for (const wid of sel.walls) {
    const w = level.walls[wid];
    if (w) {
      ids.add(w.a);
      ids.add(w.b);
    }
  }
  const out: Record<Id, Vec2> = {};
  for (const id of ids) {
    const n = level.nodes[id];
    if (n) out[id] = { x: n.x, y: n.y };
  }
  return out;
}

function pruneSelection(ctx: ToolContext): void {
  const level = ctx.level();
  const sel = ctx.ui().selection;
  const nodes = sel.nodes.filter((id) => level.nodes[id]);
  const walls = sel.walls.filter((id) => level.walls[id]);
  if (nodes.length !== sel.nodes.length || walls.length !== sel.walls.length) {
    ctx.ui().setSelection({ nodes, walls });
  }
}

function finishMove(ctx: ToolContext): void {
  if (drag?.kind === 'move' && drag.started) {
    // Still paused: the normalize pass belongs to the same undo step as the drag.
    ctx.actions.normalize(ctx.levelId, Object.keys(drag.origins));
    resumeHistory();
    pruneSelection(ctx);
  }
}

export const selectTool: Tool = {
  onPointerDown(e, ctx) {
    if (e.button !== 0) return;
    const ui = ctx.ui();
    const level = ctx.level();
    const hit = hitTest(level, e.world, ui.viewport.k);
    const sel = ui.selection;

    if (!hit) {
      if (!e.shiftKey) ui.clearSelection();
      drag = { kind: 'box', a: e.world, additive: e.shiftKey };
      return;
    }
    if (e.shiftKey) {
      ui.setSelection(
        hit.kind === 'node'
          ? { ...sel, nodes: toggle(sel.nodes, hit.id) }
          : { ...sel, walls: toggle(sel.walls, hit.id) },
      );
      drag = null;
      return;
    }
    let origins: Record<Id, Vec2>;
    let single: Id | null = null;
    if (hit.kind === 'node') {
      if (!sel.nodes.includes(hit.id)) ui.setSelection({ nodes: [hit.id], walls: [] });
      const n = level.nodes[hit.id];
      origins = { [hit.id]: { x: n.x, y: n.y } };
      single = hit.id;
    } else {
      const next = sel.walls.includes(hit.id) ? sel : { nodes: [], walls: [hit.id] };
      if (next !== sel) ui.setSelection(next);
      origins = nodesToMove(level, next);
    }
    drag = { kind: 'move', startScreen: e.screen, grab: e.world, origins, single, started: false };
  },

  onPointerMove(e, ctx) {
    const ui = ctx.ui();
    if (!drag) {
      const hit = hitTest(ctx.level(), e.world, ui.viewport.k);
      ui.setHover({
        nodeId: hit?.kind === 'node' ? hit.id : null,
        wallId: hit?.kind === 'wall' ? hit.id : null,
      });
      ui.patchDraft({ cursor: e.world, snap: null });
      return;
    }
    if (drag.kind === 'box') {
      ui.patchDraft({ cursor: e.world, box: { a: drag.a, b: e.world } });
      return;
    }
    if (!drag.started && dist(e.screen, drag.startScreen) < DRAG_THRESHOLD_PX) return;

    const positions: Record<Id, Vec2> = {};
    if (drag.single) {
      const origin = drag.origins[drag.single];
      const snap = ctx.snap(add(origin, sub(e.world, drag.grab)), {
        shift: e.shiftKey,
        excludeNodeIds: new Set([drag.single]),
      });
      positions[drag.single] = snap.point;
      ui.patchDraft({ cursor: e.world, snap });
    } else {
      const grid = ctx.plan().settings.snapGrid;
      const round = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
      const delta = sub(e.world, drag.grab);
      const step = { x: round(delta.x), y: round(delta.y) };
      for (const [id, o] of Object.entries(drag.origins)) positions[id] = add(o, step);
      ui.patchDraft({ cursor: e.world, snap: null });
    }
    ctx.actions.moveNodes(ctx.levelId, positions, { normalize: false });
    if (!drag.started) {
      // First set of the drag is tracked; the rest are folded into it.
      drag.started = true;
      pauseHistory();
    }
  },

  onPointerUp(e, ctx) {
    const ui = ctx.ui();
    if (drag?.kind === 'move') finishMove(ctx);
    else if (drag?.kind === 'box') {
      const a = drag.a;
      const b = e.world;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const inside = (p: Vec2) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      const level = ctx.level();
      const walls = Object.values(level.walls)
        .filter((w) => inside(level.nodes[w.a]) && inside(level.nodes[w.b]))
        .map((w) => w.id);
      const sel = ui.selection;
      if (Math.max(maxX - minX, maxY - minY) * ui.viewport.k > DRAG_THRESHOLD_PX) {
        ui.setSelection(
          drag.additive
            ? { nodes: sel.nodes, walls: [...new Set([...sel.walls, ...walls])] }
            : { nodes: [], walls },
        );
      }
      ui.patchDraft({ box: null });
    }
    drag = null;
  },

  onDoubleClick() {},

  onKeyDown(e, ctx) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const ui = ctx.ui();
    const sel = ui.selection;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel.nodes.length && !sel.walls.length) return false;
      ctx.actions.deleteEntities(ctx.levelId, sel);
      ui.clearSelection();
      ui.setHover({ nodeId: null, wallId: null });
      return true;
    }
    if (e.key === 'Escape') {
      if (drag) {
        selectTool.cancel(ctx);
        return true;
      }
      if (!sel.nodes.length && !sel.walls.length) return false;
      ui.clearSelection();
      return true;
    }
    return false;
  },

  cancel(ctx) {
    finishMove(ctx);
    drag = null;
    ctx.ui().patchDraft({ box: null, snap: null });
  },
};
