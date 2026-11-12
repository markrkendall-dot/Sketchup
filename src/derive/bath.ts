import { glassOf, isBath, SHOWER, TOILET, TUB, VANITY_BASIN, variantOf } from '../model/bath';
import { counterTopOf } from '../model/casework';
import type { Fixture, Vec2 } from '../model/types';
import { fixtureFrame, fixturePoint, vanityBasinsLocal } from './casework';
import type { FurnitureSymbol, Local3, Solid } from './furniture';

// Bath and laundry geometry (DESIGN.md "Bath and laundry"). Pure: no three. Each kind is a recipe of
// solids in the fixture's frame (derive/casework.ts: s across the back from its middle, d from the
// back toward the front, y above the floor top), like furniture's (derive/furniture.ts): boxes, round
// logs (taps, pipes, a water heater's tank) and plan prisms (an oval tub, a toilet's bowl, a basin).
// The recipes scale with the fixture's width, depth and height and keep every solid inside its
// footprint; taps and shower heads on the wall stand above a tub's or a shower's height.

/** What a solid is made of (view3d/materials.ts bathMaterial): the body (china, enamel, a tray), chrome, glass, or dark (a washer's window, a display). */
export type BathPart = 'body' | 'chrome' | 'glass' | 'dark';
export type BathSolid = Solid<BathPart>;
type Pt = { s: number; d: number };

const P = (s: number, d: number, y: number): Local3 => ({ s, d, y });

/** An ellipse round (cs, cd) with half-axes rs (across) and rd (along d), as a ring of n points. */
export function ellipse(cs: number, cd: number, rs: number, rd: number, n = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push({ s: cs + rs * Math.cos(t), d: cd + rd * Math.sin(t) });
  }
  return out;
}

/** A rectangle with its corners rounded to radius r (each corner a quarter circle of `steps` segments). */
export function roundedRect(s0: number, s1: number, d0: number, d1: number, r: number, steps = 6): Pt[] {
  const rr = Math.max(0, Math.min(r, (s1 - s0) / 2 - 1e-3, (d1 - d0) / 2 - 1e-3));
  if (rr < 1e-3)
    return [
      { s: s0, d: d0 },
      { s: s1, d: d0 },
      { s: s1, d: d1 },
      { s: s0, d: d1 },
    ];
  const corners: [number, number, number][] = [
    [s1 - rr, d0 + rr, -Math.PI / 2],
    [s1 - rr, d1 - rr, 0],
    [s0 + rr, d1 - rr, Math.PI / 2],
    [s0 + rr, d0 + rr, Math.PI],
  ];
  const out: Pt[] = [];
  for (const [cs, cd, a0] of corners) for (let i = 0; i <= steps; i++) {
    const t = a0 + ((Math.PI / 2) * i) / steps;
    out.push({ s: cs + rr * Math.cos(t), d: cd + rr * Math.sin(t) });
  }
  return out;
}

class Builder {
  readonly out: BathSolid[] = [];
  box(part: BathPart, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number): void {
    if (s1 - s0 > 1e-6 && d1 - d0 > 1e-6 && y1 - y0 > 1e-6) this.out.push({ type: 'box', part, s0, s1, d0, d1, y0, y1 });
  }
  log(part: BathPart, a: Local3, b: Local3, diameter: number): void {
    if (Math.hypot(b.s - a.s, b.d - a.d, b.y - a.y) > 1e-6 && diameter > 1e-6) this.out.push({ type: 'log', part, a, b, diameter });
  }
  prism(part: BathPart, ring: Pt[], y0: number, y1: number, holes: Pt[][] = []): void {
    if (ring.length >= 3 && y1 - y0 > 1e-6) this.out.push({ type: 'prism', part, ring, holes, y0, y1 });
  }
  /** A tap's spout: a riser from the deck at (s, d) up `rise`, then a spout `reach` toward the front. */
  tap(s: number, d: number, deck: number, rise: number, reach: number): void {
    this.log('chrome', P(s, d, deck), P(s, d, deck + rise), 1.25);
    this.log('chrome', P(s, d, deck + rise - 0.5), P(s, d + reach, deck + rise - 0.5), 0.9);
  }
}

