import type { Opening, Roof, RoofFinish, Wall, WallFinish, WallKind } from './types';

// Exterior appearance defaults (DESIGN.md "Exterior appearance"). Pure data, shared by the panel,
// the 3D materials, the opening fills and the loader's validation.

export const WALL_FINISHES: readonly WallFinish[] = ['shingle', 'clapboard', 'board', 'plain', 'screen'];

export const WALL_FINISH_LABEL: Record<WallFinish, string> = {
  shingle: 'Shingle',
  clapboard: 'Clapboard',
  board: 'Vertical board',
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

/** Roof surface colours by finish: standing-seam metal grey-brown, asphalt shingle dark grey. */
export const ROOF_COLOR: Record<RoofFinish, string> = { metal: '#6e6259', shingle: '#4a4a4a' };
export const roofColorOf = (r: Pick<Roof, 'finish' | 'color'>): string => r.color ?? ROOF_COLOR[r.finish];

/** Fascia and rake boards, and the trim round openings: tan. */
export const TRIM_COLOR = '#d9c9a3';

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
