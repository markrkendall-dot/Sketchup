// A staircase's style (types.ts Staircase): the defaults of its optional fields, and what the store
// and migrate() accept.

import { isHexColor } from './finish';
import type { Inches, Staircase, StairHandrail, StairNewel, StairStartStep, StairStringer, StairUnderside } from './types';

export const STAIR_STRINGERS: readonly StairStringer[] = ['closed', 'open'];
export const STAIR_UNDERSIDES: readonly StairUnderside[] = ['solid', 'framed', 'open'];
export const STAIR_NEWELS: readonly StairNewel[] = ['box', 'square'];
export const STAIR_HANDRAILS: readonly StairHandrail[] = ['round', 'board'];
export const STAIR_START_STEPS: readonly StairStartStep[] = ['square', 'bullnose'];

/** A staircase's style with every field filled in. */
export interface StairStyle {
  treadColor: string;
  riserColor: string;
  nosing: Inches;
  treadThickness: Inches;
  stringer: StairStringer;
  underside: StairUnderside;
  newel: StairNewel;
  handrail: StairHandrail;
  handrailHeight: Inches;
  balusterGap: Inches;
  startStep: StairStartStep;
}

/**
 * The defaults: oak treads and rail over white risers, a 1" nosing on 1" treads, skirt boards, solid
 * underneath (as a flight on its own is drawn), 5 1/2" box newels, a 2" round rail 36" over the
 * nosings (34" to 38" and graspable, R318.7.8), balusters at most 3 3/4" apart (under the 4 3/8"
 * sphere the code allows on a stair's side) and a square first step.
 */
export const STAIR_STYLE_DEFAULTS: StairStyle = {
  treadColor: '#b5835a',
  riserColor: '#f1efe8',
  nosing: 1,
  treadThickness: 1,
  stringer: 'closed',
  underside: 'solid',
  newel: 'box',
  handrail: 'round',
  handrailHeight: 36,
  balusterGap: 3.75,
  startStep: 'square',
};

/** The ranges the style's numbers are held to. */
export const STAIR_STYLE_LIMITS = {
  nosing: { min: 0, max: 1.5 },
  treadThickness: { min: 0.75, max: 2 },
  handrailHeight: { min: 30, max: 42 },
  balusterGap: { min: 1, max: 6 },
} as const;

export const staircaseStyleOf = (sc: Partial<Staircase> | undefined): StairStyle => ({
  treadColor: sc?.treadColor ?? STAIR_STYLE_DEFAULTS.treadColor,
  riserColor: sc?.riserColor ?? STAIR_STYLE_DEFAULTS.riserColor,
  nosing: sc?.nosing ?? STAIR_STYLE_DEFAULTS.nosing,
  treadThickness: sc?.treadThickness ?? STAIR_STYLE_DEFAULTS.treadThickness,
  stringer: sc?.stringer ?? STAIR_STYLE_DEFAULTS.stringer,
  underside: sc?.underside ?? STAIR_STYLE_DEFAULTS.underside,
  newel: sc?.newel ?? STAIR_STYLE_DEFAULTS.newel,
  handrail: sc?.handrail ?? STAIR_STYLE_DEFAULTS.handrail,
  handrailHeight: sc?.handrailHeight ?? STAIR_STYLE_DEFAULTS.handrailHeight,
  balusterGap: sc?.balusterGap ?? STAIR_STYLE_DEFAULTS.balusterGap,
  startStep: sc?.startStep ?? STAIR_STYLE_DEFAULTS.startStep,
});

const inRange = (v: unknown, r: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
const oneOf = <T>(v: unknown, list: readonly T[]) => list.includes(v as T);

/** Why one style field's value cannot be used (lower case, like columnProblem), or null; undefined is fine. */
export function staircaseFieldProblem<K extends keyof Staircase>(key: K, v: Staircase[K] | undefined): string | null {
  if (v === undefined) return null;
  switch (key) {
    case 'id':
      return null;
    case 'name':
      return typeof v === 'string' ? null : 'the name must be text';
    case 'treadColor':
    case 'riserColor':
      return isHexColor(v) ? null : 'the colour must be a hex colour';
    case 'stringer':
      return oneOf(v, STAIR_STRINGERS) ? null : 'unknown stringer';
    case 'underside':
      return oneOf(v, STAIR_UNDERSIDES) ? null : 'unknown underside';
    case 'newel':
      return oneOf(v, STAIR_NEWELS) ? null : 'unknown newel';
    case 'handrail':
      return oneOf(v, STAIR_HANDRAILS) ? null : 'unknown handrail';
    case 'startStep':
      return oneOf(v, STAIR_START_STEPS) ? null : 'unknown first step';
    case 'nosing':
    case 'treadThickness':
    case 'handrailHeight':
    case 'balusterGap': {
      const r = STAIR_STYLE_LIMITS[key as keyof typeof STAIR_STYLE_LIMITS];
      return inRange(v, r) ? null : `the ${key === 'treadThickness' ? 'tread thickness' : key === 'handrailHeight' ? 'handrail height' : key === 'balusterGap' ? 'baluster gap' : 'nosing'} must be from ${r.min}" to ${r.max}"`;
    }
    default:
      return 'unknown field';
  }
}

/** The style fields of a staircase, in the panel's order. */
export const STAIRCASE_STYLE_KEYS = ['name', 'treadColor', 'riserColor', 'nosing', 'treadThickness', 'stringer', 'underside', 'newel', 'handrail', 'handrailHeight', 'balusterGap', 'startStep'] as const satisfies readonly (keyof Staircase)[];

/** Why a staircase cannot be used, or null. */
export function staircaseProblem(sc: Partial<Staircase>): string | null {
  for (const k of STAIRCASE_STYLE_KEYS) {
    const p = staircaseFieldProblem(k, sc[k]);
    if (p) return p;
  }
  return null;
}
