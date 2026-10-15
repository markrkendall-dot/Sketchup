import type { Fixture, FixtureKind, FrontStyle, Level, LevelFinishes } from './types';

// Casework data (DESIGN.md "Casework"): the kinds of fixture, their stock sizes, the counter and
// toe-kick dimensions and the colour defaults. Pure data shared by the tool, the panel, the 3D
// materials, the 2D symbols and the loader's validation.

export const FIXTURE_KINDS: readonly FixtureKind[] = ['base', 'wall', 'tall', 'island', 'sink', 'range', 'fridge', 'dishwasher', 'wallOven', 'hood', 'microwave', 'box', 'furniture'];
/** The kinds the Cabinet tool offers (furniture has its own tool and catalogue, model/furniture.ts). */
export const CASEWORK_KINDS: readonly FixtureKind[] = FIXTURE_KINDS.filter((k) => k !== 'furniture');

export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  base: 'Base cabinet',
  wall: 'Wall cabinet',
  tall: 'Tall cabinet',
  island: 'Island',
  sink: 'Sink cabinet',
  range: 'Range',
  fridge: 'Refrigerator',
  dishwasher: 'Dishwasher',
  wallOven: 'Wall oven',
  hood: 'Range hood',
  microwave: 'Microwave',
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
  wall: { width: 30, depth: 12, height: 30, elevation: 54 },
  tall: { width: 24, depth: 24, height: 84, elevation: 0 },
  island: { width: 72, depth: 36, height: 34.5, elevation: 0 },
  sink: { width: 36, depth: 24, height: 34.5, elevation: 0 },
  range: { width: 30, depth: 25, height: 36, elevation: 0 },
  fridge: { width: 36, depth: 30, height: 70, elevation: 0 },
  dishwasher: { width: 24, depth: 24, height: 34.5, elevation: 0 },
  wallOven: { width: 30, depth: 24, height: 84, elevation: 0 },
  hood: { width: 30, depth: 18, height: 12, elevation: 66 },
  microwave: { width: 30, depth: 16, height: 17, elevation: 54 },
  box: { width: 24, depth: 24, height: 24, elevation: 0 },
  // Nominal: the Furniture tool places each piece at its own size (model/furniture.ts).
  furniture: { width: 24, depth: 24, height: 30, elevation: 0 },
};

/** Wall cabinet heights the panel offers; tall cabinets 84 or 96. */
export const WALL_CABINET_HEIGHTS = [30, 36, 42] as const;
export const TALL_CABINET_HEIGHTS = [84, 96] as const;

/** Kinds a counter top runs over. */
export const hasCounter = (kind: FixtureKind): boolean => kind === 'base' || kind === 'island' || kind === 'dishwasher' || kind === 'sink';
/** Kinds that are cabinets (carcass and fronts in the cabinet colour). */
export const isCabinet = (kind: FixtureKind): boolean => kind === 'base' || kind === 'wall' || kind === 'tall' || kind === 'island' || kind === 'sink';
/** Kinds that hang above the counter: drawn dashed on the plan. */
export const isOverhead = (kind: FixtureKind): boolean => kind === 'wall' || kind === 'hood' || kind === 'microwave';

/** A counter top slab is this thick; it sits on the cabinet. */
export const COUNTER_THICKNESS = 1.5;
/** The toe kick under a floor-standing cabinet: this high, set back this far from the front. */
export const TOE_KICK = { height: 4, setback: 3 } as const;
/** Door and drawer fronts: thickness, the reveal between them, the drawer front's height. */
export const FRONT = { thickness: 0.75, reveal: 0.125, drawer: 6, doorWidth: 18 } as const;
/** A panel front: stile and rail width, how far the panel is recessed. */
export const PANEL = { frame: 2, recess: 0.375 } as const;
/** The sink basin: bowl size, depth, wall thickness. */
export const BASIN = { width: 33, depth: 22, deep: 8, wall: 0.5 } as const;

export const FRONT_STYLES: readonly FrontStyle[] = ['slab', 'panel'];
export const FRONT_STYLE_LABEL: Record<FrontStyle, string> = { slab: 'Slab', panel: 'Framed panel' };

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
export const levelFinishesOf = (level: Pick<Level, 'finishes'>): LevelFinishes | undefined => level.finishes;

/** The top of a fixture above the floor top. */
export const fixtureTop = (f: Pick<Fixture, 'elevation' | 'height'>): number => f.elevation + f.height;
/** The top of the counter over a counter-bearing fixture. */
export const counterTopOf = (f: Pick<Fixture, 'elevation' | 'height'>): number => fixtureTop(f) + COUNTER_THICKNESS;
