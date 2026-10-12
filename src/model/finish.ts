import type { Column, Glazing, Opening, Roof, RoofEave, RoofFinish, Wall, WallFinish, WallKind } from './types';

// Exterior appearance defaults (DESIGN.md "Exterior appearance"). Pure data, shared by the panel,
// the 3D materials, the opening fills and the loader's validation.

export const WALL_FINISHES: readonly WallFinish[] = ['shingle', 'clapboard', 'board', 'block', 'plain', 'screen'];

export const WALL_FINISH_LABEL: Record<WallFinish, string> = {
  shingle: 'Shingle',
  clapboard: 'Clapboard',
  board: 'Vertical board',
  block: 'Concrete block',
  plain: 'Plain',
  screen: 'Screen',
};

/** The house's dark red-brown stain. */
export const DEFAULT_EXTERIOR_COLOR = '#5a3a35';
export const DEFAULT_INTERIOR_COLOR = '#e8e4dc';

export const defaultWallFinish = (kind: WallKind): WallFinish => (kind === 'exterior' ? 'shingle' : 'plain');
export const defaultWallColor = (kind: WallKind): string => (kind === 'exterior' ? DEFAULT_EXTERIOR_COLOR : DEFAULT_INTERIOR_COLOR);

export const wallFinishOf = (w: Pick<Wall, 'kind' | 'finish'>): WallFinish => w.finish ?? defaultWallFinish(w.kind);
export const wallColorOf = (w: Pick<Wall, 'kind' | 'color'>): string => w.color ?? defaultWallColor(w.kind);

/** Roof surface colours by finish: corrugated metal grey-brown, asphalt shingle dark grey. */
export const ROOF_COLOR: Record<RoofFinish, string> = { metal: '#6e6259', shingle: '#4a4a4a' };
export const roofColorOf = (r: Pick<Roof, 'finish' | 'color'>): string => r.color ?? ROOF_COLOR[r.finish];

/** Fascia and rake boards, and the trim round openings: tan. */
export const TRIM_COLOR = '#d9c9a3';

/** Roof eaves (DESIGN.md "Roofs"): a fascia board by default, or open with rafter tails. */
export const ROOF_EAVES: readonly RoofEave[] = ['fascia', 'open'];
export const ROOF_EAVE_LABEL: Record<RoofEave, string> = { fascia: 'Fascia board', open: 'Open, rafter tails' };
/** Rafter tails of open eaves: 5.5" deep (a 2x6) every 24" on centre. */
export const DEFAULT_RAFTER: { readonly depth: number; readonly spacing: number } = { depth: 5.5, spacing: 24 };
/** Rust and streaking of a metal roof, 0 (none) to 1. */
export const DEFAULT_WEATHERING = 0.35;
/**
 * A roof texture tile is 24" across the slope by 48" down it; roof UVs are in tiles (meshes.ts
 * addRoofUVs), so a texture repeats once per tile.
 */
export const ROOF_TILE = { across: 24, down: 48 } as const;

export const roofEaveOf = (r: Pick<Roof, 'eave'>): RoofEave => r.eave ?? 'fascia';
export const rafterOf = (r: Pick<Roof, 'rafter'>): { depth: number; spacing: number } => r.rafter ?? DEFAULT_RAFTER;
/** The fascia, rake boards and rafter tails: the roof's board colour, else tan. */
export const boardColorOf = (r: Pick<Roof, 'boardColor'>): string => r.boardColor ?? TRIM_COLOR;
export const weatheringOf = (r: Pick<Roof, 'weathering'>): number => r.weathering ?? DEFAULT_WEATHERING;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR.test(v);

/** `#rgb` or `#rrggbb` (with or without the hash) as lower-case `#rrggbb`, or null. */
export function normalizeHex(text: string): string | null {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(t)) t = [...t].map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(t) ? `#${t.toLowerCase()}` : null;
}

export const DEFAULT_LITES = { window: { cols: 2, rows: 3 }, door: { cols: 1, rows: 1 } } as const;
export const DEFAULT_TRIM = 4;
export const MAX_LITES = 12;

export const litesOf = (o: Pick<Opening, 'type' | 'lites'>): { cols: number; rows: number } =>
  o.lites ?? (o.type === 'door' ? DEFAULT_LITES.door : DEFAULT_LITES.window);
export const trimOf = (o: Pick<Opening, 'trim'>): number => o.trim ?? DEFAULT_TRIM;

/** Sashes of a window (leaves of a door): 1 by default, at most 6 (a door uses 1 or 2). */
export const DEFAULT_SASHES = 1;
export const MAX_SASHES = 6;
export const MAX_LEAVES = 2;
export const GLAZINGS: readonly Glazing[] = ['glass', 'screen'];
export const GLAZING_LABEL: Record<Glazing, string> = { glass: 'Glass', screen: 'Screen' };
/** A door leaf: the dark green of the house door. */
export const DEFAULT_LEAF_COLOR = '#2f3a33';

export const sashesOf = (o: Pick<Opening, 'sashes'>): number => o.sashes ?? DEFAULT_SASHES;
/** A door's leaves: one, or two for a double door (any sash count above one). */
export const leavesOf = (o: Pick<Opening, 'sashes'>): number => Math.min(MAX_LEAVES, sashesOf(o));
export const glazingOf = (o: Pick<Opening, 'glazing'>): Glazing => o.glazing ?? 'glass';
export const leafColorOf = (o: Pick<Opening, 'leafColor'>): string => o.leafColor ?? DEFAULT_LEAF_COLOR;

/** Column colours by kind: brick red for a chimney, trim tan for a post. */
export const COLUMN_COLOR: Record<Column['kind'], string> = { chimney: '#7a4a3e', post: '#c9b58c' };
export const columnColorOf = (c: Pick<Column, 'kind' | 'color'>): string => c.color ?? COLUMN_COLOR[c.kind];
/** A chimney's cap: pale concrete. */
export const CHIMNEY_CAP_COLOR = '#b8b4ac';
