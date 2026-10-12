import { DEFAULT_LITES, DEFAULT_TRIM, MAX_SASHES } from '../model/finish';
import type { Opening } from '../model/types';

// Window and door fills (DESIGN.md "Exterior appearance"). Pure: an opening becomes a list of axis
// aligned boxes in the wall's own frame; meshes.ts turns them into prisms and merges them per
// material part. Frame: `s` along the wall's centerline (like Opening.offset), `d` the distance
// from the wall's mid plane toward the outside (negative = toward the inside), `y` above the
// floor top. Inches throughout.

/** The material groups a fill is merged into (export: trim, sash, glass, screen, door_leaf, shutter). */
export type FillPart = 'trim' | 'sash' | 'glass' | 'screen' | 'leaf' | 'shutter';

export type FillKind =
  | 'trim'
  | 'sill'
  | 'sashFrame'
  | 'mullion'
  | 'muntin'
  | 'glass'
  | 'screen'
  | 'doorFrame'
  | 'leaf'
  | 'midRail'
  | 'panel'
  | 'shutter'
  | 'batten';

export interface FillBox {
  part: FillPart;
  kind: FillKind;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  y0: number;
  y1: number;
}

export const SASH_FRAME = 1.5;
export const SASH_DEPTH = 1.75;
export const MUNTIN = 0.75;
export const MUNTIN_DEPTH = 1;
export const GLASS_THICKNESS = 0.25;
export const SILL_THICKNESS = 1.5;
export const SILL_PROJECTION = 1;
export const TRIM_PROJECTION = 1;
export const DOOR_LEAF = 1.75;
export const DOOR_PANEL_DEPTH = 0.75;
export const SHUTTER_THICKNESS = 1;
/** The post between two sashes of a window. */
export const MULLION = 2;
/** With a fixed centre pane, the two side sashes are at most this wide. */
export const FIXED_SIDE_SASH = 24;
/** A screened sash's frame boards, and the screen itself. */
export const SCREEN_FRAME = 1;
export const SCREEN_THICKNESS = 0.125;
/** A screen door: stiles and rails, and a mid rail centred this high above the bottom of the leaf. */
export const SCREEN_DOOR_FRAME = 1.5;
export const MID_RAIL = 4;
export const MID_RAIL_HEIGHT = 36;
/** A half-lite door: the share of the panel area that is glazed, and the stile between the two panels below. */
export const HALF_LITE = 0.55;
export const CENTER_STILE = 5;
/** Shutter boards are one sash wide, within these limits, with two battens across each. */
export const SHUTTER_MIN = 10;
export const SHUTTER_MAX = 18;
export const BATTEN = 3;
export const BATTEN_PROUD = 0.75;

export interface FillInput {
  type: Opening['type'];
  /** Jambs along the centerline, after clamping to the wall. */
  j0: number;
  j1: number;
  /** Hole bottom and top above the floor top. */
  bottom: number;
  top: number;
  /** Wall thickness. */
  thickness: number;
  lites?: Opening['lites'];
  trim?: number;
  shutters?: boolean;
  sashes?: number;
  fixedCenter?: boolean;
  glazing?: Opening['glazing'];
  halfLite?: boolean;
}

/** Number of (vertical, horizontal) muntins for a lite grid. */
export const muntinCounts = (lites: { cols: number; rows: number }): { vertical: number; horizontal: number } => ({
  vertical: Math.max(0, Math.floor(lites.cols) - 1),
  horizontal: Math.max(0, Math.floor(lites.rows) - 1),
});

/** The lite grid the fill uses: the opening's own, else 2 x 3 for a window and 1 x 1 for a door. */
export const fillLites = (type: Opening['type'], lites?: Opening['lites']): { cols: number; rows: number } =>
  lites ?? (type === 'door' ? DEFAULT_LITES.door : DEFAULT_LITES.window);

/** A whole number of sashes from 1 to MAX_SASHES; anything unusable is one sash. */
export const sashCount = (sashes: number | undefined): number =>
  sashes !== undefined && Number.isFinite(sashes) ? Math.min(MAX_SASHES, Math.max(1, Math.floor(sashes))) : 1;

/**
 * Where a window's sashes sit across the hole j0..j1: one [s0, s1] per sash, left to right, with a
 * MULLION between neighbours (narrower in a very narrow window, so every sash keeps some width).
 * With `fixedCenter` and 3 sashes the side sashes are min(24, (w - 4) / 4) wide and the centre one
 * takes the rest (24 / 92 / 24 for a 144" window); otherwise the sashes share the width equally.
 */
export function sashSpans(j0: number, j1: number, sashes?: number, fixedCenter = false): [number, number][] {
  const n = sashCount(sashes);
  if (n === 1) return [[j0, j1]];
  const w = j1 - j0;
  const m = Math.min(MULLION, w / (3 * n));
  if (fixedCenter && n === 3) {
    const side = Math.min(FIXED_SIDE_SASH, (w - 2 * m) / 4);
    return [
      [j0, j0 + side],
      [j0 + side + m, j1 - side - m],
      [j1 - side, j1],
    ];
  }
  const sw = (w - (n - 1) * m) / n;
  return Array.from({ length: n }, (_, i): [number, number] => [j0 + i * (sw + m), i === n - 1 ? j1 : j0 + i * (sw + m) + sw]);
}

