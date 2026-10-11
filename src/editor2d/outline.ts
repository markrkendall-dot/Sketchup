import type { Vec2 } from '../model/types';

type Seg = readonly [Vec2, Vec2];

/** Remove vertices lying on the straight line between their neighbours (joints of split walls). */
function dropCollinear(line: Vec2[], closed: boolean): Vec2[] {
  const out = [...line];
  for (let i = closed ? 0 : 1; out.length > (closed ? 3 : 2) && i < (closed ? out.length : out.length - 1); ) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const len = Math.hypot(abx, aby) * Math.hypot(bcx, bcy);
    // Same direction (not a U-turn) and no measurable bend.
    if (len > 0 && Math.abs(abx * bcy - aby * bcx) <= 1e-9 * len && abx * bcx + aby * bcy > 0) out.splice(i, 1);
    else i++;
  }
  return out;
}

const key = (p: Vec2) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;

/**
 * Chain segments that share endpoints into polylines (closed ones end with Z) and return them as
 * one SVG path. A browser strokes separate segments independently, so two segments meeting end to
 * end double-cover (or under-cover) the joint pixel, which shows as a dot on a straight wall face
 * split by a T and as a nicked corner. Chained, the joint is a proper line join.
 */
export function outlinePath(segs: readonly Seg[]): string {
  // Endpoint keys are computed once per segment; `at` maps a key to the segments touching it.
  const keys: string[] = new Array(segs.length * 2);
  const at = new Map<string, number[]>();
  segs.forEach(([p, q], i) => {
    keys[2 * i] = key(p);
    keys[2 * i + 1] = key(q);
    for (const k of [keys[2 * i], keys[2 * i + 1]]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  /** Unused segment touching the point with key k: its far end and that end's key. */
  const nextFrom = (k: string): [Vec2, string] | null => {
    for (const i of at.get(k) ?? []) {
      if (used[i]) continue;
      used[i] = 1;
      return keys[2 * i] === k ? [segs[i][1], keys[2 * i + 1]] : [segs[i][0], keys[2 * i]];
    }
    return null;
  };
  const pt = (p: Vec2) => `${p.x},${p.y}`;
  let d = '';
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd: Vec2[] = [segs[i][0], segs[i][1]];
    const startKey = keys[2 * i];
    let endKey = keys[2 * i + 1];
    for (let n = nextFrom(endKey); n; n = nextFrom(n[1])) {
      fwd.push(n[0]);
      endKey = n[1];
    }
    const closed = fwd.length > 2 && startKey === endKey;
    let line = fwd;
    if (!closed) {
      // Extend backwards from the first point, collected in reverse and prepended once.
      const back: Vec2[] = [];
      for (let n = nextFrom(startKey); n; n = nextFrom(n[1])) back.push(n[0]);
      if (back.length) line = [...back.reverse(), ...fwd];
    } else line.pop();
    const pts = dropCollinear(line, closed);
    d += `M${pts.map(pt).join('L')}${closed ? 'Z' : ''}`;
  }
  return d;
}
