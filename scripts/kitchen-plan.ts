// The kitchen of 2926 Wesley, to be redesigned (docs/examples/kitchen.json): the room as it stands,
// from the five photos in docs/kitchen/photos/, with two draft design options to flip between.
//
// MEASURED: the kitchen's width, 13 ft exactly (ROOM.w; MK, 15 Nov 2026).
//
// NOT MEASURED YET. Everything else is read off the photos against standard sizes (24" deep base
// cabinets, a 36" counter, a 36" refrigerator, a 24" dishwasher, an 80" door) and is to be replaced
// by MK's measurements (docs/kitchen/MEASURE.md lists what to measure). The guesses, all of them:
//   - the room's length to the fireplace wall, 28 ft (ROOM.d), and the ceiling, 9 ft (CEILING);
//   - the pantry: a corner closed by one diagonal wall (photos 02 and 05), meeting the left wall
//     57" from the far wall and a short stub 36" along the far wall; a 28" door in the diagonal;
//   - the windows and the sliding door: their sizes and where they are along their walls;
//   - every cabinet width, the appliances' places, the recessed lights, the dining furniture
//     (there for scale only).
// Not modelled: the dark floor of the kitchen half, which ends on a line across the room at the
// refrigerator's far side and the sink base's dining-side edge (y about 120, photos 04 and 05; a
// room has one floor finish); the open blind corner by the cooktop (drawn as a corner cabinet); the
// narrow pull-out beside the cooktop (drawn as a 9" door); the photo shelves; the ceiling speakers
// and vents; what is beyond the fireplace wall's two openings.
//
// The two options are DRAFTS that exercise the software (same walls and windows; the pantry goes in
// the second): the real designs are to be agreed with MK once the room is measured.
//
// Coordinates: inches, as seen in photo 01 from above: x from the left wall's inside face to the
// right, y from the far wall's inside face toward the camera. Walls are drawn on centerlines.
import type { Fixture, Id, Phase, Plan, Vec2 } from '../src/model/types';
import { createEmptyPlan } from '../src/model/plan';
import { firstStructure } from '../src/model/structures';
import { getPlan, type NewFixture } from '../src/store/planStore';
import { addOpeningAt, demolish, designOptions, drawWalls, fixture, furnish, label, level, NEW, partition, roof, stableIds, store, win, workIn } from './planLib';

/** The room's inside faces: 13 ft wide (measured), 28 ft to the fireplace wall (a guess). */
export const ROOM = { w: 156, d: 336 };
export const CEILING = 108;
/** The outside walls' thickness (the pantry's partitions are planLib's 5"). */
const TE = 6;
/** The pantry: where its diagonal wall's centerline meets the left wall's, and the stub's centerline (x) and where the diagonal meets it (y). */
const PANTRY = { left: 57, stub: 36, turn: 18 };
/** Where the left run starts (clear of the diagonal wall's face) and the oven tower's left side (clear of the stub's). */
const LEFT_START = 58;
const TOWER_X0 = PANTRY.stub + 2.5;

const ESPRESSO = '#2e211d';
const BUTCHER = '#8d5f33';
const SAGE_TILE = '#b6bdb0';
const WALL_GREY = '#d9dcd2';
const OAK_FLOOR = '#b9976b';
const CART_OAK = '#c9a36b';
const WHITE = '#f1efe9';

const BASE = { depth: 24, height: 34.5, elevation: 0 };
/** Wall cabinets from 54" to the crown box at 96". */
const UPPER = { depth: 13, height: 42, elevation: 54 };

/** A fixture against the left wall (facing right), the far wall (facing the camera) or the right wall (facing left), by where its middle is along that wall. */
const onLeft = (y: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x: 0, y }, direction: 0 });
const onFar = (x: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x, y: 0 }, direction: 90 });
const onRight = (y: number): Pick<Fixture, 'origin' | 'direction'> => ({ origin: { x: ROOM.w, y }, direction: 180 });

/**
 * The cooktop wall (photo 04), the same in every layout so far. From the far corner: the corner
 * unit, a drawer bank, the 36" cabinet under the five-burner cooktop, a narrow pull-out, a
 * drawer-over-door base, then the refrigerator standing free at the end. Wall cabinets in one line
 * from the corner to over the refrigerator, under a crown box.
 */
