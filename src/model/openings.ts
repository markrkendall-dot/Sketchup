import type { Opening } from './types';

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

/**
 * Clamp an opening center to the wall's core interval: [s0 + w/2, s1 - w/2]. When the opening is
 * wider than the interval it sits centered on it.
 */
export function clampOpeningOffset(offset: number, width: number, s0: number, s1: number): number {
  const half = width / 2;
  if (s1 - s0 <= width) return (s0 + s1) / 2;
  return Math.min(Math.max(offset, s0 + half), s1 - half);
}

/**
 * The interval along a wall's centerline that openings may occupy, as computed in the store.
 * M2: the whole centerline, matching the square-cap footprints (s0 = 0, s1 = L).
 * TODO(M3): use the mitred footprint's s0/s1 once corner joins exist.
 */
export function openingInterval(length: number): [number, number] {
  return [0, length];
}

/** Distances from each wall end (node) to the nearer jamb of an opening. */
export function jambDistances(offset: number, width: number, length: number): { fromA: number; fromB: number } {
  return { fromA: offset - width / 2, fromB: length - (offset + width / 2) };
}