interface Dims {
  hw: number;
  D: number;
  y0: number;
  y1: number;
  f: Fixture;
}

function bathtub(b: Builder, x: Dims): void {
  const H = x.y1 - x.y0;
  const bottom = x.y0 + Math.min(TUB.floor + 0.5, H * 0.25);
  if (variantOf(x.f) === 'freestanding') {
    // An oval tub on a recessed plinth, its floor filler beside the end at s < 0.
    const rs = x.hw;
    const rd = x.D / 2;
    const wall = Math.min(TUB.wall - 0.5, rs / 6, rd / 4);
    b.prism('body', ellipse(0, rd, rs * 0.85, rd * 0.78), x.y0, x.y0 + Math.min(2, H / 8));
    b.prism('body', ellipse(0, rd, rs * 0.96, rd * 0.94), x.y0 + Math.min(2, H / 8), bottom);
    b.prism('body', ellipse(0, rd, rs, rd), bottom, x.y1, [ellipse(0, rd, rs - wall, rd - wall)]);
    b.log('chrome', P(-rs + wall + 4, rd, bottom), P(-rs + wall + 4, rd, bottom + 0.25), 2);
    const fs = -x.hw + 1.5;
    const fd = Math.min(2.5, x.D / 6);
    b.log('chrome', P(fs, fd, x.y0), P(fs, fd, x.y1 + 10), 1.5);
    b.log('chrome', P(fs, fd, x.y1 + 9.5), P(fs + 5, fd + 4, x.y1 + 9.5), 1);
    return;
  }
  // An alcove tub: an apron and rim round a rounded basin, the taps on the end wall at s < 0.
  const t = Math.min(TUB.wall, x.D / 6, x.hw / 6);
  b.box('body', -x.hw, x.hw, 0, x.D, x.y0, bottom);
  const rect: Pt[] = [
    { s: -x.hw, d: 0 },
    { s: x.hw, d: 0 },
    { s: x.hw, d: x.D },
    { s: -x.hw, d: x.D },
  ];
  // The basin: wider at the back rest's end (s > 0) than at the drain end.
  b.prism('body', rect, bottom, x.y1, [roundedRect(-x.hw + t, x.hw - t * 1.6, t, x.D - t, Math.min(6, x.D / 4))]);
  b.log('chrome', P(-x.hw + t + 4, x.D / 2, bottom), P(-x.hw + t + 4, x.D / 2, bottom + 0.25), 2);
  b.log('chrome', P(-x.hw, x.D / 2, x.y1 + 5), P(-x.hw + 6, x.D / 2, x.y1 + 5), 1.25);
  b.log('chrome', P(-x.hw, x.D / 2, x.y1 + 16), P(-x.hw + 0.5, x.D / 2, x.y1 + 16), 6);
  b.log('chrome', P(-x.hw + 0.5, x.D / 2, x.y1 + 16), P(-x.hw + 3, x.D / 2, x.y1 + 16), 1);
}

/** The base of a shower: a tray's top, or a curbless floor's. */
export const showerBase = (f: Pick<Fixture, 'kind' | 'variant' | 'height'>): number => Math.min(variantOf(f) === 'curbless' ? SHOWER.curbless : SHOWER.tray, f.height);

