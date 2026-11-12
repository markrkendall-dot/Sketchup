import { BATH_KINDS } from './bath';
import { isHexColor } from './finish';
import type { Backsplash, BacksplashFinish, CounterMaterial, Fixture, FixtureKind, FrontStyle, HandleFinish, HandleStyle, Level, LevelFinishes } from './types';

// Casework data (DESIGN.md "Casework"): the kinds of fixture, their stock sizes, the counter and
// toe-kick dimensions and the colour defaults. Pure data shared by the tool, the panel, the 3D
// materials, the 2D symbols and the loader's validation.

export const FIXTURE_KINDS: readonly FixtureKind[] = ['base', 'cornerBase', 'wall', 'cornerWall', 'shelf', 'tall', 'island', 'sink', 'range', 'fridge', 'dishwasher', 'wallOven', 'hood', 'microwave', ...BATH_KINDS, 'box', 'furniture'];
/** The kinds the Cabinet tool offers (furniture has its own tool and catalogue, model/furniture.ts). */
export const CASEWORK_KINDS: readonly FixtureKind[] = FIXTURE_KINDS.filter((k) => k !== 'furniture');

export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  base: 'Base cabinet',
  cornerBase: 'Corner base cabinet',
  wall: 'Wall cabinet',
  cornerWall: 'Corner wall cabinet',
  shelf: 'Open shelf',
  tall: 'Tall cabinet',
  island: 'Island',
  sink: 'Sink cabinet',
  range: 'Range',
  fridge: 'Refrigerator',
  dishwasher: 'Dishwasher',
  wallOven: 'Wall oven',
  hood: 'Range hood',
  microwave: 'Microwave',
  bathtub: 'Bathtub',
  shower: 'Shower',
  showerGlass: 'Glass panel',
  toilet: 'Toilet',
  vanity: 'Vanity',
  basin: 'Basin',
  washer: 'Washer',
  dryer: 'Dryer',
  waterHeater: 'Water heater',
  box: 'Box',
  furniture: 'Furniture',
};

/** The short word on an appliance's plan symbol. */
export const FIXTURE_PLAN_LABEL: Partial<Record<FixtureKind, string>> = {
  range: 'RANGE',
  fridge: 'REF',
  dishwasher: 'DW',
  wallOven: 'OVEN',
  hood: 'HOOD',
  microwave: 'MW',
  washer: 'W',
  dryer: 'D',
  waterHeater: 'WH',
  shelf: 'SHELF',
  box: 'BOX',
};

export interface FixtureSize {
  width: number;
  depth: number;
  height: number;
  /** Bottom above the floor top. */
  elevation: number;
}

/** Stock sizes (inches), what the tool places; the panel changes them afterwards. */
export const FIXTURE_DEFAULTS: Record<FixtureKind, FixtureSize> = {
  base: { width: 36, depth: 24, height: 34.5, elevation: 0 },
  // A corner base is 36" along each wall (legs 24" deep); a corner wall cabinet 24" each way (12" legs).
  cornerBase: { width: 36, depth: 36, height: 34.5, elevation: 0 },
  wall: { width: 30, depth: 12, height: 30, elevation: 54 },
  cornerWall: { width: 24, depth: 24, height: 30, elevation: 54 },
  // Two 1 1/2" boards 12" apart on 4" brackets from 54" (a wall cabinet's bottom): boards at 58" and 70".
  shelf: { width: 36, depth: 10, height: 17.5, elevation: 54 },
  tall: { width: 24, depth: 24, height: 84, elevation: 0 },
  island: { width: 72, depth: 36, height: 34.5, elevation: 0 },
  sink: { width: 36, depth: 24, height: 34.5, elevation: 0 },
  range: { width: 30, depth: 25, height: 36, elevation: 0 },
  fridge: { width: 36, depth: 30, height: 70, elevation: 0 },
  dishwasher: { width: 24, depth: 24, height: 34.5, elevation: 0 },
  wallOven: { width: 30, depth: 24, height: 84, elevation: 0 },
  hood: { width: 30, depth: 18, height: 12, elevation: 66 },
  microwave: { width: 30, depth: 16, height: 17, elevation: 54 },
  // Bath and laundry (model/bath.ts): a 60" x 30" tub, a 36" square shower (its height the glass's),
  // a fixed 30" glass panel, a toilet (tank 20" wide), a 36" vanity (counter at 34"), a pedestal
  // basin, front-load washer and dryer, a 50-gallon water heater.
  bathtub: { width: 60, depth: 30, height: 20, elevation: 0 },
  shower: { width: 36, depth: 36, height: 78, elevation: 0 },
  showerGlass: { width: 30, depth: 0.5, height: 78, elevation: 0 },
  toilet: { width: 20, depth: 28, height: 30, elevation: 0 },
  vanity: { width: 36, depth: 21, height: 32.5, elevation: 0 },
  basin: { width: 22, depth: 18, height: 34, elevation: 0 },
  washer: { width: 27, depth: 30, height: 38, elevation: 0 },
  dryer: { width: 27, depth: 30, height: 38, elevation: 0 },
  waterHeater: { width: 22, depth: 22, height: 60, elevation: 0 },
  box: { width: 24, depth: 24, height: 24, elevation: 0 },
  // Nominal: the Furniture tool places each piece at its own size (model/furniture.ts).
  furniture: { width: 24, depth: 24, height: 30, elevation: 0 },
};

