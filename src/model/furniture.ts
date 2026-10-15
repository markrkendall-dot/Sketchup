import type { FabricId, Fixture, FixtureKind, FurniturePiece, WoodId } from './types';
import type { FixtureSize } from './casework';

// The furniture catalogue (DESIGN.md "Furniture"): what each piece is, its stock size, the woods and
// fabrics it can be made in. Pure data shared by the tool, the panel, the geometry (derive/
// furniture.ts), the textures and the loader's validation. The style is the Adirondack camp's:
// peeled-log and hickory frames, cane seats, point-blanket stripes, buffalo check and plaid wool,
// Navajo and braided rugs, painted Adirondack chairs.

export type FurnitureCategory = 'Beds' | 'Storage' | 'Tables and desks' | 'Seating' | 'Rugs and lamps' | 'Outdoor';
export const FURNITURE_CATEGORIES: readonly FurnitureCategory[] = ['Beds', 'Storage', 'Tables and desks', 'Seating', 'Rugs and lamps', 'Outdoor'];

export interface FurnitureSpec {
  label: string;
  category: FurnitureCategory;
  /** Stock width (along the back) x depth x height, standing on the floor. */
  size: { width: number; depth: number; height: number };
  /** The smallest a piece's recipe still makes sense at. */
  min: { width: number; depth: number; height: number };
  wood: WoodId;
  fabric?: FabricId;
  /** Whether the piece shows a wood and a fabric (the panel offers only these). */
  uses: { wood: boolean; fabric: boolean };
  /** The tool snaps a 'wall' piece's back to a wall face; a 'free' piece is centred on the cursor. */
  placement: 'wall' | 'free';
  /** A rug: drawn under the other pieces, picked last, and other pieces may stand on it. */
  floorLayer?: boolean;
}

const spec = (s: Omit<FurnitureSpec, 'uses'> & { uses?: Partial<FurnitureSpec['uses']> }): FurnitureSpec => ({
  ...s,
  uses: { wood: s.uses?.wood ?? true, fabric: s.uses?.fabric ?? s.fabric !== undefined },
});

export const FURNITURE: Record<FurniturePiece, FurnitureSpec> = {
  bed: spec({ label: 'Bed', category: 'Beds', size: { width: 64, depth: 84, height: 46 }, min: { width: 36, depth: 72, height: 24 }, wood: 'peeledLog', fabric: 'pointBlanket', placement: 'wall' }),
  nightstand: spec({ label: 'Nightstand', category: 'Beds', size: { width: 22, depth: 18, height: 26 }, min: { width: 12, depth: 12, height: 16 }, wood: 'hickory', placement: 'wall' }),
  dresser: spec({ label: 'Dresser', category: 'Storage', size: { width: 54, depth: 20, height: 34 }, min: { width: 24, depth: 14, height: 24 }, wood: 'nordicPine', placement: 'wall' }),
  chest: spec({ label: 'Chest of drawers', category: 'Storage', size: { width: 36, depth: 20, height: 48 }, min: { width: 20, depth: 14, height: 30 }, wood: 'nordicPine', placement: 'wall' }),
  bookcase: spec({ label: 'Bookcase', category: 'Storage', size: { width: 36, depth: 12, height: 72 }, min: { width: 18, depth: 8, height: 24 }, wood: 'nordicPine', placement: 'wall' }),
  trunk: spec({ label: 'Trunk', category: 'Storage', size: { width: 40, depth: 18, height: 18 }, min: { width: 20, depth: 12, height: 12 }, wood: 'hickory', placement: 'free' }),
  desk: spec({ label: 'Desk', category: 'Tables and desks', size: { width: 48, depth: 24, height: 30 }, min: { width: 30, depth: 18, height: 26 }, wood: 'hickory', placement: 'wall' }),
  diningTable: spec({ label: 'Dining table', category: 'Tables and desks', size: { width: 60, depth: 36, height: 30 }, min: { width: 30, depth: 24, height: 26 }, wood: 'nordicPine', placement: 'free' }),
  coffeeTable: spec({ label: 'Coffee table', category: 'Tables and desks', size: { width: 48, depth: 24, height: 18 }, min: { width: 20, depth: 14, height: 12 }, wood: 'peeledLog', placement: 'free' }),
  sideTable: spec({ label: 'Side table', category: 'Tables and desks', size: { width: 20, depth: 20, height: 24 }, min: { width: 12, depth: 12, height: 14 }, wood: 'hickory', placement: 'free' }),
  diningChair: spec({ label: 'Dining chair', category: 'Seating', size: { width: 18, depth: 18, height: 38 }, min: { width: 14, depth: 14, height: 30 }, wood: 'hickory', placement: 'free', uses: { fabric: false } }),
  deskChair: spec({ label: 'Desk chair', category: 'Seating', size: { width: 18, depth: 18, height: 38 }, min: { width: 14, depth: 14, height: 30 }, wood: 'hickory', placement: 'free', uses: { fabric: false } }),
  sofa: spec({ label: 'Sofa', category: 'Seating', size: { width: 84, depth: 36, height: 34 }, min: { width: 48, depth: 28, height: 26 }, wood: 'peeledLog', fabric: 'buffaloRed', placement: 'free' }),
  armchair: spec({ label: 'Armchair', category: 'Seating', size: { width: 34, depth: 34, height: 34 }, min: { width: 26, depth: 26, height: 26 }, wood: 'peeledLog', fabric: 'woolPlaid', placement: 'free' }),
  rocker: spec({ label: 'Rocking chair', category: 'Seating', size: { width: 24, depth: 34, height: 42 }, min: { width: 18, depth: 26, height: 34 }, wood: 'hickory', placement: 'free', uses: { fabric: false } }),
  bench: spec({ label: 'Bench', category: 'Seating', size: { width: 48, depth: 16, height: 18 }, min: { width: 18, depth: 10, height: 12 }, wood: 'hickory', placement: 'wall' }),
  rug: spec({ label: 'Rug', category: 'Rugs and lamps', size: { width: 96, depth: 60, height: 0.375 }, min: { width: 24, depth: 18, height: 0.25 }, wood: 'nordicPine', fabric: 'navajo', placement: 'free', floorLayer: true, uses: { wood: false } }),
  floorLamp: spec({ label: 'Floor lamp', category: 'Rugs and lamps', size: { width: 16, depth: 16, height: 60 }, min: { width: 10, depth: 10, height: 36 }, wood: 'darkLog', placement: 'free', uses: { wood: false } }),
  adirondackChair: spec({ label: 'Adirondack chair', category: 'Outdoor', size: { width: 30, depth: 34, height: 38 }, min: { width: 24, depth: 28, height: 30 }, wood: 'paintedGreen', placement: 'free', uses: { fabric: false } }),
};

