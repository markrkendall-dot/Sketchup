// 146 Mick Road knocked down and rebuilt on its foundation (docs/examples/146-mick-road-rebuild.json;
// docs/history/PLAN-v14-rebuild.md): the house as it stands comes from scripts/example-plan.ts
// (buildExistingHouse), everything above the main block's block ring is marked demolished, the bump
// under the old Utility wing with it, and the new house is drawn as new work, so the Existing view is
// today's house and the Proposed view is the rebuild. MK's brief (24 Oct 2026), after a reference
// plan of a 52' x 26' main house with a 26' x 14' bedroom-suite addition, an 8' x 10' screen room and
// an 8' x 10' covered entry: a main-floor master suite (bedroom, closet, bath with a shower), a great
// room, dining, a kitchen with an island, a pantry, a powder room, a laundry, an entry and a stair,
// and upstairs two bedrooms with a full bath (shower).
//
// Coordinates as in planLib.ts: inches, x east, y south, outside faces; the main block's new 2x6
// walls (6 1/2") stand on the old centerlines (3 1/2" inside the block's faces), so its inside faces
// are x 6 3/4..311 1/4 and y 6 3/4..308 1/4. New partitions are 4 1/2".
import { roofBearing, roofHeightAt } from '../src/derive/roofs';
import { getStaircaseLayout, heightAt } from '../src/derive/staircase';
import { stairsHoleOutline } from '../src/derive/stairs';
import { getLevelElevations } from '../src/derive/levels';
import { groundAt } from '../src/derive/site';
import { COLUMN_COLOR } from '../src/model/finish';
import { MEMBER_DEFAULTS } from '../src/model/structure';
import type { Id, Plan, Vec2 } from '../src/model/types';
import { isCabinet } from '../src/model/casework';
import { getPlan, type NewFixture } from '../src/store/planStore';
import { buildExistingHouse } from './example-plan';
import {
  addOpeningAt,
  BLOCK_COLOR,
  CL,
  DARK_LOG,
  deck,
  DOOR_GREEN,
  drawWalls,
  FIELDSTONE,
  fixture,
  ft,
  furnish,
  label,
  level,
  MAIN,
  NEW,
  OUTDOOR_RISER,
  outline,
  PINE_FLOOR,
  PLACEHOLDER_WET,
  PROPOSED_CARPET,
  PROPOSED_PINE,
  roof,
  ROOF_GALVANIZED,
  round2,
  SHAKE_BROWN,
  STAINED_DOOR,
  stableIds,
  store,
  STOVE_BLACK,
  TB,
  WHITE,
  WOOD_FLOOR,
  type ExistingIds,
  type OpeningSpec,
} from './planLib';

/** New exterior walls (2x6 framing, sheathing and drywall) and partitions (2x4). */
const TN = 6.5;
const TP = 4.5;
const HN = TN / 2;
const HP = TP / 2;
/** The main block's inside faces with the new walls. */
const IN = { x0: CL.x0 + HN, x1: CL.x1 - HN, y0: CL.y0 + HN, y1: CL.y1 - HN };
/** The master suite: 14' out from the main block's east face, the block's full depth, like the reference plan's addition. */
const SUITE = { x0: MAIN.x1, x1: MAIN.x1 + ft(14), y0: MAIN.y0, y1: MAIN.y1 };
const SUITE_CL = { x1: SUITE.x1 - HN };
/** The covered entry (8' x 10') at the west face's north end and the screen room (8' x 12') south of it. */
const WEST = { x0: -ft(8), entryY1: ft(10), screenY1: ft(22) };
/** The porch roofs' outlines stop 12" short of the house wall so their overhang ends at its face. */
const ROOF_WEST_X1 = MAIN.x0 - 12;
/** First floor top (+2"): the basement floor -100" plus its 90" walls and the 12" floor. */
const FLOOR_TOP = 2;

const NORTH = { x: 0, y: -1 };
const SOUTH = { x: 0, y: 1 };
const EAST = { x: 1, y: 0 };
const WESTWARD = { x: -1, y: 0 };

/**
 * Lines of the First Floor (centerlines): the coat closet band, the entry's east wall and the stair's
 * foot, the hall's south wall, the kitchen / great room partition (on the middle basement girder's
 * line, x 170.5, so the bearing line stands over it), the corridor's east wall, the powder room's
 * south wall, and the suite's partitions.
 */
const F = {
  closetSouth: 32.75,
  closetEast: 76.5,
  stairFoot: 78.75,
  stairTop: 218.75,
  hallSouth: 104.5,
  // 3/4" east of the girder's line (x 170.5), where today's Kitchen/Living partition stood: a new
  // wall ending on a demolished wall's node would become a duplicate of it (model/plan.ts
  // normalizeLevel keeps the old one), and nodes merge within 1/2".
  partition: 171.25,
  corridorEast: 257,
  powderSouth: 69,
  basementDoor: 221,
  suite: { bathSouth: 93, hallEast: 356, closetEast: 417.5, bedNorth: 157.5 },
};
/**
 * The stair: 36" wide along the north wall, 15 risers of 7.2" on 10" treads climbing east from the
 * entry. Its north side is on the basement's block wall's inside face (y 7.5, 3/4" in from the new
 * wall's), since the basement stair stacked under it must clear that wall.
 */
const STAIR_Y0 = CL.y0 + TB / 2;
const STAIR = { y0: STAIR_Y0, y: STAIR_Y0 + 18, width: 36, run: 140, risers: 15 };
/** The low walls under the stair along the basement stair's hole: their south faces on the stair's south edge. */
const SPANDREL_Y = STAIR.y0 + STAIR.width - HP;
/** Lines of the Second Floor: the bath's east wall, the hall's south wall (over the First Floor's), the closets' fronts and end walls, the linen closet's west wall. */
const S = { bathEast: 81, hallSouth: 104.5, closetFront: 133.25, closetEndWest: 81, closetEndEast: 237, linenWest: 257, partition: 170.5 };

/** Mark everything on a level demolished (walls, openings, stairs, roofs, fixtures, decks, floor openings, rooms). */
function demolishLevel(levelId: Id, keepWalls: Id[] = []): void {
  const lvl = level(levelId);
  const keep = new Set(keepWalls);
  const sel = {
    walls: Object.keys(lvl.walls).filter((id) => !keep.has(id)),
    openings: Object.values(lvl.openings)
      .filter((o) => !keep.has(o.wallId))
      .map((o) => o.id),
    stairs: Object.keys(lvl.stairs),
    roofs: Object.keys(lvl.roofs),
    fixtures: Object.keys(lvl.fixtures),
    decks: Object.keys(lvl.decks),
    floorOpenings: Object.keys(lvl.floorOpenings),
    rooms: Object.keys(lvl.rooms),
  };
  store().setPhase(levelId, sel, 'demo');
  const after = level(levelId);
  const left = [
    ...sel.walls.filter((id) => after.walls[id]?.phase !== 'demo'),
    ...sel.openings.filter((id) => after.openings[id]?.phase !== 'demo'),
    ...sel.stairs.filter((id) => after.stairs[id]?.phase !== 'demo'),
    ...sel.roofs.filter((id) => after.roofs[id]?.phase !== 'demo'),
    ...sel.fixtures.filter((id) => after.fixtures[id]?.phase !== 'demo'),
    ...sel.decks.filter((id) => after.decks[id]?.phase !== 'demo'),
    ...sel.rooms.filter((id) => after.rooms[id]?.phase !== 'demo'),
  ];
  if (left.length) throw new Error(`demolition on ${lvl.name} left ${left.length} items standing`);
}

/**
 * The rebuild, drawn as new work on the demolished house. Sections: demolition; the main block's
 * walls and the suite's; the foundation under the suite; the First Floor's rooms; the stairs; the
 * Second Floor; openings; roofs; the covered entry and the screen room; the deck and the outdoor
 * stair; casework and fittings; furniture; alarms; the stove and its flue; structure; labels; the look.
 */