/** Wall cabinet heights the panel offers; tall cabinets 84 or 96. */
export const WALL_CABINET_HEIGHTS = [30, 36, 42] as const;
export const TALL_CABINET_HEIGHTS = [84, 96] as const;

/** Kinds a counter top runs over. */
export const hasCounter = (kind: FixtureKind): boolean => kind === 'base' || kind === 'cornerBase' || kind === 'island' || kind === 'dishwasher' || kind === 'sink' || kind === 'vanity';
/** Kinds that are cabinets (carcass and fronts in the cabinet colour). */
export const isCabinet = (kind: FixtureKind): boolean =>
  kind === 'base' || kind === 'cornerBase' || kind === 'wall' || kind === 'cornerWall' || kind === 'tall' || kind === 'island' || kind === 'sink' || kind === 'vanity';
/** Kinds that hang above the counter: drawn dashed on the plan. */
export const isOverhead = (kind: FixtureKind): boolean => kind === 'wall' || kind === 'cornerWall' || kind === 'shelf' || kind === 'hood' || kind === 'microwave';
/** The L-shaped corner units: one cabinet across an inside corner. */
export const isCorner = (kind: FixtureKind): boolean => kind === 'cornerBase' || kind === 'cornerWall';
/** Kinds that get a backsplash behind them when their back (or an end) is on a wall face: base runs and a range. */
export const takesBacksplash = (kind: FixtureKind): boolean => kind === 'base' || kind === 'cornerBase' || kind === 'sink' || kind === 'dishwasher' || kind === 'range';
/** Cabinets with door and drawer fronts that take pulls. */
export const takesHandles = (kind: FixtureKind): boolean => isCabinet(kind);

/** A counter top slab is this thick unless set (counterThickness); it sits on the cabinet. */
export const COUNTER_THICKNESS = 1.5;
/** Counter thicknesses the panel suggests (laminate 1 1/2, stone 1 1/4 or 2, butcher block 1 1/2 or 2 1/2). */
export const COUNTER_THICKNESS_RANGE = { min: 0.5, max: 6 } as const;
/** How deep a corner unit's legs are (from each wall): a base corner's 24", a wall corner's 12". */
export const CORNER_LEG: Record<'cornerBase' | 'cornerWall', number> = { cornerBase: 24, cornerWall: 12 };
/** A corner unit's leg depth for its size: the stock leg, no deeper than its size allows. */
export const cornerLegOf = (f: Pick<Fixture, 'kind' | 'width' | 'depth'>): number =>
  Math.max(1, Math.min(CORNER_LEG[f.kind === 'cornerWall' ? 'cornerWall' : 'cornerBase'], f.width - 3, f.depth - 3));
/** The toe kick under a floor-standing cabinet: this high, set back this far from the front. */
export const TOE_KICK = { height: 4, setback: 3 } as const;
/** Door and drawer fronts: thickness, the reveal between them, the drawer front's height. */
export const FRONT = { thickness: 0.75, reveal: 0.125, drawer: 6, doorWidth: 18 } as const;
/** A panel front: stile and rail width, how far the panel is recessed. */
export const PANEL = { frame: 2, recess: 0.375 } as const;
/** The sink basin: bowl size, depth, wall thickness. */
export const BASIN = { width: 33, depth: 22, deep: 8, wall: 0.5 } as const;

