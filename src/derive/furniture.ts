import { BED_FRAME, bedSizeOf, BED_SIZES, FURNITURE, pieceWoodOf, WOODS } from '../model/furniture';
import type { Fixture, FurniturePiece, Vec2 } from '../model/types';
import { fixtureFrame, fixturePoint } from './casework';

// Furniture geometry (DESIGN.md "Furniture"): each catalogue piece as a recipe of solids in the
// fixture's own frame (derive/casework.ts: s across the back from its middle, d from the back toward
// the front, y above the floor top). Pure: no three. The recipes scale with the piece's width, depth
// and height and keep every solid inside its footprint and height, so a piece of any size stays in
// its rectangle on the plan. A piece in a log wood (WOODS[...].log) is built of round logs, the
// Adirondack guide-built way; the others of sawn stock.

/** What a solid is made of (view3d/materials.ts furnitureMaterial picks the material). */
export type FurniturePart = 'wood' | 'fabric' | 'linen' | 'cane' | 'metal' | 'shade' | 'books';
export type GrainAxis = 's' | 'd' | 'y';
export interface Local3 {
  s: number;
  d: number;
  y: number;
}

export type FurnitureSolid =
  /** An axis-aligned box; the wood's grain runs along `grain` (absent: its longest side). */
  | { type: 'box'; part: FurniturePart; s0: number; s1: number; d0: number; d1: number; y0: number; y1: number; grain?: GrainAxis }
  /** A sawn stick from a to b: `across` wide level and square to its axis, `thick` the other way. */
  | { type: 'stick'; part: FurniturePart; a: Local3; b: Local3; across: number; thick: number }
  /** A round log (or a pole, a lamp shade) from a to b, `diameter` across. */
  | { type: 'log'; part: FurniturePart; a: Local3; b: Local3; diameter: number };

interface Dims {
  /** Half the width: s runs over [-hw, hw]. */
  hw: number;
  D: number;
  y0: number;
  y1: number;
  log: boolean;
  f: Fixture;
}

const P = (s: number, d: number, y: number): Local3 => ({ s, d, y });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

class Builder {
  readonly out: FurnitureSolid[] = [];
  box(part: FurniturePart, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number, grain?: GrainAxis): void {
    if (s1 - s0 > 1e-6 && d1 - d0 > 1e-6 && y1 - y0 > 1e-6) this.out.push({ type: 'box', part, s0, s1, d0, d1, y0, y1, ...(grain ? { grain } : {}) });
  }
  stick(part: FurniturePart, a: Local3, b: Local3, across: number, thick: number): void {
    if (Math.hypot(b.s - a.s, b.d - a.d, b.y - a.y) > 1e-6 && across > 1e-6 && thick > 1e-6) this.out.push({ type: 'stick', part, a, b, across, thick });
  }
  log(part: FurniturePart, a: Local3, b: Local3, diameter: number): void {
    if (Math.hypot(b.s - a.s, b.d - a.d, b.y - a.y) > 1e-6 && diameter > 1e-6) this.out.push({ type: 'log', part, a, b, diameter });
  }
  /** An upright leg or post at (s, d), `size` across (a log or a square), from y0 to y1. */
  post(x: Dims, s: number, d: number, size: number, y0: number, y1: number): void {
    if (x.log) this.log('wood', P(s, d, y0), P(s, d, y1), size);
    else this.box('wood', s - size / 2, s + size / 2, d - size / 2, d + size / 2, y0, y1, 'y');
  }
  /** A level rail from (sa, da) to (sb, db) at height y (its centre), `size` across. */
  rail(x: Dims, sa: number, da: number, sb: number, db: number, y: number, size: number): void {
    if (x.log) this.log('wood', P(sa, da, y), P(sb, db, y), size);
    else {
      const h = size / 2;
      this.box('wood', Math.min(sa, sb) - (sa === sb ? h : 0), Math.max(sa, sb) + (sa === sb ? h : 0), Math.min(da, db) - (da === db ? h : 0), Math.max(da, db) + (da === db ? h : 0), y - h, y + h);
    }
  }
  /** Four legs inset `inset` from the footprint's corners (their outside faces), `size` across. */
  legs4(x: Dims, size: number, inset: number, top: number, d0 = 0, d1 = x.D): void {
    const s = x.hw - inset - size / 2;
    for (const ss of [-s, s]) for (const dd of [d0 + inset + size / 2, d1 - inset - size / 2]) this.post(x, ss, dd, size, x.y0, top);
  }
}

