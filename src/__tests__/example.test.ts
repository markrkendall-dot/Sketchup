import { Box3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExampleJson } from '../../scripts/example-plan';
import example from '../../docs/examples/146-mick-road.json';
import { getFaces } from '../derive/rooms';
import { clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { migrate } from '../model/plan';
import type { Plan } from '../model/types';

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
    const rooms = plan.levelOrder.flatMap((id) => Object.values(plan.levels[id].rooms).map((r) => r.name));
    expect(rooms).toHaveLength(8);
    // The first-floor rooms are measured; every other room name still says it is an estimate.
    const measured = ['Kitchen', 'Living', 'Bath', 'Entry hall (6\'3" adjusted)', 'Utility'];
    for (const name of measured) expect(rooms).toContain(name);
    for (const name of rooms.filter((n) => !measured.includes(n))) expect(name).toMatch(/est\.|not measured/);
  });

  it("the main block measures 26'6\" x 25'4\" on the outside faces", () => {
    for (const id of plan.levelOrder) {
      const level = plan.levels[id];
      // The block's walls: the ones whose both ends are on the block's four corners' lines.
      const main = Object.values(level.walls).filter((w) => {
        if (w.kind !== 'exterior') return false;
        const a = level.nodes[w.a];
        const b = level.nodes[w.b];
        return [a, b].every((n) => n.x >= 3.5 - 1e-9 && n.x <= 314.5 + 1e-9 && n.y >= 3.5 - 1e-9 && n.y <= 300.5 + 1e-9) && (a.x === b.x ? a.x === 3.5 || a.x === 314.5 : a.y === 3.5 || a.y === 300.5);
      });
      const xs = main.flatMap((w) => [level.nodes[w.a].x, level.nodes[w.b].x]);
      const ys = main.flatMap((w) => [level.nodes[w.a].y, level.nodes[w.b].y]);
      const t = main[0].thickness;
      // Centerlines are 311 x 297 apart: the outside is 318 x 304 with 7" walls (the 8" basement
      // walls share the centerlines and stand 1/2" proud of the siding all round).
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(311, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(297, 6);
      for (const w of main) expect(w.thickness).toBe(id === plan.levelOrder[0] ? 8 : 7);
      if (id !== plan.levelOrder[0]) {
        expect(Math.max(...xs) - Math.min(...xs) + t).toBeCloseTo(318, 6);
        expect(Math.max(...ys) - Math.min(...ys) + t).toBeCloseTo(304, 6);
      }
    }
  });

  it('has the measured First Floor partitions (5") and rooms', () => {
    const level = plan.levels[plan.levelOrder[1]];
    const interior = Object.values(level.walls).filter((w) => w.kind === 'interior');
    expect(interior.length).toBeGreaterThanOrEqual(5);
    for (const w of interior) expect(w.thickness).toBe(5);
    for (const w of Object.values(level.walls).filter((w) => w.kind === 'exterior')) expect(w.thickness).toBe(7);
    // One stair, climbing west, cutting the floor above.
    expect(Object.values(level.stairs)).toHaveLength(1);
    const faces = getFaces(level, 'all');
    // The stair north wall's free east end is the one open wall end (the stair's open end).
    expect(faces.openEnds).toHaveLength(1);
    expect(faces.orphanRoomIds).toHaveLength(0);
    // Face to face sizes (east-west x north-south) from the owner's tape.
    const expected: Record<string, [number, number]> = { Kitchen: [138, 195], Living: [161, 169], Bath: [114, 90], Utility: [138, 113] };
    for (const [name, [w, h]] of Object.entries(expected)) {
      const room = Object.values(level.rooms).find((r) => r.name === name);
      const face = faces.faces.find((f) => f.roomId === room?.id);
      expect(face, name).toBeDefined();
      const xs = face!.netPolygon.map((p) => p.x);
      const ys = face!.netPolygon.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs), `${name} east-west`).toBeCloseTo(w, 0);
      expect(Math.max(...ys) - Math.min(...ys), `${name} north-south`).toBeCloseTo(h, 0);
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
    // The house door, the basement walkout door and the Bath door.
    expect(openings.filter((o) => o.type === 'door')).toHaveLength(3);
    // The porch's entry and its two open bays above the knee walls, then the Kitchen/Living passage
    // and the one at the stair south wall's east end.
    expect(openings.filter((o) => o.type === 'passage')).toHaveLength(5);
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