function shower(b: Builder, x: Dims): void {
  const H = x.y1 - x.y0;
  const bh = showerBase(x.f);
  const top = x.y0 + bh;
  const curbless = variantOf(x.f) === 'curbless';
  if (curbless) {
    // A tiled floor, a linear drain along the back wall.
    b.box('body', -x.hw, x.hw, 0, x.D, x.y0, top);
    b.box('chrome', -x.hw + Math.min(4, x.hw / 3), x.hw - Math.min(4, x.hw / 3), Math.min(2, x.D / 8), Math.min(4.5, x.D / 4), top, top + 0.125);
  } else {
    // A tray with a raised rim and a round drain in the middle.
    const rim = Math.min(1.5, x.hw / 6, x.D / 6);
    b.box('body', -x.hw, x.hw, 0, x.D, x.y0, top - 0.5);
    b.prism('body', [{ s: -x.hw, d: 0 }, { s: x.hw, d: 0 }, { s: x.hw, d: x.D }, { s: -x.hw, d: x.D }], top - 0.5, top, [roundedRect(-x.hw + rim, x.hw - rim, rim, x.D - rim, 2)]);
    b.log('chrome', P(0, x.D / 2, top - 0.5), P(0, x.D / 2, top - 0.375), 3);
  }
  // The valve on the back wall and the head over the middle of the back on an arm.
  const head = x.y0 + SHOWER.head;
  const arm = Math.min(8, x.D / 2);
  b.log('chrome', P(0, 0, x.y0 + 48), P(0, 0.5, x.y0 + 48), 6);
  b.log('chrome', P(0, 0.5, x.y0 + 48), P(0, 3, x.y0 + 48), 1);
  b.log('chrome', P(0, 0, head), P(0, arm, head), 0.75);
  b.log('chrome', P(0, arm, head - 0.75), P(0, arm, head), Math.min(8, 2 * arm, x.hw * 2 - 1));
  // Glass sides on a chrome channel, from the base to the shower's height.
  const g = SHOWER.glass;
  const glass = glassOf(x.f);
  const g0 = top + 0.75;
  if (x.y1 - g0 < 6) return;
  const panel = (s0: number, s1: number, d0: number, d1: number) => {
    b.box('chrome', s0, s1, d0, d1, top, g0);
    b.box('glass', s0, s1, d0, d1, g0, x.y1);
  };
  const ends = { left: glass.left ? g : 0, right: glass.right ? g : 0 };
  if (glass.front) {
    // A fixed panel and a door the other half, a pull on the door by the join.
    const mid = 0;
    panel(-x.hw + ends.left, mid - 0.125, x.D - g, x.D);
    panel(mid + 0.125, x.hw - ends.right, x.D - g, x.D);
    if (x.hw > 6 && H > 54) b.log('chrome', P(mid + 3, x.D - g - 0.75, x.y0 + 36), P(mid + 3, x.D - g - 0.75, x.y0 + 50), 0.75);
  }
  const back = 0;
  const front = glass.front ? x.D - g : x.D;
  if (glass.left) panel(-x.hw, -x.hw + g, back, front);
  if (glass.right) panel(x.hw - g, x.hw, back, front);
}

function showerGlass(b: Builder, x: Dims): void {
  const channel = Math.min(1, (x.y1 - x.y0) / 10);
  b.box('chrome', -x.hw, x.hw, 0, x.D, x.y0, x.y0 + channel);
  b.box('glass', -x.hw, x.hw, 0, x.D, x.y0 + channel, x.y1);
}

/** A toilet's tank depth and its bowl's ellipse (centre and half-axes) in its frame. */
export function toiletLayout(f: Pick<Fixture, 'width' | 'depth' | 'height'>): { tank: number; tankHalf: number; cd: number; rs: number; rd: number; rim: number } {
  const tank = Math.min(TOILET.tank, f.depth * 0.35);
  const tankHalf = Math.min(f.width / 2, 10);
  const rd = (f.depth - tank + 1.5) / 2;
  return { tank, tankHalf, cd: f.depth - rd, rs: Math.min(f.width / 2, 7.5), rd, rim: Math.min(TOILET.rim, f.height * 0.55) };
}

function toilet(b: Builder, x: Dims): void {
  const t = toiletLayout(x.f);
  const rim = x.y0 + t.rim;
  // The tank against the wall, its lid and the flush lever on its front at s < 0.
  b.box('body', -t.tankHalf + 0.5, t.tankHalf - 0.5, 0.5, t.tank, rim - 1, x.y1 - 1);
  b.box('body', -t.tankHalf, t.tankHalf, 0, t.tank + 0.25, x.y1 - 1, x.y1);
  b.box('chrome', -t.tankHalf + 1.5, -t.tankHalf + 4, t.tank, Math.min(x.D, t.tank + 0.6), x.y1 - 4, x.y1 - 3.25);
  // The supply line from the wall.
  b.log('chrome', P(-t.tankHalf * 0.6, 0, x.y0 + 7), P(-t.tankHalf * 0.6, 2, x.y0 + 7), 1);
  // The pedestal, the bowl (an open oval) and the seat on its rim.
  b.prism('body', ellipse(0, t.cd - t.rd * 0.15, t.rs * 0.6, t.rd * 0.62), x.y0, rim - 4);
  const wall = Math.min(1.75, t.rs / 3);
  b.prism('body', ellipse(0, t.cd, t.rs - wall, t.rd - wall), rim - 5, rim - 4.5);
  b.prism('body', ellipse(0, t.cd, t.rs, t.rd), rim - 4.5, rim, [ellipse(0, t.cd, t.rs - wall, t.rd - wall)]);
  b.prism('body', ellipse(0, t.cd, t.rs, t.rd), rim, rim + 0.75, [ellipse(0, t.cd + 0.5, t.rs - 2.5, t.rd - 3.25)]);
  // The seat's hinges.
  for (const s of [-t.rs * 0.55, t.rs * 0.55]) b.box('chrome', s - 0.75, s + 0.75, t.tank + 0.25, t.tank + 1.5, rim + 0.75, rim + 1.25);
}