/** A drawer bank: `cols` x `rows` fronts over the carcass's front face (d1), proud of it, with iron pulls. */
function drawerBank(b: Builder, s0: number, s1: number, y0: number, y1: number, d1: number, cols: number, rows: number): void {
  const reveal = 0.25;
  const w = (s1 - s0 - reveal * (cols + 1)) / cols;
  const h = (y1 - y0 - reveal * (rows + 1)) / rows;
  if (w < 2 || h < 2) return;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const fs0 = s0 + reveal + c * (w + reveal);
      const fy0 = y0 + reveal + r * (h + reveal);
      b.box('wood', fs0, fs0 + w, d1 - 1, d1 - 0.25, fy0, fy0 + h, 's');
      const pull = Math.min(1, h / 3);
      b.box('metal', fs0 + w / 2 - 1.5, fs0 + w / 2 + 1.5, d1 - 0.25, d1, fy0 + h / 2 - pull / 2, fy0 + h / 2 + pull / 2);
    }
  }
}

/** A case piece (dresser, chest, nightstand): a top, a carcass on short legs, a drawer bank. */
function casePiece(b: Builder, x: Dims, cols: number, rows: number): void {
  const leg = Math.min(4, (x.y1 - x.y0) / 6);
  const top = Math.min(1, (x.y1 - x.y0) / 10);
  const legSize = Math.min(2, x.hw / 4, x.D / 6);
  b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - top, x.y1, 's');
  b.box('wood', -x.hw + 0.5, x.hw - 0.5, 0, x.D - 1.25, x.y0 + leg, x.y1 - top, 's');
  b.legs4({ ...x, log: false }, legSize, 0.5, x.y0 + leg, 0, x.D - 1.25);
  drawerBank(b, -x.hw + 0.5, x.hw - 0.5, x.y0 + leg, x.y1 - top, x.D, cols, rows);
}

/** The headboard or footboard of a bed: two posts, a top and a lower rail, spindles or a panel between. */
function bedEnd(b: Builder, x: Dims, d: number, top: number, low: number, post: number, spindles: number): void {
  const s = x.hw - post / 2;
  b.post(x, -s, d, post, x.y0, top);
  b.post(x, s, d, post, x.y0, top);
  const rail = Math.min(post - 1, 3.5);
  b.rail(x, -s, d, s, d, top - post / 2 - rail / 2, rail);
  b.rail(x, -s, d, s, d, low, rail);
  const y0 = low + rail / 2;
  const y1 = top - post / 2 - rail;
  if (y1 - y0 < 2) return;
  if (x.log) {
    for (let i = 1; i <= spindles; i++) {
      const ss = -s + ((2 * s) * i) / (spindles + 1);
      b.log('wood', P(ss, d, y0), P(ss, d, y1), Math.min(2, post / 2));
    }
  } else b.box('wood', -s + post / 2, s - post / 2, d - 0.75, d + 0.75, y0, y1, 's');
}