/** Width of each shutter board: one sash of the window, clamped to 10" to 18". */
export const shutterWidth = (w: number, sashes?: number): number => Math.min(SHUTTER_MAX, Math.max(SHUTTER_MIN, w / sashCount(sashes)));

/** The boxes of a window or door fill; passages (and degenerate holes) have none. */
export function openingFill(input: FillInput): FillBox[] {
  const { type, j0, j1, bottom, top, thickness } = input;
  if (type === 'passage') return [];
  const w = j1 - j0;
  const h = top - bottom;
  if (!(w > 1e-6) || !(h > 1e-6)) return [];
  const half = thickness / 2;
  const trim = Math.max(0, input.trim ?? DEFAULT_TRIM);
  const screened = input.glazing === 'screen';
  const boxes: FillBox[] = [];
  const add = (part: FillPart, kind: FillKind, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number) => {
    if (s1 - s0 > 1e-9 && d1 - d0 > 1e-9 && y1 - y0 > 1e-9) boxes.push({ part, kind, s0, s1, d0, d1, y0, y1 });
  };

  // Trim on the outside face: head across the top, a board down each jamb. A window's sill is a
  // separate board below.
  const t0 = half;
  const t1 = half + TRIM_PROJECTION;
  add('trim', 'trim', j0 - trim, j1 + trim, t0, t1, top, top + trim);
  add('trim', 'trim', j0 - trim, j0, t0, t1, bottom, top);
  add('trim', 'trim', j1, j1 + trim, t0, t1, bottom, top);

  const depth = Math.min(SASH_DEPTH, thickness);
  const sd = depth / 2;

  /**
   * Glass at mid-wall and the muntins of a lite grid across it: white like the sash in a window,
   * the leaf's own colour in a door.
   */
  const glaze = (g0: number, g1: number, gy0: number, gy1: number, lites: { cols: number; rows: number }) => {
    if (!(g1 - g0 > 1e-6) || !(gy1 - gy0 > 1e-6)) return;
    add('glass', 'glass', g0, g1, -GLASS_THICKNESS / 2, GLASS_THICKNESS / 2, gy0, gy1);
    const { vertical, horizontal } = muntinCounts(lites);
    const md = Math.min(MUNTIN_DEPTH, thickness) / 2;
    const part: FillPart = type === 'door' ? 'leaf' : 'sash';
    // A muntin is never wider than half a lite (a tiny sash keeps its muntins inside it).
    const mv = Math.min(MUNTIN, (g1 - g0) / (2 * (vertical + 1)));
    const mh = Math.min(MUNTIN, (gy1 - gy0) / (2 * (horizontal + 1)));
    for (let i = 1; i <= vertical; i++) {
      const c = g0 + ((g1 - g0) * i) / (vertical + 1);
      add(part, 'muntin', c - mv / 2, c + mv / 2, -md, md, gy0, gy1);
    }
    for (let i = 1; i <= horizontal; i++) {
      const c = gy0 + ((gy1 - gy0) * i) / (horizontal + 1);
      add(part, 'muntin', g0, g1, -md, md, c - mh / 2, c + mh / 2);
    }
  };
  /** An insect screen at mid-wall: one pane, no muntins. */
  const screen = (g0: number, g1: number, gy0: number, gy1: number) =>
    add('screen', 'screen', g0, g1, -SCREEN_THICKNESS / 2, SCREEN_THICKNESS / 2, gy0, gy1);

  if (type === 'window') {
    // Sill: 1.5" thick, projecting 1" beyond the trim.
    add('trim', 'sill', j0 - trim, j1 + trim, t0, t1 + SILL_PROJECTION, bottom - SILL_THICKNESS, bottom);
    // Sashes side by side with mullions between them; each has its own frame of four boards round
    // its own pane (a lite grid of glass, a single fixed pane in the middle of a fixed-centre
    // window, or a screen).
    const spans = sashSpans(j0, j1, input.sashes, input.fixedCenter);
    const grid = fillLites('window', input.lites);
    spans.forEach(([a, b], i) => {
      if (i > 0) add('sash', 'mullion', spans[i - 1][1], a, -sd, sd, bottom, top);
      const fr = Math.min(screened ? SCREEN_FRAME : SASH_FRAME, (b - a) / 4, h / 4);
      add('sash', 'sashFrame', a, a + fr, -sd, sd, bottom, top);
      add('sash', 'sashFrame', b - fr, b, -sd, sd, bottom, top);
      add('sash', 'sashFrame', a + fr, b - fr, -sd, sd, top - fr, top);
      add('sash', 'sashFrame', a + fr, b - fr, -sd, sd, bottom, bottom + fr);
      if (screened) screen(a + fr, b - fr, bottom + fr, top - fr);
      else glaze(a + fr, b - fr, bottom + fr, top - fr, input.fixedCenter && spans.length === 3 && i === 1 ? { cols: 1, rows: 1 } : grid);
    });
    if (input.shutters) {
      // A board each side flanking the trim, one sash wide, with two battens across it at a
      // quarter and three quarters of its height.
      const sw = shutterWidth(w, input.sashes);
      const front = t0 + SHUTTER_THICKNESS;
      const bh = Math.min(BATTEN, h / 6);
      const inset = Math.min(1, sw / 10);
      for (const [a, b] of [
        [j0 - trim - sw, j0 - trim],
        [j1 + trim, j1 + trim + sw],
      ]) {
        add('shutter', 'shutter', a, b, t0, front, bottom, top);
        for (const f of [0.25, 0.75]) {
          const c = bottom + h * f;
          add('shutter', 'batten', a + inset, b - inset, front, front + BATTEN_PROUD, c - bh / 2, c + bh / 2);
        }
      }
    }
    return boxes;
  }

  // Door: one frame (boards at the jambs and head) round one leaf, or two meeting at the centre.
  const fr = Math.min(SASH_FRAME, w / 4, h / 4);
  add('sash', 'doorFrame', j0, j0 + fr, -sd, sd, bottom, top);
  add('sash', 'doorFrame', j1 - fr, j1, -sd, sd, bottom, top);
  add('sash', 'doorFrame', j0 + fr, j1 - fr, -sd, sd, top - fr, top);
  const ly0 = bottom;
  const ly1 = top - fr;
  const lh = ly1 - ly0;
  const ld = Math.min(DOOR_LEAF, thickness) / 2;
  const pd = Math.min(DOOR_PANEL_DEPTH, thickness) / 2;
  const lites = fillLites('door', input.lites);
  const leaf = (l0: number, l1: number) => {
    if (screened) {
      // A screen door: a light frame, a mid rail at push height, screen above and below it.
      const f = Math.min(SCREEN_DOOR_FRAME, (l1 - l0) / 4, lh / 8);
      add('leaf', 'leaf', l0, l0 + f, -ld, ld, ly0, ly1);
      add('leaf', 'leaf', l1 - f, l1, -ld, ld, ly0, ly1);
      add('leaf', 'leaf', l0 + f, l1 - f, -ld, ld, ly1 - f, ly1);
      add('leaf', 'leaf', l0 + f, l1 - f, -ld, ld, ly0, ly0 + f);
      const r = Math.min(MID_RAIL, lh / 8);
      const c = Math.min(Math.max(ly0 + MID_RAIL_HEIGHT, ly0 + f + r), ly1 - f - r);
      add('leaf', 'midRail', l0 + f, l1 - f, -ld, ld, c - r / 2, c + r / 2);
      screen(l0 + f, l1 - f, ly0 + f, c - r / 2);
      screen(l0 + f, l1 - f, c + r / 2, ly1 - f);
      return;
    }
    // Two stiles and two rails round a recessed panel, glass, or (half lite) both.
    const stile = Math.min(5, (l1 - l0) / 4);
    const topRail = Math.min(5, lh / 6);
    const botRail = Math.min(8, lh / 5);
    add('leaf', 'leaf', l0, l0 + stile, -ld, ld, ly0, ly1);
    add('leaf', 'leaf', l1 - stile, l1, -ld, ld, ly0, ly1);
    add('leaf', 'leaf', l0 + stile, l1 - stile, -ld, ld, ly1 - topRail, ly1);
    add('leaf', 'leaf', l0 + stile, l1 - stile, -ld, ld, ly0, ly0 + botRail);
    const p0 = l0 + stile;
    const p1 = l1 - stile;
    const py0 = ly0 + botRail;
    const py1 = ly1 - topRail;
    if (input.halfLite) {
      // The lite grid glazes the upper 55% of the panel area; a rail under the glass, and below it
      // two recessed panels either side of a centre stile.
      const gy0 = py1 - (py1 - py0) * HALF_LITE;
      glaze(p0, p1, gy0, py1, lites);
      const rail = Math.min(topRail, (gy0 - py0) / 3);
      const cs = Math.min(CENTER_STILE, (p1 - p0) / 3) / 2;
      const cm = (p0 + p1) / 2;
      add('leaf', 'leaf', p0, p1, -ld, ld, gy0 - rail, gy0);
      add('leaf', 'leaf', cm - cs, cm + cs, -ld, ld, py0, gy0 - rail);
      add('leaf', 'panel', p0, cm - cs, -pd, pd, py0, gy0 - rail);
      add('leaf', 'panel', cm + cs, p1, -pd, pd, py0, gy0 - rail);
    } else if (lites.cols * lites.rows > 1) glaze(p0, p1, py0, py1, lites);
    else add('leaf', 'panel', p0, p1, -pd, pd, py0, py1);
  };
  const l0 = j0 + fr;
  const l1 = j1 - fr;
  if (sashCount(input.sashes) >= 2) {
    // A double door: two full leaves meeting at the centre.
    const mid = (l0 + l1) / 2;
    leaf(l0, mid);
    leaf(mid, l1);
  } else leaf(l0, l1);
  return boxes;
}