/** Pulls: a knob is 1 1/4" square and 1" proud; a bar pull 3/8" square on two posts, 1 1/4" proud. */
export const HANDLE = { knob: 1.25, knobProud: 1, bar: 0.375, barProud: 1.25, post: 0.375, inset: 1.25, from: 2.5 } as const;
/** Open shelves: the boards' thickness and count unless set, the brackets under a hung shelf. */
export const SHELF = { thickness: 1.5, count: 2, maxCount: 12, bracket: 0.5, bracketDrop: 4 } as const;
/** A drawer bank's drawers: at least 2, at most 6. */
export const DRAWER_BANK = { min: 2, max: 6 } as const;
/** A backsplash: a 4" upstand, 18" up to the wall cabinets unless set; tile 3/8" thick, a slab 3/4". */
export const BACKSPLASH = { upstand: 4, toWall: 18, tile: 0.375, slab: 0.75 } as const;

export const FRONT_STYLES: readonly FrontStyle[] = ['slab', 'panel'];
export const FRONT_STYLE_LABEL: Record<FrontStyle, string> = { slab: 'Slab', panel: 'Framed panel' };

export const COUNTER_MATERIALS: readonly CounterMaterial[] = ['laminate', 'butcherBlock', 'stoneSpeckled', 'stoneVeined'];
export const COUNTER_MATERIAL_LABEL: Record<CounterMaterial, string> = {
  laminate: 'Laminate (solid colour)',
  butcherBlock: 'Butcher block (wood)',
  stoneSpeckled: 'Stone, speckled (granite)',
  stoneVeined: 'Stone, veined (marble)',
};
export const BACKSPLASHES: readonly Backsplash[] = ['none', 'upstand', 'toWall', 'full'];
export const BACKSPLASH_LABEL: Record<Backsplash, string> = { none: 'None', upstand: '4" upstand', toWall: 'Up to the wall cabinets', full: 'To the ceiling' };
export const BACKSPLASH_FINISHES: readonly BacksplashFinish[] = ['tile', 'slab'];
export const BACKSPLASH_FINISH_LABEL: Record<BacksplashFinish, string> = { tile: 'Tile (3" x 6")', slab: 'Slab (the counter\'s material)' };
export const HANDLE_STYLES: readonly HandleStyle[] = ['none', 'knob', 'bar'];
export const HANDLE_STYLE_LABEL: Record<HandleStyle, string> = { none: 'None', knob: 'Knobs', bar: 'Bar pulls' };
export const HANDLE_FINISHES: readonly HandleFinish[] = ['steel', 'black', 'brass'];
export const HANDLE_FINISH_LABEL: Record<HandleFinish, string> = { steel: 'Brushed steel', black: 'Black', brass: 'Brass' };
export const HANDLE_COLOR: Record<HandleFinish, string> = { steel: '#b8bcc0', black: '#26262a', brass: '#b8923f' };
/** A butcher block counter without a colour of its own or the level's: oiled maple. */
export const BUTCHER_BLOCK_COLOR = '#c19a68';
/** A tiled backsplash without a colour: white subway tile. */
export const TILE_COLOR = '#eeebe4';

/** Colour defaults: painted cabinets off-white, a dark stone counter, steel appliances. */
export const DEFAULT_CABINET_COLOR = '#e9e4d8';
export const DEFAULT_COUNTER_COLOR = '#6b6760';
export const APPLIANCE_COLOR = '#b8bcc0';
export const KICK_COLOR = '#2b2a28';
export const BASIN_COLOR = '#d9dcde';

export type CounterOverhang = NonNullable<Fixture['counterOverhang']>;

/** The counter overhang a fixture gets without one of its own: 1" at the front; an island 1" all round. */
export const defaultCounterOverhang = (kind: FixtureKind): CounterOverhang =>
  kind === 'island' ? { front: 1, back: 1, left: 1, right: 1 } : { front: 1, back: 0, left: 0, right: 0 };
export const counterOverhangOf = (f: Pick<Fixture, 'kind' | 'counterOverhang'>): CounterOverhang => f.counterOverhang ?? defaultCounterOverhang(f.kind);

export const frontStyleOf = (f: Pick<Fixture, 'frontStyle'>, finishes?: LevelFinishes): FrontStyle => f.frontStyle ?? finishes?.frontStyle ?? 'slab';
export const frontColorOf = (f: Pick<Fixture, 'frontColor'>, finishes?: LevelFinishes): string => f.frontColor ?? finishes?.cabinetColor ?? DEFAULT_CABINET_COLOR;
export const counterColorOf = (finishes?: LevelFinishes): string => finishes?.counterColor ?? DEFAULT_COUNTER_COLOR;

type CounterFields = Pick<Fixture, 'counterMaterial' | 'counterColor' | 'counterThickness'>;
/** A counter's resolved look: material, colour, thickness. */
export interface CounterSpec {
  material: CounterMaterial;
  color: string;
  thickness: number;
}
/**
 * The counter over a run of fixtures (or one fixture): each field from the first fixture that sets
 * it (pass them in id order), else the level's, else laminate 1 1/2" in the counter colour (a butcher
 * block without any colour is oiled maple).
 */