const RECIPES: Record<FurniturePiece, (b: Builder, x: Dims) => void> = {
  bed(b, x) {
    const W = 2 * x.hw;
    const H = x.y1 - x.y0;
    const post = clamp(W / 14, 2.5, 5);
    // The mattress inside the frame, its top at 24" (lower on a short bed).
    const ms = x.hw - BED_FRAME.side;
    const md0 = BED_FRAME.head;
    const md1 = x.D - BED_FRAME.foot;
    const mTop = x.y0 + Math.min(24, H * 0.55);
    const rail = Math.min(10, mTop - x.y0 - 2);
    // Head (at the back, d 0) to its full height; foot lower.
    bedEnd(b, x, post / 2, x.y1, x.y0 + rail, post, Math.max(3, Math.round(W / 9)));
    const footTop = Math.min(x.y1, mTop + 6);
    bedEnd(b, x, x.D - post / 2, footTop, x.y0 + rail, post, Math.max(2, Math.round(W / 16)));
    // Side rails between the posts.
    const sr = Math.min(3.5, post - 0.5);
    b.rail(x, -(x.hw - sr / 2), post, -(x.hw - sr / 2), x.D - post, x.y0 + rail, sr);
    b.rail(x, x.hw - sr / 2, post, x.hw - sr / 2, x.D - post, x.y0 + rail, sr);
    // Mattress and foundation, linen; the blanket over the lower two thirds with a turned-down sheet.
    b.box('linen', -ms, ms, md0, md1, x.y0 + rail + sr / 2, mTop, 'd');
    const turn = md0 + (md1 - md0) * 0.3;
    b.box('linen', -ms - 0.5, ms + 0.5, turn - 7, turn, mTop - 3, mTop + 1.25, 's');
    b.box('fabric', -ms - 1, ms + 1, turn, md1 + 1, mTop - 5, mTop + 1.5, 'd');
    // Pillows: two on a full bed or wider, one on a twin.
    const n = W >= 50 ? 2 : 1;
    const gap = 2;
    const pw = (2 * ms - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const s0 = -ms + gap + i * (pw + gap);
      b.box('linen', s0, s0 + pw, md0 + 1, md0 + Math.min(19, (md1 - md0) * 0.25), mTop, Math.min(x.y1, mTop + 5), 's');
    }
  },
  nightstand(b, x) {
    casePiece(b, x, 1, 2);
  },
  dresser(b, x) {
    casePiece(b, x, x.hw * 2 >= 40 ? 2 : 1, x.y1 - x.y0 >= 30 ? 3 : 2);
  },
  chest(b, x) {
    casePiece(b, x, 1, Math.max(3, Math.round((x.y1 - x.y0) / 9)));
  },
  bookcase(b, x) {
    const t = 1;
    const plinth = Math.min(3, (x.y1 - x.y0) / 8);
    b.box('wood', -x.hw, -x.hw + t, 0, x.D, x.y0, x.y1, 'y');
    b.box('wood', x.hw - t, x.hw, 0, x.D, x.y0, x.y1, 'y');
    b.box('wood', -x.hw + t, x.hw - t, 0, x.D, x.y1 - t, x.y1, 's');
    b.box('wood', -x.hw + t, x.hw - t, 0, x.D, x.y0, x.y0 + plinth, 's');
    b.box('wood', -x.hw + t, x.hw - t, 0, 0.5, x.y0 + plinth, x.y1 - t, 'y');
    const shelves = Math.max(2, Math.round((x.y1 - x.y0) / 14));
    const step = (x.y1 - t - (x.y0 + plinth)) / shelves;
    for (let i = 1; i < shelves; i++) {
      const y = x.y0 + plinth + i * step;
      b.box('wood', -x.hw + t, x.hw - t, 0.5, x.D, y - 0.375, y + 0.375, 's');
    }
    // Books on every shelf: a row of spines, short of the shelf's front.
    for (let i = 0; i < shelves; i++) {
      const y = x.y0 + plinth + i * step + (i === 0 ? 0 : 0.375);
      const top = Math.min(y + step * 0.7, y + 10);
      if (top - y > 2 && x.D > 4) b.box('books', -x.hw + t + 1, x.hw - t - Math.min(6, x.hw / 2), 0.5, Math.min(x.D - 1, 8.5), y, top, 'y');
    }
  },
  trunk(b, x) {
    const lid = Math.min(3, (x.y1 - x.y0) / 4);
    b.box('wood', -x.hw + 0.5, x.hw - 0.5, 0.5, x.D - 0.5, x.y0, x.y1 - lid, 's');
    b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - lid, x.y1 - 0.25, 's');
    for (const s of [-x.hw / 2, x.hw / 2]) {
      b.box('metal', s - 0.75, s + 0.75, x.D - 0.5, x.D, x.y0, x.y1 - lid, 'y');
      b.box('metal', s - 0.75, s + 0.75, 0, 0.5, x.y0, x.y1 - lid, 'y');
      b.box('metal', s - 0.75, s + 0.75, 0, x.D, x.y1 - 0.25, x.y1, 'd');
    }
  },
  desk(b, x) {
    const top = 1.25;
    const leg = x.log ? clamp(x.hw / 10, 2, 3.5) : 2;
    b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - top, x.y1, 's');
    b.legs4(x, leg, 1, x.y1 - top);
    // The apron and a pencil drawer in it, a modesty panel at the back.
    const apron = Math.min(4, (x.y1 - x.y0) / 6);
    const s = x.hw - 1 - leg;
    b.box('wood', -s, s, 1, x.D - 2, x.y1 - top - apron, x.y1 - top, 's');
    const dw = Math.min(20, s);
    b.box('wood', -dw / 2, dw / 2, x.D - 2, x.D - 1.25, x.y1 - top - apron + 0.25, x.y1 - top - 0.25, 's');
    b.box('metal', -1.5, 1.5, x.D - 1.25, x.D - 1, x.y1 - top - apron / 2 - 0.4, x.y1 - top - apron / 2 + 0.4);
    b.box('wood', -s, s, 1, 1.75, x.y0 + 12, x.y1 - top - apron, 's');
  },
  diningTable(b, x) {
    const top = 1.5;
    const leg = x.log ? clamp(x.hw / 8, 2.5, 4) : 3;
    b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - top, x.y1, 's');
    b.legs4(x, leg, 2, x.y1 - top);
    const apron = Math.min(3.5, (x.y1 - x.y0) / 6);
    const s = x.hw - 2 - leg / 2;
    for (const dd of [2 + leg / 2, x.D - 2 - leg / 2]) b.box('wood', -s, s, dd - 0.5, dd + 0.5, x.y1 - top - apron, x.y1 - top, 's');
    for (const ss of [-s, s]) b.box('wood', ss - 0.5, ss + 0.5, 2 + leg, x.D - 2 - leg, x.y1 - top - apron, x.y1 - top, 'd');
  },
  coffeeTable(b, x) {
    const top = Math.min(2, (x.y1 - x.y0) / 5);
    const leg = x.log ? clamp(Math.min(x.hw, x.D / 2) / 4, 2, 4.5) : 2;
    b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - top, x.y1, 's');
    b.legs4(x, leg, 1.5, x.y1 - top);
    b.box('wood', -x.hw + 1.5, x.hw - 1.5, 1.5, x.D - 1.5, x.y0 + 4, x.y0 + 5, 's');
  },
  sideTable(b, x) {
    RECIPES.coffeeTable(b, x);
  },
  diningChair(b, x) {
    chair(b, x, 18);
  },
  deskChair(b, x) {
    chair(b, x, 18);
  },
  rocker(b, x) {
    const runner = 3;
    // Two runners, each three sticks along d, low in the middle.
    for (const s of [-x.hw + 1, x.hw - 1]) {
      const pts = [P(s, 0.75, x.y0 + runner), P(s, x.D / 3, x.y0 + 0.75), P(s, (2 * x.D) / 3, x.y0 + 0.75), P(s, x.D - 0.75, x.y0 + runner)];
      for (let i = 0; i < 3; i++) b.stick('wood', pts[i], pts[i + 1], 1.5, 1);
    }
    chair(b, { ...x, y0: x.y0 + 1.5 }, 16, true);
  },
  bench(b, x) {
    const seat = 2;
    b.box('wood', -x.hw, x.hw, 0, x.D, x.y1 - seat, x.y1, 's');
    const inset = Math.min(4, x.hw / 4);
    for (const s of [-x.hw + inset, x.hw - inset]) {
      if (x.log) {
        const size = Math.min(3, x.D / 4);
        b.post(x, s, size / 2 + 1, size, x.y0, x.y1 - seat);
        b.post(x, s, x.D - size / 2 - 1, size, x.y0, x.y1 - seat);
      } else b.box('wood', s - 0.75, s + 0.75, 1, x.D - 1, x.y0, x.y1 - seat, 'y');
    }
    b.rail(x, -x.hw + inset, x.D / 2, x.hw - inset, x.D / 2, x.y0 + (x.y1 - x.y0) / 3, 1.5);
  },
  sofa(b, x) {
    upholstered(b, x);
  },
  armchair(b, x) {
    upholstered(b, x);
  },
  rug(b, x) {
    b.box('fabric', -x.hw, x.hw, 0, x.D, x.y0, x.y1, 'd');
  },
  floorLamp(b, x) {
    const r = Math.min(x.hw, x.D / 2);
    b.box('metal', -r * 0.6, r * 0.6, x.D / 2 - r * 0.6, x.D / 2 + r * 0.6, x.y0, x.y0 + 1);
    const shade = Math.min(12, (x.y1 - x.y0) / 4);
    b.log('metal', P(0, x.D / 2, x.y0 + 1), P(0, x.D / 2, x.y1 - shade + 2), 1);
    b.log('shade', P(0, x.D / 2, x.y1 - shade), P(0, x.D / 2, x.y1), 2 * r * 0.95);
  },
  coatBench(b, x) {
    // A mudroom built-in: pine side panels, open boot cubbies under a 2" seat with a cushion, a
    // beadboard back, a hook rail with iron hooks, a shelf along the top.
    const H = x.y1 - x.y0;
    const side = 0.75;
    const si = x.hw - side;
    b.box('wood', -x.hw, -si, 0, x.D, x.y0, x.y1, 'y');
    b.box('wood', si, x.hw, 0, x.D, x.y0, x.y1, 'y');
    const seatTop = x.y0 + Math.min(18, H * 0.3);
    b.box('wood', -si, si, 0, x.D, seatTop - 1.5, seatTop, 's');
    const toe = Math.min(3, (seatTop - x.y0) / 4);
    b.box('wood', -si, si, 0, x.D - 1, x.y0, x.y0 + toe, 's');
    const cubbies = Math.max(1, Math.round((2 * si) / 16));
    for (let i = 1; i < cubbies; i++) {
      const s = -si + (2 * si * i) / cubbies;
      b.box('wood', s - 0.375, s + 0.375, 0, x.D - 1, x.y0 + toe, seatTop - 1.5, 'y');
    }
    const shelfD = Math.min(12, x.D);
    b.box('wood', -si, si, 0, 0.75, seatTop, x.y1 - 1.25, 'y');
    b.box('wood', -si, si, 0, shelfD, x.y1 - 1.25, x.y1, 's');
    const hookY = Math.min(x.y1 - 5, x.y0 + Math.max(seatTop - x.y0 + 12, H * 0.88));
    b.box('wood', -si, si, 0.75, 1.75, hookY - 2, hookY + 2, 's');
    const hooks = Math.max(1, Math.floor((2 * si) / 8));
    for (let i = 0; i < hooks; i++) {
      const s = -si + (2 * si * (i + 0.5)) / hooks;
      b.box('metal', s - 0.5, s + 0.5, 1.75, Math.min(x.D, 4.25), hookY - 1, hookY + 1);
    }
    b.box('fabric', -si, si, 0.75, x.D - 0.5, seatTop, Math.min(x.y1, seatTop + 2), 'd');
  },
  adirondackChair(b, x) {
    const H = x.y1 - x.y0;
    const seatFront = x.y0 + Math.min(15, H * 0.4);
    const seatBack = seatFront - 4;
    const arm = x.y0 + Math.min(24, H * 0.63);
    const armW = Math.min(5.5, x.hw / 3);
    const legW = 3;
    // The front legs, square to the floor, carrying the arms.
    for (const s of [-x.hw + armW / 2, x.hw - armW / 2]) {
      b.box('wood', s - 0.75, s + 0.75, x.D - 6, x.D - 2.5, x.y0, arm - 0.75, 'y');
      // The seat stringer, from the front leg down to the floor at the back.
      b.stick('wood', P(s * 0.85, x.D - 1, seatFront - 1), P(s * 0.85, 9, x.y0 + 1.5), legW, 1);
      // The wide flat arm.
      b.box('wood', s - armW / 2, s + armW / 2, 3, x.D, arm - 0.75, arm, 'd');
    }
    // Seat slats across, falling toward the back.
    const n = 6;
    for (let i = 0; i < n; i++) {
      const d = 11 + ((x.D - 13) * i) / (n - 1);
      const y = seatBack + ((seatFront - seatBack) * (d - 11)) / (x.D - 13);
      b.box('wood', -x.hw + armW + 0.5, x.hw - armW - 0.5, d - 1.25, d + 1.25, y - 0.75, y, 's');
    }
    // The fan back: five slats leaning back, wider apart at the top.
    const slats = 5;
    const sw = Math.min(3.5, (2 * (x.hw - armW)) / slats - 0.5);
    for (let i = 0; i < slats; i++) {
      const t = (i - (slats - 1) / 2) / ((slats - 1) / 2 || 1);
      const bottomS = t * (x.hw - armW - sw / 2 - 1);
      const topS = t * (x.hw - sw / 2 - 1);
      b.stick('wood', P(bottomS, 10, seatBack - 0.5), P(topS, 1.25, x.y1 - 1.5), sw, 0.75);
    }
    b.box('wood', -x.hw + armW, x.hw - armW, 8, 9.5, seatBack + 1, seatBack + 4, 's');
    b.box('wood', -x.hw + 1, x.hw - 1, 3.5, 5, arm + 1, arm + 3.5, 's');
  },
};

