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

// The interval an opening may occupy (the wall's core interval between corner joins) and jamb
// distances measured from it live in derive/openings.ts: they need the mitered footprints.