export function counterSpecOf(members: readonly CounterFields[], finishes?: LevelFinishes): CounterSpec {
  const first = <K extends keyof CounterFields>(k: K): CounterFields[K] | undefined => members.find((m) => m[k] !== undefined)?.[k];
  const material = first('counterMaterial') ?? finishes?.counterMaterial ?? 'laminate';
  const color = first('counterColor') ?? finishes?.counterColor ?? (material === 'butcherBlock' ? BUTCHER_BLOCK_COLOR : DEFAULT_COUNTER_COLOR);
  return { material, color, thickness: first('counterThickness') ?? finishes?.counterThickness ?? COUNTER_THICKNESS };
}
/** One fixture's counter thickness (its own, else the level's, else 1 1/2"). */
export const counterThicknessOf = (f: CounterFields, finishes?: LevelFinishes): number => f.counterThickness ?? finishes?.counterThickness ?? COUNTER_THICKNESS;

type SplashFields = Pick<Fixture, 'backsplash' | 'backsplashFinish' | 'backsplashColor' | 'backsplashHeight'>;
export interface BacksplashSpec {
  backsplash: Backsplash;
  finish: BacksplashFinish;
  /** Absent for a slab without a colour of its own: it takes the counter's. */
  color?: string;
  /** A `toWall` backsplash's height above the counter. */
  height: number;
}
/** The backsplash a fixture (or a run: first that sets each field) gets: its own, else the level's, else none. */
export function backsplashSpecOf(members: readonly SplashFields[], finishes?: LevelFinishes): BacksplashSpec {
  const first = <K extends keyof SplashFields>(k: K): SplashFields[K] | undefined => members.find((m) => m[k] !== undefined)?.[k];
  const finish = first('backsplashFinish') ?? finishes?.backsplashFinish ?? 'tile';
  const color = first('backsplashColor') ?? finishes?.backsplashColor ?? (finish === 'tile' ? TILE_COLOR : undefined);
  return { backsplash: first('backsplash') ?? finishes?.backsplash ?? 'none', finish, ...(color ? { color } : {}), height: first('backsplashHeight') ?? finishes?.backsplashHeight ?? BACKSPLASH.toWall };
}
/** A cabinet's pulls and their finish: its own, else the level's, else none (steel). */
export const handlesOf = (f: Pick<Fixture, 'handles'>, finishes?: LevelFinishes): HandleStyle => f.handles ?? finishes?.handles ?? 'none';
export const handleFinishOf = (f: Pick<Fixture, 'handleFinish'>, finishes?: LevelFinishes): HandleFinish => f.handleFinish ?? finishes?.handleFinish ?? 'steel';
/**
 * An open shelf's board count and thickness, where the lowest board sits above the shelf's bottom
 * (`first`: a hung shelf's brackets are under it, 4", a standing one's is on the floor) and the
 * spacing between boards (the rest of the height shared out).
 */
export function shelfLayoutOf(f: Pick<Fixture, 'height' | 'elevation' | 'shelves' | 'shelfThickness'>): { count: number; thickness: number; first: number; spacing: number } {
  const count = f.shelves ?? SHELF.count;
  const thickness = Math.min(f.shelfThickness ?? SHELF.thickness, f.height);
  const first = f.elevation > 1e-9 ? Math.max(0, Math.min(SHELF.bracketDrop, f.height - thickness)) : 0;
  return { count, thickness, first, spacing: count > 1 ? (f.height - thickness - first) / (count - 1) : 0 };
}
export const levelFinishesOf = (level: Pick<Level, 'finishes'>): LevelFinishes | undefined => level.finishes;

/** The top of a fixture above the floor top. */
export const fixtureTop = (f: Pick<Fixture, 'elevation' | 'height'>): number => f.elevation + f.height;
/** The top of the counter over a counter-bearing fixture (a counter `thickness` thick, 1 1/2" unless given). */
export const counterTopOf = (f: Pick<Fixture, 'elevation' | 'height'>, thickness: number = COUNTER_THICKNESS): number => fixtureTop(f) + thickness;

// ---------------------------------------------------------------------------------------------
// The kitchen's optional fields (counters, backsplashes, pulls, drawer banks, glass doors, corner
// units, open shelves): which kinds take each, and what a valid value is. The loader keeps the
// valid ones and drops the rest one by one; the store refuses a bad one and drops those a kind does
// not take when the kind changes.

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIntIn = (v: unknown, lo: number, hi: number): v is number => isFiniteNum(v) && Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && list.includes(v as T);