/** A ladder-back chair (Old Hickory style): legs, a woven cane seat, back posts and three slats; arms on a rocker. */
function chair(b: Builder, x: Dims, seatH: number, arms = false): void {
  const leg = x.log ? 1.75 : 1.5;
  const seat = x.y0 + Math.min(seatH, (x.y1 - x.y0) * 0.5);
  const s = x.hw - leg / 2 - (arms ? 1.5 : 0);
  const front = x.D - leg / 2 - (arms ? 1.5 : 0);
  const back = leg / 2 + (arms ? 1.5 : 0);
  for (const ss of [-s, s]) {
    b.post(x, ss, front, leg, x.y0, seat);
    b.post(x, ss, back, leg, x.y0, x.y1);
    b.rail(x, ss, back, ss, front, x.y0 + 6, 1);
  }
  b.box('cane', -s, s, back, front, seat - 1, seat, 's');
  for (let i = 0; i < 3; i++) {
    const y = seat + 6 + ((x.y1 - seat - 9) * i) / 2;
    b.box('wood', -s + leg / 2, s - leg / 2, back - 0.5, back + 0.5, y, y + 2.5, 's');
  }
  if (arms) {
    for (const ss of [-s, s]) {
      b.post(x, ss, front, leg, seat, seat + 9);
      b.box('wood', ss - 1.5, ss + 1.5, 0, x.D, seat + 9, seat + 10, 'd');
    }
  }
}

