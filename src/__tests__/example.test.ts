import { Box3, type BufferGeometry, type Mesh, type MeshStandardMaterial } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExampleJson } from '../../scripts/example-plan';
import example from '../../docs/examples/146-mick-road.json';
import { shutterWidth, SILL_THICKNESS } from '../derive/openings3d';
import { isOpeningVisible, isVisible } from '../derive/phase';
import { roofBearing, roofExtremes, roofHeightAt } from '../derive/roofs';
import { faceAt, getFaces } from '../derive/rooms';
import { columnDefaults } from '../derive/site';
import { flightSteps, floorToFloor, stairsBase, stairsRise } from '../derive/stairs';
import { normalize, perpLeft, polygonSignedArea, sub } from '../model/geometry';
import { clearMeshCache, getLevelMeshes, stairHoles } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { trimOf } from '../model/finish';
import { migrate } from '../model/plan';
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
    expect(names(lf, 'existing')).toEqual(['Bath', 'Entry hall', 'Entry porch (est.)', 'Kitchen (17\'2" adjusted: re-measure)', 'Living', 'Stair', 'Utility']);
    expect(names(ls, 'existing')).toEqual(['Bath', 'Bunk', 'Guest (11\'5" adjusted)', 'Master', 'Master closet', 'Office / hall (11\'11" adjusted)']);
    expect(names(lb, 'proposed')).toEqual(['Basement (unpartitioned, est.)', 'Crawl space (proposed)', 'Utility (below)']);
    expect(names(lf, 'proposed')).toEqual([
      'Entry hall',
      'Foyer (proposed)',
      'Kitchen (17\'2" adjusted: re-measure)',
      'Living',
      'Master bath (proposed)',
      'Master bedroom (proposed)',
      'Powder room (proposed)',
      'Screen porch (proposed)',
    ]);
    expect(names(ls, 'proposed')).toEqual(names(ls, 'existing'));
  });

  it('counts the existing, demolished and new work', () => {
    const levels = plan.levelOrder.map((id) => plan.levels[id]);
    const count = (items: { phase?: Phase }[]) => {
      const out: Record<Phase, number> = { existing: 0, demo: 0, new: 0 };
      for (const x of items) out[x.phase ?? 'existing']++;
      return out;
    };
    const all = <K extends 'walls' | 'openings' | 'stairs' | 'roofs' | 'rooms'>(k: K) => levels.flatMap((l) => Object.values(l[k]));
    // Walls: the old porch's three (the foyer's north wall splits its west wall in two), the wing's
    // north wall and the two y 99.5 pieces are demolished; the new ones are the addition, its
    // partition, the foyer, the screen porch and the powder room, and the block under the addition.
    expect(count(all('walls'))).toEqual({ existing: 53, demo: 7, new: 14 });
    expect(count(all('openings'))).toEqual({ existing: 23, demo: 10, new: 15 });
    expect(count(all('stairs'))).toEqual({ existing: 0, demo: 1, new: 3 });
    expect(count(all('roofs'))).toEqual({ existing: 1, demo: 2, new: 3 });
    expect(count(all('rooms'))).toEqual({ existing: 11, demo: 4, new: 6 });
    expect(count(Object.values(plan.site.columns))).toEqual({ existing: 1, demo: 0, new: 3 });
    // Demolished: the stair, the house door, the entry porch with its five screen openings, its roof
    // and label, the wing's north wall with its window and the wing's roof, the east window into the
    // new bedroom, the hall passage, the Living's west window (replaced without shutters).
    const f = plan.levels[plan.levelOrder[1]];
    expect(Object.values(f.rooms).filter((r) => r.phase === 'demo').map((r) => r.name).sort()).toEqual(['Bath', 'Entry porch (est.)', 'Stair', 'Utility']);
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
    // One stair today, climbing east from the west wall, cutting the floor above.
    const stairs = Object.values(level.stairs).filter((s) => isVisible(s.phase, 'existing'));
    expect(stairs).toHaveLength(1);
    expect(stairs[0].direction).toBe(0);
    expect(stairs[0].origin).toEqual({ x: 7, y: 118.5 });
    expect(stairs[0].cutsFloorAbove).toBe(true);
    const faces = getFaces(level, 'existing');
    expect(faces.openEnds).toHaveLength(0);
    expect(faces.orphanRoomIds).toHaveLength(0);
    // Face to face sizes (east-west x north-south) from the owner's tape; the Stair is the 2'9" strip.
    expectSizes(level, { Kitchen: [138, 206], Living: [161, 168], Bath: [114, 90], 'Entry hall': [185, 90], Utility: [138, 113], Stair: [161, 33] });
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
    const doors = Object.values(level.openings).filter((o) => o.type === 'door');
    expect(doors).toHaveLength(4);
    for (const o of doors) {
      const a = level.nodes[level.walls[o.wallId].a];
      const b = level.nodes[level.walls[o.wallId].b];
      const key = `${o.width}@${a.y === b.y ? a.y : '?'}`;
      expect(roomAtLeaf(o), key).toMatch(new RegExp(`^${into[key]}`));
    }
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
    expect(openings.filter((o) => o.type === 'window')).toHaveLength(20);
    // The house door, the porch's screen door, the basement walkout double door, the first-floor
    // Bath door, and the Second Floor's Bunk, Master, Bath and Guest doors.
    expect(openings.filter((o) => o.type === 'door')).toHaveLength(8);
    // The Kitchen/Living passage; the hall and Living passages and the 30" opening at the stair; the
    // Master closet opening.
    expect(openings.filter((o) => o.type === 'passage')).toHaveLength(5);
    // The porch: screens in its four bays and a screen door.
    expect(openings.filter((o) => o.glazing === 'screen').map((o) => `${o.type} ${o.width}`).sort()).toEqual(['door 36', 'window 18', 'window 18', 'window 44', 'window 44']);
    expect(Object.values(plan.levels[plan.levelOrder[1]].rooms).some((r) => r.name === 'Entry porch (est.)')).toBe(true);
    expect(Object.keys(plan.site.gradePoints)).toHaveLength(19);
    // The porch's floor (top +2) is at grade: the ground is at +1 round it, its corners against the
    // house too; the walkout's threshold is at the basement floor in front of both jambs.
    const grade = (x: number, y: number) => Object.values(plan.site.gradePoints).find((g) => g.at.x === x && g.at.y === y)?.elevation;
    expect([grade(-66, 0), grade(-66, 48), grade(-66, 96), grade(0, 0), grade(0, 96)]).toEqual([1, 1, 1, 1, 1]);
    expect([grade(354.5, 321), grade(426.5, 321)]).toEqual([-100, -100]);
    expect(plan.site.northAngle).toBe(0);
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
    // The main block's south picture windows (photo 1): casement, fixed pane, casement, about 12' and 10' wide.
    const south = existing.filter((o) => o.type === 'window' && Math.abs(at(f, o).y - 311.5) < 1e-6 && at(f, o).x < 318);
    expect(south.map((o) => [o.width, o.sashes, o.fixedCenter, o.lites]).sort()).toEqual([
      [118, 3, true, { cols: 2, rows: 3 }],
      [144, 3, true, { cols: 2, rows: 3 }],
    ]);
    // The house door (photo 8): dark green, nine lites over two panels.
    const door = existing.find((o) => o.type === 'door' && Math.abs(at(f, o).x - 3.5) < 1e-6)!;
    expect(door).toMatchObject({ width: 36, lites: { cols: 3, rows: 3 }, halfLite: true, leafColor: '#2f4a3a' });
    // The basement: grey block, but vertical boards in the stain round the walkout double door (photo 2).
    const walls = Object.values(b.walls);
    expect(walls.filter((w) => w.finish === 'block' && w.color === '#8f8a84')).toHaveLength(walls.length - 1);
    const boards = walls.find((w) => w.finish === 'board')!;
    expect(boards.color).toBe('#5a3a35');
    const walkout = Object.values(b.openings);
    expect(walkout).toHaveLength(1);
    // The block under the proposed addition is block too.
    expect(walls.filter((w) => w.phase === 'new').every((w) => w.finish === 'block' && w.thickness === 8)).toBe(true);
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

  it('has no open wall ends and no orphan labels in any view', () => {
    for (const vm of ['existing', 'proposed', 'all'] as const) {
      for (const id of plan.levelOrder) {
        const set = getFaces(plan.levels[id], vm);
        expect(set.openEnds, `${plan.levels[id].name} ${vm}`).toHaveLength(0);
        expect(set.orphanRoomIds, `${plan.levels[id].name} ${vm}`).toHaveLength(0);
      }
    }
  });

  it('has the rooms of the proposed design (face to face, east-west x north-south)', () => {
    const [b, f, s] = plan.levelOrder.map((id) => plan.levels[id]);
    expectSizes(
      f,
      {
        // The wing grown north: bath 11'6" x 9'2 1/2", bedroom 11'6" x 15'5 1/2" (the old Utility plus 6').
        'Master bath': [138, 110.5],
        'Master bedroom': [138, 185.5],
        // The kitchen as an L with the old bath: its bounding box.
        Kitchen: [138, 301],
        Living: [161, 168],
        'Powder room': [60, 49],
        // The old hall, the stair strip and the stair in one face.
        'Entry hall': [185, 128],
        Foyer: [89, 79.75],
        'Screen porch': [89, 150],
      },
      'proposed',
    );
    expectSizes(b, { 'Crawl space': [137, 180], 'Utility (below)': [137, 112] }, 'proposed');
    // Upstairs nothing changes.
    expectSizes(s, { Bunk: [162, 90], Bath: [44, 74], Master: [162, 168], Guest: [137, 153], 'Master closet': [30, 33] }, 'proposed');
    // In the All view the demolished rooms keep their faces and the new labels sit in the parts the
    // old rooms did not cover, so no face has two names.
    expectSizes(f, { Utility: [138, 113], 'Master bedroom': [138, 65.5], 'Entry porch': [59, 57.25], Stair: [161, 33] }, 'all');
  });

  it('has the new stair: two risers up to a landing, then the flight east along the north wall', () => {
    const [f, s] = [plan.levels[plan.levelOrder[1]], plan.levels[plan.levelOrder[2]]];
    const ftf = floorToFloor(plan, plan.levelOrder[1]);
    expect(ftf).toBe(108);
    const flights = Object.values(f.stairs).filter((st) => st.phase === 'new');
    expect(flights.map((st) => [st.origin, st.direction, st.width, st.run, stairsBase(st), stairsRise(st, ftf), flightSteps(st, ftf).risers, st.cutsFloorAbove])).toEqual([
      [{ x: 25, y: 79 }, 270, 36, 36, 0, 14, 2, false],
      [{ x: 25, y: 43 }, 270, 36, 36, 0, 14, 1, false],
      [{ x: 43, y: 25.25 }, 0, 35.5, 126, 14, 94, 13, true],
    ]);
    // The landing is in the hall's face (the old hall and the strip are one room in Proposed).
    const set = getFaces(f, 'proposed');
    expect(f.rooms[faceAt(set, { x: 25, y: 25 })!.roomId!].name).toBe('Entry hall');
    // Only the main flight cuts the Second Floor, from where the headroom drops under 80" (about
    // 18.8" up the run) to its top at the Bunk's east wall face (x 169), 1/2" off the north wall's
    // inside face so the opening lies inside the slab.
    const holes = stairHoles(f, 'proposed', ftf);
    expect(holes).toHaveLength(1);
    const xs = holes[0].map((p) => p.x);
    const ys = holes[0].map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(43 + (126 * (108 - 80 - 14)) / 94, 6);
    expect([Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([169, 7.5, 43]);
    // The slab is cut: its top loses the new opening and gets the old one back.
    const top = (vm: ViewMode) => slabTopArea(getLevelMeshes(plan, s.id, vm).floor!);
    const hole = (h: Vec2[]) => Math.abs(polygonSignedArea(h));
    const oldHole = hole(stairHoles(f, 'existing', ftf)[0]);
    expect(top('existing') - top('proposed')).toBeCloseTo(hole(holes[0]) - oldHole, 0);
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
      // One gable over the whole east wing, ridge north-south.
      ['gable', [318, 463, 0, 315], 90, 7, 18],
      // The foyer's gable faces west; the porch's shed is high at the house wall. Their outlines
      // stop 18" short of the wall, so the overhang ends at its outside face.
      ['gable', [-96, -18, 64.25, 158], 0, 8, 18],
      ['shed', [-96, -18, 158, 315], 180, 4, 18],
    ]);
    // The shed is 128" above the first floor at the house wall and 96" at the porch's outer wall;
    // the foyer's ridge is under the upstairs west window's sill (156" above the first floor).
    const [, foyer, shed] = roofs;
    expect(roofHeightAt(shed, roofBearing(f.wallHeight, shed), { x: 0, y: 236 })).toBeCloseTo(128, 6);
    expect(roofHeightAt(shed, roofBearing(f.wallHeight, shed), { x: -96, y: 236 })).toBeCloseTo(96, 6);
    expect(roofExtremes(foyer, roofBearing(f.wallHeight, foyer)).ridge + foyer.thickness).toBeLessThan(156);
    // Posts in the stain from the porch floor to the roof over each.
    const posts = Object.values(plan.site.columns).filter((c) => c.kind === 'post');
    expect(posts).toHaveLength(3);
    for (const p of posts) {
      expect(p).toMatchObject({ phase: 'new', width: 8, depth: 8, base: 2, color: '#5a3a35' });
      expect(p.top).toBeCloseTo(columnDefaults(plan, 'post', p.at, 'new').top, 2);
    }
  });

  it('swings each new door into the room the design names', () => {
    const f = plan.levels[plan.levelOrder[1]];
    const set = getFaces(f, 'proposed');
    const doors = Object.values(f.openings).filter((o) => o.type === 'door' && o.phase === 'new');
    const into = (o: Opening) => {
      const w = f.walls[o.wallId];
      const a = f.nodes[w.a];
      const dir = normalize(sub(f.nodes[w.b], a));
      const n = perpLeft(dir);
      const side = (o.swing?.side ?? 'left') === 'left' ? 1 : -1;
      const face = faceAt(set, { x: a.x + dir.x * o.offset + n.x * side * 12, y: a.y + dir.y * o.offset + n.y * side * 12 });
      return face?.roomId ? f.rooms[face.roomId].name.replace(/ \(.*$/, '') : 'outside';
    };
    expect(doors.map((o) => `${o.width} ${into(o)}`).sort()).toEqual([
      '28 Master bath',
      '28 Powder room',
      '32 Entry hall',
      '32 Master bedroom',
      '36 Foyer',
      '36 Screen porch',
      '36 outside',
    ]);
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
    for (const n of ['Roof', 'Rafters', 'Fascia', 'Chimney', 'Terrain', 'Window', 'Door', 'Floor']) expect(names, n).toContain(n);
    // The chimney's shaft, cap and spark arrestor.
    const site = root.children.find((c) => c.name === 'Site')!;
    expect(site.children.filter((c) => c.name === 'Chimney').map((c) => ((c as Mesh).material as MeshStandardMaterial).name)).toEqual([
      'column_chimney_existing_5a3a35',
      'chimney_cap_existing',
      'chimney_arrestor_existing',
    ]);
    const box = new Box3().setFromObject(root);
    // The chimney and the main ridge are the tallest things: well above the second floor.
    expect(box.max.y / 0.0254).toBeGreaterThan(plan.baseFloorElevation + 2 * 96 + 100);
    disposeExportScene(root);
  });
});