function vanity(b: Builder, x: Dims): void {
  // The cabinet is casework (derive/casework.ts fixtureBoxes); here the undermount basins under the
  // counter's holes and a tap behind each.
  const top = counterTopOf(x.f);
  for (const r of vanityBasinsLocal(x.f)) {
    const bottom = top - VANITY_BASIN.deep;
    const w = VANITY_BASIN.wall;
    const outer = roundedRect(r.s0, r.s1, r.d0, r.d1, 2.5);
    b.prism('body', outer, bottom, bottom + w);
    b.prism('body', outer, bottom + w, top, [roundedRect(r.s0 + w, r.s1 - w, r.d0 + w, r.d1 - w, 2)]);
    b.log('chrome', P((r.s0 + r.s1) / 2, (r.d0 + r.d1) / 2, bottom + w), P((r.s0 + r.s1) / 2, (r.d0 + r.d1) / 2, bottom + w + 0.2), 1.5);
    const c = (r.s0 + r.s1) / 2;
    const d = Math.max(1, r.d0 - 2.5);
    b.tap(c, d, top, 7, 4);
    for (const s of [c - 4, c + 4]) b.log('chrome', P(s, d, top), P(s, d, top + 2.5), 1.25);
  }
}

function basin(b: Builder, x: Dims): void {
  const bowl = Math.min(6, (x.y1 - x.y0) / 3);
  const cd = x.D * 0.55;
  const rs = Math.max(1, x.hw - 2.5);
  const rd = Math.max(1, Math.min(x.D * 0.35, x.D - cd - 1.5));
  b.prism('body', roundedRect(-x.hw, x.hw, 0, x.D, Math.min(4, x.D / 3)), x.y1 - bowl, x.y1, [ellipse(0, cd, rs, rd)]);
  b.prism('body', ellipse(0, cd, rs, rd), x.y1 - bowl, x.y1 - bowl + 0.75);
  b.log('chrome', P(0, cd, x.y1 - bowl + 0.75), P(0, cd, x.y1 - bowl + 0.95), 1.5);
  b.tap(0, Math.min(2.5, cd - rd - 0.5), x.y1, 5, Math.min(4, rd));
  if (variantOf(x.f) === 'wallHung') {
    // The trap under it, back into the wall.
    const ty = Math.max(x.y0, x.y1 - bowl - 10);
    b.log('chrome', P(0, cd * 0.8, ty), P(0, cd * 0.8, x.y1 - bowl), 1.5);
    b.log('chrome', P(0, 0, ty), P(0, cd * 0.8, ty), 1.5);
  } else {
    // A pedestal: an oval column on a wider foot.
    const pd = Math.min(cd, x.D / 2);
    b.prism('body', ellipse(0, pd, Math.min(4.5, x.hw * 0.4), Math.min(3.5, x.D * 0.25)), x.y0, x.y0 + 1.5);
    b.prism('body', ellipse(0, pd, Math.min(3.5, x.hw * 0.3), Math.min(2.75, x.D * 0.2)), x.y0 + 1.5, x.y1 - bowl);
  }
}

