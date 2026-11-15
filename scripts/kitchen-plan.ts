// The kitchen to be redesigned (docs/examples/kitchen.json): the room as it stands, from photo
// docs/kitchen/photos/01-kitchen-from-dining.jpg, with two draft design options to flip between.
//
// NOT MEASURED YET. Every size below is read off the one photo against standard cabinet sizes
// (24" deep base cabinets, a 36" counter, a 36" refrigerator, an 80" door) and is to be replaced by
// MK's measurements (docs/kitchen/MEASURE.md lists what to measure). The guesses, all of them:
//   - the room: 12'6" wide (ROOM.w), the kitchen 12' deep to where the floor changes, the dining side
//     another 8' (ROOM.d is both), the ceiling 9' (CEILING);
//   - the pantry: 50" along the left wall, 46" along the far wall, a 28" door in its angled wall;
//   - the windows: 56" wide over the sink, 28" wide on the far wall, 24" in the pantry;
//   - every cabinet width, the appliances' places, and the six recessed lights (a guess at a grid).
// Not modelled: the dark floor in the kitchen half (a room has one floor), the photo shelves, the
// soffit's exact shape, what is on the dining side.
//
// The two options are DRAFTS that exercise the software (same walls and windows; the pantry goes in
// the second): the real designs are to be agreed with MK once the room is measured.
//
// Coordinates: inches, as seen in the photo from above: x from the left wall's inside face to the
// right, y from the far wall's inside face toward the camera. Walls are drawn on centerlines.
import type { Fixture, Id, Phase, Plan, Vec2 } from '../src/model/types';
import { createEmptyPlan } from '../src/model/plan';
import { firstStructure } from '../src/model/structures';
import { getPlan, type NewFixture } from '../src/store/planStore';
import { addOpeningAt, demolish, designOptions, drawWalls, fixture, furnish, label, level, NEW, partition, roof, stableIds, store, win, workIn } from './planLib';

/** The room's inside faces. */
export const ROOM = { w: 150, d: 240 };
export const CEILING = 108;
/** Wall thicknesses: the outside walls and the pantry's partitions. */
const TE = 6;
const TP = 4.5;
/** The pantry's faces toward the kitchen: its south wall's (y) and its east wall's (x). */
const PANTRY = { south: 50, east: 46 };

const ESPRESSO = '#2e211d';
const BUTCHER = '#8d5f33';
const SAGE_TILE = '#b6bdb0';
const WALL_GREY = '#d9dcd2';
const OAK_FLOOR = '#b9976b';
const CART_OAK = '#c9a36b';

const BASE = { depth: 24, height: 34.5, elevation: 0 };
/** Wall cabinets from 54" to the soffit at 96". */
const UPPER = { depth: 13, height: 42, elevation: 54 };

/** A fixture against the left wall (facing right), the far wall (facing the camera) or the right wall (facing left), by where its middle is along that wall. */
const onLeft = (y: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x: 0, y }, direction: 0 });
const onFar = (x: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x, y: 0 }, direction: 90 });
const onRight = (y: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x: ROOM.w, y }, direction: 180 });

/**
 * The right-hand run, the same in every layout so far: an L from the far wall's corner, the
 * cooktop under its hood, wall cabinets to the soffit, the refrigerator in its surround at the end.
 */
