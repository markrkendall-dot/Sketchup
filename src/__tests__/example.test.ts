import { Box3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildExampleJson } from '../../scripts/example-plan';
import example from '../../docs/examples/146-mick-road.json';
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
    expect(rooms).toHaveLength(5);
    for (const name of rooms) expect(name).toMatch(/est\.|not measured/);
  });

  it('the main block measures 26.5 x 25.5 feet on the outside faces', () => {
    for (const id of plan.levelOrder) {
      const level = plan.levels[id];
      // The block's walls: the ones whose both ends are on the block's four corners' lines.
      const main = Object.values(level.walls).filter((w) => {
        const a = level.nodes[w.a];
        const b = level.nodes[w.b];
        return [a, b].every((n) => n.x >= 3.25 - 1e-9 && n.x <= 314.75 + 1e-9 && n.y >= 3.25 - 1e-9 && n.y <= 302.75 + 1e-9) && (a.x === b.x ? a.x === 3.25 || a.x === 314.75 : a.y === 3.25 || a.y === 302.75);
      });
      const xs = main.flatMap((w) => [level.nodes[w.a].x, level.nodes[w.b].x]);
      const ys = main.flatMap((w) => [level.nodes[w.a].y, level.nodes[w.b].y]);
      const t = main[0].thickness;
      // Centerlines are 311.5 x 299.5 apart: the outside is 318 x 306 with 6.5" walls (the 8" basement
      // walls share the centerlines and stand 3/4" proud of the siding all round).
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(311.5, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(299.5, 6);
      expect(t).toBe(id === plan.levelOrder[0] ? 8 : 6.5);
      if (id !== plan.levelOrder[0]) {
        expect(Math.max(...xs) - Math.min(...xs) + t).toBeCloseTo(26.5 * 12, 6);
        expect(Math.max(...ys) - Math.min(...ys) + t).toBeCloseTo(25.5 * 12, 6);
      }
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
    expect(openings.filter((o) => o.type === 'door')).toHaveLength(2);
    // The porch's entry and its two open bays above the knee walls.
    expect(openings.filter((o) => o.type === 'passage')).toHaveLength(3);
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
