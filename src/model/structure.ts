// Structure (DESIGN.md "Structure"): the joists over a level, the beams and posts that carry what
// a removed wall carried, and the footings under the posts. The sizes here are placeholders for the
// engineer to set: the tool draws and checks the load path, it does not size anything.

import type { Beam, Degrees, JoistZone, LevelFraming, Member, Post, Vec2 } from './types';

const isPoint = (v: unknown): v is Vec2 =>
  typeof v === 'object' && v !== null && Number.isFinite((v as Vec2).x) && Number.isFinite((v as Vec2).y);

/** Defaults for new members: a flush beam of two 1 3/4" x 11 7/8" LVLs, a 6x6 post, a 24" x 12" footing. */
export const MEMBER_DEFAULTS = {
  beam: { width: 3.5, depth: 11.875, mount: 'flush' as Beam['mount'], label: '(2) 1 3/4 x 11 7/8 LVL' },
  post: { width: 5.5, depth: 5.5, label: '6x6' },
  footing: { width: 24, thickness: 12 },
} as const;

/** Structure in 3D: LVL beams and posts as pale wood, footings as concrete. */
export const MEMBER_COLOR = { beam: '#d6b98c', post: '#c8a678', footing: '#a8a29e' } as const;

/** The depth of an attic's ceiling joists, where there is no floor above to take it from. */
export const ATTIC_JOIST_DEPTH = 5.5;

/** A joist axis in [0, 180). */
export const normalizeJoists = (deg: Degrees): Degrees => ((deg % 180) + 180) % 180;

/** "N-S" / "E-W" / "37°": the joists' axis in words (plan up is north at north angle 0). */
export function joistWords(deg: Degrees, northAngle = 0): string {
  const d = normalizeJoists(deg - northAngle);
  if (Math.abs(d - 90) < 0.5) return 'north-south';
  if (d < 0.5 || d > 179.5) return 'east-west';
  return `${Math.round(d)}°`;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A height over the floor a timber may be set to, inches. */
const settable = (v: unknown): v is number => finite(v) && v >= -600 && v <= 1200;
const positive = (v: unknown, max = 600): v is number => finite(v) && v > 0 && v <= max;

/** Why a level's framing cannot be used, or null. */
export function framingProblem(f: Partial<LevelFraming>): string | null {
  if (!finite(f.joists)) return 'the joists need a direction';
  if (f.depth !== undefined && !positive(f.depth, 48)) return 'the joist depth must be from 0" to 48"';
  return null;
}

/** Why a joist zone cannot be used, or null. */
export function joistZoneProblem(z: Partial<JoistZone>): string | null {
  if (!Array.isArray(z.outline) || z.outline.length < 3 || !z.outline.every(isPoint)) return 'needs an outline of at least 3 points';
  if (!finite(z.joists)) return 'the joists need a direction';
  return null;
}

/** Why a beam or post cannot be used, or null; `lowest`: whether its level is the lowest (footings). */
export function memberProblem(m: Partial<Beam> | Partial<Post>, lowest: boolean): string | null {
  if (m.kind === 'beam') {
    const b = m as Partial<Beam>;
    if (!isPoint(b.a) || !isPoint(b.b)) return 'needs two ends';
    if (Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) < 1) return 'must be at least 1" long';
    if (!positive(b.width, 48) || !positive(b.depth, 48)) return 'width and depth must be from 0" to 48"';
    if (b.mount !== 'flush' && b.mount !== 'dropped') return 'is flush or dropped';
    if (b.label !== undefined && typeof b.label !== 'string') return 'the label must be text';
    if ((b.za !== undefined || b.zb !== undefined) && !(settable(b.za) && settable(b.zb))) return 'a timber needs its top at both ends';
    if (b.color !== undefined && !(typeof b.color === 'string' && HEX.test(b.color))) return 'the colour must be a hex colour';
    return null;
  }
  if (m.kind === 'post') {
    const p = m as Partial<Post>;
    if (!isPoint(p.at)) return 'needs a position';
    if (!positive(p.width, 48) || !positive(p.depth, 48)) return 'width and depth must be from 0" to 48"';
    if (!finite(p.rotation)) return 'needs a rotation';
    if (p.label !== undefined && typeof p.label !== 'string') return 'the label must be text';
    if ((p.base !== undefined || p.top !== undefined) && !(settable(p.base) && settable(p.top) && p.top > p.base)) return 'a timber post needs a base under its top';
    if (p.color !== undefined && !(typeof p.color === 'string' && HEX.test(p.color))) return 'the colour must be a hex colour';
    if (p.footing !== undefined) {
      if (!lowest) return 'only a post on the lowest level stands on a footing';
      if (!positive(p.footing.width, 120) || !positive(p.footing.thickness, 60)) return 'the footing needs a width and a thickness';
    }
    return null;
  }
  return 'is a beam or a post';
}

/** A beam or post at set heights (a timber): drawn as set, not followed by the structure checks. */
export const isTimber = (m: Member): boolean => (m.kind === 'beam' ? m.za !== undefined : m.base !== undefined);

/** A beam's or post's plan points (to move it). */
export const memberPoints = (m: Member): Vec2[] => (m.kind === 'beam' ? [m.a, m.b] : [m.at]);

