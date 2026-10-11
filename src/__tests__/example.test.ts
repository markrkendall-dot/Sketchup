import { Box3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExampleJson } from '../../scripts/example-plan';
import example from '../../docs/examples/146-mick-road.json';
import { faceAt, getFaces } from '../derive/rooms';
import { normalize, perpLeft, sub } from '../model/geometry';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { migrate } from '../model/plan';
import type { Level, Plan } from '../model/types';

const plan: Plan = migrate(example);
const visibility = { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: plan.levelOrder[1] };

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
    const names = (id: string) => Object.values(plan.levels[id].rooms).map((r) => r.name);
    const [lb, lf, ls] = plan.levelOrder;
    expect(names(lb)).toEqual(['Basement (unpartitioned, est.)']);
    expect(names(lf).sort()).toEqual(['Bath', 'Entry hall', 'Entry porch (est.)', 'Kitchen (17\'2" adjusted: re-measure)', 'Living', 'Stair', 'Utility']);
    expect(names(ls).sort()).toEqual(['Bath', 'Bunk', 'Guest (11\'5" adjusted)', 'Master', 'Master closet', 'Office / hall (11\'11" adjusted)']);
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

  /** Net bounding-box size of the named room's face. */
  const faceSize = (level: Level, name: string): [number, number] => {
    const set = getFaces(level, 'all');
    const room = Object.values(level.rooms).find((r) => r.name === name || r.name.startsWith(`${name} (`));
    const face = set.faces.find((f) => f.roomId === room?.id);
    expect(face, name).toBeDefined();
    const xs = face!.netPolygon.map((p) => p.x);
    const ys = face!.netPolygon.map((p) => p.y);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const expectSizes = (level: Level, expected: Record<string, [number, number]>) => {
    for (const [name, [w, h]] of Object.entries(expected)) {
      const [fw, fh] = faceSize(level, name);
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
    // One stair, climbing east from the west wall, cutting the floor above.
    const stairs = Object.values(level.stairs);
    expect(stairs).toHaveLength(1);
    expect(stairs[0].direction).toBe(0);
    expect(stairs[0].origin).toEqual({ x: 7, y: 118.5 });
    expect(stairs[0].cutsFloorAbove).toBe(true);
    const faces = getFaces(level, 'all');
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
    const faces = getFaces(level, 'all');
    expect(faces.openEnds).toHaveLength(0);
    expect(faces.orphanRoomIds).toHaveLength(0);
    expectSizes(level, { Bunk: [162, 90], Bath: [44, 74], Master: [162, 168], Guest: [137, 153], 'Master closet': [30, 33] });
    // The Office / hall is one face with the landing and the stair well: 7'4" wide at the east wall.
    const [, officeH] = faceSize(level, 'Office / hall');
    expect(Math.abs(officeH - 143)).toBeLessThanOrEqual(0.5);
  });

  it('swings each Second Floor door into the room the plan names', () => {
    const level = plan.levels[plan.levelOrder[2]];
    const set = getFaces(level, 'all');
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
    const roofs = plan.levelOrder.flatMap((id) => Object.values(plan.levels[id].roofs));
    // Main gable, east wing gable, and the entry porch gable (one porch on the west face, photo 8).
    expect(roofs).toHaveLength(3);
    expect(roofs.every((r) => r.finish === 'metal' && r.color === '#6e6259')).toBe(true);
    expect(Object.values(plan.site.columns).map((c) => c.kind)).toEqual(['chimney']);
    const openings = plan.levelOrder.flatMap((id) => Object.values(plan.levels[id].openings));
    expect(openings.filter((o) => o.type === 'window').length).toBeGreaterThanOrEqual(16);
    // The house door, the basement walkout door, the first-floor Bath door, and the Second Floor's
    // Bunk, Master, Bath and Guest doors.
    expect(openings.filter((o) => o.type === 'door')).toHaveLength(7);
    // The porch's entry and its two open bays above the knee walls; the Kitchen/Living passage; the
    // hall and Living passages and the 30" opening at the stair; the Master closet opening.
    expect(openings.filter((o) => o.type === 'passage')).toHaveLength(8);
    expect(Object.values(plan.levels[plan.levelOrder[1]].rooms).some((r) => r.name === 'Entry porch (est.)')).toBe(true);
    expect(Object.keys(plan.site.gradePoints).length).toBeGreaterThanOrEqual(8);
    expect(plan.site.northAngle).toBe(0);
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
    for (const n of ['Roof', 'Chimney', 'Terrain', 'Window', 'Door', 'Floor']) expect(names, n).toContain(n);
    const box = new Box3().setFromObject(root);
    // The chimney and the main ridge are the tallest things: well above the second floor.
    expect(box.max.y / 0.0254).toBeGreaterThan(plan.baseFloorElevation + 2 * 96 + 100);
    disposeExportScene(root);
  });
});