function rebuild(ids: ExistingIds): void {
  const { bId, fId, sId } = ids;
  store().updateSettings({ defaultExteriorThickness: TN, defaultInteriorThickness: TP });

  // ---- Demolition. Everything above the block ring: both floors entire (the wing, the entry porch,
  // the chimney, today's fixtures and labels); on the Basement the bump under the wing (its three
  // block walls with the walkout door), today's wooden stairs with their landing (the suite covers
  // their line) and the bump's label. The block ring, the girders, the retaining wall, the fence, the
  // yard and the grade points stay. The old walls bore the old floors; nothing new rests on them, so
  // they are marked not bearing and the structure checks look only at the new framing.
  demolishLevel(fId);
  demolishLevel(sId);
  for (const lid of [fId, sId]) {
    store().updateWalls(lid, Object.keys(level(lid).walls), { bearing: false });
  }
  const basement = level(bId);
  // The bump's walls carried the old wing's floor; the new one spans to the suite's own walls.
  const bump = Object.values(basement.walls)
    .filter((w) => {
      const a = basement.nodes[w.a];
      const b = basement.nodes[w.b];
      // East of the block's east wall (not pieces of that wall), north of the retaining wall's return.
      return Math.min(a.x, b.x) >= CL.x1 && !(a.x === CL.x1 && b.x === CL.x1) && Math.max(a.y, b.y) <= CL.y1 + 1e-6 && Math.min(a.y, b.y) >= 100;
    })
    .map((w) => w.id);
  if (bump.length !== 3) throw new Error(`the basement bump has ${bump.length} walls, not 3`);
  const bumpLabel = Object.values(basement.rooms).find((r) => r.name === 'Utility (below)');
  if (!bumpLabel) throw new Error('no label on the bump');
  store().setPhase(
    bId,
    {
      walls: bump,
      openings: Object.values(basement.openings)
        .filter((o) => bump.includes(o.wallId))
        .map((o) => o.id),
      stairs: Object.keys(basement.stairs),
      decks: Object.keys(basement.decks),
      rooms: [bumpLabel.id],
    },
    'demo',
  );
  store().updateWalls(bId, bump, { bearing: false });
  // The site: the masonry chimney (the stove gets a stainless flue) and the old porch's pad and stones.
  const site = getPlan().site;
  store().setPhase(
    fId,
    {
      walls: [],
      openings: [],
      columns: ids.chimney ? [ids.chimney] : [],
      surfaces: Object.values(site.surfaces)
        .filter((s) => s.material === 'concrete' || s.material === 'stone')
        .map((s) => s.id),
    },
    'demo',
  );

  // ---- The walls. The main block's new 2x6 walls on the old centerlines (replacesDemolished: they
  // lie on the demolished ones), the suite's three walls, the screen room's. Shakes in the garage's
  // brown (the proposed look paints them the same in the Proposed view).
  const shell = (lid: Id, pts: Vec2[], close: boolean) => {
    const w = drawWalls(lid, pts, TN, close, NEW, true);
    store().updateWalls(lid, w, { finish: 'shake', color: SHAKE_BROWN });
    return w;
  };
  shell(fId, outline(CL), true);
  shell(fId, [{ x: CL.x1, y: CL.y0 }, { x: SUITE_CL.x1, y: CL.y0 }, { x: SUITE_CL.x1, y: CL.y1 }, { x: CL.x1, y: CL.y1 }], false);
  const screenCl = { x0: WEST.x0 + HN, y0: WEST.entryY1 + HN, y1: WEST.screenY1 - HN };
  const screen = shell(fId, [{ x: CL.x0, y: screenCl.y0 }, { x: screenCl.x0, y: screenCl.y0 }, { x: screenCl.x0, y: screenCl.y1 }, { x: CL.x0, y: screenCl.y1 }], false);
  // A river-stone knee wall up to the screens' sills (36") round the screen room.
  store().updateWalls(fId, screen, { band: { finish: 'riverstone', height: 36 } });
  shell(sId, outline(CL), true);
  // The foundation under the suite: 8" block from the main block's corners, full height like the
  // old bump's (the ground in front of its south wall is at the basement floor, so it walks out
  // there as today), on the old bump's south line and beyond it.
  const footing = drawWalls(bId, [{ x: CL.x1, y: CL.y0 }, { x: SUITE_CL.x1, y: CL.y0 }, { x: SUITE_CL.x1, y: CL.y1 }, { x: CL.x1, y: CL.y1 }], TB, false, NEW, true);
  store().updateWalls(bId, footing, { finish: 'block', color: BLOCK_COLOR });

  /** A new 2x4 partition between two centerline points; it may lie on a demolished wall. */
  const part = (lid: Id, a: Vec2, b: Vec2) => {
    if (!store().addWall(lid, a, b, { kind: 'interior', thickness: TP, phase: NEW, replacesDemolished: true })) throw new Error(`partition ${JSON.stringify([a, b])} was rejected`);
  };

  // ---- First Floor. A north band 8' deep along the road wall: the entry (6' x 6') with a coat
  // closet (6' x 2') in the north-west corner, the stair up the north wall from the entry, the hall
  // 5' wide along it, and at its east end a corridor (3') past the top of the basement stair to the
  // kitchen, with the powder room (4'4" x 5') and the pantry (4'4" x 2'7") east of the corridor.
  // South of the band, on the lake side: the great room (13'5 1/2" x 16'9 1/2") west of the
  // partition on the middle girder's line and the kitchen and dining (11'6 1/2" x 16'9 1/2") east
  // of it, the dining at the lake window, open to the great room through a 94" cased opening.
  part(fId, { x: CL.x0, y: F.closetSouth }, { x: F.closetEast, y: F.closetSouth });
  part(fId, { x: F.closetEast, y: CL.y0 }, { x: F.closetEast, y: F.closetSouth });
  part(fId, { x: CL.x0, y: F.hallSouth }, { x: CL.x1, y: F.hallSouth });
  part(fId, { x: F.partition, y: F.hallSouth }, { x: F.partition, y: CL.y1 });
  part(fId, { x: F.corridorEast, y: CL.y0 }, { x: F.corridorEast, y: F.hallSouth });
  part(fId, { x: F.corridorEast, y: F.powderSouth }, { x: CL.x1, y: F.powderSouth });
  // The suite: the bath across the north end (13'5 3/4" x 7'), a 5' band of suite hall (3'),
  // walk-in closet (4'9") and laundry (5'), and the bedroom (13'5 3/4" x 12'4 1/2") at the lake end.
  part(fId, { x: CL.x1, y: F.suite.bathSouth }, { x: SUITE_CL.x1, y: F.suite.bathSouth });
  part(fId, { x: CL.x1, y: F.suite.bedNorth }, { x: SUITE_CL.x1, y: F.suite.bedNorth });
  part(fId, { x: F.suite.hallEast, y: F.suite.bathSouth }, { x: F.suite.hallEast, y: F.suite.bedNorth });
  part(fId, { x: F.suite.closetEast, y: F.suite.bathSouth }, { x: F.suite.closetEast, y: F.suite.bedNorth });

  // ---- The stairs. The stair up: one straight run east along the north wall from the entry, 36"
  // wide, 15 risers of 7.2" on 10" treads (108" floor to floor), railed on its open (south) side,
  // thick pine treads, framed underneath; the Second Floor's edge at x 218.75 is its top riser. Its
  // well upstairs is a floor opening from where the headroom drops under 80", guarded on the west
  // and south (the guard opens at the east edge where the run arrives). The basement stair is
  // stacked under it, climbing the same way: 36" wide, 14 risers (102"), from x 88.75 up to the
  // first floor at the stair's top, where a 32" door at the corridor's north end closes it; it cuts
  // the First Floor's slab from a few inches up its run, and the stair above spans the hole. The
  // headroom over it is the stair above's framed underside, about 90" all the way (stacked flights
  // of one pitch keep it). Under the stair above, along the hole's south and west edges, low walls
  // stand up to its underside (the stair's framing closes the gap over each), so nothing opens
  // into the hole from the hall.
  const stairUp = store().addStairs(fId, { origin: { x: F.stairFoot, y: STAIR.y }, direction: 0, width: STAIR.width, run: STAIR.run, risers: STAIR.risers, phase: NEW, cutsFloorAbove: false, railings: { right: true } });
  if (!stairUp) throw new Error('the stair up was rejected');
  if (F.stairFoot + STAIR.run !== F.stairTop) throw new Error('the run does not reach the Second Floor edge');
  const mainStair = store().groupStairs(fId, [stairUp], { name: 'Main stair', underside: 'framed', treadColor: PINE_FLOOR, treadThickness: 2 });
  if (!mainStair) throw new Error('staircase rejected');
  const ftfFirst = level(fId).wallHeight + level(sId).floorThickness;
  const wellHole = stairsHoleOutline(level(fId).stairs[stairUp], ftfFirst, level(fId).wallHeight);
  if (!wellHole) throw new Error('the stair up cuts no floor');
  // An inch before the headroom rule's line: the hole is inset 1/4" from the opening (derive/floorOpenings.ts).
  const wellX0 = round2(Math.min(...wellHole.map((p) => p.x))) - 1;
  if (!store().addFloorOpening(sId, { outline: outline({ x0: wellX0, x1: F.stairTop, y0: STAIR.y0, y1: STAIR.y0 + STAIR.width }), railings: [false, true, true, true], phase: NEW })) throw new Error('floor opening rejected');
  const DOWN = { foot: 88.75, run: 130, risers: 14 };
  if (DOWN.foot + DOWN.run !== F.stairTop) throw new Error('the basement stair does not arrive at the stair top');
  const stairDown = store().addStairs(bId, { origin: { x: DOWN.foot, y: STAIR.y }, direction: 0, width: STAIR.width, run: DOWN.run, risers: DOWN.risers, phase: NEW, cutsFloorAbove: true, railings: { right: true } });
  if (!stairDown) throw new Error('the basement stair was rejected');
  // Its own staircase, for a round handrail on its open side (a flight alone carries a deck's board rail).
  if (!store().groupStairs(bId, [stairDown], { name: 'Basement stair', treadColor: PINE_FLOOR })) throw new Error('basement staircase rejected');
  const ftfBasement = level(bId).wallHeight + level(fId).floorThickness;
  const downHole = stairsHoleOutline(level(bId).stairs[stairDown], ftfBasement, level(bId).wallHeight);
  if (!downHole) throw new Error('the basement stair cuts no floor');
  const holeX0 = round2(Math.min(...downHole.map((p) => p.x)));
  // The door at the top of the basement stair, in a wall just past the stair up's top riser.
  part(fId, { x: F.basementDoor, y: CL.y0 }, { x: F.basementDoor, y: SPANDREL_Y });
  // The low walls under the stair above: along the hole's south edge (its faces inside the stair's
  // outline) from the hole's start to the door's wall, in pieces so each can rise to the underside
  // over its own west end, and a return up to the north wall at the hole's start.
  const spandrelSplits = [holeX0, 130, 160, 190, F.basementDoor];
  for (let i = 0; i + 1 < spandrelSplits.length; i++) part(fId, { x: spandrelSplits[i], y: SPANDREL_Y }, { x: spandrelSplits[i + 1], y: SPANDREL_Y });
  part(fId, { x: holeX0, y: CL.y0 }, { x: holeX0, y: SPANDREL_Y });
  const layout = getStaircaseLayout(getPlan(), fId, mainStair, 'proposed');
  const soffit = layout?.undersides[stairUp];
  if (!soffit) throw new Error('the stair up has no framed underside');
  // The underside rises east, so it is lowest over a wall's west face; floored to 1/4", at least 1".
  const underSoffit = (x: number) => Math.max(1, Math.floor(heightAt(soffit, { x, y: STAIR.y }) * 4) / 4);
  const wallAtPoint = (p: Vec2) => {
    const lvl = level(fId);
    const found = Object.values(lvl.walls).find((w) => {
      const a = lvl.nodes[w.a];
      const b = lvl.nodes[w.b];
      const onLine = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 0.5 * Math.hypot(b.x - a.x, b.y - a.y);
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      return w.phase === NEW && onLine && t > 0 && t < 1;
    });
    if (!found) throw new Error(`no new wall at ${JSON.stringify(p)}`);
    return found.id;
  };
  for (let i = 0; i + 1 < spandrelSplits.length; i++) {
    const x0 = spandrelSplits[i];
    store().updateWalls(fId, [wallAtPoint({ x: (x0 + spandrelSplits[i + 1]) / 2, y: SPANDREL_Y })], { heightOverride: underSoffit(x0 - HP) });
  }
  store().updateWalls(fId, [wallAtPoint({ x: holeX0, y: (CL.y0 + SPANDREL_Y) / 2 })], { heightOverride: underSoffit(holeX0 - HP) });
  if (getStaircaseLayout(getPlan(), fId, mainStair, 'proposed')?.wallsThrough.length) throw new Error('a wall rises into the stair');

  // ---- Second Floor: the stair's top landing at the north wall, a hall 5' wide along the well's
  // south side (over the First Floor's hall wall, so the ceiling joists bear down through it), the
  // bath (6' x 7'9") in the north-west corner over the entry, a linen closet (4'4" x 7'9") in the
  // north-east over the powder room and pantry (a wet stack, if the laundry is ever wanted up here),
  // and the two bedrooms (13'5 1/2" and 11'6 1/2" by 16'9 1/2") on the lake side, each with a 6' x
  // 2' closet along its north wall against the outside wall.
  part(sId, { x: S.bathEast, y: CL.y0 }, { x: S.bathEast, y: S.hallSouth });
  part(sId, { x: CL.x0, y: S.hallSouth }, { x: CL.x1, y: S.hallSouth });
  part(sId, { x: S.linenWest, y: CL.y0 }, { x: S.linenWest, y: S.hallSouth });
  part(sId, { x: S.partition, y: S.hallSouth }, { x: S.partition, y: CL.y1 });
  part(sId, { x: CL.x0, y: S.closetFront }, { x: S.closetEndWest, y: S.closetFront });
  part(sId, { x: S.closetEndWest, y: S.hallSouth }, { x: S.closetEndWest, y: S.closetFront });
  part(sId, { x: S.closetEndEast, y: S.closetFront }, { x: CL.x1, y: S.closetFront });
  part(sId, { x: S.closetEndEast, y: S.hallSouth }, { x: S.closetEndEast, y: S.closetFront });

  // ---- Openings, all new. Windows have 2 x 3 lites per sash unless given, black sashes with red
  // trim in the Proposed view (the look). Interior leaves are stained like the old Bath door.
  const add = (lid: Id, p: Vec2, o: OpeningSpec) => addOpeningAt(lid, p, { ...o, phase: NEW });
  const win = (lid: Id, p: Vec2, width: number, height: number, extra: Partial<OpeningSpec> = {}) => add(lid, p, { type: 'window', width, height, lites: { cols: 2, rows: 3 }, ...extra });
  const door = (lid: Id, p: Vec2, width: number, into: Vec2, extra: Partial<OpeningSpec> = {}) => add(lid, p, { type: 'door', width, height: 80, into, leafColor: STAINED_DOOR, ...extra });
  const passage = (lid: Id, p: Vec2, width: number, height = 80) => add(lid, p, { type: 'passage', width, height, sill: 0 });
  const halfLite = { lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: DOOR_GREEN };
  // The lake face: the great room's picture window (a casement, a fixed pane and a casement, 12')
  // and the dining's (8'), sill 30; upstairs a casement pair in each bedroom, sill 34 (a way out in
  // a fire, R310 to verify).
  win(fId, { x: 84, y: CL.y1 }, 144, 60, { sashes: 3, fixedCenter: true, lites: { cols: 2, rows: 4 } });
  win(fId, { x: 239, y: CL.y1 }, 96, 60, { sashes: 3, fixedCenter: true, lites: { cols: 2, rows: 4 } });
  win(sId, { x: 82, y: CL.y1 }, 66, 46, { sashes: 2, sill: 34 });
  win(sId, { x: 242, y: CL.y1 }, 66, 46, { sashes: 2, sill: 34 });
  // The road face: a window over the stair's lower run (its sill above the treads there), one over
  // the corridor's landing, a transom high in the powder room, the suite bath's transom; upstairs
  // the bath's, one over the stair well above the run's top treads, and the hall landing's.
  win(fId, { x: 118, y: CL.y0 }, 46, 34, { sashes: 2, sill: 54, lites: { cols: 2, rows: 2 } });
  win(fId, { x: (F.basementDoor + HP + F.corridorEast - HP) / 2, y: CL.y0 }, 26, 44, { sill: 42 });
  win(fId, { x: 285, y: CL.y0 }, 36, 18, { sashes: 2, sill: 72, lites: { cols: 2, rows: 1 } });
  win(fId, { x: 430, y: CL.y0 }, 48, 24, { sashes: 2, sill: 60, lites: { cols: 2, rows: 1 } });
  win(sId, { x: 42, y: CL.y0 }, 36, 36, { sill: 48, lites: { cols: 2, rows: 2 } });
  win(sId, { x: 190, y: CL.y0 }, 46, 44, { sashes: 2, sill: 40 });
  win(sId, { x: 236.75, y: CL.y0 }, 30, 44, { sill: 40 });
  // The west face: the front door under the covered entry (green, nine lites over two panels,
  // swinging in), the great room's door to the screen room (the same, swinging out), and upstairs
  // the west bedroom's window and the bath's.
  door(fId, { x: CL.x0, y: 66.5 }, 36, EAST, halfLite);
  door(fId, { x: CL.x0, y: 190 }, 36, WESTWARD, halfLite);
  win(sId, { x: CL.x0, y: 200 }, 46, 44, { sashes: 2, sill: 34 });
  win(sId, { x: CL.x0, y: 50 }, 36, 36, { sill: 48, lites: { cols: 2, rows: 2 } });
  // The east faces: upstairs the east bedroom's window, its sill 42 so it clears the suite's shed
  // (its top meets the wall 30" above the Second Floor); the suite's east wall: the bath's window,
  // the laundry's, and two flanking the king bed over the nightstands; the bedroom's 72" sliding
  // door to the deck on the south, over the walkout door below.
  win(sId, { x: CL.x1, y: 220 }, 46, 44, { sashes: 2, sill: 42 });
  win(fId, { x: SUITE_CL.x1, y: 48 }, 36, 44, { sashes: 2, sill: 40 });
  win(fId, { x: SUITE_CL.x1, y: 125 }, 30, 30, { sill: 48, lites: { cols: 2, rows: 2 } });
  const BED_Y = (F.suite.bedNorth + HP + IN.y1) / 2;
  for (const dy of [-50, 50]) win(fId, { x: SUITE_CL.x1, y: BED_Y + dy }, 30, 48, { sill: 30, lites: { cols: 2, rows: 4 } });
  const SUITE_MID = (CL.x1 + HN + SUITE_CL.x1 - HN) / 2;
  add(fId, { x: SUITE_MID, y: CL.y1 }, { type: 'door', width: 72, height: 80, sliding: true, lites: { cols: 2, rows: 4 } });
  // The basement's walkout double door under it: two plain leaves in the shake brown, no trim.
  add(bId, { x: SUITE_MID, y: CL.y1 }, { type: 'door', width: 72, height: 80, lites: { cols: 1, rows: 1 }, sashes: 2, leafColor: SHAKE_BROWN, trim: 0 });
  // The screen room: screens above the knee wall, three bays west, two north and one south beside
  // the screen door to the lawn (the posts between them are the wall pieces); no trim.
  const screened = { type: 'window' as const, width: 40, height: 44, sill: 36, glazing: 'screen' as const, trim: 0 };
  for (const y of [149, 192, 235]) add(fId, { x: screenCl.x0, y }, screened);
  for (const x of [-67, -22]) add(fId, { x, y: screenCl.y0 }, screened);
  add(fId, { x: -22, y: screenCl.y1 }, screened);
  add(fId, { x: -70, y: screenCl.y1 }, { type: 'door', width: 36, height: 80, into: SOUTH, leafColor: SHAKE_BROWN, glazing: 'screen', trim: 0 });
  // Inside, First Floor: the coat closet's 60" bifolds; the hall's 7' cased opening into the great
  // room and the corridor's 36" one into the kitchen; the basement door at the corridor's north
  // end; the powder room's and the pantry's doors from the corridor; the 94" opening between the
  // great room and the dining, floor to ceiling (a flush beam over it); the suite's door from the
  // kitchen into its hall, the bath's and the closet's doors off that hall, the laundry's 56"
  // bifolds from the bedroom.
  passage(fId, { x: (IN.x0 + F.closetEast - HP) / 2, y: F.closetSouth }, 60);
  passage(fId, { x: 118, y: F.hallSouth }, 84, 84);
  passage(fId, { x: (F.stairTop + F.corridorEast - HP) / 2, y: F.hallSouth }, 36, 84);
  door(fId, { x: F.basementDoor, y: (STAIR.y0 + SPANDREL_Y - HP) / 2 }, 30, EAST);
  door(fId, { x: F.corridorEast, y: 40 }, 28, EAST);
  door(fId, { x: F.corridorEast, y: 86 }, 28, EAST);
  passage(fId, { x: F.partition, y: 259 }, 94, level(fId).wallHeight);
  door(fId, { x: CL.x1, y: 137 }, 32, EAST);
  door(fId, { x: (CL.x1 + HN + F.suite.hallEast - HP) / 2, y: F.suite.bathSouth }, 30, NORTH);
  door(fId, { x: F.suite.hallEast, y: 125 }, 28, EAST);
  passage(fId, { x: (F.suite.closetEast + HP + SUITE_CL.x1 - HN) / 2, y: F.suite.bedNorth }, 56);
  // Second Floor: the bath's door and the linen closet's off the hall, a 30" door into each bedroom
  // from the hall, and 60" bifolds on each closet.
  door(sId, { x: S.bathEast, y: 60 }, 28, WESTWARD);
  door(sId, { x: S.linenWest, y: 60 }, 30, EAST);
  door(sId, { x: 140, y: S.hallSouth }, 30, SOUTH);
  door(sId, { x: 200, y: S.hallSouth }, 30, SOUTH);
  passage(sId, { x: (IN.x0 + S.closetEndWest - HP) / 2, y: S.closetFront }, 60);
  passage(sId, { x: (S.closetEndEast + HP + IN.x1) / 2, y: S.closetFront }, 60);

  // ---- Roofs. The main gable as today's (ridge east-west, 6:12, 24" overhang) over the Second
  // Floor; the suite's shed on the First Floor, 3:12 down to the east so its top meets the main
  // wall 138" up, 30" over the Second Floor and under the east bedroom's window; the covered
  // entry's gable facing west over the front door and the screen room's shed down to the west
  // (they overlap at y 120 and are joined there). Metal in the Existing view's galvanized; the Proposed view
  // paints every roof the hunter green standing seam of the look.
  roof(sId, { shape: 'gable', outline: outline(MAIN), ridgeAngle: 0, pitch: 6, overhang: 24 }, ROOF_GALVANIZED, 0, NEW);
  roof(fId, { shape: 'shed', outline: outline({ x0: MAIN.x1 + 18, x1: SUITE.x1, y0: MAIN.y0, y1: MAIN.y1 }), ridgeAngle: 0, pitch: 3, overhang: 18 }, ROOF_GALVANIZED, 0, NEW);
  const entryRoof = roof(fId, { shape: 'gable', outline: outline({ x0: WEST.x0, x1: ROOF_WEST_X1, y0: MAIN.y0, y1: WEST.entryY1 }), ridgeAngle: 0, pitch: 6, overhang: 12 }, ROOF_GALVANIZED, 0, NEW);
  roof(fId, { shape: 'shed', outline: outline({ x0: WEST.x0, x1: ROOF_WEST_X1, y0: WEST.entryY1, y1: WEST.screenY1 }), ridgeAngle: 180, pitch: 3, overhang: 12 }, ROOF_GALVANIZED, 0, NEW);

  // ---- The covered entry: an open porch, 8' x 10', under its gable: a fieldstone stoop the whole
  // size, its top 1/2" under the threshold (the ground round it is at +1), two 10" dark-stained
  // log posts on 18" fieldstone piers at its outer corners, a 10" log plate between them under the
  // eave with 6" knee braces (the Adirondack entry of the renovation design, simplified). Logs are
  // timbers at set heights (the structure checks leave them to the engineer).
  const pier = (at: Vec2, w: number, d: number, top: number) => {
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => groundAt(getPlan(), { x: at.x + (sx * w) / 2, y: at.y + (sy * d) / 2 })));
    const base = Math.floor(Math.min(...corners)) - 2;
    if (!(base < top)) throw new Error(`pier at ${JSON.stringify(at)} would be buried`);
    if (!store().addColumn({ at, kind: 'pier', phase: NEW, width: w, depth: d, rotation: 0, base, top, color: FIELDSTONE })) throw new Error(`pier at ${JSON.stringify(at)} rejected`);
  };
  pier({ x: WEST.x0 / 2, y: WEST.entryY1 / 2 }, -WEST.x0, WEST.entryY1, 1.5);
  const gable = level(fId).roofs[entryRoof];
  const gableUnder = (p: Vec2) => {
    const h = roofHeightAt(gable, roofBearing(level(fId).wallHeight, gable), p);
    if (h === null) throw new Error(`no entry roof over ${JSON.stringify(p)}`);
    return h;
  };
  const LOG = 10;
  const POST_X = WEST.x0 + LOG / 2 + 1;
  const postsY = [MAIN.y0 + LOG / 2 + 1, WEST.entryY1 - LOG / 2 - 1];
  const PLATE = Math.floor(Math.min(...postsY.map((y) => gableUnder({ x: POST_X, y }))) - LOG / 2 - 0.25);
  const logPost = (at: Vec2, base: number, top: number, d: number, label: string) => {
    if (!store().addMember(fId, { kind: 'post', at, width: d, depth: d, rotation: 0, base: round2(base), top: round2(top), color: DARK_LOG, profile: 'log', label, phase: NEW })) throw new Error(`${label} rejected`);
  };
  const logBetween = (a: Vec2, za: number, b: Vec2, zb: number, d: number, label: string) => {
    if (!store().addMember(fId, { kind: 'beam', a, b, width: d, depth: d, mount: 'dropped', za: round2(za), zb: round2(zb), color: DARK_LOG, profile: 'log', label, phase: NEW })) throw new Error(`${label} rejected`);
  };
  for (const y of postsY) {
    pier({ x: POST_X, y }, 18, 18, 20);
    logPost({ x: POST_X, y }, 20 - FLOOR_TOP, PLATE, LOG, '10" log post');
  }
  logBetween({ x: POST_X, y: postsY[0] - LOG / 2 - 8 }, PLATE + LOG / 2, { x: POST_X, y: postsY[1] + LOG / 2 + 8 }, PLATE + LOG / 2, LOG, '10" log plate');
  for (const [i, y] of postsY.entries()) {
    const inward = i === 0 ? 1 : -1;
    logBetween({ x: POST_X, y }, PLATE - 24 + 3, { x: POST_X, y: y + inward * 24 }, PLATE + 3, 6, '6" log brace');
  }
  // A flagstone landing between the gravel pull-off and the stoop.
  if (!store().addSurface({ outline: outline({ x0: -66, x1: -30, y0: -ft(2), y1: 0 }), material: 'stone', phase: NEW })) throw new Error('path rejected');

  // ---- The deck off the master bedroom (as the renovation design had it, MK 14 Oct 2026): 8'
  // deep, from the retaining wall's east face to the suite's east face, its top 6" below the
  // bedroom floor, flush with the retaining wall's top, so the lake-side terrace steps onto it. The
  // wall and the house carry its west and north edges; railings along the east and south; posts
  // to the ground. No stair of its own: the outdoor stair is rebuilt along the suite's east side,
  // 23" east of today's (the suite is that much wider than the wing), from the lawn down to a
  // landing at the walkout's level and on down the bank to the lower lawn.
  deck(fId, { outline: outline({ x0: CL.x1 + 5, x1: SUITE.x1, y0: SUITE.y1, y1: SUITE.y1 + ft(8) }), elevation: -6, railings: [false, true, true, false], phase: NEW });
  // The ground along the suite's east side, as it is along the wing's today (-20 at the road end,
  // the walkout's -100 at the lake end, the lawn level east of the stair's top), so the rebuilt
  // stair lands on the lawn. Grade points have no phase; these sit within 2' of today's.
  const gp = (x: number, y: number, elevation: number) => {
    if (!store().addGradePoint({ at: { x, y }, elevation })) throw new Error('grade point rejected');
  };
  gp(SUITE.x1, 188, -20);
  gp(SUITE.x1 + 54, 188, -20);
  gp(SUITE.x1 + 54, 175, -20);
  gp(SUITE.x1, SUITE.y1, -100);
  const STAIR_X = SUITE.x1 + 22;
  const LANDING = { x0: SUITE.x1 + 4, x1: SUITE.x1 + 40, y0: SUITE.y1 - 6, y1: SUITE.y1 + 30 };
  const UPPER_RUN = 110;
  // Both flights railed both sides (new work; today's rails are not drawn), the upper one arriving
  // at a boardwalk landing on the lawn at the top of the bank.
  const upperFlight = store().addStairs(bId, { origin: { x: STAIR_X, y: LANDING.y0 }, direction: 270, width: 36, run: UPPER_RUN, rise: 80, risers: 11, phase: NEW, cutsFloorAbove: false, open: true, railings: { left: true, right: true } });
  if (!upperFlight) throw new Error('outdoor stair rejected');
  deck(bId, { outline: outline({ x0: LANDING.x0, x1: LANDING.x1, y0: LANDING.y0 - UPPER_RUN - 24, y1: LANDING.y0 - UPPER_RUN }), elevation: 80, railings: [false, false, false, false], phase: NEW });
  deck(bId, { outline: outline(LANDING), elevation: 0, railings: [false, true, false, false], phase: NEW });
  const lowerFlight = store().addStairs(bId, { origin: { x: STAIR_X, y: LANDING.y1 + 120 }, direction: 270, width: 36, run: 120, base: -96, rise: 12 * OUTDOOR_RISER, risers: 12, phase: NEW, cutsFloorAbove: false, open: true, railings: { left: true, right: true } });
  if (!lowerFlight) throw new Error('outdoor lower flight rejected');
  // Each flight its own staircase (the landing between them is a deck, not a piece of stairs):
  // round handrails on open stringers.
  for (const [id, name] of [
    [upperFlight, 'Lake stair, upper flight'],
    [lowerFlight, 'Lake stair, lower flight'],
  ] as const) {
    if (!store().groupStairs(bId, [id], { name, stringer: 'open', underside: 'open' })) throw new Error(`${name} rejected`);
  }

  // ---- Casework and fittings (placeholders at stock sizes; the level's casework defaults are
  // Nordic pine, set below). A fixture's origin is the middle of its back edge and its direction
  // the way its front faces.
  const fix = (lid: Id, f: Omit<NewFixture, 'phase' | 'elevation'> & { elevation?: number }) => fixture(lid, { elevation: 0, ...f, phase: NEW });
  const COUNTER = 34.5;
  const BASE = { depth: 24, height: COUNTER };
  const UPPER = { depth: 12, height: 30, elevation: 54 };
  const K = { west: F.partition + HP, east: IN.x1, north: F.hallSouth + HP };
  // The kitchen, x 172.75..311.25, y 106.75..212 (the dining south of it to the lake window): the
  // refrigerator (counter depth) in the north-west corner on the north wall; the range on the west
  // run (its hood's 8" duct runs north between the floor joists above, which run east-west... so
  // across them; see the structure note: the duct runs in the ceiling north 14' to a cap in the
  // north wall's band board, above the stair) between two bases; a 30" base and upper on the north
  // wall's east end; and the island, 60" x 26" top over the dishwasher and the sink, its fronts
  // west toward the range, 53" from the west run and 41" from the east wall. Counter about 11'.
  fix(fId, { kind: 'fridge', origin: { x: K.west + 2 + 18, y: K.north }, direction: 90, width: 36, depth: 30, height: 70 });
  fix(fId, { kind: 'wall', origin: { x: K.west + 2 + 18, y: K.north }, direction: 90, width: 36, depth: 15, height: 15, elevation: 70 });
  const westRun: [NewFixture['kind'], number, number][] = [
    ['base', 139 + 12, 24],
    ['range', 139 + 24 + 15, 30],
    ['base', 139 + 54 + 9, 18],
  ];
  for (const [kind, y, width] of westRun) {
    if (kind === 'range') {
      fix(fId, { kind, origin: { x: K.west, y }, direction: 0, width, depth: 25, height: 36 });
      fix(fId, { kind: 'hood', origin: { x: K.west, y }, direction: 0, width, depth: 18, height: 30, elevation: 66 });
    } else {
      fix(fId, { kind, origin: { x: K.west, y }, direction: 0, width, ...BASE });
      fix(fId, { kind: 'wall', origin: { x: K.west, y }, direction: 0, width, ...UPPER });
    }
  }
  fix(fId, { kind: 'base', origin: { x: IN.x1 - 15, y: K.north }, direction: 90, width: 30, ...BASE });
  fix(fId, { kind: 'wall', origin: { x: IN.x1 - 15, y: K.north }, direction: 90, width: 30, ...UPPER });
  const ISLAND = { back: 270, dwY: 139 + 12, sinkY: 139 + 24 + 18 };
  fix(fId, { kind: 'dishwasher', origin: { x: ISLAND.back, y: ISLAND.dwY }, direction: 180, width: 24, depth: 24, height: COUNTER, counterOverhang: { front: 1, back: 1, left: 0, right: 1 } });
  fix(fId, { kind: 'sink', origin: { x: ISLAND.back, y: ISLAND.sinkY }, direction: 180, width: 36, depth: 24, height: COUNTER, counterOverhang: { front: 1, back: 1, left: 1, right: 0 } });
  // The range hood's duct in the ceiling north to the road wall, drawn as a box through the hall.
  const METAL = COLUMN_COLOR.flue;
  const RANGE_Y = westRun[1][1];
  fix(fId, { kind: 'box', label: 'Hood duct', origin: { x: K.west + 8, y: RANGE_Y }, direction: 270, width: 8, depth: RANGE_Y - MAIN.y0 + 1, elevation: level(fId).wallHeight + 1, height: 8, frontColor: METAL });
  // The pantry: 12" shelves 84" high on its east wall and along its south wall.
  const SHELVES = { kind: 'box' as const, label: 'Shelves', height: 84, frontColor: PINE_FLOOR, depth: 12 };
  fix(fId, { ...SHELVES, origin: { x: IN.x1, y: (F.powderSouth + HP + F.hallSouth - HP) / 2 }, direction: 180, width: F.hallSouth - HP - (F.powderSouth + HP) });
  fix(fId, { ...SHELVES, origin: { x: (F.corridorEast + HP + 12 + IN.x1 - 12) / 2, y: F.hallSouth - HP }, direction: 270, width: IN.x1 - 12 - (F.corridorEast + HP + 12) });
  // The powder room: the WC under the transom, a 24" vanity on the east wall clear of the door.
  const WC = { kind: 'toilet' as const, width: 20, depth: 28, height: 30, frontColor: WHITE };
  fix(fId, { ...WC, origin: { x: 285, y: IN.y0 }, direction: 90 });
  fix(fId, { kind: 'sink', origin: { x: IN.x1, y: 50 }, direction: 180, width: 24, depth: 20, height: 31.5 });
  // The master bath: a 60" x 42" walk-in shower in the north-west corner (a glass panel on its
  // south side), a 72" double vanity on the south wall, the WC against the east wall under its
  // window. The laundry: the washer and dryer on its north wall, the dryer's vent out the east wall.
  // The closet: rods and shelves 24" deep along its north wall and a 12" shelf unit on its south.
  const SX = CL.x1 + HN;
  fix(fId, { kind: 'shower', variant: 'curbless', origin: { x: SX + 30, y: IN.y0 }, direction: 90, width: 60, depth: 42, height: 78, frontColor: WHITE });
  fix(fId, { kind: 'showerGlass', origin: { x: SX + 60, y: IN.y0 + 21 }, direction: 180, width: 42, depth: 0.5, height: 78 });
  fix(fId, { kind: 'sink', origin: { x: 425, y: F.suite.bathSouth - HP }, direction: 270, width: 72, depth: 21, height: COUNTER });
  fix(fId, { ...WC, origin: { x: SUITE_CL.x1 - HN, y: 48 }, direction: 180 });
  const LAUNDRY_X0 = F.suite.closetEast + HP;
  fix(fId, { kind: 'washer', origin: { x: LAUNDRY_X0 + 15, y: F.suite.bathSouth + HP }, direction: 90, width: 27, depth: 28, height: 38, frontColor: WHITE });
  fix(fId, { kind: 'dryer', origin: { x: LAUNDRY_X0 + 43, y: F.suite.bathSouth + HP }, direction: 90, width: 27, depth: 28, height: 38, frontColor: WHITE });
  fix(fId, { kind: 'box', label: 'Dryer vent', origin: { x: SUITE_CL.x1 + HN, y: F.suite.bathSouth + HP + 14 }, direction: 180, width: 4, depth: SUITE_CL.x1 + HN - (LAUNDRY_X0 + 56), elevation: 60, height: 4, frontColor: METAL });
  const CLOSET = { x0: F.suite.hallEast + HP, x1: F.suite.closetEast - HP };
  fix(fId, { kind: 'box', label: 'Rods and shelves', origin: { x: (CLOSET.x0 + CLOSET.x1) / 2, y: F.suite.bathSouth + HP }, direction: 90, width: CLOSET.x1 - CLOSET.x0, depth: 24, height: 84, frontColor: PINE_FLOOR });
  fix(fId, { kind: 'box', label: 'Shelves', origin: { x: (CLOSET.x0 + CLOSET.x1) / 2, y: F.suite.bedNorth - HP }, direction: 270, width: CLOSET.x1 - CLOSET.x0, depth: 12, height: 84, frontColor: PINE_FLOOR });
  // Upstairs: the bath's tub-shower across its north end, the WC on the west wall and a 24" vanity
  // on the south wall clear of the door; 18" shelves in the linen closet. The shower over the tub is
  // its head and riser at the tap end only: nothing says what closes its front (screen, doors or a
  // curtain).
  fix(sId, { kind: 'bathtub', origin: { x: (IN.x0 + S.bathEast - HP) / 2, y: IN.y0 }, direction: 90, width: 60, depth: 32, height: 20, frontColor: WHITE, tubShower: 'head' });
  fix(sId, { ...WC, origin: { x: IN.x0, y: 62 }, direction: 0 });
  fix(sId, { kind: 'sink', origin: { x: 30, y: S.hallSouth - HP }, direction: 270, width: 24, depth: 20, height: 31.5 });
  fix(sId, { kind: 'box', label: 'Shelves', origin: { x: IN.x1, y: (IN.y0 + S.hallSouth - HP) / 2 }, direction: 180, width: S.hallSouth - HP - IN.y0, depth: 18, height: 84, frontColor: PINE_FLOOR });

  // ---- Furniture (Adirondack camp style, on the furniture layer). The great room faces the stove
  // and the lake: the log sofa with its back to the kitchen opening, the rocker and the armchair by
  // the window, a coffee table on the Navajo rug, a bookcase on the north wall by the cased
  // opening. The dining table by the lake window seats six. The master bedroom's king log bed on
  // the east wall between its windows, nightstands under them, a rug at its foot. Upstairs a queen
  // log bed in each bedroom with its headboard on the partition, a dresser under the window. Two
  // Adirondack chairs in the screen room facing the lake.
  furnish(fId, 'rug', { x: 130, y: 225 }, 180, { width: 96, depth: 72, fabric: 'navajo' });
  furnish(fId, 'sofa', { x: 160, y: 225 }, 180);
  furnish(fId, 'coffeeTable', { x: 112, y: 225 }, 180);
  furnish(fId, 'armchair', { x: 60, y: 258 }, 60, { fabric: 'woolPlaid' });
  furnish(fId, 'rocker', { x: 54, y: 196 }, 120);
  furnish(fId, 'bookcase', { x: 40, y: F.hallSouth + HP }, 90, { width: 48 });
  furnish(fId, 'floorLamp', { x: 162, y: 182 }, 180);
  const TABLE = { x: 239, north: 240, south: 276 };
  furnish(fId, 'diningTable', { x: TABLE.x, y: TABLE.south }, 270, { width: 72, depth: TABLE.south - TABLE.north, wood: 'nordicPine' });
  for (const x of [TABLE.x - 24, TABLE.x, TABLE.x + 24]) {
    furnish(fId, 'diningChair', { x, y: TABLE.north - 18 }, 90);
    furnish(fId, 'diningChair', { x, y: TABLE.south + 18 }, 270);
  }
  const BED_X = SUITE_CL.x1 - HN;
  furnish(fId, 'rug', { x: BED_X - 90, y: BED_Y }, 0, { width: 72, depth: 96, fabric: 'braided' });
  furnish(fId, 'bed', { x: BED_X, y: BED_Y }, 180, { bed: 'king', height: 48 });
  for (const side of [-1, 1]) furnish(fId, 'nightstand', { x: BED_X, y: BED_Y + side * 50 }, 180, { width: 24, depth: 18, height: 26 });
  furnish(fId, 'adirondackChair', { x: -66, y: 226 }, 90);
  furnish(fId, 'sideTable', { x: -42, y: 234 }, 90, { width: 18, depth: 18, wood: 'paintedGreen' });
  furnish(fId, 'adirondackChair', { x: -18, y: 226 }, 90);
  furnish(sId, 'bed', { x: S.partition - HP, y: 222 }, 180, { bed: 'queen' });
  for (const y of [172, 272]) furnish(sId, 'nightstand', { x: S.partition - HP, y }, 180);
  furnish(sId, 'dresser', { x: IN.x0, y: 200 }, 0);
  furnish(sId, 'rug', { x: 80, y: 222 }, 0, { width: 72, depth: 96, fabric: 'braided' });
  furnish(sId, 'bed', { x: S.partition + HP, y: 222 }, 0, { bed: 'queen', fabric: 'woolPlaid' });
  for (const y of [172, 272]) furnish(sId, 'nightstand', { x: S.partition + HP, y }, 0);
  furnish(sId, 'dresser', { x: IN.x1, y: 200 }, 180);
  furnish(sId, 'rug', { x: 300, y: 222 }, 180, { width: 72, depth: 96, fabric: 'navajo' });

  // ---- Alarms (R314, R315: verify against the 2025 RCNYS): a smoke alarm in each bedroom and in
  // the basement, a combination smoke and CO alarm outside the sleeping areas on each floor (by
  // the suite's door in the kitchen, in the hall upstairs) and in the great room with the stove.
  const alarm = (lid: Id, at: Vec2, what: string) =>
    fixture(lid, { kind: 'box', label: what, origin: { x: at.x, y: at.y - 3 }, direction: 90, width: 6, depth: 6, height: 2, elevation: level(lid).wallHeight - 2, frontColor: WHITE, phase: NEW });
  alarm(fId, { x: 400, y: 200 }, 'Smoke');
  alarm(fId, { x: 300, y: 200 }, 'Smoke/CO');
  alarm(fId, { x: 100, y: 160 }, 'Smoke/CO');
  alarm(sId, { x: 88, y: 260 }, 'Smoke');
  alarm(sId, { x: 242, y: 260 }, 'Smoke');
  alarm(sId, { x: 170, y: 72 }, 'Smoke/CO');
  alarm(bId, { x: MAIN.x1 / 2, y: MAIN.y1 / 2 + 24 }, 'Smoke');

  // ---- The wood stove on the great room's west wall at its south end, south of the screen room,
  // facing east: a fieldstone hearth 50" out and 40" wide, a stone surround on the wall, the stove
  // 6" off it. Its flue runs outside (as the renovation design's, docs/history/PLAN-v7-exterior-flue.md):
  // a black connector up from the stove's collar and west through a wall thimble 66" up; outdoors an
  // insulated stainless chimney 2" off the siding, south of the screen room's roof, straight up the
  // gable wall through the main roof's rake overhang, 3' over the roof where it leaves it and 2'
  // over anything within 10' (the 3-2-10 rule), with a rain cap.
  const STOVE = { y: 288 };
  const stone = (x0: number, x1: number, y0: number, y1: number, height: number, what: string) => {
    if (!store().addColumn({ at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, kind: 'pier', phase: NEW, width: x1 - x0, depth: y1 - y0, rotation: 0, base: FLOOR_TOP, top: FLOOR_TOP + height, color: FIELDSTONE })) throw new Error(`${what} rejected`);
  };
  stone(IN.x0, IN.x0 + 50, STOVE.y - 20, STOVE.y + 20, 1, 'hearth');
  stone(IN.x0, IN.x0 + 3, STOVE.y - 23, STOVE.y + 23, 60, 'stone surround');
  fix(fId, { kind: 'box', label: 'Wood stove', origin: { x: IN.x0 + 6, y: STOVE.y }, direction: 0, width: 24, depth: 26, height: 30, elevation: 1, frontColor: STOVE_BLACK });
  const THIMBLE = 66;
  const COLLAR = { x: IN.x0 + 12, y: STOVE.y };
  const FLUE = { x: MAIN.x0 - 2 - 4, y: STOVE.y };
  if (!store().addColumn({ at: COLLAR, kind: 'flue', phase: NEW, width: 8, depth: 8, rotation: 0, base: FLOOR_TOP + 31, top: FLOOR_TOP + THIMBLE + 4, color: STOVE_BLACK })) throw new Error('connector rejected');
  fix(fId, { kind: 'box', label: 'Stovepipe', origin: { x: IN.x0, y: STOVE.y }, direction: 0, width: 8, depth: COLLAR.x - 4 - IN.x0, height: 8, elevation: THIMBLE - 4, frontColor: STOVE_BLACK });
  fix(fId, { kind: 'box', label: 'Tee', origin: { x: MAIN.x0, y: STOVE.y }, direction: 180, width: 8, depth: MAIN.x0 - FLUE.x, height: 8, elevation: THIMBLE - 4, frontColor: METAL });
  const mainRoof = Object.values(level(sId).roofs).find((r) => r.phase === NEW)!;
  const secondTop = getLevelElevations(getPlan())[sId].floorTop;
  const roofTop = (p: Vec2) => {
    const under = roofHeightAt(mainRoof, roofBearing(level(sId).wallHeight, mainRoof), p);
    if (under === null) throw new Error(`no roof over ${JSON.stringify(p)}`);
    return secondTop + under + mainRoof.thickness;
  };
  const near = [FLUE.y - ft(10), MAIN.y1 / 2, FLUE.y + ft(10)].filter((y) => Math.abs(y - FLUE.y) <= ft(10) && y >= MAIN.y0 && y <= MAIN.y1);
  const flueTop = round2(Math.max(roofTop(FLUE) + 36, ...near.map((y) => roofTop({ x: FLUE.x, y }) + 24)));
  if (!store().addColumn({ at: FLUE, kind: 'flue', phase: NEW, width: 8, depth: 8, rotation: 0, base: FLOOR_TOP + THIMBLE - 10, top: flueTop, cap: true })) throw new Error('flue rejected');

  // ---- The new casework in Nordic pine (the kitchen, the vanities, the shelves).
  for (const lid of [fId, sId]) {
    for (const f of Object.values(level(lid).fixtures)) {
      if (f.phase === NEW && (isCabinet(f.kind) || (f.kind === 'box' && (f.label === 'Shelves' || f.label === 'Rods and shelves')))) store().updateFixture(lid, f.id, { wood: 'nordicPine' });
    }
  }

  // ---- Structure (placeholders for the engineer). The First Floor's joists run east-west on the
  // basement's three girders, as today. The Second Floor's joists run east-west too south of the
  // hall wall, bearing on the west wall, the kitchen / great room partition (over the middle
  // girder, x 170.5) and the east wall, 13'5" and 11'7" spans, with a flush beam over the 94"
  // dining opening on the girder's line, its ends on the partition and the south wall; over the
  // north band (the entry, the stair and the corridor) they run north-south, 8'5" from the road
  // wall to the hall wall, so nothing has to cross the stair well, and the hall wall bears them
  // (a doubled joist under it in the First Floor's framing, for the engineer). The ceiling joists
  // run north-south like the rafters (rafter ties) and bear on the upstairs hall wall, which stands
  // over the First Floor's. The hood's duct crosses the Second Floor's east-west joists over the
  // kitchen: it runs in the ceiling as drawn only if they are deep enough to hang it under; else it
  // goes up the partition and north through the band's joists. For the engineer.
  store().setLevelFraming(bId, { joists: 0 });
  store().setLevelFraming(fId, { joists: 0 });
  store().setLevelFraming(sId, { joists: 90 });
  if (!store().addJoistZone(fId, { outline: outline({ x0: MAIN.x0, x1: MAIN.x1, y0: MAIN.y0, y1: F.hallSouth }), joists: 90, phase: NEW })) throw new Error('joist zone rejected');
  const BEAM = MEMBER_DEFAULTS.beam;
  const GIRDER_X = 170.5;
  if (!store().addMember(fId, { kind: 'beam', a: { x: GIRDER_X, y: 259 - 47 - 6 }, b: { x: GIRDER_X, y: CL.y1 }, width: BEAM.width, depth: BEAM.depth, mount: 'flush', label: BEAM.label, phase: NEW })) throw new Error('beam rejected');
  // The basement stair passes under the middle girder's line (x 170.5) with its treads about 6' up
  // there, so that girder is cut back to the stair's south edge: a flush header in the First
  // Floor's framing along that edge from the west girder to the east one (y 45, beside the stair,
  // not over it) picks up the girder's north end and the headed joists; north of it the band's
  // joists are mostly the stair hole. The old girder is shown demolished (a placeholder itself,
  // its size and place to measure). For the engineer.
  const middle = Object.values(level(bId).members ?? {}).find((m) => m.kind === 'beam' && m.phase === 'existing' && m.a.x === GIRDER_X && m.b.x === GIRDER_X);
  if (!middle) throw new Error('no middle girder');
  store().setPhase(bId, { walls: [], openings: [], members: [middle.id] }, 'demo');
  const HEADER_Y = SPANDREL_Y + HP + 2.25;
  const girders = Object.values(level(bId).members ?? {}).flatMap((m) => (m.kind === 'beam' && m.phase === 'existing' ? [m.a.x] : []));
  if (girders.length !== 2) throw new Error(`${girders.length} outer girders`);
  if (!store().addMember(bId, { kind: 'beam', a: { x: Math.min(...girders), y: HEADER_Y }, b: { x: Math.max(...girders), y: HEADER_Y }, width: BEAM.width, depth: BEAM.depth, mount: 'flush', label: `${BEAM.label}: header at the basement stair`, phase: NEW })) throw new Error('header rejected');
  if (!store().addMember(bId, { kind: 'beam', a: { x: GIRDER_X, y: HEADER_Y }, b: { x: GIRDER_X, y: CL.y1 }, width: middle.width, depth: middle.depth, mount: 'dropped', label: 'middle girder cut back at the stair (engineer to size)', phase: NEW })) throw new Error('girder rejected');

  // ---- Labels (phase new: they show in the Proposed and All views; today's keep theirs in the
  // Existing view). Dry rooms in the painted V-groove boards and pale pine of the renovation design,
  // the wet rooms painted with tile, carpet in the upstairs bedrooms, boards on the screen room's
  // floor; the suite's rooms the same.
  // North of the old bump (y 191.5), so the All view, where the bump's walls still show, finds its own face.
  label(bId, 'Basement under the suite (new, walkout)', { x: 400, y: 100 }, NEW);
  label(fId, 'Coat closet (new)', { x: 40, y: 18 }, NEW, PROPOSED_PINE);
  label(fId, 'Entry hall (new)', { x: 40, y: 70 }, NEW, PROPOSED_PINE);
  label(fId, 'Basement stair (new)', { x: 155, y: 22 }, NEW, PROPOSED_PINE);
  label(fId, 'Powder room (new)', { x: 285, y: 44 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Pantry (new)', { x: 280, y: 86 }, NEW, PROPOSED_PINE);
  label(fId, 'Great room (new)', { x: 88, y: 150 }, NEW, PROPOSED_PINE);
  label(fId, 'Kitchen / dining (new)', { x: 242, y: 120 }, NEW, PROPOSED_PINE);
  label(fId, 'Master bedroom (new)', { x: 345, y: 290 }, NEW, PROPOSED_CARPET);
  label(fId, 'Master bath (new)', { x: 400, y: 70 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Suite hall (new)', { x: 336, y: 125 }, NEW, PROPOSED_PINE);
  label(fId, 'Walk-in closet (new)', { x: 387, y: 140 }, NEW, PROPOSED_CARPET);
  label(fId, 'Laundry (new)', { x: 450, y: 140 }, NEW, PLACEHOLDER_WET);
  label(fId, 'Screen room (new)', { x: -48, y: 192 }, NEW, { floorFinish: 'boards', floorColor: WOOD_FLOOR });
  label(sId, 'Hall (new)', { x: 170, y: 72 }, NEW, PROPOSED_PINE);
  label(sId, 'Bath (new)', { x: 42, y: 70 }, NEW, PLACEHOLDER_WET);
  label(sId, 'Linen closet (new)', { x: 285, y: 50 }, NEW, PROPOSED_PINE);
  label(sId, 'Bedroom west (new)', { x: 88, y: 160 }, NEW, PROPOSED_CARPET);
  label(sId, 'West closet (new)', { x: 42, y: 118 }, NEW, PROPOSED_CARPET);
  label(sId, 'Bedroom east (new)', { x: 242, y: 160 }, NEW, PROPOSED_CARPET);
  label(sId, 'East closet (new)', { x: 275, y: 118 }, NEW, PROPOSED_CARPET);

  // ---- The look after the work, as the renovation design's (MK, after his garage): brown painted
  // engineered shakes under a hunter green standing-seam roof, black windows trimmed in red, no
  // shutters. The Proposed view only.
  store().updateProposedLook({
    wallFinish: 'shake',
    wallColor: SHAKE_BROWN,
    roofFinish: 'seam',
    roofColor: '#2f4a36',
    boardColor: SHAKE_BROWN,
    trimColor: '#a8322d',
    sashColor: '#1c1c1c',
    shutters: false,
  });
}

/** Build the rebuild plan in the store and return it (the store is left holding it). */
export function buildRebuildPlan(): Plan {
  const ids = buildExistingHouse('146 Mick Road (rebuilt on the foundation, design study)');
  rebuild(ids);
  return getPlan();
}

/** The rebuild plan as the JSON text of docs/examples/146-mick-road-rebuild.json (stable ids, fixed date). */
export function buildRebuildJson(): string {
  return stableIds(buildRebuildPlan(), 'plan-146-mick-road-rebuild');
}