function rightRun(lid: Id, phase: Phase): Id[] {
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase });
  return [
    add({ kind: 'cornerBase', ...onFar(ROOM.w - 18), width: 36, depth: 36, height: 34.5, elevation: 0 }),
    add({ kind: 'base', ...onRight(45), width: 18, ...BASE, drawers: 4 }),
    add({ kind: 'base', ...onRight(72), width: 36, ...BASE }),
    add({ kind: 'base', ...onRight(99), width: 18, ...BASE, drawers: 4 }),
    add({ kind: 'cooktop', origin: { x: ROOM.w - 2, y: 72 }, direction: 180, width: 36, depth: 21, height: 1.5, elevation: 36 }),
    add({ kind: 'hood', ...onRight(72), width: 36, depth: 20, height: 30, elevation: 66 }),
    add({ kind: 'cornerWall', ...onFar(ROOM.w - 13), width: 26, depth: 26, height: UPPER.height, elevation: UPPER.elevation }),
    add({ kind: 'wall', ...onRight(40), width: 28, ...UPPER }),
    add({ kind: 'wall', ...onRight(99), width: 18, ...UPPER }),
    add({ kind: 'fridge', ...onRight(126), width: 36, depth: 30, height: 70, elevation: 0, fridgeStyle: 'frenchDoor' }),
    add({ kind: 'wall', ...onRight(126), width: 36, depth: 24, height: 24, elevation: 72 }),
    // The surround's end panel, and the soffit over the wall cabinets.
    add({ kind: 'box', label: 'End panel', ...onRight(144.75), width: 1.5, depth: 30, height: 96, elevation: 0 }),
    add({ kind: 'box', label: 'Soffit', ...onRight(72.75), width: 145.5, depth: 14, height: CEILING - 96, elevation: 96 }),
  ];
}

/** The kitchen as it stands. Returns its fixtures (the cabinets and appliances, then the cart). */
function existingKitchen(lid: Id): { casework: Id[]; cart: Id } {
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: 'existing' });
  const casework = [
    // The left run, from the pantry's wall toward the dining side: dishwasher, the sink under the window, drawers, doors.
    add({ kind: 'dishwasher', ...onLeft(PANTRY.south + 12), width: 24, ...BASE }),
    add({ kind: 'sink', ...onLeft(PANTRY.south + 42), width: 36, ...BASE }),
    add({ kind: 'base', ...onLeft(PANTRY.south + 72), width: 24, ...BASE, drawers: 3 }),
    add({ kind: 'base', ...onLeft(PANTRY.south + 99), width: 30, ...BASE }),
    // The far wall: the oven tower against the pantry, then base cabinets under the window to the corner.
    add({ kind: 'wallOven', ...onFar(PANTRY.east + 15.5), width: 30, depth: 25, height: 96, elevation: 0 }),
    add({ kind: 'base', ...onFar(PANTRY.east + 49.5), width: 37.5, ...BASE }),
    ...rightRun(lid, 'existing'),
  ];
  // The movable cart in the middle: an oak frame under a white top.
  const cart = add({ kind: 'island', origin: { x: ROOM.w / 2, y: 96 }, direction: 90, width: 30, depth: 48, height: 34.5, elevation: 0, frontColor: CART_OAK, counterMaterial: 'laminate', counterColor: '#f3f2ee' });
  return { casework, cart };
}

/** Six recessed lights on a grid (a guess; photo 01 shows four of them). */
function recessedLights(lid: Id): void {
  for (const y of [60, 130, 200]) {
    for (const x of [45, 105]) fixture(lid, { kind: 'recessedLight', origin: { x, y: y - 3 }, direction: 90, width: 6, depth: 6, height: 0.5, elevation: CEILING - 0.5, phase: 'existing' });
  }
}