/** A log-frame sofa or armchair: log arms and back, a platform, seat and back cushions, throw pillows. */
function upholstered(b: Builder, x: Dims): void {
  const H = x.y1 - x.y0;
  const post = clamp(Math.min(x.hw, x.D) / 6, 2.5, 5);
  const armTop = x.y0 + Math.min(25, H * 0.75);
  const s = x.hw - post / 2;
  for (const ss of [-s, s]) {
    b.post(x, ss, post / 2, post, x.y0, x.y1);
    b.post(x, ss, x.D - post / 2, post, x.y0, armTop);
    b.rail(x, ss, post, ss, x.D - post / 2, armTop - post / 2, post);
    b.rail(x, ss, post, ss, x.D - post, x.y0 + 7, post * 0.8);
  }
  b.rail(x, -s, post / 2, s, post / 2, x.y1 - post / 2, post);
  b.rail(x, -s, x.D - post / 2, s, x.D - post / 2, x.y0 + 7, post * 0.8);
  const inner = s - post / 2;
  b.box('wood', -inner, inner, post, x.D - post, x.y0 + 6, x.y0 + 10, 's');
  const seatTop = x.y0 + Math.min(18, H * 0.53);
  const n = Math.max(1, Math.round((2 * inner) / 28));
  const cw = (2 * inner) / n;
  const backD = Math.min(8, x.D / 4);
  for (let i = 0; i < n; i++) {
    const s0 = -inner + i * cw;
    b.box('fabric', s0 + 0.25, s0 + cw - 0.25, post + backD - 1, x.D - 1, x.y0 + 10, seatTop, 's');
    b.box('fabric', s0 + 0.25, s0 + cw - 0.25, post, post + backD, seatTop - 1, x.y1 - post, 's');
  }
  // Throw pillows against the arms.
  if (inner > 14) {
    const p = Math.min(16, inner / 2);
    for (const sgn of [-1, 1]) {
      const s0 = sgn < 0 ? -inner + 0.5 : inner - 4.5;
      b.box('linen', s0, s0 + 4, post + backD, post + backD + p, seatTop, Math.min(x.y1 - post, seatTop + p * 0.85), 'y');
    }
  }
}