function rightRun(lid: Id, phase: Phase): Id[] {
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase });
  return [
    add({ kind: 'cornerBase', ...onFar(ROOM.w - 18), width: 36, depth: 36, height: 34.5, elevation: 0 }),
    add({ kind: 'base', ...onRight(45), width: 18, ...BASE, drawers: 4 }),
    add({ kind: 'base', ...onRight(72), width: 36, ...BASE }),
    add({ kind: 'base', ...onRight(94.5), width: 9, ...BASE }),
    add({ kind: 'base', ...onRight(109.5), width: 21, ...BASE }),
    add({ kind: 'cooktop', origin: { x: ROOM.w - 2, y: 72 }, direction: 180, width: 36, depth: 21, height: 1.5, elevation: 36 }),
    add({ kind: 'hood', ...onRight(72), width: 36, depth: 20, height: 12, elevation: 66 }),
    add({ kind: 'cornerWall', ...onFar(ROOM.w - 13), width: 26, depth: 26, height: UPPER.height, elevation: UPPER.elevation }),
    add({ kind: 'wall', ...onRight(40), width: 28, ...UPPER }),
    add({ kind: 'wall', ...onRight(72), width: 36, depth: 13, height: 18, elevation: 78 }),
    add({ kind: 'wall', ...onRight(105), width: 30, ...UPPER }),
    add({ kind: 'wall', ...onRight(138), width: 36, depth: 13, height: 24, elevation: 72 }),
    add({ kind: 'fridge', ...onRight(138), width: 36, depth: 30, height: 70, elevation: 0, fridgeStyle: 'frenchDoor' }),
    add({ kind: 'box', label: 'Crown box', ...onRight(78), width: 156, depth: 14, height: 10, elevation: 96 }),
  ];
}

/** The kitchen as it stands. Returns its fixtures: the cabinets and appliances, the pantry's, and the cart. */
function existingKitchen(lid: Id): { casework: Id[]; pantry: Id[]; cart: Id } {
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: 'existing' });
  const farBase = ROOM.w - 36 - (TOWER_X0 + 30);
  const casework = [
    // The sink wall (photo 05), from the pantry toward the dining side: dishwasher, the sink under the window, a drawer base. The run ends there.
    add({ kind: 'dishwasher', ...onLeft(LEFT_START + 12), width: 24, ...BASE }),
    add({ kind: 'sink', ...onLeft(LEFT_START + 42), width: 36, ...BASE }),
    add({ kind: 'base', ...onLeft(LEFT_START + 75), width: 30, ...BASE, drawers: 2 }),
    // The far wall: the oven tower against the pantry's stub, then a base cabinet under the window to the corner unit.
    add({ kind: 'wallOven', ...onFar(TOWER_X0 + 15), width: 30, depth: 25, height: 96, elevation: 0 }),
    add({ kind: 'base', ...onFar(TOWER_X0 + 30 + farBase / 2), width: farBase, ...BASE }),
    ...rightRun(lid, 'existing'),
  ];
  // Inside the pantry (photo 02): shelves on the left wall over a white counter on a drawer base.
  const pantry = [
    add({ kind: 'base', ...onLeft(13), width: 24, ...BASE, drawers: 3, frontColor: WHITE, counterMaterial: 'laminate', counterColor: '#f3f2ee', backsplash: 'none' }),
    add({ kind: 'shelf', ...onLeft(19), width: 36, depth: 12, height: 50, elevation: 44, shelves: 4, frontColor: WHITE }),
  ];
  // The movable cart in the middle: an oak frame under a white top.
  const cart = add({ kind: 'island', origin: { x: ROOM.w / 2, y: 100 }, direction: 90, width: 30, depth: 48, height: 34.5, elevation: 0, frontColor: CART_OAK, counterMaterial: 'laminate', counterColor: '#f3f2ee' });
  return { casework, pantry, cart };
}

/** Recessed lights in pairs across the room, and the chandelier over the dining table (photo 03; all guessed). */
function lights(lid: Id): void {
  for (const y of [50, 125, 200]) {
    for (const x of [46, 110]) fixture(lid, { kind: 'recessedLight', origin: { x, y: y - 3 }, direction: 90, width: 6, depth: 6, height: 0.5, elevation: CEILING - 0.5, phase: 'existing' });
  }
  fixture(lid, { kind: 'pendant', origin: { x: ROOM.w / 2, y: 271 }, direction: 90, width: 18, depth: 18, height: CEILING - 68, elevation: 68, phase: 'existing' });
}