function room(lid: Id): void {
  store().updateLevel(lid, { name: 'Main Floor', wallHeight: CEILING, floorThickness: 12 });
  store().updateSettings({ defaultExteriorThickness: TE, defaultInteriorThickness: TP });
  const h = TE / 2;
  const box = [
    { x: -h, y: -h },
    { x: ROOM.w + h, y: -h },
    { x: ROOM.w + h, y: ROOM.d + h },
    { x: -h, y: ROOM.d + h },
  ];
  drawWalls(lid, box, TE, true);
  // The pantry in the far left corner: a wall facing the camera, an angled wall with the door, a
  // short wall back to the far wall (the oven tower stands against it).
  const p = TP / 2;
  const a: Vec2 = { x: -h, y: PANTRY.south - p };
  const b: Vec2 = { x: 18, y: PANTRY.south - p };
  const c: Vec2 = { x: PANTRY.east - p, y: 22 };
  const d: Vec2 = { x: PANTRY.east - p, y: -h };
  partition(lid, a, b);
  partition(lid, b, c);
  partition(lid, c, d);
  addOpeningAt(lid, { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, { type: 'door', width: 28, height: 80, into: { x: -1, y: -1 }, leafColor: '#f0eee8' });
  // Windows (they stay): the double window over the sink, the far wall's over the counter, the pantry's.
  win(lid, { x: -h, y: PANTRY.south + 52 }, 56, 54, 1, 1, { sill: 42, sashes: 2 });
  win(lid, { x: PANTRY.east + 52, y: -h }, 28, 52, 1, 2, { sill: 44 });
  win(lid, { x: -h, y: 22 }, 24, 48, 1, 2, { sill: 40 });
  // The dining side is open to the rest of the house: a wide opening in the near wall.
  addOpeningAt(lid, { x: ROOM.w / 2, y: ROOM.d + h }, { type: 'passage', width: 96, height: 96, sill: 0 });
  label(lid, 'Kitchen', { x: ROOM.w / 2, y: 190 }, 'existing', { wallFinish: 'paint', wallColor: WALL_GREY, floorFinish: 'boards', floorColor: OAK_FLOOR, ceilingFinish: 'paint', ceilingColor: '#f4f3ee' });
  label(lid, 'Pantry', { x: 16, y: 20 }, 'existing', { wallFinish: 'paint', wallColor: WALL_GREY, floorFinish: 'boards', floorColor: OAK_FLOOR, ceilingFinish: 'paint', ceilingColor: '#f4f3ee' });
  roof(lid, { shape: 'flat', outline: box, ridgeAngle: 0, pitch: 0, overhang: 12 }, '#5b5852', 0);
  // Today's finishes: espresso slab fronts with bar pulls, butcher block, grey-green tile.
  store().updateFinishes(lid, {
    cabinetColor: ESPRESSO,
    frontStyle: 'slab',
    handles: 'bar',
    handleFinish: 'steel',
    counterMaterial: 'butcherBlock',
    counterColor: BUTCHER,
    backsplash: 'toWall',
    backsplashFinish: 'tile',
    backsplashColor: SAGE_TILE,
  });
}

/** Draft A: today's layout rebuilt in light finishes, with lights under the wall cabinets. */
function draftA(lid: Id, option: Id, old: { casework: Id[] }): void {
  workIn(option);
  demolish(lid, { fixtures: old.casework });
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: NEW });
  add({ kind: 'dishwasher', ...onLeft(PANTRY.south + 12), width: 24, ...BASE, applianceFinish: 'panel' });
  add({ kind: 'sink', ...onLeft(PANTRY.south + 42), width: 36, ...BASE });
  add({ kind: 'base', ...onLeft(PANTRY.south + 72), width: 24, ...BASE, drawers: 3 });
  add({ kind: 'base', ...onLeft(PANTRY.south + 99), width: 30, ...BASE });
  add({ kind: 'wallOven', ...onFar(PANTRY.east + 15.5), width: 30, depth: 25, height: 96, elevation: 0 });
  add({ kind: 'base', ...onFar(PANTRY.east + 49.5), width: 37.5, ...BASE });
  rightRun(lid, NEW);
  for (const y of [40, 99]) add({ kind: 'underCabinetLight', origin: { x: ROOM.w - 4, y }, direction: 180, width: 16, depth: 2, height: 0.75, elevation: UPPER.elevation - 0.75 });
  store().updateOptionFinishes(lid, option, {
    cabinetColor: '#f1efe9',
    frontStyle: 'panel',
    handles: 'bar',
    handleFinish: 'black',
    counterMaterial: 'stoneVeined',
    counterColor: '#edece7',
    backsplash: 'toWall',
    backsplashFinish: 'tile',
    backsplashColor: '#f5f3ee',
  });
}