/** The solids of a furniture piece in its own frame (empty for anything that is not furniture). */
export function furnitureSolids(f: Fixture): FurnitureSolid[] {
  if (f.kind !== 'furniture' || !f.piece || !FURNITURE[f.piece]) return [];
  const b = new Builder();
  const x: Dims = { hw: f.width / 2, D: f.depth, y0: f.elevation, y1: f.elevation + f.height, log: WOODS[pieceWoodOf(f)].log, f };
  RECIPES[f.piece](b, x);
  return b.out;
}

/** A unit vector and length. */
const axisOf = (a: Local3, b: Local3) => {
  const v = { s: b.s - a.s, d: b.d - a.d, y: b.y - a.y };
  const len = Math.hypot(v.s, v.d, v.y) || 1;
  return { s: v.s / len, d: v.d / len, y: v.y / len, len };
};

/**
 * A stick's eight corners: its cross-section is `across` wide along the level direction square to
 * its axis (along s for an upright stick) and `thick` the other way. Ends at a then at b.
 */
export function stickCorners(st: Extract<FurnitureSolid, { type: 'stick' }>): Local3[] {
  const ax = axisOf(st.a, st.b);
  // side = axis x up (level), or s for a vertical stick.
  let side = { s: -ax.d, d: ax.s, y: 0 };
  const sl = Math.hypot(side.s, side.d);
  side = sl < 1e-6 ? { s: 1, d: 0, y: 0 } : { s: side.s / sl, d: side.d / sl, y: 0 };
  // thick = side x axis.
  const tk = { s: side.d * ax.y - side.y * ax.d, d: side.y * ax.s - side.s * ax.y, y: side.s * ax.d - side.d * ax.s };
  const out: Local3[] = [];
  for (const end of [st.a, st.b]) {
    for (const [i, j] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      out.push({
        s: end.s + (side.s * i * st.across) / 2 + (tk.s * j * st.thick) / 2,
        d: end.d + (side.d * i * st.across) / 2 + (tk.d * j * st.thick) / 2,
        y: end.y + (side.y * i * st.across) / 2 + (tk.y * j * st.thick) / 2,
      });
    }
  }
  return out;
}