/** A front-load washer or dryer: the cabinet, a round door low on its front, a control strip along the top. */
function laundry(b: Builder, x: Dims, washer: boolean): void {
  const H = x.y1 - x.y0;
  const face = x.D - 0.5;
  b.box('body', -x.hw, x.hw, 0, face, x.y0, x.y1);
  const panel = Math.min(7, H / 5);
  // Control strip: a dark display in the middle, a chrome dial at s > 0; a washer's drawer at s < 0.
  b.box('dark', -Math.min(4, x.hw / 3), Math.min(4, x.hw / 3), face, x.D, x.y1 - panel + 1.5, x.y1 - 1.5);
  b.log('chrome', P(x.hw - Math.min(5, x.hw / 3), face, x.y1 - panel / 2), P(x.hw - Math.min(5, x.hw / 3), x.D, x.y1 - panel / 2), Math.min(3, panel - 2));
  if (washer) b.box('body', -x.hw + 1.5, -x.hw + Math.min(10, x.hw * 0.6), face, x.D, x.y1 - panel + 1.5, x.y1 - 1.5);
  // The door.
  const r = Math.max(1, Math.min(x.hw - 2.5, (H - panel - 4) / 2));
  const yc = x.y0 + 2 + (H - panel - 2) / 2;
  if (washer) {
    b.log('chrome', P(0, face, yc), P(0, x.D - 0.2, yc), 2 * r);
    b.log('dark', P(0, x.D - 0.2, yc), P(0, x.D, yc), 2 * r - 3);
  } else {
    b.log('body', P(0, face, yc), P(0, x.D - 0.2, yc), 2 * r);
    b.log('dark', P(0, x.D - 0.2, yc), P(0, x.D, yc), 2 * r * 0.6);
    b.box('chrome', r * 0.55, r * 0.55 + 1, x.D - 0.2, x.D, yc - 3, yc + 3);
  }
}

function waterHeater(b: Builder, x: Dims): void {
  const dia = Math.max(1, Math.min(2 * x.hw, x.D) - 0.5);
  const c = { s: 0, d: x.D / 2 };
  const H = x.y1 - x.y0;
  b.box('dark', -dia / 2, dia / 2, c.d - dia / 2, c.d + dia / 2, x.y0, x.y0 + Math.min(1, H / 20));
  b.log('body', P(c.s, c.d, x.y0 + Math.min(1, H / 20)), P(c.s, c.d, x.y1 - 2), dia);
  b.log('body', P(c.s, c.d, x.y1 - 2), P(c.s, c.d, x.y1 - 1), dia * 0.92);
  b.log('chrome', P(c.s, c.d, x.y1 - 1), P(c.s, c.d, x.y1), Math.min(3, dia / 4));
  for (const s of [-dia * 0.3, dia * 0.3]) b.log('chrome', P(s, c.d, x.y1 - 1.5), P(s, c.d, x.y1), 1);
  // The relief valve on its side, toward the front.
  b.log('chrome', P(dia * 0.35, c.d + dia * 0.35, x.y1 - 8), P(dia * 0.42, c.d + dia * 0.42, x.y1 - 8), 1.5);
}

/** The solids of a bath or laundry fixture in its own frame (empty for any other kind). */
export function bathSolids(f: Fixture): BathSolid[] {
  if (!isBath(f.kind)) return [];
  const b = new Builder();
  const x: Dims = { hw: f.width / 2, D: f.depth, y0: f.elevation, y1: f.elevation + f.height, f };
  switch (f.kind) {
    case 'bathtub':
      bathtub(b, x);
      break;
    case 'shower':
      shower(b, x);
      break;
    case 'showerGlass':
      showerGlass(b, x);
      break;
    case 'toilet':
      toilet(b, x);
      break;
    case 'vanity':
      vanity(b, x);
      break;
    case 'basin':
      basin(b, x);
      break;
    case 'washer':
      laundry(b, x, true);
      break;
    case 'dryer':
      laundry(b, x, false);
      break;
    case 'waterHeater':
      waterHeater(b, x);
      break;
  }
  return b.out;
}

// ---------------------------------------------------------------------------------------------
// Plan symbol detail

/**
 * The plan detail of a bath fixture, drawn thin inside its outline like furniture's: a tub's basin
 * and drain, a shower's cross and drain and its glass, a toilet's tank and bowl, a vanity's basins,
 * a basin's bowl, a water heater's tank. The washer and dryer carry a word (model/casework.ts
 * FIXTURE_PLAN_LABEL) and a line along their front.
 */
