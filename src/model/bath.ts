import type { BathVariant, Fixture, FixtureKind } from './types';

// Bath and laundry fixtures (DESIGN.md "Bath and laundry"): kinds of fixture like the kitchen's
// appliances, placed by the Cabinet tool and shown like casework (never on the furniture layer).
// Pure data shared by the tool, the panel, the geometry (derive/bath.ts), the materials and the
// loader's validation.

/** The bath and laundry kinds, in the order the Cabinet tool offers them. */
export const BATH_KINDS: readonly FixtureKind[] = ['bathtub', 'shower', 'showerGlass', 'toilet', 'vanity', 'basin', 'washer', 'dryer', 'waterHeater'];
export const isBath = (kind: FixtureKind): boolean => BATH_KINDS.includes(kind);

/** The forms a kind comes in, its default first; kinds not listed have none. */
export const VARIANTS: Partial<Record<FixtureKind, readonly BathVariant[]>> = {
  bathtub: ['alcove', 'freestanding'],
  shower: ['tray', 'curbless'],
  basin: ['pedestal', 'wallHung'],
};
export const VARIANT_LABEL: Record<BathVariant, string> = {
  alcove: 'Alcove (between walls)',
  freestanding: 'Freestanding (oval)',
  tray: 'On a tray',
  curbless: 'Curbless (tiled floor)',
  pedestal: 'Pedestal',
  wallHung: 'Wall-hung',
};
export const isVariantOf = (kind: FixtureKind, v: unknown): v is BathVariant => typeof v === 'string' && (VARIANTS[kind] ?? []).includes(v as BathVariant);
/** The fixture's form: its own, else its kind's default (null for a kind without forms). */
export const variantOf = (f: Pick<Fixture, 'kind' | 'variant'>): BathVariant | null => {
  const list = VARIANTS[f.kind];
  if (!list) return null;
  return f.variant && list.includes(f.variant) ? f.variant : list[0];
};

/** A shower's glass sides, each false when absent. */
export const glassOf = (f: Pick<Fixture, 'glass'>): { front: boolean; left: boolean; right: boolean } => ({
  front: !!f.glass?.front,
  left: !!f.glass?.left,
  right: !!f.glass?.right,
});

/** What the Cabinet tool places with a kind besides its stock size: a shower with a glass front. */
export const BATH_STOCK_EXTRA: Partial<Record<FixtureKind, Partial<Fixture>>> = { shower: { glass: { front: true } } };

/** Vitreous china and enamel: white. Laundry appliances are white enamel too. */
export const CERAMIC_WHITE = '#f4f3ef';
/** Shower glass: clear, faintly green at its edges. */
export const SHOWER_GLASS_COLOR = '#b9d3cf';
/** Taps, spouts, shower heads, drains, door rims: polished chrome. */
export const CHROME_COLOR = '#c9ccd0';

/**
 * The colour a bath fixture's body is drawn in: its front colour (a tub, a toilet, a washer in
 * another colour), else white. A vanity's fronts follow the cabinet colours instead; its basins are
 * always white (bathBodyColorOf).
 */
export const bathBodyColorOf = (f: Pick<Fixture, 'kind' | 'frontColor'>): string => (f.kind === 'vanity' ? CERAMIC_WHITE : (f.frontColor ?? CERAMIC_WHITE));

/** Tub, shower tray and basin dimensions: rim and wall thickness, how deep the basin is. */
export const TUB = { wall: 3, floor: 2.5, oval: 28 } as const;
export const SHOWER = { tray: 3, curbless: 0.5, glass: 0.375, head: 80 } as const;
/** A toilet's tank depth and its bowl's rim height. */
export const TOILET = { tank: 8.5, rim: 15 } as const;
/** A vanity basin (undermount): its rectangle in the counter and its depth; a double vanity from 60". */
export const VANITY_BASIN = { width: 17, depth: 13, deep: 6, wall: 0.5, double: 60 } as const;