/** The dining end and the wall past the refrigerator (photos 03 and 04): rough, for scale. */
function dining(lid: Id): void {
  // furnish() places proposed furniture; this is what is there today.
  const have = (id: Id) => store().updateFixture(lid, id, { phase: 'existing' });
  have(furnish(lid, 'bookcase', { x: ROOM.w, y: 172 }, 180, { width: 24, wood: 'darkLog' }));
  have(furnish(lid, 'dresser', { x: ROOM.w, y: 232 }, 180, { width: 60, wood: 'fumedOak' }));
  have(furnish(lid, 'diningTable', { x: ROOM.w / 2, y: 256 }, 90, { width: 48, depth: 48, wood: 'hickory' }));
  have(furnish(lid, 'diningChair', { x: ROOM.w / 2, y: 236 }, 90));
  have(furnish(lid, 'diningChair', { x: ROOM.w / 2, y: 324 }, 270));
  have(furnish(lid, 'diningChair', { x: ROOM.w / 2 - 44, y: 280 }, 0));
  have(furnish(lid, 'diningChair', { x: ROOM.w / 2 + 44, y: 280 }, 180));
  // The fireplace in its chimney breast, in the middle of the end wall.
  fixture(lid, { kind: 'box', label: 'Chimney breast', origin: { x: ROOM.w / 2, y: ROOM.d }, direction: 270, width: 60, depth: 14, height: CEILING, elevation: 0, frontColor: '#ece6d6', phase: 'existing' });
  fixture(lid, { kind: 'box', label: 'Fireplace', origin: { x: ROOM.w / 2, y: ROOM.d - 13 }, direction: 270, width: 40, depth: 2, height: 34, elevation: 12, frontColor: '#26241f', phase: 'existing' });
}