/** A solid's bounding box in the fixture's frame. */
export function solidExtent(sol: FurnitureSolid): { s0: number; s1: number; d0: number; d1: number; y0: number; y1: number } {
  if (sol.type === 'box') return { s0: sol.s0, s1: sol.s1, d0: sol.d0, d1: sol.d1, y0: sol.y0, y1: sol.y1 };
  if (sol.type === 'stick') {
    const c = stickCorners(sol);
    return {
      s0: Math.min(...c.map((p) => p.s)),
      s1: Math.max(...c.map((p) => p.s)),
      d0: Math.min(...c.map((p) => p.d)),
      d1: Math.max(...c.map((p) => p.d)),
      y0: Math.min(...c.map((p) => p.y)),
      y1: Math.max(...c.map((p) => p.y)),
    };
  }
  // A cylinder of radius r along a unit axis reaches r sqrt(1 - a_e^2) past its ends along axis e.
  const ax = axisOf(sol.a, sol.b);
  const r = sol.diameter / 2;
  const reach = (c: number) => r * Math.sqrt(Math.max(0, 1 - c * c));
  return {
    s0: Math.min(sol.a.s, sol.b.s) - reach(ax.s),
    s1: Math.max(sol.a.s, sol.b.s) + reach(ax.s),
    d0: Math.min(sol.a.d, sol.b.d) - reach(ax.d),
    d1: Math.max(sol.a.d, sol.b.d) + reach(ax.d),
    y0: Math.min(sol.a.y, sol.b.y) - reach(ax.y),
    y1: Math.max(sol.a.y, sol.b.y) + reach(ax.y),
  };
}

// ---------------------------------------------------------------------------------------------
// Plan symbol detail

