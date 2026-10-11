import { DEFAULT_LITES, DEFAULT_TRIM } from '../model/finish';
import type { Opening } from '../model/types';

// Window and door fills (DESIGN.md "Exterior appearance"). Pure: an opening becomes a list of axis
// aligned boxes in the wall's own frame; meshes.ts turns them into prisms and merges them per
// material part. Frame: `s` along the wall's centerline (like Opening.offset), `d` the distance
// from the wall's mid plane toward the outside (negative = toward the inside), `y` above the
// floor top. Inches throughout.

/** The material groups a fill is merged into (export: trim, sash, glass, door_leaf, shutter). */
export type FillPart = 'trim' | 'sash' | 'glass' | 'leaf' | 'shutter';

export type FillKind = 'trim' | 'sill' | 'sashFrame' | 'muntin' | 'glass' | 'doorFrame' | 'leaf' | 'panel' | 'shutter';

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
}

/** Number of (vertical, horizontal) muntins for a lite grid. */
export const muntinCounts = (lites: { cols: number; rows: number }): { vertical: number; horizontal: number } => ({
  vertical: Math.max(0, Math.floor(lites.cols) - 1),
  horizontal: Math.max(0, Math.floor(lites.rows) - 1),
});

/** The lite grid the fill uses: the opening's own, else 2 x 3 for a window and 1 x 1 for a door. */
export const fillLites = (type: Opening['type'], lites?: Opening['lites']): { cols: number; rows: number } =>
  lites ?? (type === 'door' ? DEFAULT_LITES.door : DEFAULT_LITES.window);

/** The boxes of a window or door fill; passages (and degenerate holes) have none. */
export function openingFill(input: FillInput): FillBox[] {
  const { type, j0, j1, bottom, top, thickness } = input;
  if (type === 'passage') return [];
  const w = j1 - j0;
  const h = top - bottom;
  if (!(w > 1e-6) || !(h > 1e-6)) return [];
  const half = thickness / 2;
  const trim = Math.max(0, input.trim ?? DEFAULT_TRIM);
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
  const fr = Math.min(SASH_FRAME, w / 4, h / 4);
  // The sash (or door frame) fills the hole; its inside is the glazed area.
  const iw0 = j0 + fr;
  const iw1 = j1 - fr;

  const glaze = (g0: number, g1: number, gy0: number, gy1: number, lites: { cols: number; rows: number }) => {
    if (!(g1 - g0 > 1e-6) || !(gy1 - gy0 > 1e-6)) return;
    add('glass', 'glass', g0, g1, -GLASS_THICKNESS / 2, GLASS_THICKNESS / 2, gy0, gy1);
    const { vertical, horizontal } = muntinCounts(lites);
    const md = Math.min(MUNTIN_DEPTH, thickness) / 2;
    for (let i = 1; i <= vertical; i++) {
      const c = g0 + ((g1 - g0) * i) / (vertical + 1);
      add('sash', 'muntin', c - MUNTIN / 2, c + MUNTIN / 2, -md, md, gy0, gy1);
    }
    for (let i = 1; i <= horizontal; i++) {
      const c = gy0 + ((gy1 - gy0) * i) / (horizontal + 1);
      add('sash', 'muntin', g0, g1, -md, md, c - MUNTIN / 2, c + MUNTIN / 2);
    }
  };

  if (type === 'window') {
    // Sill: 1.5" thick, projecting 1" beyond the trim.
    add('trim', 'sill', j0 - trim, j1 + trim, t0, t1 + SILL_PROJECTION, bottom - SILL_THICKNESS, bottom);
    // Sash frame: four boards.
    add('sash', 'sashFrame', j0, j0 + fr, -sd, sd, bottom, top);
    add('sash', 'sashFrame', j1 - fr, j1, -sd, sd, bottom, top);
    add('sash', 'sashFrame', iw0, iw1, -sd, sd, top - fr, top);
    add('sash', 'sashFrame', iw0, iw1, -sd, sd, bottom, bottom + fr);
    glaze(iw0, iw1, bottom + fr, top - fr, fillLites('window', input.lites));
    if (input.shutters) {
      // Two boards, each a third of the window width, flanking the trim.
      const sw = w / 3;
      add('shutter', 'shutter', j0 - trim - sw, j0 - trim, t0, t0 + SHUTTER_THICKNESS, bottom, top);
      add('shutter', 'shutter', j1 + trim, j1 + trim + sw, t0, t0 + SHUTTER_THICKNESS, bottom, top);
    }
    return boxes;
  }

  // Door: frame boards at the jambs and head, a leaf with rails and stiles round a recessed panel.
  add('sash', 'doorFrame', j0, iw0, -sd, sd, bottom, top);
  add('sash', 'doorFrame', iw1, j1, -sd, sd, bottom, top);
  add('sash', 'doorFrame', iw0, iw1, -sd, sd, top - fr, top);
  const l0 = iw0;
  const l1 = iw1;
  const ly0 = bottom;
  const ly1 = top - fr;
  const ld = Math.min(DOOR_LEAF, thickness) / 2;
  const stile = Math.min(5, (l1 - l0) / 4);
  const topRail = Math.min(5, (ly1 - ly0) / 6);
  const botRail = Math.min(8, (ly1 - ly0) / 5);
  add('leaf', 'leaf', l0, l0 + stile, -ld, ld, ly0, ly1);
  add('leaf', 'leaf', l1 - stile, l1, -ld, ld, ly0, ly1);
  add('leaf', 'leaf', l0 + stile, l1 - stile, -ld, ld, ly1 - topRail, ly1);
  add('leaf', 'leaf', l0 + stile, l1 - stile, -ld, ld, ly0, ly0 + botRail);
  const lites = fillLites('door', input.lites);
  const p0 = l0 + stile;
  const p1 = l1 - stile;
  const py0 = ly0 + botRail;
  const py1 = ly1 - topRail;
  if (lites.cols * lites.rows > 1) glaze(p0, p1, py0, py1, lites);
  else {
    const pd = Math.min(DOOR_PANEL_DEPTH, thickness) / 2;
    add('leaf', 'panel', p0, p1, -pd, pd, py0, py1);
  }
  return boxes;
}