function room(lid: Id): void {
  store().updateLevel(lid, { name: 'Main Floor', wallHeight: CEILING, floorThickness: 12 });
  store().updateSettings({ defaultExteriorThickness: TE });
  const h = TE / 2;
  const box = [
    { x: -h, y: -h },
    { x: ROOM.w + h, y: -h },
    { x: ROOM.w + h, y: ROOM.d + h },
    { x: -h, y: ROOM.d + h },
  ];
  drawWalls(lid, box, TE, true);
  // The pantry in the far left corner: one diagonal wall with the door, and a short stub back to
  // the far wall that the oven tower stands against.
  const a: Vec2 = { x: -h, y: PANTRY.left };
  const b: Vec2 = { x: PANTRY.stub, y: PANTRY.turn };
  partition(lid, a, b);
  partition(lid, b, { x: PANTRY.stub, y: -h });
  addOpeningAt(lid, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { type: 'door', width: 28, height: 80, into: { x: -1, y: -1 }, leafColor: '#f0eee8' });
  // Windows (they stay). Far wall: the pantry's and the one over the counter. Left wall: the slider
  // over the sink, the sliding glass door, a window near the dining end. Right wall: a small high one past the refrigerator.
  win(lid, { x: 17, y: -h }, 24, 48, 1, 2, { sill: 40 });
  win(lid, { x: TOWER_X0 + 30 + 26, y: -h }, 28, 52, 1, 2, { sill: 44 });
  win(lid, { x: -h, y: LEFT_START + 46 }, 50, 38, 1, 1, { sill: 44, sashes: 2 });
  addOpeningAt(lid, { x: -h, y: 206 }, { type: 'door', width: 72, height: 80, sliding: true });
  win(lid, { x: -h, y: 282 }, 30, 54, 1, 2, { sill: 34 });
  win(lid, { x: ROOM.w + h, y: 204 }, 26, 24, 1, 1, { sill: 62 });
  // The fireplace wall at the dining end: an opening each side of the chimney breast.
  for (const x of [24, ROOM.w - 24]) addOpeningAt(lid, { x, y: ROOM.d + h }, { type: 'passage', width: 36, height: 84, sill: 0 });
  const finishes = { wallFinish: 'paint', wallColor: WALL_GREY, floorFinish: 'boards', floorColor: OAK_FLOOR, ceilingFinish: 'paint', ceilingColor: '#f4f3ee' } as const;
  label(lid, 'Kitchen', { x: ROOM.w / 2, y: 200 }, 'existing', finishes);
  label(lid, 'Pantry', { x: 12, y: 12 }, 'existing', finishes);
  roof(lid, { shape: 'flat', outline: box, ridgeAngle: 0, pitch: 0, overhang: 12 }, '#5b5852', 0);
  // Today's finishes: espresso slab fronts with bar pulls, a wood-look counter, grey-green tile.
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

const underCabinetLights = (lid: Id): void => {
  for (const y of [40, 105]) fixture(lid, { kind: 'underCabinetLight', origin: { x: ROOM.w - 4, y }, direction: 180, width: 18, depth: 2, height: 0.75, elevation: UPPER.elevation - 0.75, phase: NEW });
};

/** Draft A: today's layout rebuilt in light finishes, with lights under the wall cabinets. */
function draftA(lid: Id, option: Id, old: { casework: Id[] }): void {
  workIn(option);
  demolish(lid, { fixtures: old.casework });
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: NEW });
  const farBase = ROOM.w - 36 - (TOWER_X0 + 30);
  add({ kind: 'dishwasher', ...onLeft(LEFT_START + 12), width: 24, ...BASE, applianceFinish: 'panel' });
  add({ kind: 'sink', ...onLeft(LEFT_START + 42), width: 36, ...BASE });
  add({ kind: 'base', ...onLeft(LEFT_START + 75), width: 30, ...BASE, drawers: 3 });
  add({ kind: 'wallOven', ...onFar(TOWER_X0 + 15), width: 30, depth: 25, height: 96, elevation: 0 });
  add({ kind: 'base', ...onFar(TOWER_X0 + 30 + farBase / 2), width: farBase, ...BASE });
  rightRun(lid, NEW);
  underCabinetLights(lid);
  store().updateOptionFinishes(lid, option, {
    cabinetColor: WHITE,
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
function draftB(lid: Id, option: Id, old: { casework: Id[]; pantry: Id[]; cart: Id }): void {
  workIn(option);
  demolish(lid, {
    fixtures: [...old.casework, ...old.pantry, old.cart],
    walls: [
      { x: (PANTRY.stub - TE / 2) / 2, y: (PANTRY.left + PANTRY.turn) / 2 },
      { x: PANTRY.stub, y: PANTRY.turn / 2 },
    ],
    rooms: ['Pantry'],
  });
  const add = (f: Omit<NewFixture, 'phase'>) => fixture(lid, { ...f, phase: NEW });
  // The far wall, left to right: a tall pantry cabinet (clear of the old pantry's window), the oven
  // tower, base cabinets under the window to the corner unit.
  add({ kind: 'tall', ...onFar(48), width: 24, depth: 24, height: 96, elevation: 0 });
  add({ kind: 'wallOven', ...onFar(75), width: 30, depth: 25, height: 96, elevation: 0 });
  add({ kind: 'base', ...onFar(105), width: 30, ...BASE, drawers: 3 });
  // The left run now reaches the far corner under the old pantry's window; the sink stays under its own.
  add({ kind: 'cornerBase', ...onFar(18), width: 36, depth: 36, height: 34.5, elevation: 0, corner: 'right' });
  add({ kind: 'base', ...onLeft(48), width: 24, ...BASE, drawers: 3 });
  add({ kind: 'dishwasher', ...onLeft(72), width: 24, ...BASE, applianceFinish: 'panel' });
  add({ kind: 'sink', ...onLeft(102), width: 36, ...BASE });
  add({ kind: 'base', ...onLeft(135), width: 30, ...BASE });
  rightRun(lid, NEW);
  // The island: 36" x 66" (35" aisles each side) with a 12" overhang at the dining end for two stools.
  add({ kind: 'island', origin: { x: ROOM.w / 2, y: 86 }, direction: 90, width: 36, depth: 66, height: 34.5, elevation: 0, counterOverhang: { front: 12, back: 1, left: 1, right: 1 } });
  for (const x of [ROOM.w / 2 - 10, ROOM.w / 2 + 10]) {
    const id = furnish(lid, 'stool', { x, y: 181 }, 270);
    store().updateFixture(lid, id, { phase: NEW });
  }
  for (const y of [104, 136]) add({ kind: 'pendant', origin: { x: ROOM.w / 2, y: y - 5 }, direction: 90, width: 10, depth: 10, height: CEILING - 70, elevation: 70, applianceFinish: 'black' });
  underCabinetLights(lid);
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
  store().setPlan(createEmptyPlan('2926 Wesley kitchen (draft, not yet measured)', 'single'));
  const [lid] = firstStructure(getPlan()).levelOrder;
  room(lid);
  const old = existingKitchen(lid);
  lights(lid);
  dining(lid);
  const [a, b] = designOptions(['Draft A: same layout, light finishes', 'Draft B: pantry out, island']);
  draftA(lid, a, old);
  draftB(lid, b, old);
  workIn(a);
  // Where to stand: one view per photo, in the photos' order (the viewer opens on the first).
  const view = (name: string, at: Vec2, yaw: number, pitch = -0.1) => {
    if (!store().addView({ name, levelId: lid, at, yaw, pitch })) throw new Error(`view ${name} rejected`);
  };
  view('From the dining side', { x: ROOM.w / 2, y: 226 }, 0);
  // Doors are drawn shut, so photo 02's look inside is from the pantry door's outside here.
  view('The pantry door', { x: 50, y: 84 }, Math.PI / 4, -0.05);
  view('Toward the dining end', { x: 100, y: 40 }, Math.PI);
  view('The cooktop wall', { x: 42, y: 86 }, -Math.PI / 2, -0.05);
  view('The sink wall', { x: 118, y: 104 }, Math.PI / 2, -0.05);
  if (Object.keys(level(lid).fixtures).length === 0) throw new Error('the kitchen has no fixtures');
  return getPlan();
}

/** The kitchen plan as the JSON text of docs/examples/kitchen.json (stable ids, fixed date). */
export function buildKitchenJson(): string {
  return stableIds(buildKitchenPlan(), 'plan-kitchen');
}