export interface FurnitureSymbol {
  /** Detail lines and closed shapes in plan coordinates, drawn thin inside the outline. */
  lines: [Vec2, Vec2][];
  rects: Vec2[][];
  circles: { at: Vec2; r: number }[];
}

/** The plan detail of a piece: a bed's pillows and turn-down, a chair's back, a sofa's cushions, a rug's border and fringe, a lamp's shade. */
export function furnitureSymbol(f: Fixture): FurnitureSymbol {
  const out: FurnitureSymbol = { lines: [], rects: [], circles: [] };
  if (f.kind !== 'furniture' || !f.piece) return out;
  const fr = fixtureFrame(f);
  const pt = (s: number, d: number) => fixturePoint(fr, s, d);
  const rect = (s0: number, s1: number, d0: number, d1: number) => out.rects.push([pt(s0, d0), pt(s0, d1), pt(s1, d1), pt(s1, d0)]);
  const line = (s0: number, d0: number, s1: number, d1: number) => out.lines.push([pt(s0, d0), pt(s1, d1)]);
  const hw = f.width / 2;
  const D = f.depth;
  switch (f.piece) {
    case 'bed': {
      const ms = hw - BED_FRAME.side;
      const md0 = BED_FRAME.head;
      const md1 = D - BED_FRAME.foot;
      const n = f.width >= 50 ? 2 : 1;
      const gap = 2;
      const pw = (2 * ms - gap * (n + 1)) / n;
      for (let i = 0; i < n; i++) {
        const s0 = -ms + gap + i * (pw + gap);
        rect(s0, s0 + pw, md0 + 1, md0 + Math.min(19, (md1 - md0) * 0.25));
      }
      const turn = md0 + (md1 - md0) * 0.3;
      line(-ms, turn, ms, turn);
      line(-ms, turn - 7, ms, turn - 7);
      break;
    }
    case 'diningChair':
    case 'deskChair':
    case 'rocker':
      line(-hw + 1, 2.5, hw - 1, 2.5);
      break;
    case 'sofa':
    case 'armchair': {
      const post = clamp(Math.min(hw, D) / 6, 2.5, 5);
      const inner = hw - post;
      const backD = post + Math.min(8, D / 4);
      rect(-inner, inner, backD, D - 1);
      const n = Math.max(1, Math.round((2 * inner) / 28));
      for (let i = 1; i < n; i++) {
        const s = -inner + (2 * inner * i) / n;
        line(s, backD, s, D - 1);
      }
      break;
    }
    case 'adirondackChair':
      for (const t of [-1, -0.5, 0, 0.5, 1]) line(t * (hw - 4), 10, t * (hw - 2), 1.5);
      break;
    case 'rug': {
      const inset = Math.min(3, hw / 4, D / 8);
      rect(-hw + inset, hw - inset, inset, D - inset);
      const fringe = Math.max(2, Math.round(f.width / 4));
      for (let i = 0; i <= fringe; i++) {
        const s = -hw + (f.width * i) / fringe;
        line(s, 0, s, Math.min(1.5, inset));
        line(s, D, s, D - Math.min(1.5, inset));
      }
      break;
    }
    case 'floorLamp':
      out.circles.push({ at: pt(0, D / 2), r: Math.min(hw, D / 2) * 0.95 });
      break;
    case 'dresser':
    case 'chest':
    case 'nightstand':
    case 'desk':
      line(-hw + 1, D - 1, hw - 1, D - 1);
      break;
    case 'bookcase':
      line(-hw + 1, 0.5, hw - 1, 0.5);
      break;
    case 'coatBench': {
      // The top shelf's edge and the cubby dividers under the seat.
      const shelf = Math.min(12, D);
      line(-hw + 0.75, shelf, hw - 0.75, shelf);
      const si = hw - 0.75;
      const n = Math.max(1, Math.round((2 * si) / 16));
      for (let i = 1; i < n; i++) {
        const s = -si + (2 * si * i) / n;
        line(s, D - 1, s, D - 4);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** "Queen", "Full"... for a bed's width, used by the panel. */
export const bedSizeLabel = (width: number): string | null => {
  const s = bedSizeOf(width);
  return s ? BED_SIZES[s].label : null;
};
