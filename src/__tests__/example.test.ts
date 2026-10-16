import { Box3, type BufferGeometry, type Mesh, type MeshStandardMaterial } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExampleJson } from '../../scripts/example-plan';
import example from '../../docs/examples/146-mick-road.json';
import { getIssues } from '../derive/checks';
import { wallBearings } from '../derive/structure';
import { isTimber } from '../model/structure';
import { getDeckLayout } from '../derive/decks';
import { floorOpeningHole, getFloorOpeningLayout } from '../derive/floorOpenings';
import { getLevelElevations } from '../derive/levels';
import { shutterWidth, SILL_THICKNESS } from '../derive/openings3d';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { roofBearing, roofExtremes, roofHeightAt } from '../derive/roofs';
import { faceAt, getFaces } from '../derive/rooms';
import { fenceLayout, groundAt } from '../derive/site';
import { flightSteps, floorToFloor, stairsBase, stairsRise } from '../derive/stairs';
import { normalize, perpLeft, pointInPolygon, polygonSignedArea, sub } from '../model/geometry';
import { counterRuns, fixtureOutline } from '../derive/casework';
import { getStaircaseLayout } from '../derive/staircase';
import { computeFootprints } from '../derive/footprint';
import { clearMeshCache, getLevelMeshes, stairHoles } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { trimOf } from '../model/finish';
import { migrate } from '../model/plan';
import { FURNITURE, furnitureNameOf } from '../model/furniture';
import type { Level, Opening, Phase, Plan, Vec2, ViewMode } from '../model/types';

const plan: Plan = migrate(example);
const visibility = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: plan.levelOrder[1] };

/** Plan area (square inches) of a slab geometry's top faces (level, at the floor top, y 0). */
function slabTopArea(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  let area = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const [ay, by, cy] = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
    if (Math.abs(ay) > 1e-6 || Math.abs(by) > 1e-6 || Math.abs(cy) > 1e-6) continue;
    const [ax, az, bx, bz, cx, cz] = [pos.getX(i), pos.getZ(i), pos.getX(i + 1), pos.getZ(i + 1), pos.getX(i + 2), pos.getZ(i + 2)];
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return area;
}

afterAll(() => clearMeshCache());

