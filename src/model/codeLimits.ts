// The building-code numbers the checks (derive/checks.ts) hold the plan to, in one place.
//
// The house is a one- or two-family dwelling in New York State outside New York City, so the code is
// the 2025 Residential Code of New York State (part of the 2025 Uniform Code, in force since 31 Dec
// 2025), which is built on the 2024 International Residential Code with New York's amendments. The
// 2024 IRC renumbered chapter 3 (stairways R311.7 became R318.7, guards R312 became R321), so each
// entry carries both numbers. New York's 8 1/4" riser and 9" tread come from its amendment of the
// earlier IRC editions.
//
// VERIFY every number and section against the 2025 RCNYS text before relying on it: the table was
// put together from the model code and secondary sources (docs/history/PLAN-v8-stair-structure.md).

export const CODE_EDITION = '2025 Residential Code of New York State (2024 IRC with New York amendments)';

export interface CodeLimit {
  /** The number the check uses, in inches unless `unit` says otherwise. */
  value: number;
  unit: 'in' | 'risers' | 'deg';
  /** Section in the 2024 IRC numbering (the 2025 RCNYS's base). */
  ref: string;
  /** The same rule's section in the 2021 IRC and earlier New York codes. */
  refOld: string;
  /** What the rule says, in a few words. */
  text: string;
}

const limit = (value: number, ref: string, refOld: string, text: string, unit: CodeLimit['unit'] = 'in'): CodeLimit => ({ value, unit, ref, refOld, text });

export const CODE = {
  /** A walking surface more than this above the floor or grade below needs a guard. */
  guardDrop: limit(30, 'R321.1', 'R312.1.1', 'a guard where the drop is more than 30"'),
  /** The guard's height over the walking surface. */
  guardHeight: limit(36, 'R321.1.2', 'R312.1.2', 'guards at least 36" high'),
  /** On the open sides of a stair, along the nosings. */
  guardHeightStair: limit(34, 'R321.1.2', 'R312.1.2', 'guards on the open sides of a stair at least 34" over the nosings'),
  /** The largest sphere that may pass through a guard. */
  guardOpening: limit(4, 'R321.1.3', 'R312.1.3', 'openings in a guard that a 4" sphere cannot pass'),
  guardOpeningStair: limit(4.375, 'R321.1.3', 'R312.1.3', 'on the open sides of a stair, openings a 4 3/8" sphere cannot pass'),
  riserMax: limit(8.25, 'R318.7.5.1', 'R311.7.5.1', 'risers at most 8 1/4" (New York)'),
  treadMin: limit(9, 'R318.7.5.2', 'R311.7.5.2', 'treads at least 9" deep (New York)'),
  /** The most the largest riser (tread) in a flight may exceed the smallest. */
  uniformity: limit(0.375, 'R318.7.5.1', 'R311.7.5.1', 'risers and treads within 3/8" of each other in a flight'),
  headroom: limit(80, 'R318.7.2', 'R311.7.2', 'headroom at least 6\'8" over the nosings'),
  widthMin: limit(36, 'R318.7.1', 'R311.7.1', 'stairways at least 36" wide'),
  /** A flight with at least this many risers needs a handrail on one side. */
  handrailRisers: limit(4, 'R318.7.8', 'R311.7.8', 'a handrail on flights of four or more risers', 'risers'),
  handrailMin: limit(34, 'R318.7.8.1', 'R311.7.8.1', 'handrails 34" to 38" over the nosings'),
  handrailMax: limit(38, 'R318.7.8.1', 'R311.7.8.1', 'handrails 34" to 38" over the nosings'),
  /** Type I round handrail: outside diameter range. */
  gripMin: limit(1.25, 'R318.7.8.5', 'R311.7.8.5', 'a graspable handrail, 1 1/4" to 2" round (Type I)'),
  gripMax: limit(2, 'R318.7.8.5', 'R311.7.8.5', 'a graspable handrail, 1 1/4" to 2" round (Type I)'),
  /** A landing at least as wide as the stair it serves, and this deep in the direction of travel. */
  landingDepth: limit(36, 'R318.7.6', 'R311.7.6', 'landings at least as wide as the stair and 36" deep'),
  /** The most a flight may rise between floors or landings. */
  flightRiseMax: limit(151, 'R318.7.3', 'R311.7.3', 'at most 12\'7" of rise between landings'),
  nosingMin: limit(0.75, 'R318.7.5.3', 'R311.7.5.3', 'nosings 3/4" to 1 1/4" where treads are under 11"'),
  nosingMax: limit(1.25, 'R318.7.5.3', 'R311.7.5.3', 'nosings 3/4" to 1 1/4" where treads are under 11"'),
  /** A bearing wall may sit off the support below it by at most the joists' depth. */
  joistOffset: limit(0, 'R502.4', 'R502.4', 'bearing partitions within the joists\' depth of the support below'),
  bearingWood: limit(1.5, 'R502.6', 'R502.6', 'joists and beams bear at least 1 1/2" on wood or metal'),
  bearingMasonry: limit(3, 'R502.6', 'R502.6', 'and at least 3" on masonry or concrete'),
  /** Over this span a floor opening's header is doubled; over `headerHanger` it hangs on hangers. */
  headerDouble: limit(48, 'R502.10', 'R502.10', 'headers over 4\' doubled, over 6\' on hangers'),
  headerHanger: limit(72, 'R502.10', 'R502.10', 'headers over 4\' doubled, over 6\' on hangers'),
  wallHeader: limit(0, 'R602.7', 'R602.7', 'a header sized for the load over each opening in a bearing wall'),
  /** Every load carried down to the foundation. */
  loadPath: limit(0, 'R301.1', 'R301.1', 'a complete load path from the floors and roof down to the foundation'),
  footing: limit(0, 'R403.1', 'R403.1', 'posts and walls that carry loads stand on footings'),
} as const;

export type CodeKey = keyof typeof CODE;

/** "R321.1 (was R312.1.1)": a section to quote beside a check's message. */
export function codeRef(key: CodeKey): string {
  const c = CODE[key];
  return c.ref === c.refOld ? c.ref : `${c.ref} (was ${c.refOld})`;
}