/** The kitchen fields, each with the kinds that take it and its check. */
export const KITCHEN_FIELDS = {
  counterMaterial: { kinds: hasCounter, ok: oneOf(COUNTER_MATERIALS) },
  counterColor: { kinds: hasCounter, ok: isHexColor },
  counterThickness: { kinds: hasCounter, ok: (v: unknown) => isFiniteNum(v) && v >= COUNTER_THICKNESS_RANGE.min && v <= COUNTER_THICKNESS_RANGE.max },
  backsplash: { kinds: takesBacksplash, ok: oneOf(BACKSPLASHES) },
  backsplashFinish: { kinds: takesBacksplash, ok: oneOf(BACKSPLASH_FINISHES) },
  backsplashColor: { kinds: takesBacksplash, ok: isHexColor },
  backsplashHeight: { kinds: takesBacksplash, ok: (v: unknown) => isFiniteNum(v) && v > 0 && v <= 120 },
  handles: { kinds: takesHandles, ok: oneOf(HANDLE_STYLES) },
  handleFinish: { kinds: takesHandles, ok: oneOf(HANDLE_FINISHES) },
  drawers: { kinds: (k: FixtureKind) => k === 'base', ok: (v: unknown) => isIntIn(v, DRAWER_BANK.min, DRAWER_BANK.max) },
  glassFront: { kinds: (k: FixtureKind) => k === 'wall' || k === 'cornerWall', ok: (v: unknown) => v === true },
  corner: { kinds: isCorner, ok: (v: unknown) => v === 'left' || v === 'right' },
  shelves: { kinds: (k: FixtureKind) => k === 'shelf', ok: (v: unknown) => isIntIn(v, 1, SHELF.maxCount) },
  shelfThickness: { kinds: (k: FixtureKind) => k === 'shelf', ok: (v: unknown) => isFiniteNum(v) && v > 0 && v <= 6 },
} as const;
export type KitchenField = keyof typeof KITCHEN_FIELDS;
export const KITCHEN_FIELD_KEYS = Object.keys(KITCHEN_FIELDS) as KitchenField[];

/** Why a fixture's kitchen fields cannot be stored (a kind that does not take one, a bad value), or null. */
export function kitchenFieldProblem(f: Partial<Pick<Fixture, KitchenField>> & Pick<Fixture, 'kind'>): string | null {
  for (const k of KITCHEN_FIELD_KEYS) {
    const v = f[k];
    if (v === undefined) continue;
    const rule = KITCHEN_FIELDS[k];
    if (!rule.kinds(f.kind)) return `a ${f.kind} has no ${k}`;
    if (!rule.ok(v)) return `bad ${k} ${String(v)}`;
  }
  return null;
}

/** The valid kitchen fields of a raw record for a kind (colours lower-cased), the rest left out. */
export function validKitchenFields(raw: Record<string, unknown>, kind: FixtureKind): Partial<Pick<Fixture, KitchenField>> {
  const out: Record<string, unknown> = {};
  for (const k of KITCHEN_FIELD_KEYS) {
    const v = raw[k];
    const rule = KITCHEN_FIELDS[k];
    if (v === undefined || !rule.kinds(kind) || !rule.ok(v)) continue;
    out[k] = typeof v === 'string' && isHexColor(v) ? v.toLowerCase() : v;
  }
  return out as Partial<Pick<Fixture, KitchenField>>;
}

/** The level's kitchen defaults: which keys and their checks (LevelFinishes). */
export const KITCHEN_FINISH_FIELDS = {
  counterMaterial: KITCHEN_FIELDS.counterMaterial.ok,
  counterThickness: KITCHEN_FIELDS.counterThickness.ok,
  backsplash: KITCHEN_FIELDS.backsplash.ok,
  backsplashFinish: KITCHEN_FIELDS.backsplashFinish.ok,
  backsplashColor: KITCHEN_FIELDS.backsplashColor.ok,
  backsplashHeight: KITCHEN_FIELDS.backsplashHeight.ok,
  handles: KITCHEN_FIELDS.handles.ok,
  handleFinish: KITCHEN_FIELDS.handleFinish.ok,
} as const;
export type KitchenFinishField = keyof typeof KITCHEN_FINISH_FIELDS;
export const KITCHEN_FINISH_KEYS = Object.keys(KITCHEN_FINISH_FIELDS) as KitchenFinishField[];