export const FURNITURE_PIECES = Object.keys(FURNITURE) as readonly FurniturePiece[];

export interface WoodSpec {
  label: string;
  /** The wood's colour, and the flat colour its exports carry. */
  color: string;
  /** How its texture is drawn (view3d/woodGrain.ts). */
  grain: 'pine' | 'hickory' | 'oak' | 'log' | 'bark' | 'paint';
  /** Built of round logs (posts, rails and spindles), not sawn stock. */
  log: boolean;
}

/**
 * The woods. Nordic pine is the house's pine (MK, 15 Oct 2026: pine that does not yellow): pale and
 * cool, as under a water-white finish. The logs are peeled (like the stair hall's post) or with
 * their bark; the painted ones are the camp's green, barn red and cream.
 */
export const WOODS: Record<WoodId, WoodSpec> = {
  nordicPine: { label: 'Pine, Nordic natural', color: '#ddd3c1', grain: 'pine', log: false },
  hickory: { label: 'Hickory', color: '#a87e57', grain: 'hickory', log: false },
  peeledLog: { label: 'Peeled log', color: '#c9ab7e', grain: 'log', log: true },
  darkLog: { label: 'Log with bark', color: '#4a3526', grain: 'bark', log: true },
  fumedOak: { label: 'Fumed oak (Mission)', color: '#5d4532', grain: 'oak', log: false },
  paintedGreen: { label: 'Painted camp green', color: '#2f4a36', grain: 'paint', log: false },
  paintedRed: { label: 'Painted barn red', color: '#8a2d25', grain: 'paint', log: false },
  paintedCream: { label: 'Painted cream', color: '#e6dec9', grain: 'paint', log: false },
};
export const WOOD_IDS = Object.keys(WOODS) as readonly WoodId[];

export interface FabricSpec {
  label: string;
  pattern: 'check' | 'point' | 'plaid' | 'plain' | 'leather' | 'navajo' | 'braided';
  /** The pattern's colours, ground first. */
  colors: readonly string[];
  /** The flat colour exports carry (the pattern's overall tone). */
  flat: string;
}