describe('docs/examples/146-mick-road.json', () => {
  it('is what scripts/build-example.ts writes (run npm run build:example after changing the script)', () => {
    expect(JSON.parse(buildExampleJson())).toEqual(example);
  });

  it('loads through migrate() byte for byte', () => {
    expect(JSON.stringify(plan, null, 2) + '\n').toBe(buildExampleJson());
  });

  it('has the three levels and the estimate-flagging names', () => {
    expect(plan.levelOrder.map((id) => plan.levels[id].name)).toEqual(['Basement', 'First Floor', 'Second Floor']);
    expect(plan.name).toBe('146 Mick Road (starter, estimates flagged)');
    expect(plan.baseFloorElevation).toBe(-100);
    const [b, f, s] = plan.levelOrder.map((id) => plan.levels[id]);
    expect([b.wallHeight, b.floorThickness, f.wallHeight, f.floorThickness, s.wallHeight, s.floorThickness]).toEqual([90, 4, 96, 12, 96, 12]);
    // The labels of each view: the existing house in Existing, the proposed design in Proposed.
    const names = (id: string, vm: ViewMode) =>
      Object.values(plan.levels[id].rooms)
        .filter((r) => isVisible(r.phase ?? 'existing', vm))
        .map((r) => r.name)
        .sort();
    const [lb, lf, ls] = plan.levelOrder;
    expect(names(lb, 'existing')).toEqual(['Basement (unpartitioned, est.)', 'Utility (below)']);
    // The old entry hall is MK's front room; the stair strip is part of the Living (photos 16 to 20).
    expect(names(lf, 'existing')).toEqual(['Bath', 'Entry porch (est.)', 'Front room', 'Kitchen (17\'2" adjusted: re-measure)', 'Living', 'Utility']);
    expect(names(ls, 'existing')).toEqual(['Bath', 'Bunk', 'Guest (11\'5" adjusted)', 'Master', 'Master closet', 'Office / hall (11\'11" adjusted)']);
    expect(names(lb, 'proposed')).toEqual(['Basement (unpartitioned, est.)', 'Crawl space (proposed)', 'Crawl space under the foyer (proposed)', 'Utility (below)']);
    expect(names(lf, 'proposed')).toEqual([
      'Foyer (proposed)',
      'Kitchen (17\'2" adjusted: re-measure)',
      'Laundry (proposed)',
      'Living',
      'Master bath (proposed)',
      'Master bedroom (proposed)',
      'Pantry (proposed)',
      'Powder room (proposed)',
      'Screen porch (proposed)',
    ]);
    // Upstairs the Bunk is the stair hall's upper half (open to below) and the old bath the stair's
    // top landing; the new bath is east of it; there is no hall (the Guest takes the Office); the
    // rest keep their names. The Master and the Guest get closets (the livability review).
    expect(names(ls, 'proposed')).toEqual(['Bath (proposed)', 'Guest (11\'5" adjusted)', 'Guest closet (proposed)', 'Landing (proposed)', 'Master', 'Master closet', 'Master wardrobe (proposed)']);
  });

  it('counts the existing, demolished and new work', () => {
    const levels = plan.levelOrder.map((id) => plan.levels[id]);
    const count = (items: { phase?: Phase }[]) => {
      const out: Record<Phase, number> = { existing: 0, demo: 0, new: 0 };
      for (const x of items) out[x.phase ?? 'existing']++;
      return out;
    };
    const all = <K extends 'walls' | 'openings' | 'stairs' | 'roofs' | 'rooms' | 'fixtures' | 'decks' | 'floorOpenings'>(k: K) => levels.flatMap((l) => Object.values(l[k]));
    // Walls demolished (a new wall does not split a demolished one it meets): the old porch's two,
    // the wing's north wall, the three y 99.5 pieces and the old bath's west wall on the First Floor;
    // upstairs the Bunk's east wall (the old bath's west wall, the stair's top landing), the old
    // bath's south wall, and the Master's and the Guest's old north walls (no hall; the Bunk's south
    // wall stays as the Master's north wall). New: the addition, its partition, the foyer, the
    // screen porch, the north band's two walls, the powder room's three under the stair and the
    // laundry closet's two (each splitting what it meets but the demolished walls), the block under
    // the addition and under the foyer, the upstairs bath's south wall, the landing's three walls
    // (the Master's east wall, its south and east walls), and the closets of the livability review
    // (the Master's wardrobe and the Guest's closet, two walls each; the master bedroom's wardrobes
    // are built-in cabinets, not walls). The
    // retaining wall's three pieces on the Basement are existing; its two pieces carried west to the
    // property line are new. The laundry closet's north wall meets the main block's east wall where
    // the pantry's south wall does (y 57.5), so the two split it once. The foyer moved north (MK, 16
    // Oct 2026) with the house door north of the beam post: today's west wall from y 8 to y 99.5
    // (the old front door's piece among them) is demolished in three pieces and rebuilt in two either
    // side of the foyer's north wall: two existing pieces fewer, three demolished and two new more.
    expect(count(all('walls'))).toEqual({ existing: 51, demo: 16, new: 37 });
    // Upstairs, the Bunk's, the old bath's, the Master's and the Guest's doors go; the new bath's,
    // the Master's and the Guest's are off the landing. Today's grey half-lite door to the Utility
    // and the Guest's three-sash south window give way to a solid door and a two-sash window in the
    // same openings. Today's 48" Living doorway gives way to the wide Kitchen/Living opening. The
    // wing's east casement pair goes for the two windows flanking the master bedroom's king bed.
    // Nothing takes the place of the Living's west window: the stove stands there (MK, 15 Oct 2026).
    expect(count(all('openings'))).toEqual({ existing: 9, demo: 23, new: 30 });
    // The demolished stair: today's flight. Today's wooden stair (two flights, along the wing's east
    // side and down the bank, with its landing, a deck) stays (MK). New: the grand stair's bottom
    // step, landing and straight run, and the master bedroom's deck; the stair hall's floor opening
    // upstairs.
    expect(count(all('stairs'))).toEqual({ existing: 2, demo: 1, new: 3 });
    expect(count(all('decks'))).toEqual({ existing: 1, demo: 0, new: 1 });
    expect(count(all('floorOpenings'))).toEqual({ existing: 0, demo: 0, new: 1 });
    expect(count(all('roofs'))).toEqual({ existing: 1, demo: 2, new: 3 });
    // The upstairs Bath's label goes with the old bath (its new one is east of the stair's top
    // landing) and the Office / hall's with the hall (the Landing's is new); the Coats closet is gone.
    // The master bedroom's wardrobes are cabinets, so they carry no label.
    expect(count(all('rooms'))).toEqual({ existing: 7, demo: 7, new: 13 });
    // Every fixture of today (Kitchen, Bath, front room, Utility) gives way to the proposed kitchen,
    // the pantry's shelves, the stove with its stovepipe and tee, and the placeholder bath and
    // laundry fixtures (the walk-in shower in four pieces), the foyer's bench and hooks, the dryer's
    // vent and the range hood's duct, the master bedroom's wardrobes, king bed and nightstands, and
    // seven alarms, all new; and the furniture (MK, 15 Oct 2026): 8 pieces in the Living, 3 on the
    // screen porch, a rug in the master bedroom, 5 in the upstairs west room (two full beds, a
    // nightstand, a dresser, a rug) and 7 in the east room (a queen bed, two nightstands, a desk and
    // its chair, a dresser, a rug).
    // The foyer's coat bench (built in) replaces its loose bench and two hook rails: two fewer.
    expect(count(all('fixtures'))).toEqual({ existing: 0, demo: 34, new: 89 });
    // The masonry chimney is demolished; the stove's connector and its flue are new, and six
    // fieldstone piers: two under the entry canopy's log posts, its stoop, and one under each of the
    // screen porch's three log posts.
    expect(count(Object.values(plan.site.columns))).toEqual({ existing: 0, demo: 1, new: 8 });
    // Demolished: the stair, the house door, the entry porch with its five screen openings, its roof
    // and label, the wing's north wall (it has no window), the wing's roof and its south window (a
    // sliding door replaces it), the east window into the new bedroom, the front room's walls with
    // the hall passage and the old bath's door, the front room's north window (the stair climbs in
    // front of it), the Living's west window (the stove's wall now) and the old bath's north
    // window (the pantry's shelves line that wall). Upstairs, the two east windows (the wing's shed
    // rises past their sills; transoms replace them) and the Bunk's door with its wall.
    const f = plan.levels[plan.levelOrder[1]];
    expect(Object.values(f.rooms).filter((r) => r.phase === 'demo').map((r) => r.name).sort()).toEqual(['Bath', 'Entry porch (est.)', 'Front room', 'Utility']);
    // A demolished wall's openings are demolished with it.
    for (const o of Object.values(f.openings)) if (f.walls[o.wallId].phase === 'demo') expect(o.phase).toBe('demo');
  });

  it("the main block measures 26'6\" x 26'3\" on the outside faces", () => {
    for (const id of plan.levelOrder) {
      const level = plan.levels[id];
      // The block's walls: the ones whose both ends are on the block's four corners' lines.
      const main = Object.values(level.walls).filter((w) => {
        if (w.kind !== 'exterior') return false;
        const a = level.nodes[w.a];
        const b = level.nodes[w.b];
        return [a, b].every((n) => n.x >= 3.5 - 1e-9 && n.x <= 314.5 + 1e-9 && n.y >= 3.5 - 1e-9 && n.y <= 311.5 + 1e-9) && (a.x === b.x ? a.x === 3.5 || a.x === 314.5 : a.y === 3.5 || a.y === 311.5);
      });
      const xs = main.flatMap((w) => [level.nodes[w.a].x, level.nodes[w.b].x]);
      const ys = main.flatMap((w) => [level.nodes[w.a].y, level.nodes[w.b].y]);
      const t = main[0].thickness;
      // Centerlines are 311 x 308 apart: the outside is 318 x 315 with 7" walls (the 8" basement
      // walls share the centerlines and stand 1/2" proud of the siding all round).
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(311, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(308, 6);
      for (const w of main) expect(w.thickness).toBe(id === plan.levelOrder[0] ? 8 : 7);
      if (id !== plan.levelOrder[0]) {
        expect(Math.max(...xs) - Math.min(...xs) + t).toBeCloseTo(318, 6);
        expect(Math.max(...ys) - Math.min(...ys) + t).toBeCloseTo(315, 6);
      }
    }
  });

  /** Net bounding-box size of the named room's face in a view (default: the existing house). */
  const faceSize = (level: Level, name: string, vm: ViewMode = 'existing'): [number, number] => {
    const set = getFaces(level, vm);
    const room = Object.values(level.rooms).find((r) => r.name === name || r.name.startsWith(`${name} (`));
    const face = set.faces.find((f) => f.roomId === room?.id);
    expect(face, name).toBeDefined();
    const xs = face!.netPolygon.map((p) => p.x);
    const ys = face!.netPolygon.map((p) => p.y);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const expectSizes = (level: Level, expected: Record<string, [number, number]>, vm: ViewMode = 'existing') => {
    for (const [name, [w, h]] of Object.entries(expected)) {
      const [fw, fh] = faceSize(level, name, vm);
      expect(Math.abs(fw - w), `${name} east-west ${fw}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(fh - h), `${name} north-south ${fh}`).toBeLessThanOrEqual(0.5);
    }
  };

  it('has the measured First Floor partitions (5") and rooms', () => {
    const level = plan.levels[plan.levelOrder[1]];
    const interior = Object.values(level.walls).filter((w) => w.kind === 'interior');
    expect(interior.length).toBeGreaterThanOrEqual(5);
    for (const w of interior) expect(w.thickness).toBe(5);
    for (const w of Object.values(level.walls).filter((w) => w.kind === 'exterior')) expect(w.thickness).toBe(7);
    // One stair today, climbing east from about 2' in from the west wall (photos 16 and 18) to x 132,
    // cutting the floor above.
    const stairs = Object.values(level.stairs).filter((s) => isVisible(s.phase, 'existing'));
    expect(stairs).toHaveLength(1);
    expect(stairs[0].direction).toBe(0);
    expect(stairs[0].origin).toEqual({ x: 31, y: 118.5 });
    expect(stairs[0].run).toBe(101);
    expect(stairs[0].cutsFloorAbove).toBe(true);
    const faces = getFaces(level, 'existing');
    expect(faces.openEnds).toHaveLength(0);
    expect(faces.orphanRoomIds).toHaveLength(0);
    // Face to face sizes (east-west x north-south) from the owner's tape; the Living takes in the
    // 2'9" stair strip (no wall on the stair's south side), 168" + 5" + 33".
    expectSizes(level, { Kitchen: [138, 206], Living: [161, 206], Bath: [114, 90], 'Front room': [185, 90], Utility: [138, 113] });
  });

  it('has the measured Second Floor partitions (5") and rooms', () => {
    const level = plan.levels[plan.levelOrder[2]];
    const interior = Object.values(level.walls).filter((w) => w.kind === 'interior');
    expect(interior.length).toBeGreaterThanOrEqual(8);
    for (const w of interior) expect(w.thickness).toBe(5);
    const faces = getFaces(level, 'existing');
    expect(faces.openEnds).toHaveLength(0);
    expect(faces.orphanRoomIds).toHaveLength(0);
    expectSizes(level, { Bunk: [162, 90], Bath: [44, 74], Master: [162, 168], Guest: [137, 153], 'Master closet': [30, 33] });
    // The Office / hall is one face with the landing and the stair well: 7'4" wide at the east wall.
    const [, officeH] = faceSize(level, 'Office / hall');
    expect(Math.abs(officeH - 143)).toBeLessThanOrEqual(0.5);
  });

  it('swings each Second Floor door into the room the plan names', () => {
    const level = plan.levels[plan.levelOrder[2]];
    const set = getFaces(level, 'existing');
    const roomAtLeaf = (o: (typeof level.openings)[string]): string | undefined => {
      const w = level.walls[o.wallId];
      const a = level.nodes[w.a];
      const b = level.nodes[w.b];
      const dir = normalize(sub(b, a));
      const n = perpLeft(dir);
      const side = (o.swing?.side ?? 'left') === 'left' ? 1 : -1;
      const p = { x: a.x + dir.x * o.offset + n.x * side * 12, y: a.y + dir.y * o.offset + n.y * side * 12 };
      const face = faceAt(set, p);
      return face ? Object.values(level.rooms).find((r) => r.id === face.roomId)?.name : undefined;
    };
    const into: Record<string, string> = { '28@99.5': 'Bunk', '28@137.5': 'Master', '24@83.5': 'Office', '30@152.5': 'Guest' };
    // Today's doors (the new bath's is checked with the design's).
    const doors = Object.values(level.openings).filter((o) => o.type === 'door' && o.phase !== 'new');
    expect(doors).toHaveLength(4);
    for (const o of doors) {
      const a = level.nodes[level.walls[o.wallId].a];
      const b = level.nodes[level.walls[o.wallId].b];
      const key = `${o.width}@${a.y === b.y ? a.y : '?'}`;
      expect(roomAtLeaf(o), key).toMatch(new RegExp(`^${into[key]}`));
    }
  });

  it('has the First Floor as the interior photos and MK show it', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const existing = Object.values(f.fixtures).filter((x) => x.phase === 'demo');
    // The Bath door: its south jamb about 1' from the Bath's south wall face (y 97), photos 20 and 22.
    const bathDoor = Object.values(f.openings).find((o) => o.type === 'door' && o.width === 30 && o.phase === 'demo')!;
    const w = f.walls[bathDoor.wallId];
    const [a, b] = [f.nodes[w.a], f.nodes[w.b]];
    const y = a.y + ((b.y - a.y) / Math.abs(b.y - a.y)) * bathDoor.offset;
    expect([a.x, y - 15, y + 15]).toEqual([194.5, 54, 84]);
    // The front room's pipe chase: a 4" full-height box across the corner at 45 degrees, its face
    // from the north wall's face (y 7) to the Bath's west wall face (x 192).
    const angled = existing.find((x) => x.kind === 'box' && x.height === 96 && x.direction === 135)!;
    const [, east, north] = fixtureOutline(angled);
    expect(east.x).toBeCloseTo(192, 0);
    expect(north.y).toBeCloseTo(7, 0);
    // The Utility (inside x 318..456, y 195..308): wall cabinets on its north and west walls, open
    // shelves under its south and east windows, a blue mini fridge; nothing reaches past its faces.
    const inUtility = existing.filter((x) => fixtureOutline(x).every((p) => p.x >= 318 - 1e-6 && p.x <= 456 + 1e-6 && p.y >= 195 - 1e-6 && p.y <= 308 + 1e-6));
    expect(inUtility.map((x) => (x.kind === 'box' ? x.label : x.kind)).sort()).toEqual(['Mini fridge', 'Open shelves', 'Open shelves', 'wall', 'wall', 'wall', 'wall', 'wall']);
    // The rooms' interior finishes from the photos (the Utility's from MK): the Kitchen's blue check
    // and beige tile, the Living's cream boards and the front room's cream paint over a red-brown
    // board floor, the Bath's green over a 40" pine wainscot on parquet, the Utility's pine on wood.
    const finishOf = (prefix: string) => {
      const r = Object.values(f.rooms).find((x) => x.name.startsWith(prefix))!;
      return [r.wallFinish, r.wainscot?.finish ?? null, r.wainscot?.height ?? null, r.floorFinish];
    };
    expect(finishOf('Kitchen')).toEqual(['check', null, null, 'tile']);
    expect(finishOf('Living')).toEqual(['boards', null, null, 'boards']);
    expect(finishOf('Front room')).toEqual(['paint', null, null, 'boards']);
    expect(finishOf('Bath')).toEqual(['paint', 'pine', 40, 'parquet']);
    expect(finishOf('Utility')).toEqual(['pine', null, null, 'boards']);
    // In the existing view each of those rooms has its floor finish and dresses the walls round it.
    const meshes = getLevelMeshes(plan, f.id, 'existing');
    expect(meshes.floorFinishes.length).toBe(5);
    const dressedRooms = new Set(meshes.walls.flatMap((w) => (w.faces ?? []).map((x) => f.rooms[x.roomId].name.split(' ')[0])));
    expect([...dressedRooms].sort()).toEqual(['Bath', 'Front', 'Kitchen', 'Living', 'Utility']);
    // The shelves stay under the windows' 30" sills.
    expect(inUtility.filter((x) => x.label === 'Open shelves').every((x) => x.height < 30)).toBe(true);
  });

  it('has the yard: Mick Road, the gravel pull-off and strip, the porch step and the split-rail fence', () => {
    const surfaces = Object.values(plan.site.surfaces);
    const box = (o: Vec2[]) => [Math.min(...o.map((p) => p.x)), Math.min(...o.map((p) => p.y)), Math.max(...o.map((p) => p.x)), Math.max(...o.map((p) => p.y))];
    expect(surfaces.map((x) => [x.material, x.phase, box(x.outline)])).toEqual([
      // Mick Road, 18' wide, 12' north of the north face; the pull-off between it and the house.
      ['asphalt', 'existing', [-1200, -360, 900, -144]],
      ['gravel', 'existing', [-216, -144, 300, -24]],
      // The porch entry's pad and two flagstones, demolished for the proposed foyer and its stoop.
      ['concrete', 'demo', [-96, 24, -66, 72]],
      ['stone', 'demo', [-98, 96, -78, 112]],
      ['stone', 'demo', [-104, 126, -84, 142]],
      // The strip along the lake face.
      ['gravel', 'existing', [6, 327, 300, 339]],
    ]);
    // Nothing paved runs under the house or the chimney.
    for (const x of surfaces) for (const p of x.outline) expect(p.y < -20 || p.x <= -66 || p.y > 315).toBe(true);
    // The fence: two rails, a foot inside the retaining wall's top, every post standing on the ground
    // and none more than 10' from the next.
    const fences = Object.values(plan.site.fences);
    expect(fences.map((f) => [f.height, f.rails, f.postSpacing, f.phase, f.points.length])).toEqual([[42, 2, 120, 'existing', 5]]);
    const layout = fenceLayout(fences[0], (p) => groundAt(plan, p));
    for (let i = 1; i < layout.posts.length; i++) expect(Math.hypot(layout.posts[i].at.x - layout.posts[i - 1].at.x, layout.posts[i].at.y - layout.posts[i - 1].at.y)).toBeLessThanOrEqual(120 + 1e-6);
    // On the terrace (-6) along the retaining wall.
    for (const p of fences[0].points.slice(1, 4)) expect(groundAt(plan, p)).toBeCloseTo(-6, 0);
  });

  it('has the roofs, columns, windows, doors and terrain of the house', () => {
    const allRoofs = plan.levelOrder.flatMap((id) => Object.values(plan.levels[id].roofs));
    const roofs = allRoofs.filter((r) => isVisible(r.phase, 'existing'));
    // Main gable, east wing gable, and the entry porch gable (one porch on the west face, photo 8).
    expect(roofs).toHaveLength(3);
    // Corrugated metal with open eaves (rafter tails) and boards in the stain; weathered galvanized
    // on the main block (rust 0.6) and the porch (0.7), a browner sheet on the wing (0.3). The
    // proposed roofs are the same metal.
    for (const r of allRoofs) {
      expect(r).toMatchObject({ finish: 'metal', eave: 'open', rafter: { depth: 5.5, spacing: 24 }, thickness: 2.5, fascia: 7, boardColor: '#5a3a35' });
    }
    expect(roofs.map((r) => `${r.color} ${r.weathering}`).sort()).toEqual(['#6e4b3c 0.3', '#8a8378 0.6', '#8a8378 0.7']);
    // The chimney: 24" along the north wall and 20" out from it, stained like the house, capped.
    const columns = Object.values(plan.site.columns).filter((c) => isVisible(c.phase, 'existing'));
    expect(columns.map((c) => c.kind)).toEqual(['chimney']);
    expect(columns[0]).toMatchObject({ at: { x: 159, y: -10 }, width: 24, depth: 20, rotation: 0, color: '#5a3a35', cap: true });
    const openings = plan.levelOrder.flatMap((id) => {
      const level = plan.levels[id];
      return Object.values(level.openings).filter((o) => isOpeningVisible(o, level.walls[o.wallId], 'existing'));
    });
    // The wing's north face has no window (MK).
    expect(openings.filter((o) => o.type === 'window')).toHaveLength(19);
    // The house door, the porch's screen door, the basement walkout double door, the first-floor
    // Bath and Kitchen to Utility doors, and the Second Floor's Bunk, Master, Bath and Guest doors.
    expect(openings.filter((o) => o.type === 'door')).toHaveLength(9);
    // The Kitchen/Living passage and pass-through, the front room's opening to the stair strip, the
    // Master closet opening.
    expect(openings.filter((o) => o.type === 'passage')).toHaveLength(4);
    // The porch: screens in its four bays and a screen door.
    expect(openings.filter((o) => o.glazing === 'screen').map((o) => `${o.type} ${o.width}`).sort()).toEqual(['door 36', 'window 18', 'window 18', 'window 44', 'window 44']);
    expect(Object.values(plan.levels[plan.levelOrder[1]].rooms).some((r) => r.name === 'Entry porch (est.)')).toBe(true);
    // 40 from the photos, MK and the site sketch (the retaining wall's line), 8 for the bank below
    // the walkout and the lower lawn (photos 24 to 27), and 1 for the lawn falling away from the
    // foyer's stoop.
    expect(Object.keys(plan.site.gradePoints)).toHaveLength(49);
    // The lake-side terrace is filled in level at -6 from the house's south face to the retaining
    // wall, and from the wall's free west end to the wing (MK); the ground along the house's other
    // faces stays within a foot of the first floor (no sag between grade points).
    for (let x = -110; x <= 300; x += 15) for (const y of [316, 350, 390, 425]) expect(groundAt(plan, { x, y }), `${x},${y}`).toBeCloseTo(-6, 6);
    for (let x = 0; x <= 318; x += 6) expect(groundAt(plan, { x, y: -1 })).toBeGreaterThan(-10);
    for (let y = 0; y <= 315; y += 6) expect(groundAt(plan, { x: -1, y })).toBeGreaterThan(-10);
    for (let y = 0; y <= 180; y += 6) expect(groundAt(plan, { x: 319, y })).toBeGreaterThan(-10);
    // The porch's floor (top +2) is at grade: the ground is at +1 round it, its corners against the
    // house too; the walkout's threshold is at the basement floor in front of both jambs.
    const grade = (x: number, y: number) => Object.values(plan.site.gradePoints).find((g) => g.at.x === x && g.at.y === y)?.elevation;
    expect([grade(-66, 0), grade(-66, 48), grade(-66, 96), grade(0, 0), grade(0, 96)]).toEqual([1, 1, 1, 1, 1]);
    expect([grade(354.5, 321), grade(426.5, 321)]).toEqual([-100, -100]);
    expect(plan.site.northAngle).toBe(0);
  });

  it('has the target exterior in the Proposed view: brown shakes, a green standing-seam roof, black windows trimmed red', () => {
    expect(plan.proposedLook).toEqual({
      wallFinish: 'shake',
      wallColor: '#4b3a32',
      roofFinish: 'seam',
      roofColor: '#2f4a36',
      boardColor: '#4b3a32',
      trimColor: '#a8322d',
      sashColor: '#1c1c1c',
      shutters: false,
    });
    const f = plan.levelOrder[1];
    const proposed = getLevelMeshes(plan, f, 'proposed');
    expect(new Set(proposed.walls.filter((w) => w.kind === 'exterior').map((w) => w.finish))).toEqual(new Set(['shake']));
    expect(new Set(proposed.roofs.map((r) => r.finish))).toEqual(new Set(['seam']));
    expect(proposed.openings.every((o) => o.trimColor === '#a8322d' && o.sashColor === '#1c1c1c' && !o.parts.some((p) => p.part === 'shutter'))).toBe(true);
    // Today's look in Existing: shingle and clapboard, corrugated metal, shutters on the west window.
    const existing = getLevelMeshes(plan, f, 'existing');
    expect(existing.walls.some((w) => w.finish === 'shake')).toBe(false);
    expect(existing.openings.some((o) => o.parts.some((p) => p.part === 'shutter'))).toBe(true);
  });

  it('dresses the faces as the photos show them', () => {
    const [b, f] = plan.levelOrder.map((id) => plan.levels[id]);
    const at = (level: Level, o: Opening) => {
      const w = level.walls[o.wallId];
      const a = level.nodes[w.a];
      const d = normalize(sub(level.nodes[w.b], a));
      return { x: a.x + d.x * o.offset, y: a.y + d.y * o.offset };
    };
    const existing = Object.values(f.openings).filter((o) => isOpeningVisible(o, f.walls[o.wallId], 'existing'));
    // The main block's south picture windows (photos 1, 14, 17): casement, fixed pane, casement, about
    // 12' and 10' wide, the casements 2 x 4 lites.
    const south = existing.filter((o) => o.type === 'window' && Math.abs(at(f, o).y - 311.5) < 1e-6 && at(f, o).x < 318);
    expect(south.map((o) => [o.width, o.sashes, o.fixedCenter, o.lites]).sort()).toEqual([
      [118, 3, true, { cols: 2, rows: 4 }],
      [144, 3, true, { cols: 2, rows: 4 }],
    ]);
    // The house door (photos 8 and 19): dark green, one lite over two panels, swinging in.
    const door = existing.find((o) => o.type === 'door' && Math.abs(at(f, o).x - 3.5) < 1e-6)!;
    expect(door).toMatchObject({ width: 36, lites: { cols: 1, rows: 1 }, halfLite: true, leafColor: '#2f4a3a' });
    // The basement: grey block, but vertical boards in the stain round the walkout double door
    // (photo 2), and the poured retaining wall outside (photos 2 and 23): its three pieces today and
    // the two carrying it on west to the property line (the site sketch).
    const walls = Object.values(b.walls);
    const plain = (vm: 'existing' | 'proposed') => walls.filter((w) => w.finish === 'plain' && isVisible(w.phase, vm)).length;
    expect([plain('existing'), plain('proposed')]).toEqual([3, 5]);
    const retaining = walls.filter((w) => w.finish === 'plain');
    expect(retaining.map((w) => [w.thickness, w.color, w.heightOverride])).toEqual(Array(5).fill([10, '#b3b0a8', 96]));
    // The foyer's foundation is faced in fieldstone (the Adirondack entry's stone base).
    const stone = walls.filter((w) => w.finish === 'stone');
    expect(stone.map((w) => [w.phase, w.thickness, w.color])).toEqual(Array(3).fill(['new', 8, '#8e8579']));
    expect(walls.filter((w) => w.finish === 'block' && w.color === '#8f8a84')).toHaveLength(walls.length - 1 - retaining.length - stone.length);
    const boards = walls.find((w) => w.finish === 'board')!;
    expect(boards.color).toBe('#5a3a35');
    const walkout = Object.values(b.openings);
    expect(walkout).toHaveLength(1);
    // The foundation under the proposed addition is block too; the foyer's is stone.
    expect(walls.filter((w) => w.phase === 'new' && w.finish !== 'plain' && w.finish !== 'stone').every((w) => w.finish === 'block' && w.thickness === 8)).toBe(true);
    expect(walkout[0]).toMatchObject({ type: 'door', wallId: boards.id, width: 72, height: 80, sashes: 2, leafColor: '#5a3a35', trim: 0 });
  });

  it.each(['existing', 'proposed'] as const)('no two window or door surrounds (trim, sill, shutters) overlap on a face in the %s view', (vm) => {
    for (const id of plan.levelOrder) {
      const level = plan.levels[id];
      const boxes = Object.values(level.openings)
        .filter((o) => o.type !== 'passage' && isOpeningVisible(o, level.walls[o.wallId], vm))
        .map((o) => {
          const w = level.walls[o.wallId];
          const a = level.nodes[w.a];
          const d = normalize(sub(level.nodes[w.b], a));
          const reach = o.width / 2 + trimOf(o) + (o.shutters ? shutterWidth(o.width, o.sashes) : 0);
          return { id: o.id, a, d, s0: o.offset - reach, s1: o.offset + reach, y0: o.sill - (o.type === 'window' ? SILL_THICKNESS : 0), y1: o.sill + o.height + trimOf(o) };
        });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i];
          const q = boxes[j];
          // Only openings in walls on one line can collide.
          const off = sub(q.a, p.a);
          if (Math.abs(p.d.x * q.d.y - p.d.y * q.d.x) > 1e-9 || Math.abs(p.d.x * off.y - p.d.y * off.x) > 1e-6) continue;
          // q's interval in p's frame.
          const shift = p.d.x * off.x + p.d.y * off.y;
          const sign = p.d.x * q.d.x + p.d.y * q.d.y;
          const [q0, q1] = [shift + sign * q.s0, shift + sign * q.s1].sort((m, n) => m - n);
          const overlap = Math.min(p.s1, q1) - Math.max(p.s0, q0) > 1e-9 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 1e-9;
          expect(overlap, `${level.name}: ${p.id} and ${q.id}`).toBe(false);
        }
      }
    }
  });

  it('passes the code checks: guards, the grand stair and the structure; seven header notes', () => {
    expect(getIssues(plan).filter((i) => i.severity !== 'info').map((i) => `${i.code}: ${i.message}`)).toEqual([]);
    // Headers for the engineer: the new openings cut into existing bearing walls (the west wall and
    // the Kitchen/Living partition carry the upstairs ceiling beams' ends down from above). The
    // bedroom's solid door and the Guest's two-sash window go in today's openings, whose headers are
    // there; the tool notes them all the same.
    expect(getIssues(plan).map((i) => [plan.levels[i.levelId].name, i.code, i.at])).toEqual([
      ['First Floor', 'structure.wall-opening', { x: 314.5, y: 264 }],
      ['First Floor', 'structure.wall-opening', { x: 170.5, y: 169.25 }],
      ['First Floor', 'structure.wall-opening', { x: 25, y: 3.5 }],
      ['First Floor', 'structure.wall-opening', { x: 459.5, y: 289 }],
      ['Second Floor', 'structure.wall-opening', { x: 314.5, y: 222 }],
      ['Second Floor', 'structure.wall-opening', { x: 140, y: 3.5 }],
      ['Second Floor', 'structure.wall-opening', { x: 256, y: 311.5 }],
    ]);
  });

  it('infers the bearing walls: the y 99.5 wall taken out, the partition the beams land on', () => {
    const [, fId, sId] = plan.levelOrder;
    const bearing = (view: 'existing' | 'proposed', lid: string) =>
      [...wallBearings(plan, view)[lid]]
        .filter(([id, b]) => b.bearing && plan.levels[lid].walls[id].kind === 'interior')
        .map(([id, b]) => {
          const l = plan.levels[lid];
          const w = l.walls[id];
          return [w.phase, l.nodes[w.a].x, l.nodes[w.a].y, l.nodes[w.b].x, l.nodes[w.b].y, b.reason.split(' (')[0]];
        });
    expect(bearing('existing', fId)).toEqual([
      ['demo', 314.5, 99.5, 194.5, 99.5, 'the joists cross it mid-span'],
      ['demo', 194.5, 99.5, 170.5, 99.5, 'the joists cross it mid-span'],
      ['demo', 170.5, 99.5, 3.5, 99.5, 'the joists cross it mid-span'],
    ]);
    // Both beams end at the same point on the partition (y 99.5), and the upstairs Master/Guest
    // partition, carrying the ceiling beams' ends, stands on it.
    expect(bearing('proposed', fId)).toEqual([['existing', 170.5, 311.5, 170.5, 99.5, 'a bearing wall above stands on it']]);
    // Upstairs, the Bunk's south wall (y 99.5) is not bearing: the attic joists span 11'-2" without it.
    expect(bearing('existing', sId).map((r) => r[2])).toEqual([137.5, 137.5, 152.5]);
  });

  it('has no open wall ends but the retaining wall\'s free west end (today\'s, or the new one\'s at the property line), and no orphan labels, in any view', () => {
    for (const vm of ['existing', 'proposed', 'all'] as const) {
      for (const id of plan.levelOrder) {
        const level = plan.levels[id];
        const set = getFaces(level, vm);
        const ends = set.openEnds.map((n) => [level.nodes[n].x, level.nodes[n].y]);
        expect(ends, `${level.name} ${vm}`).toEqual(id === plan.levelOrder[0] ? [vm === 'existing' ? [-388, 489] : [-984, 519]] : []);
        expect(set.orphanRoomIds, `${plan.levels[id].name} ${vm}`).toHaveLength(0);
      }
    }
  });

  it('has the rooms of the proposed design (face to face, east-west x north-south)', () => {
    const [b, f, s] = plan.levelOrder.map((id) => plan.levels[id]);
    expectSizes(
      f,
      {
        // The wing grown north: bath 11'6" x 10'5 1/2", bedroom 11'6" x 14'2 1/2" (the old Utility plus 4'9").
        'Master bath': [138, 125.5],
        'Master bedroom': [138, 170.5],
        // The kitchen south of the north band, the old bath included.
        Kitchen: [138, 248],
        // The Living, open to the stair hall (the old front room, the stair strip and the stair).
        Living: [161, 301],
        // The north band, 4' deep, all walk-in pantry; the powder room under the stair's high end.
        'Powder room': [63.5, 37],
        Pantry: [138, 48],
        // Moved 3' north (MK, 16 Oct 2026), 2" shorter; the porch 3' longer.
        Foyer: [89, 96],
        'Screen porch': [89, 188],
      },
      'proposed',
    );
    expectSizes(b, { 'Crawl space': [137, 180], 'Utility (below)': [137, 112] }, 'proposed');
    // Upstairs the bath runs across the north-east east of the stair's top landing (the old bath's
    // east wall is its west wall), and the Bunk is the stair hall's upper half, open to below. No
    // hall: the Master takes the balcony up to the Bunk's old south wall, the Guest takes the Office
    // (an L to the bath's south wall), and the landing is all that is left (its face takes in the
    // stair hall's opening, x 7..218, y 7..135).
    // The Master's wardrobe along its north wall and the Guest's closet in its alcove.
    expectSizes(s, { 'Bath (proposed)': [88, 63], Master: [162, 206], Guest: [137, 233], 'Master closet': [30, 33], Landing: [211, 128], 'Master wardrobe': [88.5, 24], 'Guest closet': [24, 60] }, 'proposed');
    // In the All view the demolished rooms keep their faces and the new labels sit in the parts the
    // old rooms did not cover, so no face has two names.
    expectSizes(f, { Utility: [138, 113], 'Master bedroom': [138, 50.5], 'Entry porch': [59, 72] }, 'all');
  });

  it('has the grand stair: a step up to a landing, then one straight run up the north wall, in a hall open through both floors', () => {
    const [f, s] = [plan.levels[plan.levelOrder[1]], plan.levels[plan.levelOrder[2]]];
    const ftf = floorToFloor(plan, plan.levelOrder[1]);
    expect(ftf).toBe(108);
    const flights = Object.values(f.stairs).filter((st) => st.phase === 'new');
    // 15 risers of 7.2": the bottom step (1), the landing (1), the run (12); the Second Floor's edge
    // is the 15th. Treads 10 3/8"; none of them cuts the floor above. One turn, at the landing.
    expect(flights.map((st) => [st.origin, st.direction, st.width, st.run, flightSteps(st, ftf).risers, st.cutsFloorAbove, st.railings ?? null])).toEqual([
      [{ x: 25, y: 59.375 }, 270, 36, 10.375, 1, false, null],
      [{ x: 25, y: 49 }, 270, 36, 42, 1, false, null],
      [{ x: 43, y: 28 }, 0, 42, 124.5, 12, false, { right: true }],
    ]);
    // One staircase, the "Grand stair", holds the three pieces: thick pine treads (2", the floors'
    // whitewashed pine) over white risers.
    expect(Object.values(f.staircases).map((sc) => [sc.name, sc.treadColor, sc.treadThickness])).toEqual([['Grand stair', '#d8d0c2', 2]]);
    const [sc] = Object.values(f.staircases);
    expect(flights.map((st) => st.staircaseId)).toEqual([sc.id, sc.id, sc.id]);
    let top = 0;
    for (const st of flights) {
      expect(stairsBase(st)).toBeCloseTo(top, 9);
      expect(flightSteps(st, ftf).rise).toBeCloseTo(7.2, 9);
      top = stairsBase(st) + stairsRise(st, ftf);
    }
    expect(top + 7.2).toBeCloseTo(ftf, 9);
    expect(flights[2].run / flightSteps(flights[2], ftf).risers).toBe(10.375);
    // The run arrives at x 167.5, short of the hall's east wall face (x 168).
    expect(flights[2].origin.x + flights[2].run).toBe(167.5);
    // The landing is in the stair hall, open to the Living, a step up from the hall.
    const set = getFaces(f, 'proposed');
    expect(f.rooms[faceAt(set, { x: 25, y: 25 })!.roomId!].name).toBe('Living');
    // Upstairs: the floor opening over the hall north of y 97, the face of the Master's north wall
    // (the Bunk's old south wall), which carries that edge with the north and west walls; its guard
    // runs up the east edge to the top landing (the old bath), open where the run arrives.
    const openings = Object.values(s.floorOpenings);
    expect(openings).toHaveLength(1);
    const [well] = openings;
    expect(well.outline).toEqual([
      { x: 7, y: 7 },
      { x: 167.5, y: 7 },
      { x: 167.5, y: 97 },
      { x: 7, y: 97 },
    ]);
    const layout = getFloorOpeningLayout(plan, s.id, well.id, 'proposed')!;
    expect(layout.supported).toEqual([true, false, true, true]);
    expect(layout.openings.map((o) => [o.edge, o.from, o.to])).toEqual([[1, 0, 42]]);
    // The top landing, floored in pine, is all the upstairs has for a hall; the Master takes the
    // old balcony.
    const sset = getFaces(s, 'proposed');
    expect(s.rooms[faceAt(sset, { x: 196, y: 28 })!.roomId!].name).toBe('Landing (proposed)');
    expect(s.rooms[faceAt(sset, { x: 150, y: 110 })!.roomId!].name).toBe('Master');
    // The slab is cut: its top loses the opening (a quarter inch in all round) and gets the old
    // stair's hole back; no stair hole goes through it.
    expect(stairHoles(f, 'proposed', ftf)).toEqual([]);
    const slab = (vm: ViewMode) => slabTopArea(getLevelMeshes(plan, s.id, vm).floor!);
    const hole = (h: Vec2[]) => Math.abs(polygonSignedArea(h));
    const oldHole = hole(stairHoles(f, 'existing', ftf)[0]);
    expect(slab('existing') - slab('proposed')).toBeCloseTo(hole(floorOpeningHole(well)) - oldHole, 0);
  });

  it("has the master bedroom's deck: from the terrace's wall to the wing's east face, flush with the wall's top, no stair of its own", () => {
    const [b, f] = plan.levelOrder;
    const decks = Object.values(plan.levels[f].decks);
    expect(decks).toHaveLength(1);
    const [deck] = decks;
    expect(deck).toMatchObject({ elevation: -6, railings: [false, true, true, false], phase: 'new' });
    expect(deck.outline).toEqual([
      { x: 319.5, y: 315 },
      { x: 463, y: 315 },
      { x: 463, y: 411 },
      { x: 319.5, y: 411 },
    ]);
    // Its top, 6" below the bedroom floor, is the retaining wall's top (the basement floor plus 96").
    const elev = getLevelElevations(plan);
    const top = elev[f].floorTop + deck.elevation;
    expect(top).toBe(-4);
    const retaining = Object.values(plan.levels[b].walls).filter((w) => w.heightOverride !== undefined);
    expect(retaining.map((w) => elev[b].floorTop + w.heightOverride!)).toEqual(Array(5).fill(top));
    // The house carries its north edge and the retaining wall its west edge; two posts (the
    // south-east corner and the middle of the south edge); no stair reaches it, so its railings run
    // the full east and south edges.
    const layout = getDeckLayout(plan, f, deck.id, 'proposed')!;
    expect(layout.supported).toEqual([true, false, false, true]);
    expect(layout.posts).toHaveLength(2);
    expect(layout.openings).toEqual([]);
    // Today's wooden stair stays beside it (MK): both flights open and existing, the upper one up
    // from its landing at the walkout's level, the lower one climbing to the landing's south edge
    // from the lower lawn, 8' under the walkout: 12 risers of 96 / 13, the landing's edge its 13th.
    const basement = plan.levels[b];
    const flights = Object.values(basement.stairs);
    expect(flights).toHaveLength(2);
    expect(flights.every((s) => s.phase === 'existing' && s.open)).toBe(true);
    const landings = Object.values(basement.decks);
    expect(landings).toHaveLength(1);
    const [landing] = landings;
    expect(landing).toMatchObject({ elevation: 0, railings: [false, true, false, false], phase: 'existing' });
    const landingLayout = getDeckLayout(plan, b, landing.id, 'proposed')!;
    expect(landingLayout.openings.map((o) => o.edge)).toEqual([2]);
    const upper = flights.find((s) => s.id !== landingLayout.openings[0].stairsId)!;
    expect(elev[b].floorTop + stairsBase(upper)).toBe(elev[b].floorTop + landing.elevation);
    const lower = basement.stairs[landingLayout.openings[0].stairsId];
    expect(lower).toMatchObject({ base: -96, risers: 12, open: true });
    expect(elev[b].floorTop + lower.base! + lower.rise! + 96 / 13).toBeCloseTo(elev[b].floorTop + landing.elevation, 9);
    expect(groundAt(plan, lower.origin)).toBeCloseTo(elev[b].floorTop + lower.base!, 6);
    expect(groundAt(plan, lower.origin)).toBe(-196);
  });

  it('has the roofs and posts of the proposed design', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const roofs = Object.values(f.roofs).filter((r) => r.phase === 'new');
    const box = (r: (typeof roofs)[number]) => {
      const xs = r.outline.map((p) => p.x);
      const ys = r.outline.map((p) => p.y);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    };
    expect(roofs.map((r) => [r.shape, box(r), r.ridgeAngle, r.pitch, r.overhang])).toEqual([
      // One shed over the whole east wing, sloping down east from the main block's east wall.
      ['shed', [336, 463, 0, 315], 0, 5, 18],
      // The foyer's gable faces west and runs on 60" past the foyer (x -96) as the open log canopy
      // over the front door; the porch's shed is high at the house wall. All three outlines stop
      // 18" short of the wall, so the overhang ends at its outside face.
      ['gable', [-156, -18, 10, 120], 0, 8, 18],
      ['shed', [-96, -18, 120, 315], 180, 4, 18],
    ]);
    // The wing's shed is 96" above the first floor at the wing's east wall and 96 + 145 x 5/12 at
    // the main block's east wall.
    const [wing, foyer, shed] = roofs;
    const wingBearing = roofBearing(f.wallHeight, wing);
    expect(roofHeightAt(wing, wingBearing, { x: 463, y: 150 })).toBeCloseTo(96, 6);
    expect(roofHeightAt(wing, wingBearing, { x: 318, y: 150 })).toBeCloseTo(96 + (145 * 5) / 12, 6);
    // Upstairs, the transoms that replace the two east windows sit with their sills at least 8"
    // over the shed's top at the wall, their heads under the ceiling; the old sills were under it.
    const s = plan.levels[plan.levelOrder[2]];
    const up = f.wallHeight + s.floorThickness;
    const wingTop = roofHeightAt(wing, wingBearing, { x: 318, y: 150 })! + wing.thickness;
    const eastWall = (o: Opening) => {
      const w = s.walls[o.wallId];
      return s.nodes[w.a].x === 314.5 && s.nodes[w.b].x === 314.5;
    };
    const transoms = Object.values(s.openings).filter((o) => o.phase === 'new' && eastWall(o));
    expect(transoms.map((o) => [o.type, o.width, o.height, o.sill, o.sashes])).toEqual([
      ['window', 46, 24, 60, 2],
      ['window', 46, 24, 60, 2],
    ]);
    for (const o of transoms) {
      expect(s.walls[o.wallId]).toBeDefined();
      expect(up + o.sill - wingTop).toBeGreaterThanOrEqual(8);
      expect(o.sill + o.height).toBeLessThanOrEqual(s.wallHeight);
    }
    const oldEast = Object.values(s.openings).filter((o) => o.phase === 'demo' && eastWall(o));
    expect(oldEast).toHaveLength(2);
    for (const o of oldEast) expect(up + o.sill).toBeLessThan(wingTop);
    // The porch's shed is 128" above the first floor at the house wall and 96" at its outer wall;
    // the foyer's ridge is under the upstairs west window's sill (156" above the first floor).
    expect(roofHeightAt(shed, roofBearing(f.wallHeight, shed), { x: 0, y: 236 })).toBeCloseTo(128, 6);
    expect(roofHeightAt(shed, roofBearing(f.wallHeight, shed), { x: -96, y: 236 })).toBeCloseTo(96, 6);
    expect(roofExtremes(foyer, roofBearing(f.wallHeight, foyer)).ridge + foyer.thickness).toBeLessThan(156);
    // No square posts: the porch and the canopy stand on log posts (members) on fieldstone piers.
    expect(Object.values(plan.site.columns).filter((c) => c.kind === 'post')).toEqual([]);
  });

  it('has the foyer moved north, the house door north of the beam post, the front door under the peak, a transom and a coat bench (MK, 15 and 16 Oct 2026)', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const at = (o: Opening) => {
      const w = f.walls[o.wallId];
      const a = f.nodes[w.a];
      const b = f.nodes[w.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: a.x + ((b.x - a.x) * o.offset) / len, y: a.y + ((b.y - a.y) * o.offset) / len };
    };
    // The transom: on the foyer's north wall (y 13.5), centred on the foyer, high over the bench.
    const transom = Object.values(f.openings).find((o) => o.phase === 'new' && o.type === 'window' && Math.abs(at(o).y - 13.5) < 1e-9)!;
    expect([at(transom).x, transom.width, transom.height, transom.sill, transom.sashes]).toEqual([-44.5, 60, 18, 70, 2]);
    // The built-in coat bench, wall to wall along the north wall's inside face (y 17), its top
    // 4" under the transom's sill, and shown with the furniture layer off.
    const bench = Object.values(f.fixtures).find((x) => x.piece === 'coatBench')!;
    expect(bench.builtIn).toBe(true);
    expect([bench.origin, bench.width, bench.depth, bench.height]).toEqual([{ x: -44.5, y: 17 }, 89, 18, 66]);
    // The house door (MK, 16 Oct 2026): 32", y 63.5..95.5, in new wall, north of the stair hall
    // beam's post (y 97.25..101.75) and south of the stair's bottom step (to y 59.4), its trim clear
    // of both; hinged on its north jamb, swinging into the hall; the bench ends north of it.
    const doors = Object.values(f.openings).filter((o) => o.phase === 'new' && o.type === 'door');
    const house = doors.find((o) => at(o).x === 3.5)!;
    expect([at(house).y, house.width, f.walls[house.wallId].phase]).toEqual([79.5, 32, 'new']);
    const trim = 4;
    expect(at(house).y - house.width / 2 - trim).toBeGreaterThanOrEqual(59.375);
    expect(at(house).y + house.width / 2 + 1.5).toBeLessThanOrEqual(97.25);
    expect(f.nodes[f.walls[house.wallId].a].y).toBeLessThan(at(house).y);
    expect(house.swing?.hinge).toBe('a');
    expect(bench.origin.y + bench.depth).toBeLessThan(at(house).y - house.width / 2);
    // It swings into the foyer (MK, 16 Oct 2026): its leaf sweeps x -32..0, clear of the front
    // door's swing (x -92.5 + 36 at most), and the hall at the stair's foot stays clear.
    const hw = f.walls[house.wallId];
    const dir = normalize(sub(f.nodes[hw.b], f.nodes[hw.a]));
    const left = perpLeft(dir);
    const side = house.swing!.side === 'left' ? left : { x: -left.x, y: -left.y };
    expect(side.x).toBe(-1);
    // The front door, 36", centred under the foyer gable's peak (its ridge at y 65).
    const front = doors.find((o) => at(o).x === -92.5)!;
    expect([at(front).y, front.width]).toEqual([65, 36]);
    // Its leaf reaches west to the wall's outside face (x 0) less its width; the front door's to its
    // inside face (x -89) plus its width.
    expect(0 - house.width).toBeGreaterThan(-89 + front.width);
    const gable = Object.values(f.roofs).find((r) => r.phase === 'new' && r.shape === 'gable')!;
    const gys = gable.outline.map((q) => q.y);
    expect((Math.min(...gys) + Math.max(...gys)) / 2).toBe(at(front).y);
    expect(transom.sill - (bench.elevation + bench.height)).toBe(4);
    // Today's front door keeps its place in the existing view, on the piece of today's wall that
    // the foyer's wall would have split (demolished and rebuilt closed).
    const door = Object.values(f.openings).find((o) => o.type === 'door' && o.phase === 'demo' && Math.abs(at(o).x - 3.5) < 1e-9)!;
    expect(at(door).y).toBe(48);
    expect(f.walls[door.wallId].phase).toBe('demo');
  });

  it('has the Adirondack entry: an open log canopy on stone piers, and log posts, a plate and a river-stone knee wall on the screen porch', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const floorTop = getLevelElevations(plan)[f.id].floorTop;
    expect(floorTop).toBe(2);
    const piers = Object.values(plan.site.columns).filter((c) => c.kind === 'pier');
    // Fieldstone, new: 18" square to +20 under the canopy's posts, 16" square to +12 under the
    // porch's, and the stoop, 60" x 72" in front of the door, 1/2" under its threshold.
    expect(piers.map((c) => [c.at, c.width, c.depth, c.top, c.color, c.phase])).toEqual([
      [{ x: -150, y: 15 }, 18, 18, 20, '#8e8579', 'new'],
      [{ x: -150, y: 115 }, 18, 18, 20, '#8e8579', 'new'],
      [{ x: -126, y: 65 }, 60, 72, 1.5, '#8e8579', 'new'],
      [{ x: -97, y: 126 }, 16, 16, 12, '#8e8579', 'new'],
      [{ x: -97, y: 236 }, 16, 16, 12, '#8e8579', 'new'],
      [{ x: -97, y: 310 }, 16, 16, 12, '#8e8579', 'new'],
    ]);
    // Each stands from under the ground at every corner, so none floats on the sloping ground, and
    // the stoop is a step up from the ground all round.
    for (const c of piers) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const g = groundAt(plan, { x: c.at.x + (sx * c.width) / 2, y: c.at.y + (sy * c.depth) / 2 });
          expect(c.base).toBeLessThan(g);
          expect(c.top - g).toBeGreaterThan(1);
        }
      }
    }
    // The logs: dark stained, round, timbers at set heights (the structure checks ignore them).
    const logs = Object.values(f.members).filter((m) => m.profile === 'log' && m.label !== '14" peeled log post');
    expect(logs.every((m) => isTimber(m) && m.color === '#3f2c1f' && m.phase === 'new' && m.width === m.depth)).toBe(true);
    const named = (label: string) => logs.filter((m) => m.label === label);
    // Every log post stands on a pier's top.
    const logPosts = logs.filter((m) => m.kind === 'post' && m.width === 10);
    expect(logPosts).toHaveLength(5);
    for (const m of logPosts) {
      if (m.kind !== 'post') continue;
      const p = piers.find((c) => c.at.x === m.at.x && c.at.y === m.at.y)!;
      expect(m.base! + floorTop).toBe(p.top);
    }
    // The canopy's tie runs 8" past each post's outer face; the ridge log and the purlins run from
    // the foyer's gable wall to x -182, 8" past the rake (x -174), so their ends show.
    const [tie] = named('10" log tie');
    expect(tie.kind === 'beam' && [tie.a.y, tie.b.y]).toEqual([15 - 5 - 8, 115 + 5 + 8]);
    for (const m of [...named('10" ridge log'), ...named('8" log purlin')]) {
      expect(m.kind === 'beam' && [m.a.x, m.b.x]).toEqual([-94, -182]);
    }
    expect([named('10" ridge log'), named('8" log purlin'), named('8" log rafter'), named('8" log king post'), named('6" log brace'), named('3" twig')].map((x) => x.length)).toEqual([1, 2, 2, 1, 6, 6]);
    // The porch's plate runs 12" past its south corner (y 315), under the shed's rake.
    const [plate] = named('10" log plate');
    expect(plate.kind === 'beam' && plate.b.y).toBe(327);
    // The porch has no twig panels (they went with the half-log; the knee wall is stone).
    expect(named('2.5" twig')).toHaveLength(0);
    // No log reaches the roof over it: the top of each beam at its ends, and each post's top, is
    // 1/4" or more under the underside of every roof over that point.
    const roofs = Object.values(f.roofs).filter((r) => r.phase === 'new');
    const lowestUnder = (p: Vec2) => Math.min(...roofs.map((r) => roofHeightAt(r, roofBearing(f.wallHeight, r), p) ?? Infinity));
    for (const m of logs) {
      if (m.kind === 'beam') {
        for (const [p, z] of [[m.a, m.za!], [m.b, m.zb!]] as const) expect(lowestUnder(p) - z, `${m.label} at ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(0.25 - 1e-6);
      } else expect(lowestUnder(m.at) - m.top!, m.label).toBeGreaterThanOrEqual(0.25 - 1e-6);
    }
    // The porch's west and south walls are dry-stacked river stone up to the screens' sills (36"),
    // in the stones' own colours (no tint), with the shakes above; the foyer's walls have no band.
    const banded = Object.values(f.walls).filter((w) => w.band);
    expect(banded.map((w) => [w.phase, w.band])).toEqual(Array(2).fill(['new', { finish: 'riverstone', height: 36 }]));
    const screens = Object.values(f.openings).filter((o) => o.phase === 'new' && o.glazing === 'screen' && o.type === 'window');
    expect(screens.every((o) => banded.some((w) => w.id === o.wallId) && o.sill === 36)).toBe(true);
  });

  it('has the structure the proposed design needs: joists, the balcony header, the kitchen beam, the opening beam, posts on footings', () => {
    const [bId, fId, sId] = plan.levelOrder;
    // East-west over the basement (MK's markup), north-south above (unconfirmed over the First Floor).
    expect([bId, fId, sId].map((id) => plan.levels[id].framing)).toEqual([{ joists: 0 }, { joists: 90 }, { joists: 90 }]);
    // East-west zones under the wing's shed roof only: over the utility today, and north of it.
    const zones = Object.values(plan.levels[fId].joistZones);
    expect(zones.map((z) => [z.joists, z.phase])).toEqual([
      [0, 'existing'],
      [0, 'new'],
    ]);
    expect(pointInPolygon({ x: 400, y: 250 }, zones[0].outline)).toBe(true);
    expect(pointInPolygon({ x: 400, y: 100 }, zones[1].outline)).toBe(true);
    expect([plan.levels[bId].joistZones, plan.levels[sId].joistZones]).toEqual([{}, {}]);
    const members = Object.values(plan.levels[fId].members);
    const beams = members.filter((m) => m.kind === 'beam' && !isTimber(m));
    // The stair hall's header and the kitchen beam, both on the old wall's line (y 99.5): steel
    // I-beams flush in the floor framing (MK, 16 Oct 2026), 8 1/8" deep so they fit in 2x10s; and the
    // beam over the Kitchen/Living opening (y 102.5..236), hung off the kitchen beam into the 16"
    // wall. The two steel beams meet over the log post, 15" west of the corner (x 155.5).
    expect(beams.map((m) => m.kind === 'beam' && [m.a, m.b, m.mount, m.phase, m.label, m.depth])).toEqual([
      [{ x: 3.5, y: 99.5 }, { x: 155.5, y: 99.5 }, 'flush', 'new', 'W8x15 steel, flush (engineer to size)', 8.125],
      [{ x: 155.5, y: 99.5 }, { x: 314.5, y: 99.5 }, 'flush', 'new', 'W8x15 steel, flush (engineer to size)', 8.125],
      [{ x: 170.5, y: 99.5 }, { x: 170.5, y: 244 }, 'flush', 'new', '(2) 1 3/4 x 11 7/8 LVL', 11.875],
    ]);
    // Posts under the beams' ends: the one inside the log (below) where the two steel beams meet,
    // (3) 2x6 in each end wall and (2) 2x4 in the 16" wall. No other post stands in a room.
    expect(members.filter((m) => m.kind === 'post' && !isTimber(m)).map((m) => m.kind === 'post' && [m.at, m.width, m.label])).toEqual([
      [{ x: 155.5, y: 99.5 }, 5.5, 'post inside the log (engineer to size)'],
      [{ x: 3.5, y: 99.5 }, 4.5, '(3) 2x6 in wall'],
      [{ x: 314.5, y: 99.5 }, 4.5, '(3) 2x6 in wall'],
      [{ x: 170.5, y: 244 }, 3.5, '(2) 2x4'],
    ]);
    // Upstairs, no hall: a flush beam in the ceiling framing on each of the Master's and the Guest's
    // old north walls' lines picks up the ceiling joists they carried.
    const ceiling = Object.values(plan.levels[sId].members).filter((m) => m.kind === 'beam');
    expect(ceiling.map((m) => m.kind === 'beam' && [m.a, m.b, m.mount, m.phase])).toEqual([
      [{ x: 3.5, y: 137.5 }, { x: 171.5, y: 137.5 }, 'flush', 'new'],
      [{ x: 171.5, y: 152.5 }, { x: 314.5, y: 152.5 }, 'flush', 'new'],
    ]);
    // The Adirondack entry's logs, all timbers: the canopy's two posts, tie, two knee braces, king
    // post, two rafters, ridge log, two purlins and six twigs of its sunburst; the screen porch's
    // three posts, plate and four knee braces.
    // The peeled log post (MK, 15 and 16 Oct 2026): 14", under both beams' ends, slid 15" west of the
    // Kitchen/Living corner into the Living, on the powder room door's centre line, so it half hides
    // the door from the Living; floor to ceiling, pale; nothing in the middle of the hall.
    const peeled = members.filter((m) => m.label === '14" peeled log post');
    expect(peeled.map((m) => m.kind === 'post' && [m.at, m.width, m.depth, m.base, m.top, m.profile, m.color, m.phase])).toEqual([[{ x: 155.5, y: 99.5 }, 14, 14, 0, 96, 'log', '#c9ab7e', 'new']]);
    const timbers = members.filter((m) => isTimber(m) && !peeled.includes(m));
    const tally: Record<string, number> = {};
    for (const m of timbers) tally[m.label ?? ''] = (tally[m.label ?? ''] ?? 0) + 1;
    expect(tally).toEqual({
      '10" log post': 5,
      '10" log tie': 1,
      '6" log brace': 6,
      '8" log king post': 1,
      '8" log rafter': 2,
      '10" ridge log': 1,
      '8" log purlin': 2,
      '3" twig': 6,
      '10" log plate': 1,
    });
    expect(timbers.every((m) => m.profile === 'log' && m.color === '#3f2c1f' && m.phase === 'new')).toBe(true);
    // The basement: the three existing north-south girders (placeholders from MK's sketch, the middle
    // one under the partition), then new posts on footings: under the log post at the beams' shared
    // end (about 14 to 16 kips, so a 36" footing), 15" west of the middle girder, and under the
    // opening beam's south end, on the girder's line.
    expect(Object.values(plan.levels[bId].members)).toEqual([
      ...[77.5, 170.5, 259.5].map((x) =>
        expect.objectContaining({ kind: 'beam', a: { x, y: 3.5 }, b: { x, y: 311.5 }, mount: 'dropped', phase: 'existing', label: 'existing girder (size and place to measure)' }),
      ),
      expect.objectContaining({ kind: 'post', at: { x: 155.5, y: 99.5 }, width: 5.5, depth: 11, footing: { width: 36, thickness: 12 }, phase: 'new' }),
      expect.objectContaining({ kind: 'post', at: { x: 170.5, y: 244 }, width: 5.5, depth: 5.5, footing: { width: 24, thickness: 12 }, phase: 'new' }),
    ]);
    // No wall is marked: the tool infers them all.
    expect(Object.values(plan.levels[fId].walls).filter((w) => w.bearing !== undefined)).toEqual([]);
  });

  it('swings each new door into the room the design names', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const set = getFaces(f, 'proposed');
    // Every new door but the master bedroom's sliding door (no swing; next test).
    const doors = Object.values(f.openings).filter((o) => o.type === 'door' && !o.sliding && o.phase === 'new');
    const into = (o: Opening) => {
      const w = f.walls[o.wallId];
      const a = f.nodes[w.a];
      const dir = normalize(sub(f.nodes[w.b], a));
      const n = perpLeft(dir);
      const side = (o.swing?.side ?? 'left') === 'left' ? 1 : -1;
      const face = faceAt(set, { x: a.x + dir.x * o.offset + n.x * side * 12, y: a.y + dir.y * o.offset + n.y * side * 12 });
      return face?.roomId ? f.rooms[face.roomId].name.replace(/ \(.*$/, '') : 'outside';
    };
    // The powder room's door swings out, into the stair hall (the Living's face; clear of its WC and
    // vanity); the pantry's swings in. No door from the Living to the screen porch (MK, 15 Oct 2026).
    // The house door swings out into the foyer, so nothing swings over the stair's foot (MK, 16 Oct
    // 2026).
    expect(doors.map((o) => `${o.width} ${into(o)}`).sort()).toEqual([
      '24 Living',
      '24 Pantry',
      '28 Master bath',
      '32 Foyer',
      '32 Master bedroom',
      '36 Foyer',
      '36 Screen porch',
      '36 outside',
    ]);
    // The bedroom's way in stays where today's grey Kitchen to Utility door is (MK), but that door,
    // three by three clear lites over two panels, gives way to a solid one swinging into the bedroom.
    const grey = Object.values(f.openings).find((o) => o.type === 'door' && o.leafColor === '#7f8b8f')!;
    const solid = doors.find((o) => o.wallId === grey.wallId)!;
    expect([grey.phase, solid.offset, solid.width, solid.lites, solid.halfLite]).toEqual(['demo', grey.offset, 32, undefined, undefined]);
    // Interior doors are stained, not the house door's green.
    expect(doors.filter((o) => ['Master bath', 'Pantry', 'Master bedroom'].includes(into(o)) || o.width === 24).every((o) => o.leafColor === '#8a5a34')).toBe(true);
    // The screen porch's lawn door at the west end of its south wall (the stove's chimney, which it
    // once had to clear, is now at the porch's north-east corner).
    const lawn = doors.find((o) => into(o) === 'outside')!;
    const lw = f.walls[lawn.wallId];
    const la = f.nodes[lw.a];
    const lx = la.x + normalize(sub(f.nodes[lw.b], la)).x * lawn.offset;
    expect([lx - lawn.width / 2, lx + lawn.width / 2]).toEqual([-86, -50]);
  });

  it("has the master bedroom's sliding door and the master bath's north transom", () => {
    const [b, f] = plan.levelOrder.map((id) => plan.levels[id]);
    // The centre of an opening on its wall's centerline.
    const at = (lvl: Level, o: Opening) => {
      const w = lvl.walls[o.wallId];
      const a = lvl.nodes[w.a];
      const d = normalize(sub(lvl.nodes[w.b], a));
      return { x: a.x + d.x * o.offset, y: a.y + d.y * o.offset };
    };
    // The sliding door: 72 x 80, two panels of 2 x 4 lites, in the wing's south wall where today's
    // window was (demolished), over the walkout's 72" double door; no window over it.
    const sliders = Object.values(f.openings).filter((o) => o.sliding);
    expect(sliders).toHaveLength(1);
    const [slider] = sliders;
    expect(slider).toMatchObject({ type: 'door', phase: 'new', width: 72, height: 80, sill: 0, lites: { cols: 2, rows: 4 } });
    expect(at(f, slider)).toEqual({ x: 390.5, y: 311.5 });
    const onWall = Object.values(f.openings).filter((o) => o.wallId === slider.wallId && o.id !== slider.id);
    expect(onWall.map((o) => [o.type, o.phase, at(f, o).x])).toEqual([['window', 'demo', 390.5]]);
    const walkout = Object.values(b.openings).find((o) => o.type === 'door' && o.sashes === 2)!;
    expect([at(b, walkout).x, walkout.width]).toEqual([390.5, 72]);
    // The master bath's north window is a transom over the vanity, east of the walk-in shower: 46 x 18, sill 70, head 88.
    const north = Object.values(f.openings).filter((o) => o.phase === 'new' && o.type === 'window' && Math.abs(at(f, o).y - 3.5) < 1e-9 && at(f, o).x > 318);
    expect(north.map((o) => [at(f, o).x, o.width, o.height, o.sill, o.sashes, o.lites])).toEqual([[429, 46, 18, 70, 2, { cols: 2, rows: 1 }]]);
  });

  it('furnishes upstairs (MK, 15 Oct 2026): a queen bed in the east room with a desk in its alcove, two full beds in the west room', () => {
    const s = plan.levels[plan.levelOrder[2]];
    const set = getFaces(s, 'proposed');
    const pieces = Object.values(s.fixtures).filter((x) => x.kind === 'furniture');
    const centre = (x: (typeof pieces)[number]) => {
      const o = fixtureOutline(x);
      return { x: o.reduce((a, p) => a + p.x, 0) / 4, y: o.reduce((a, p) => a + p.y, 0) / 4 };
    };
    const roomOf = (x: (typeof pieces)[number]) => {
      const face = set.faces.find((fc) => fc.roomId && pointInPolygon(centre(x), fc.netPolygon));
      return face ? s.rooms[face.roomId!].name.replace(/ \(.*$/, '') : 'none';
    };
    const named = pieces.map((x) => `${roomOf(x)}: ${furnitureNameOf(x)}`).sort();
    expect(named).toEqual([
      'Guest: Desk',
      'Guest: Desk chair',
      'Guest: Dresser',
      'Guest: Nightstand',
      'Guest: Nightstand',
      'Guest: Queen bed',
      'Guest: Rug',
      'Master: Dresser',
      'Master: Full bed',
      'Master: Full bed',
      'Master: Nightstand',
      'Master: Rug',
    ]);
    const bounds = (x: (typeof pieces)[number]) => {
      const o = fixtureOutline(x);
      return { x0: Math.min(...o.map((p) => p.x)), x1: Math.max(...o.map((p) => p.x)), y0: Math.min(...o.map((p) => p.y)), y1: Math.max(...o.map((p) => p.y)) };
    };
    // The desk sits in the Guest's alcove (its nook, x 252..311, y 75..140), against the east wall
    // under the transom, its chair before it; the queen's headboard on the east wall under the other.
    const desk = pieces.find((x) => x.piece === 'desk')!;
    expect(bounds(desk)).toEqual({ x0: 287, x1: 311, y0: 85, y1: 133 });
    expect(bounds(pieces.find((x) => x.piece === 'deskChair')!).x1).toBeLessThanOrEqual(287);
    expect(bounds(pieces.find((x) => x.piece === 'bed' && furnitureNameOf(x) === 'Queen bed')!)).toEqual({ x0: 227, x1: 311, y0: 190, y1: 254 });
    // Inside its room, clear of the walls, and no two pieces in one place (rugs under the rest).
    const walls = [...computeFootprints(s, 'proposed').values()].map((fp) => {
      const xs = fp.poly.map((p) => p.x);
      const ys = fp.poly.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const overlaps = (p: { x0: number; x1: number; y0: number; y1: number }, q: typeof p) =>
      Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 1e-6 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 1e-6;
    for (const a of pieces) {
      const face = set.faces.find((fc) => fc.roomId && pointInPolygon(centre(a), fc.netPolygon))!;
      for (const c of fixtureOutline(a)) expect(pointInPolygon({ x: c.x + Math.sign(centre(a).x - c.x) * 0.01, y: c.y + Math.sign(centre(a).y - c.y) * 0.01 }, face.netPolygon), `${a.piece}`).toBe(true);
      for (const w of walls) expect(overlaps(bounds(a), w), `${a.piece} in a wall`).toBe(false);
      for (const b of pieces) {
        if (b.id <= a.id || FURNITURE[a.piece!].floorLayer || FURNITURE[b.piece!].floorLayer) continue;
        expect(overlaps(bounds(a), bounds(b)), `${a.piece} and ${b.piece}`).toBe(false);
      }
    }
  });

  it('has the proposed kitchen: the range on the north wall, the refrigerator on the east wall, the island in the triangle, the table by the window, the pantry north of it and the powder room under the stair', () => {
    const f = plan.levels[plan.levelOrder[1]];
    // The proposed kitchen's casework is new; today's fixtures (photos 13 to 22) are all demolished.
    expect(Object.values(f.fixtures).filter((x) => x.phase !== 'new').every((x) => x.phase === 'demo')).toBe(true);
    const allNew = Object.values(f.fixtures).filter((x) => x.phase === 'new');
    const set = getFaces(f, 'proposed');
    const centre = (x: (typeof allNew)[number]) => {
      const o = fixtureOutline(x);
      return { x: o.reduce((s2, p) => s2 + p.x, 0) / o.length, y: o.reduce((s2, p) => s2 + p.y, 0) / o.length };
    };
    const roomOf = (x: (typeof allNew)[number]) => {
      const face = set.faces.find((fc) => fc.roomId && pointInPolygon(centre(x), fc.netPolygon));
      return face ? f.rooms[face.roomId!].name.replace(/ \(.*$/, '') : 'none';
    };
    const fixtures = allNew.filter((x) => roomOf(x) === 'Kitchen');
    // The placeholder bath fixtures (MK): a WC and a narrow vanity in the powder room, a shower, a
    // vanity and a WC in the master bath (the shower walk-in with its bench, glass and end wall), the
    // washer and dryer in its laundry closet; the master bedroom's wardrobes, king bed and
    // nightstands; the pantry's
    // shelves; the wood stove on its hearth before its stone surround in the Living, with its
    // stovepipe (two runs) into the wall, and the flue's tee outside in the screen porch.
    // The coats bench and hooks in the foyer; the vents (the dryer's riser in the laundry, its run
    // over the master bath and its hood outside; the range hood's duct across the pantry and its cap
    // outside); the alarms. The furniture (MK, 15 Oct 2026): in the Living a log sofa, an armchair,
    // a rocker, a coffee table, a side table, a bookcase, a floor lamp on a Navajo rug; two
    // Adirondack chairs and a side table on the screen porch; a braided rug at the king bed's foot.
    const nameOf = (x: (typeof allNew)[number]) => (x.kind === 'furniture' ? furnitureNameOf(x) : (x.label ?? x.kind));
    expect(allNew.filter((x) => roomOf(x) !== 'Kitchen').map((x) => `${roomOf(x)}: ${nameOf(x)}`).sort()).toEqual([
      'Foyer: Coat bench',
      'Laundry: Dryer',
      'Laundry: Dryer vent',
      'Laundry: Washer',
      'Living: Armchair',
      'Living: Bookcase',
      'Living: Coffee table',
      'Living: Floor lamp',
      'Living: Hearth',
      'Living: Rocking chair',
      'Living: Rug',
      'Living: Side table',
      'Living: Smoke/CO',
      'Living: Sofa',
      'Living: Stone',
      'Living: Stovepipe',
      'Living: Stovepipe',
      'Living: Wood stove',
      'Master bath: Bench',
      'Master bath: Dryer vent',
      'Master bath: Glass',
      'Master bath: WC',
      'Master bath: Walk-in shower',
      'Master bath: Wall',
      'Master bath: sink',
      'Master bedroom: King bed',
      'Master bedroom: Nightstand',
      'Master bedroom: Nightstand',
      'Master bedroom: Rug',
      'Master bedroom: Smoke',
      'Master bedroom: tall',
      'Master bedroom: tall',
      'Pantry: Hood duct',
      'Pantry: Shelves',
      'Pantry: Shelves',
      'Pantry: Shelves',
      'Powder room: WC',
      'Powder room: sink',
      'Screen porch: Adirondack chair',
      'Screen porch: Adirondack chair',
      'Screen porch: Side table',
      'Screen porch: Tee',
      'none: Duct cap',
      'none: Vent hood',
    ]);
    const kinds: Record<string, number> = {};
    for (const x of fixtures) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
    expect(kinds).toEqual({ dishwasher: 1, sink: 1, box: 1, furniture: 5, fridge: 1, wall: 8, base: 7, range: 1, hood: 1 });
    expect(fixtures.every((x) => x.phase === 'new')).toBe(true);
    expect(fixtures.filter((x) => x.kind === 'box').map((x) => x.label)).toEqual(['Smoke/CO']);
    // The table and its chairs are furniture: a pine farm table, hickory ladder-backs facing it.
    expect(fixtures.filter((x) => x.kind === 'furniture').map(nameOf).sort()).toEqual(['Dining chair', 'Dining chair', 'Dining chair', 'Dining chair', 'Dining table']);
    // The proposed cabinets are in the house's Nordic pine.
    expect(fixtures.filter((x) => x.kind === 'base' || x.kind === 'wall' || x.kind === 'sink').every((x) => x.wood === 'nordicPine')).toBe(true);
    const bounds = (poly: Vec2[]) => {
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    const box = (x: (typeof allNew)[number]) => bounds(fixtureOutline(x));
    // Counters: one island top 62 x 26 over the dishwasher and the sink (with the basin cut out), 1"
    // all round, x 178..240, y 133..159, no seating ledge; on the north wall the 24" base and the 15"
    // base each on its own (the pantry door and the range part them); an L from the 20" base round
    // the corner and down the east wall to the refrigerator; the base after the refrigerator.
    const runs = counterRuns(fixtures.filter((x) => isVisible(x.phase, 'proposed')));
    expect(runs).toHaveLength(5);
    const island = runs.find((r) => r.fixtureIds.some((id) => f.fixtures[id].kind === 'sink'))!;
    expect(island.fixtureIds.map((id) => f.fixtures[id].kind).sort()).toEqual(['dishwasher', 'sink']);
    expect(island.outline).toHaveLength(4);
    expect(island.holes).toHaveLength(1);
    const top = bounds(island.outline);
    expect(top).toEqual({ x0: 178, x1: 240, y0: 133, y1: 159 });
    // Moved west (MK): its west end 5" short of the old wall line (x 173), within the wide opening
    // to the Living (y 102.5..236), so you walk round it through the Living.
    expect(top.x0 - 173).toBe(5);
    expect(top.y0 > 102.5 && top.y1 < 236).toBe(true);
    // The north run on the pantry's wall (its face y 60), west to east: a 24" base for trash and
    // recycling (the livability review), the pantry door, a 15" base, the range, a 20" base into the
    // corner; the hood over the range; a 48" work aisle to the island.
    const run = fixtures.filter((x) => x.elevation === 0 && x.kind !== 'box' && box(x).y0 === 60 && box(x).x1 < 311).sort((p, q) => box(p).x0 - box(q).x0);
    expect(run.map((x) => [x.kind, box(x).x0, box(x).x1])).toEqual([
      ['base', 173, 197],
      ['base', 222, 237],
      ['range', 237, 267],
      ['base', 267, 287],
    ]);
    expect(top.y0 - (Math.max(...run.filter((x) => x.kind === 'base').map((x) => box(x).y1)) + 1)).toBe(48);
    const hood = fixtures.find((x) => x.kind === 'hood')!;
    expect([box(hood).x0, box(hood).x1, hood.elevation]).toEqual([237, 267, 66]);
    // The east wall (shared with the master suite), north to south: a corner base, a 30" and a 24"
    // base, the counter-depth refrigerator against the bedroom's wardrobes, a
    // 24" base after it; the corner base's counter joins the north run's in one L.
    const east = fixtures.filter((x) => x.elevation === 0 && box(x).x1 === 311).sort((p, q) => box(p).y0 - box(q).y0);
    expect(east.map((x) => [x.kind, box(x).y0, box(x).y1])).toEqual([
      ['base', 60, 84],
      ['base', 84, 114],
      ['base', 114, 138],
      ['fridge', 140, 176],
      ['base', 176, 200],
    ]);
    const fridge = east.find((x) => x.kind === 'fridge')!;
    expect(box(fridge).x0).toBe(282);
    const corner = runs.find((r) => r.fixtureIds.includes(east[0].id))!;
    expect(corner.fixtureIds.map((id) => f.fixtures[id].kind).sort()).toEqual(['base', 'base', 'base', 'base']);
    expect(bounds(corner.outline)).toEqual({ x0: 267, x1: 311, y0: 60, y1: 138 });
    // The aisles from the island: 46" to the east counter's front, 42" to the refrigerator's.
    expect(bounds(corner.outline).x1 - 25 - top.x1).toBe(46);
    expect(box(fridge).x0 - top.x1).toBe(42);
    // About 18'7" of counter frontage: the north run's three bases, the east run's four, the island.
    const frontage = fixtures.filter((x) => x.kind === 'base').reduce((t, x) => t + x.width, 0) + (top.x1 - top.x0);
    expect(frontage).toBe(223);
    // The work triangle, centre to centre: under 26' in all, each leg between 3'6" and 9'.
    const at = (kind: string) => centre(fixtures.find((x) => x.kind === kind)!);
    const legs = [
      ['range', 'fridge'],
      ['fridge', 'sink'],
      ['sink', 'range'],
    ].map(([p, q]) => Math.hypot(at(p).x - at(q).x, at(p).y - at(q).y));
    for (const l of legs) {
      expect(l).toBeGreaterThanOrEqual(42);
      expect(l).toBeLessThanOrEqual(108);
    }
    expect(legs.reduce((s2, l) => s2 + l, 0)).toBeLessThan(26 * 12);
    // The table by the lake window, centred on it (x 242), with two chairs each side: 45" from the
    // island to the north chairs, 39" past its ends to the walls (the east one is the way to the
    // master bedroom's door, y 248..280), 32" behind the south chairs to the lake wall (y 308).
    const table = fixtures.find((x) => x.piece === 'diningTable')!;
    expect(box(table)).toEqual({ x0: 212, x1: 272, y0: 222, y1: 258 });
    const chairs = fixtures.filter((x) => x.piece === 'diningChair').map(box);
    expect(Math.min(...chairs.map((c) => c.y0)) - top.y1).toBe(45);
    expect(308 - Math.max(...chairs.map((c) => c.y1))).toBe(32);
    expect(311 - box(table).x1).toBe(39);

    // Every new fixture is inside its room's face in the proposed view and overlaps no wall, and no
    // two fixtures share any space (a plan overlap and an overlap in height); a rug lies under the
    // pieces on it.
    const walls = [...computeFootprints(f, 'proposed').values()].map((fp) => bounds(fp.poly));
    // The vents pass through the walls (that is their job); the rest stay clear.
    const through = new Set(['Dryer vent', 'Vent hood', 'Hood duct', 'Duct cap']);
    const boxes = allNew.filter((x) => !through.has(x.label ?? '')).map((x) => ({ id: x.id, face: set.faces.find((fc) => fc.roomId && pointInPolygon(centre(x), fc.netPolygon))!, ...bounds(fixtureOutline(x)), z0: x.elevation, z1: x.elevation + x.height }));
    const overlaps = (p: { x0: number; x1: number; y0: number; y1: number }, q: typeof p) =>
      Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 1e-6 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 1e-6;
    const onFloor = (x: (typeof allNew)[number]) => x.kind === 'furniture' && !!x.piece && !!FURNITURE[x.piece].floorLayer;
    for (const b of boxes) {
      const corners = [
        { x: b.x0 + 0.01, y: b.y0 + 0.01 },
        { x: b.x1 - 0.01, y: b.y0 + 0.01 },
        { x: b.x1 - 0.01, y: b.y1 - 0.01 },
        { x: b.x0 + 0.01, y: b.y1 - 0.01 },
      ];
      for (const c of corners) expect(pointInPolygon(c, b.face.netPolygon), `${f.fixtures[b.id].kind} at ${JSON.stringify(c)}`).toBe(true);
      for (const w of walls) expect(overlaps(b, w), `${f.fixtures[b.id].kind} in a wall`).toBe(false);
      for (const q of boxes) {
        if (q.id <= b.id || onFloor(f.fixtures[b.id]) || onFloor(f.fixtures[q.id])) continue;
        const clash = overlaps(b, q) && Math.min(b.z1, q.z1) - Math.max(b.z0, q.z0) > 1e-6;
        expect(clash, `${f.fixtures[b.id].kind} and ${f.fixtures[q.id].kind}`).toBe(false);
      }
    }
    // The counters stay clear of the walls too.
    for (const r of runs) for (const w of walls) expect(overlaps(bounds(r.outline), w)).toBe(false);
    // The range hood's duct runs straight north from the hood across the pantry, over its shelves,
    // to the cap on the north face.
    const duct = allNew.find((x) => x.label === 'Hood duct')!;
    expect([box(duct).x0, box(duct).x1, box(duct).y0, box(duct).y1, duct.elevation]).toEqual([248, 256, -1, 60, 86]);
    expect(allNew.filter((x) => x.label === 'Shelves').every((x) => x.elevation + x.height < duct.elevation)).toBe(true);

    // The pantry's door in the band's wall (y 57.5); no new door is cut in the main block's east wall:
    // the bedroom's solid door hangs in today's opening (y 248..280).
    const doorAt = (o: Opening) => {
      const w = f.walls[o.wallId];
      const a = f.nodes[w.a];
      const d = normalize(sub(f.nodes[w.b], a));
      return { x: a.x + d.x * o.offset, y: a.y + d.y * o.offset };
    };
    const newDoors = Object.values(f.openings).filter((o) => o.type === 'door' && o.phase === 'new');
    expect(newDoors.filter((o) => doorAt(o).x === 314.5).map((o) => [doorAt(o).y, o.width])).toEqual([[264, 32]]);
    expect(newDoors.filter((o) => doorAt(o).y === 57.5).map((o) => [doorAt(o).x, o.width])).toEqual([[210, 24]]);
    // The Kitchen/Living partition (x 170.5) opened up (MK): one new opening floor to ceiling from
    // the hall's end to the south jamb of today's 48" Living doorway, which is demolished; the 16"
    // wall south of it and the pass-through stay.
    const kl = Object.values(f.openings).filter((o) => doorAt(o).x === 170.5 && doorAt(o).y > 99.5);
    expect(kl.map((o) => [o.phase, o.type, doorAt(o).y - o.width / 2, doorAt(o).y + o.width / 2, o.sill, o.height]).sort()).toEqual([
      ['demo', 'passage', 188, 236, 0, 80],
      ['existing', 'passage', 252, 300, 42, 42],
      ['new', 'passage', 102.5, 236, 0, 96],
    ]);
    // The old bath's north window (48" wide, its sill just above the wainscot, photo 22) goes, and
    // none replaces it: the pantry's shelves line that wall.
    const windows = Object.values(f.openings).filter((o) => o.type === 'window' && doorAt(o).y === 3.5 && doorAt(o).x > 194.5 && doorAt(o).x < 314.5);
    expect(windows.map((o) => [o.phase, doorAt(o).x, o.width, o.height, o.sill])).toEqual([['demo', 234, 48, 44, 42]]);

    // The powder room under the stair's high end: its west wall and the west piece of its south wall
    // 47 1/2" high, the east piece (past x 142) 77" with the 24" x 76" door from the hall, each at
    // most the soffit over it, and the stair's framing closes the gap above each with a panel.
    const low = Object.values(f.walls).filter((w) => w.phase === 'new' && w.heightOverride !== undefined);
    expect(low.map((w) => [f.nodes[w.a].x, f.nodes[w.a].y, f.nodes[w.b].x, f.nodes[w.b].y, w.heightOverride]).sort()).toEqual([
      [102, 3.5, 102, 46.5, 47.5],
      [102, 46.5, 142, 46.5, 47.5],
      [142, 46.5, 170.5, 46.5, 77],
    ]);
    const grand = Object.values(f.staircases ?? {}).find((sc) => sc.name === 'Grand stair')!;
    const layout = getStaircaseLayout(plan, f.id, grand.id, 'proposed')!;
    expect(layout.wallsThrough).toEqual([]);
    for (const top of [47.5, 77]) expect(layout.solids.some((x) => x.group === 'frame' && x.zb.c === top && x.zb.g.x === 0 && x.zb.g.y === 0)).toBe(true);
    const powderDoor = Object.values(f.openings).find((o) => o.wallId === low.find((w) => w.heightOverride === 77)!.id)!;
    expect([powderDoor.type, powderDoor.width, powderDoor.height, doorAt(powderDoor).x]).toEqual(['door', 24, 76, 155.5]);

    // The existing view has none of it: it shows today's 34 fixtures (photos 13 to 22 and MK's
    // description of the Utility) and their five counters (the north wall's base and drawer bank either
    // side of the range, which carries none, the 45 degree corner cabinet, the east run, and the Bath
    // vanity; the Utility has wall cabinets only).
    const existing = getLevelMeshes(plan, f.id, 'existing');
    expect([existing.fixtures.length, existing.counters.length]).toEqual([34, 5]);
    const proposedMeshes = getLevelMeshes(plan, f.id, 'proposed');
    // The kitchen's 25 (the table and its four chairs among them) and its five counters, the
    // pantry's three shelves, the stove's six parts (its stovepipe in two runs), and the ten placeholder bath and laundry
    // fixtures (the walk-in shower's floor, bench, glass and end wall among them), whose two vanities
    // carry a counter each; the master bedroom's two wardrobes, king bed and two nightstands, the
    // foyer's bench and hooks, the five pieces of the two vents and three alarms; and the furniture
    // added since (the Living's eight pieces, the screen porch's three, the bedroom's rug).
    // (The foyer's coat bench in place of its bench and two hook rails: two fewer.)
    expect([proposedMeshes.fixtures.length, proposedMeshes.counters.length]).toEqual([70, 7]);
  });

  it('has the wood stove on the Living\'s west wall on a stainless flue up the screen porch and the gable that clears the roof by the 3-2-10 rule, and no chimney', () => {
    const [f, s] = [plan.levels[plan.levelOrder[1]], plan.levels[plan.levelOrder[2]]];
    const named = (lvl: Level, label: string) => Object.values(lvl.fixtures).find((x) => x.label === label && x.phase === 'new')!;
    const bounds = (poly: Vec2[]) => {
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    };
    // Back to the west wall (its inside face x 7), facing east, centred y 162 where the bookcase was
    // (MK, 15 Oct 2026): the stove 6" off a 3" stone surround, on a hearth 18" deeper than the stove
    // and 8" wider each side.
    expect(bounds(fixtureOutline(named(f, 'Wood stove')))).toEqual([13, 39, 150, 174]);
    expect(bounds(fixtureOutline(named(f, 'Stone')))).toEqual([7, 10, 139, 185]);
    expect(bounds(fixtureOutline(named(f, 'Hearth')))).toEqual([7, 57, 142, 182]);
    expect(f.rooms[faceAt(getFaces(f, 'proposed'), { x: 26, y: 162 })!.roomId!].name).toBe('Living');
    // The west wall's openings: the house door (y 63.5..95.5, north of the beam post) and none in the
    // Living.
    const onWest = (lvl: Level, o: Opening) => lvl.nodes[lvl.walls[o.wallId].a].x === 3.5 && lvl.nodes[lvl.walls[o.wallId].b].x === 3.5;
    const centreY = (lvl: Level, o: Opening) => {
      const w = lvl.walls[o.wallId];
      const a = lvl.nodes[w.a];
      return a.y + normalize(sub(lvl.nodes[w.b], a)).y * o.offset;
    };
    const westNew = Object.values(f.openings).filter((o) => o.phase === 'new' && onWest(f, o));
    expect(westNew.filter((o) => centreY(f, o) > 140)).toEqual([]);
    const houseDoor = westNew.find((o) => o.type === 'door')!;
    const doorTrimSouth = centreY(f, houseDoor) + houseDoor.width / 2 + trimOf(houseDoor);
    // The stone surround clears the house door's trim.
    expect(139 - doorTrimSouth).toBeGreaterThanOrEqual(0);
    // Inside, a black connector from the stove's top up to an elbow, the stovepipe north over the
    // stone and west into the wall thimble (centre 66" up, y 145): it goes through no floor or ceiling.
    const flues = Object.values(plan.site.columns).filter((c) => c.kind === 'flue');
    expect(flues).toHaveLength(2);
    const connector = flues.find((c) => !c.cap)!;
    expect(connector).toMatchObject({ at: { x: 19, y: 162 }, width: 8, phase: 'new', color: '#26241f', base: 2 + 31, top: 2 + 70 });
    expect(connector.top).toBeLessThan(getLevelElevations(plan)[f.id].ceiling);
    const pipes = Object.values(f.fixtures).filter((x) => x.label === 'Stovepipe' && x.phase === 'new');
    expect(pipes.map((x) => bounds(fixtureOutline(x))).sort((m, n) => m[0] - n[0])).toEqual([[7, 15, 141, 149], [15, 23, 141, 166]]);
    for (const x of pipes) expect(x).toMatchObject({ elevation: 62, height: 8 });
    // The chimney: a round stainless pipe 2" clear of the siding (the wall's outside face is x 0),
    // straight up from its tee outdoors in the screen porch's north-east corner (the foyer stops at
    // y 120 since it moved north), capped; no chase upstairs.
    const flue = flues.find((c) => c.cap)!;
    expect(flue).toMatchObject({ at: { x: -6, y: 145 }, width: 8, phase: 'new', cap: true, base: 2 + 56 });
    expect(-(flue.at.x + flue.width / 2)).toBe(2);
    expect(bounds(fixtureOutline(named(f, 'Tee')))).toEqual([-6, 0, 141, 149]);
    expect(f.rooms[faceAt(getFaces(f, 'proposed'), { x: -6, y: 145 })!.roomId!].name).toBe('Screen porch (proposed)');
    expect(Object.values(s.fixtures).filter((x) => x.phase === 'new' && /chase/i.test(x.label ?? ''))).toEqual([]);
    // 2" or more south of the foyer roof's south eave (its outline's south edge plus the overhang).
    const foyerRoof = Object.values(f.roofs).find((r) => r.phase === 'new' && r.shape === 'gable')!;
    const eave = Math.max(...foyerRoof.outline.map((q) => q.y)) + foyerRoof.overhang;
    expect(flue.at.y - flue.width / 2 - eave).toBeGreaterThanOrEqual(2);
    // It rises up the gable wall just north of the Master's west window upstairs, clear of its trim
    // and its north shutter by 2" or more.
    const upWest = Object.values(s.openings).find((o) => o.shutters && onWest(s, o))!;
    const upNorth = centreY(s, upWest) - upWest.width / 2 - trimOf(upWest) - shutterWidth(upWest.width, upWest.sashes);
    expect(upNorth - (flue.at.y + flue.width / 2)).toBeGreaterThanOrEqual(2);
    expect(upNorth - (flue.at.y + flue.width / 2)).toBeLessThanOrEqual(6);
    // 3-2-10: 3' above where it leaves the roof (the rake overhang), 2' above any roof within 10'
    // (the ridge, y 157.5, 12 1/2" away, and the foyer's roof beside it).
    const main = Object.values(s.roofs)[0];
    const top = (p: Vec2) => getLevelElevations(plan)[s.id].floorTop + roofHeightAt(main, roofBearing(s.wallHeight, main), p)! + main.thickness;
    expect(flue.top - top(flue.at)).toBeGreaterThanOrEqual(36);
    for (const y of [145 - 120, 157.5, 145 + 120]) expect(flue.top - top({ x: flue.at.x, y })).toBeGreaterThanOrEqual(24 - 0.01);
    const foyerTop = (p: Vec2) => getLevelElevations(plan)[f.id].floorTop + roofHeightAt(foyerRoof, roofBearing(f.wallHeight, foyerRoof), p)! + foyerRoof.thickness;
    for (const y of [10, 65, 120]) expect(flue.top - foyerTop({ x: flue.at.x, y })).toBeGreaterThanOrEqual(24);
    // The masonry chimney is demolished.
    expect(Object.values(plan.site.columns).filter((c) => c.kind === 'chimney').map((c) => c.phase)).toEqual(['demo']);
  });

  it('has the upstairs full bath across the north-east, a stall shower in its corner, and the laundry in the master bath', () => {
    const [f, s] = [plan.levels[plan.levelOrder[1]], plan.levels[plan.levelOrder[2]]];
    const set = getFaces(s, 'proposed');
    const centre = (x: { origin: Vec2; direction: number; width: number; depth: number }) => {
      const o = fixtureOutline(x as Parameters<typeof fixtureOutline>[0]);
      return { x: o.reduce((t, p) => t + p.x, 0) / o.length, y: o.reduce((t, p) => t + p.y, 0) / o.length };
    };
    const inBath = Object.values(s.fixtures).filter((x) => x.phase === 'new' && s.rooms[faceAt(set, centre(x))?.roomId ?? '']?.name === 'Bath (proposed)');
    expect(inBath.map((x) => x.label ?? x.kind).sort()).toEqual(['Shower', 'WC', 'sink']);
    // The livability review's layout: a 32" x 60" shower along the east wall, the WC under the north
    // window and a 24" vanity on the south wall east of the door's swing. The WC's centre is 15"+
    // from the wall, the shower and the vanity, with 21" clear in front of the vanity (R307.1), and
    // the floor in front of the shower's open side (x 255..279, north of the vanity) is clear.
    const bx = (label: string) => {
      const o = fixtureOutline(inBath.find((x) => (x.label ?? x.kind) === label)!);
      return { x0: Math.min(...o.map((p) => p.x)), x1: Math.max(...o.map((p) => p.x)), y0: Math.min(...o.map((p) => p.y)), y1: Math.max(...o.map((p) => p.y)) };
    };
    const [shower, wc, vanity] = [bx('Shower'), bx('WC'), bx('sink')];
    expect(shower).toEqual({ x0: 279, x1: 311, y0: 7, y1: 67 });
    expect(wc).toEqual({ x0: 230, x1: 250, y0: 7, y1: 35 });
    expect(vanity).toEqual({ x0: 255, x1: 279, y0: 52, y1: 70 });
    const wcMid = (wc.x0 + wc.x1) / 2;
    expect(Math.min(wcMid - 223, shower.x0 - wcMid, vanity.x0 - wcMid)).toBeGreaterThanOrEqual(15);
    expect(vanity.y0 - 7).toBeGreaterThanOrEqual(21);
    expect(vanity.x0).toBeGreaterThanOrEqual(wc.x1);
    // The Guest's way out in a fire (R310, to verify): its south window is two casements, each over
    // 20" clear (32" sashes), sill at most 44".
    const onSouth = (o: Opening) => s.nodes[s.walls[o.wallId].a].y === 311.5 && s.nodes[s.walls[o.wallId].b].y === 311.5;
    const guestSouth = Object.values(s.openings).filter((o) => o.type === 'window' && o.phase === 'new' && onSouth(o));
    expect(guestSouth.map((o) => [o.width, o.height, o.sill, o.sashes])).toEqual([[66, 46, 34, 2]]);
    expect((guestSouth[0].width - 2) / 2).toBeGreaterThanOrEqual(20 + 8);
    expect(guestSouth[0].sill).toBeLessThanOrEqual(44);
    // Off the landing, each new door swings into its room: the bath's, the Master's and the Guest's.
    const into = (o: Opening) => {
      const w = s.walls[o.wallId];
      const a = s.nodes[w.a];
      const dir = normalize(sub(s.nodes[w.b], a));
      const n = perpLeft(dir);
      const side = (o.swing?.side ?? 'left') === 'left' ? 1 : -1;
      const face = faceAt(set, { x: a.x + dir.x * o.offset + n.x * side * 12, y: a.y + dir.y * o.offset + n.y * side * 12 });
      return face?.roomId ? s.rooms[face.roomId].name.replace(/ \(.*$/, '') : 'outside';
    };
    const upDoors = Object.values(s.openings).filter((o) => o.type === 'door' && o.phase === 'new');
    expect(upDoors.map((o) => `${o.width} ${into(o)}`).sort()).toEqual(['28 Bath', '28 Master', '30 Guest']);
    // The Guest takes the old Office, south of the bath, with its transom.
    expect(s.rooms[faceAt(set, { x: 267, y: 110 })!.roomId!].name).toBe('Guest (11\'5" adjusted)');
    // Downstairs, the washer and dryer side by side in the master bath's laundry closet.
    const fset = getFaces(f, 'proposed');
    const laundry = Object.values(f.fixtures).filter((x) => x.phase === 'new' && f.rooms[faceAt(fset, centre(x))?.roomId ?? '']?.name === 'Laundry (proposed)');
    expect(laundry.map((x) => x.label).sort()).toEqual(['Dryer', 'Dryer vent', 'Washer']);
  });

  it('builds every level without throwing, and the export has the parts of the house', () => {
    for (const id of plan.levelOrder) {
      const m = getLevelMeshes(plan, id, 'all');
      expect(m.walls.length).toBeGreaterThan(0);
      expect(m.floor).toBeDefined();
    }
    const root = buildExportScene(plan, 'all', visibility);
    const names = new Set<string>();
    root.traverse((o) => names.add(o.name.replace(/ \d+.*$/, '')));
    for (const n of ['Roof', 'Rafters', 'Fascia', 'Chimney', 'Flue', 'Terrain', 'Window', 'Door', 'Floor', 'Deck', 'Deck framing', 'Deck railing', 'Stair railing', 'Guard']) expect(names, n).toContain(n);
    // The masonry chimney's shaft, cap and spark arrestor, demolished; the stove's black connector, and
    // its flue with its rain cap, new.
    const site = root.children.find((c) => c.name === 'Site')!;
    const materials = (name: string) => site.children.filter((c) => c.name === name).map((c) => ((c as Mesh).material as MeshStandardMaterial).name);
    expect(materials('Chimney')).toEqual(['column_chimney_demo', 'chimney_cap_demo', 'chimney_arrestor_demo']);
    expect(materials('Flue')).toEqual(['column_flue_new_26241f', 'column_flue_new', 'flue_stem_new', 'flue_hood_new']);
    const box = new Box3().setFromObject(root);
    // The chimney, the flue and the main ridge are the tallest things: well above the second floor.
    expect(box.max.y / 0.0254).toBeGreaterThan(plan.baseFloorElevation + 2 * 96 + 100);
    disposeExportScene(root);
  });
});