/** Draft B: the pantry out, tall storage and the ovens on the far wall, a fixed island with two stools and pendants. */
function draftB(lid: Id, option: Id, old: { casework: Id[]; cart: Id }): void {
  workIn(option);
  demolish(lid, {
    fixtures: [...old.casework, old.cart],
    walls: [
      { x: 8, y: PANTRY.south - TP / 2 },
      { x: 30, y: 36 },
      { x: PANTRY.east - TP / 2, y: 10 },
    ],
    rooms: ['Pantry'],
  });
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: NEW });
  // The far wall, left to right: a tall pantry cabinet, the oven tower, base cabinets under the window to the corner.
  add({ kind: 'tall', ...onFar(15), width: 30, depth: 24, height: 96, elevation: 0 });
  add({ kind: 'wallOven', ...onFar(45), width: 30, depth: 25, height: 96, elevation: 0 });
  add({ kind: 'base', ...onFar(87), width: 54, ...BASE, drawers: 3 });
  // The left run now starts beside the tall cabinet; the sink stays under its window.
  add({ kind: 'base', ...onLeft(44), width: 36, ...BASE, drawers: 3 });
  add({ kind: 'dishwasher', ...onLeft(74), width: 24, ...BASE, applianceFinish: 'panel' });
  add({ kind: 'sink', ...onLeft(104), width: 36, ...BASE });
  add({ kind: 'base', ...onLeft(143), width: 42, ...BASE });
  rightRun(lid, NEW);
  // The island: 30" x 66" with a 12" overhang at the dining end for two stools.
  add({ kind: 'island', origin: { x: ROOM.w / 2, y: 92 }, direction: 90, width: 30, depth: 66, height: 34.5, elevation: 0, counterOverhang: { front: 12, back: 1, left: 1, right: 1 } });
  for (const x of [ROOM.w / 2 - 9, ROOM.w / 2 + 9]) {
    const id = furnish(lid, 'stool', { x, y: 180 }, 270);
    store().updateFixture(lid, id, { phase: NEW });
  }
  for (const y of [112, 144]) add({ kind: 'pendant', origin: { x: ROOM.w / 2, y: y - 5 }, direction: 90, width: 10, depth: 10, height: CEILING - 70, elevation: 70, applianceFinish: 'black' });
  for (const y of [40, 99]) add({ kind: 'underCabinetLight', origin: { x: ROOM.w - 4, y }, direction: 180, width: 16, depth: 2, height: 0.75, elevation: UPPER.elevation - 0.75 });
  store().updateOptionFinishes(lid, option, {
    cabinetColor: '#34493f',
    frontStyle: 'panel',
    handles: 'knob',
    handleFinish: 'brass',
    counterMaterial: 'stoneSpeckled',
    counterColor: '#dad7d0',
    backsplash: 'toWall',
    backsplashFinish: 'tile',
    backsplashColor: '#f5f3ee',
  });
}

/** Build the kitchen plan in the store and return it (the store is left holding it). */
export function buildKitchenPlan(): Plan {
  store().setPlan(createEmptyPlan('Kitchen redesign (draft, not yet measured)', 'single'));
  const [lid] = firstStructure(getPlan()).levelOrder;
  room(lid);
  const old = existingKitchen(lid);
  recessedLights(lid);
  const [a, b] = designOptions(['Draft A: same layout, light finishes', 'Draft B: pantry out, island']);
  draftA(lid, a, old);
  draftB(lid, b, old);
  workIn(a);
  // Where to stand: the photo's viewpoint first (the viewer opens on it).
  const view = (name: string, at: Vec2, yaw: number, pitch = -0.1) => {
    if (!store().addView({ name, levelId: lid, at, yaw, pitch })) throw new Error(`view ${name} rejected`);
  };
  view('From the dining side', { x: ROOM.w / 2, y: 226 }, 0);
  view('At the sink', { x: 42, y: 104 }, Math.PI / 2);
  view('From the far window', { x: 96, y: 34 }, Math.PI, -0.15);
  if (Object.keys(level(lid).fixtures).length === 0) throw new Error('the kitchen has no fixtures');
  return getPlan();
}

/** The kitchen plan as the JSON text of docs/examples/kitchen.json (stable ids, fixed date). */
export function buildKitchenJson(): string {
  return stableIds(buildKitchenPlan(), 'plan-kitchen');
}
