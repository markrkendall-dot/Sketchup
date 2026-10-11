import type { Level, Opening, Wall } from './types';

export type OpeningType = Opening['type'];

export interface OpeningDefaults {
  width: number;
  height: number;
  sill: number;
}

export const OPENING_DEFAULTS: Record<OpeningType, OpeningDefaults> = {
  door: { width: 36, height: 80, sill: 0 },
  window: { width: 36, height: 48, sill: 36 },
  passage: { width: 48, height: 80, sill: 0 },
};

export const OPENING_LABEL: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  passage: 'Passage',
};

/** Height of a wall's openings' ceiling: its own override, else the level's wall height. */
export function wallHeightOf(level: Pick<Level, 'wallHeight'>, wall: Pick<Wall, 'heightOverride'>): number {
  return wall.heightOverride ?? level.wallHeight;
}

/** True when sill + height fits under the wall height (a hair of float noise is allowed). */
export function openingFitsHeight(o: Pick<Opening, 'sill' | 'height'>, wallHeight: number): boolean {
  return o.sill + o.height <= wallHeight + 1e-9;
}

/** Shortest opening the clamp below leaves when a wall is lowered. */
const MIN_CLAMPED_HEIGHT = 12;

/**
 * Pull an opening under a lowered wall: shorten it above its sill, or when the sill is within
 * MIN_CLAMPED_HEIGHT of the top (or above it) keep its height as far as it fits and drop the sill.
 * Returns true when it changed the opening.
 */
export function clampOpeningHeight(o: Pick<Opening, 'sill' | 'height'>, wallHeight: number): boolean {
  if (openingFitsHeight(o, wallHeight)) return false;
  if (o.sill <= wallHeight - MIN_CLAMPED_HEIGHT) {
    o.height = wallHeight - o.sill;
  } else {
    o.height = Math.min(o.height, wallHeight);
    o.sill = wallHeight - o.height;
  }
  return true;
}

/**
 * Clamp an opening center to the wall's core interval: [s0 + w/2, s1 - w/2]. When the opening is
 * wider than the interval it sits centered on it.
 */
export function clampOpeningOffset(offset: number, width: number, s0: number, s1: number): number {
  const half = width / 2;
  if (s1 - s0 <= width) return (s0 + s1) / 2;
  return Math.min(Math.max(offset, s0 + half), s1 - half);
}

// The interval an opening may occupy (the wall's core interval between corner joins) and jamb
// distances measured from it live in derive/openings.ts: they need the mitered footprints.