export const FABRICS: Record<FabricId, FabricSpec> = {
  buffaloRed: { label: 'Buffalo check, red', pattern: 'check', colors: ['#a3231f', '#1c1a1a'], flat: '#5e1f1c' },
  buffaloGreen: { label: 'Buffalo check, green', pattern: 'check', colors: ['#2f5a3a', '#1c1a1a'], flat: '#253a2b' },
  pointBlanket: { label: 'Point blanket', pattern: 'point', colors: ['#ece4d0', '#2e6b3f', '#b8312b', '#e2b23a', '#2b3f6e'], flat: '#d9cdb3' },
  woolPlaid: { label: 'Wool plaid', pattern: 'plaid', colors: ['#3b5a3f', '#8e2a24', '#d8c79a', '#1f2a3a'], flat: '#4c4a38' },
  canvas: { label: 'Canvas', pattern: 'plain', colors: ['#cfc4a8'], flat: '#cfc4a8' },
  leather: { label: 'Leather', pattern: 'leather', colors: ['#6e4228'], flat: '#6e4228' },
  navajo: { label: 'Navajo weave', pattern: 'navajo', colors: ['#e7dcc6', '#9b2f24', '#2a2624', '#8a8478'], flat: '#b59a83' },
  braided: { label: 'Braided rag', pattern: 'braided', colors: ['#7b2e27', '#3e5a44', '#c9b48a', '#4a4f63'], flat: '#6b5a4a' },
  cream: { label: 'Cream wool', pattern: 'plain', colors: ['#ebe4d3'], flat: '#ebe4d3' },
};
export const FABRIC_IDS = Object.keys(FABRICS) as readonly FabricId[];

/** Bed linen (sheets, pillows) and the woven cane of chair seats, iron and a lamp shade. */
export const LINEN_COLOR = '#efeae0';
export const CANE_COLOR = '#c2a26e';
export const IRON_COLOR = '#2c2a28';
export const SHADE_COLOR = '#eadfc4';

export type BedSize = 'twin' | 'full' | 'queen' | 'king';
export const BED_SIZE_IDS: readonly BedSize[] = ['twin', 'full', 'queen', 'king'];
/** Mattress width x length; the frame adds BED_FRAME round it. */
export const BED_SIZES: Record<BedSize, { label: string; mattress: [number, number] }> = {
  twin: { label: 'Twin', mattress: [39, 75] },
  full: { label: 'Full', mattress: [54, 75] },
  queen: { label: 'Queen', mattress: [60, 80] },
  king: { label: 'King', mattress: [76, 80] },
};
/** The frame round the mattress: each side, and at the head and the foot. */
export const BED_FRAME = { side: 2, head: 2, foot: 2 } as const;
export const bedOverall = (size: BedSize): { width: number; depth: number } => {
  const [w, l] = BED_SIZES[size].mattress;
  return { width: w + 2 * BED_FRAME.side, depth: l + BED_FRAME.head + BED_FRAME.foot };
};
/** The mattress size a bed this wide is built round: the nearest within 3", else none. */
export function bedSizeOf(width: number): BedSize | null {
  let best: BedSize | null = null;
  let gap = 3 + 1e-9;
  for (const s of BED_SIZE_IDS) {
    const g = Math.abs(bedOverall(s).width - width);
    if (g <= gap) {
      gap = g;
      best = s;
    }
  }
  return best;
}

export const isFurniture = (kind: FixtureKind): boolean => kind === 'furniture';
export const isFurniturePiece = (v: unknown): v is FurniturePiece => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE, v);
export const isWoodId = (v: unknown): v is WoodId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(WOODS, v);
export const isFabricId = (v: unknown): v is FabricId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FABRICS, v);

/** A piece's wood and fabric: its own, else the catalogue's. */
export const pieceWoodOf = (f: Pick<Fixture, 'piece' | 'wood'>): WoodId => f.wood ?? FURNITURE[f.piece ?? 'bed'].wood;
export const pieceFabricOf = (f: Pick<Fixture, 'piece' | 'fabric'>): FabricId => f.fabric ?? FURNITURE[f.piece ?? 'bed'].fabric ?? 'cream';

/** What the plan and the panel call a piece: its label, else "Queen bed", "Dresser". */
export function furnitureNameOf(f: Pick<Fixture, 'piece' | 'width' | 'label'>): string {
  const label = f.label?.trim();
  if (label) return label;
  if (!f.piece) return 'Furniture';
  if (f.piece === 'bed') {
    const size = bedSizeOf(f.width);
    return size ? `${BED_SIZES[size].label} bed` : 'Bed';
  }
  return FURNITURE[f.piece].label;
}

/** Pieces whose name the plan shows (the small ones would only clutter it). */
const NAMED_ON_PLAN: ReadonlySet<FurniturePiece> = new Set<FurniturePiece>(['bed', 'dresser', 'chest', 'desk', 'diningTable', 'sofa', 'bookcase']);
/** The plan's word for a piece: its label, else its name when it is big enough to carry one. */
export function furniturePlanLabel(f: Pick<Fixture, 'piece' | 'width' | 'label'>): string | null {
  if (f.label?.trim()) return f.label.trim();
  return f.piece && NAMED_ON_PLAN.has(f.piece) ? furnitureNameOf(f) : null;
}

/** The size the tool places a piece at; a bed at its mattress size's overall size. */
export function furnitureDefaults(piece: FurniturePiece, bed?: BedSize): FixtureSize {
  const s = FURNITURE[piece].size;
  if (piece === 'bed' && bed) return { ...s, ...bedOverall(bed), elevation: 0 };
  return { ...s, elevation: 0 };
}