export function bathSymbol(f: Fixture): FurnitureSymbol {
  const out: FurnitureSymbol = { lines: [], rects: [], circles: [] };
  if (!isBath(f.kind)) return out;
  const fr = fixtureFrame(f);
  const pt = (s: number, d: number): Vec2 => fixturePoint(fr, s, d);
  const ring = (r: Pt[]) => out.rects.push(r.map((p) => pt(p.s, p.d)));
  const line = (s0: number, d0: number, s1: number, d1: number) => out.lines.push([pt(s0, d0), pt(s1, d1)]);
  const hw = f.width / 2;
  const D = f.depth;
  switch (f.kind) {
    case 'bathtub':
      if (variantOf(f) === 'freestanding') {
        const wall = Math.min(TUB.wall - 0.5, hw / 6, D / 8);
        ring(ellipse(0, D / 2, hw, D / 2, 32));
        ring(ellipse(0, D / 2, hw - wall, D / 2 - wall, 32));
        out.circles.push({ at: pt(-hw + wall + 4, D / 2), r: 1 });
        out.circles.push({ at: pt(-hw + 1.5, Math.min(2.5, D / 6)), r: 0.75 });
      } else {
        const t = Math.min(TUB.wall, D / 6, hw / 6);
        ring(roundedRect(-hw + t, hw - t * 1.6, t, D - t, Math.min(6, D / 4), 4));
        out.circles.push({ at: pt(-hw + t + 4, D / 2), r: 1 });
      }
      break;
    case 'shower': {
      const g = glassOf(f);
      // The tray's cross (corner to corner), the drain where it meets.
      line(-hw, 0, hw, D);
      line(-hw, D, hw, 0);
      if (variantOf(f) === 'curbless') line(-hw + Math.min(4, hw / 3), Math.min(3, D / 6), hw - Math.min(4, hw / 3), Math.min(3, D / 6));
      else out.circles.push({ at: pt(0, D / 2), r: 1.5 });
      const k = 1.5;
      if (g.front) out.rects.push([pt(-hw, D - k), pt(hw, D - k), pt(hw, D), pt(-hw, D)]);
      if (g.left) out.rects.push([pt(-hw, 0), pt(-hw + k, 0), pt(-hw + k, D), pt(-hw, D)]);
      if (g.right) out.rects.push([pt(hw - k, 0), pt(hw, 0), pt(hw, D), pt(hw - k, D)]);
      break;
    }
    case 'toilet': {
      const t = toiletLayout(f);
      out.rects.push([pt(-t.tankHalf, 0), pt(t.tankHalf, 0), pt(t.tankHalf, t.tank), pt(-t.tankHalf, t.tank)]);
      ring(ellipse(0, t.cd, t.rs, t.rd, 32));
      ring(ellipse(0, t.cd + 0.5, t.rs - 2.5, t.rd - 3.25, 32));
      break;
    }
    case 'vanity':
      for (const r of vanityBasinsLocal(f)) {
        ring(ellipse((r.s0 + r.s1) / 2, (r.d0 + r.d1) / 2, (r.s1 - r.s0) / 2, (r.d1 - r.d0) / 2, 28));
        out.circles.push({ at: pt((r.s0 + r.s1) / 2, Math.max(1, r.d0 - 2.5)), r: 0.75 });
      }
      break;
    case 'basin': {
      const cd = D * 0.55;
      ring(ellipse(0, cd, Math.max(1, hw - 2.5), Math.max(1, Math.min(D * 0.35, D - cd - 1.5)), 28));
      out.circles.push({ at: pt(0, Math.min(2.5, cd - 1)), r: 0.75 });
      break;
    }
    case 'washer':
    case 'dryer':
      // The front panel's line.
      line(-hw + 1.5, D - 1.5, hw - 1.5, D - 1.5);
      break;
    case 'waterHeater':
      out.circles.push({ at: pt(0, D / 2), r: Math.max(1, Math.min(2 * hw, D) - 0.5) / 2 });
      break;
    default:
      break;
  }
  return out;
}
