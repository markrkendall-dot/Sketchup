import { describe, expect, it } from 'vitest';
import { buildKitchenJson, CEILING, ROOM } from '../../scripts/kitchen-plan';
import kitchen from '../../docs/examples/kitchen.json';
import { getIssues } from '../derive/checks';
import { getLevelElevations } from '../derive/levels';
import { levelLights } from '../derive/lights';
import { viewPlanOf } from '../derive/optionView';
import { getFaces } from '../derive/rooms';
import { isCabinet } from '../model/casework';
import { migrate } from '../model/plan';
import { firstStructure } from '../model/structures';
import type { Plan, ViewMode } from '../model/types';
import { blockedAt, walkWorld } from '../view3d/walk';

const plan: Plan = migrate(kitchen);
const [lid] = firstStructure(plan).levelOrder;
const [a, b] = plan.options.map((o) => o.id);
const inOption = (id: string) => viewPlanOf(plan, id).levels[lid];
const roomNames = (id: string, vm: ViewMode) =>
  getFaces(inOption(id), vm)
    .faces.filter((x) => x.roomId)
    .map((x) => inOption(id).rooms[x.roomId!].name)
    .sort();

describe('docs/examples/kitchen.json', () => {
  it('is what scripts/build-example.ts writes (run npm run build:example after changing the script)', () => {
    expect(JSON.parse(buildKitchenJson())).toEqual(kitchen);
  });

  it('loads through migrate() byte for byte, and building it twice gives the same text', () => {
    expect(JSON.stringify(plan, null, 2) + '\n').toBe(buildKitchenJson());
    expect(buildKitchenJson()).toBe(buildKitchenJson());
  });

  it('is one room under a 9 ft ceiling with two draft options and three saved views', () => {
    expect(plan.id).toBe('plan-kitchen');
    expect(plan.levels[lid].wallHeight).toBe(CEILING);
    expect(plan.options.map((o) => o.id)).toEqual(['option-a', 'option-b']);
    expect(plan.views?.map((v) => v.name)).toEqual(['From the dining side', 'At the sink', 'From the far window']);
    const face = getFaces(plan.levels[lid], 'existing').faces.find((x) => x.roomId && plan.levels[lid].rooms[x.roomId].name === 'Kitchen')!;
    const xs = face.netPolygon.map((p) => p.x);
    const ys = face.netPolygon.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v))).toEqual([0, ROOM.w, 0, ROOM.d]);
  });

  it('the pantry stands today and in draft A, and is gone in draft B; the windows stay in both', () => {
    expect(roomNames(a, 'existing')).toEqual(['Kitchen', 'Pantry']);
    expect(roomNames(a, 'proposed')).toEqual(['Kitchen', 'Pantry']);
    expect(roomNames(b, 'proposed')).toEqual(['Kitchen']);
    const windows = (id: string) => Object.values(inOption(id).openings).filter((o) => o.type === 'window' && o.phase === 'existing').length;
    expect(windows(a)).toBe(3);
    expect(windows(b)).toBe(3);
    // The pantry's door goes with its wall in B only.
    const doors = (id: string) => Object.values(inOption(id).openings).filter((o) => o.type === 'door' && o.phase !== 'demo').length;
    expect([doors(a), doors(b)]).toEqual([1, 0]);
  });

  it("each draft's new cabinets take its own finishes; today's keep the level's", () => {
    const fronts = (id: string, phase: string) => new Set(Object.values(inOption(id).fixtures).filter((f) => isCabinet(f.kind) && f.kind !== 'island' && f.phase === phase).map((f) => f.frontColor));
    expect([...fronts(a, 'new')]).toEqual(['#f1efe9']);
    expect([...fronts(b, 'new')]).toEqual(['#34493f']);
    expect([...fronts(a, 'demo')]).toEqual([undefined]);
    expect(plan.levels[lid].finishes?.cabinetColor).toBe('#2e211d');
  });

  it('is lit: six recessed lights today, under-cabinet strips in the drafts, pendants over the island in B', () => {
    const kinds = (id: string, vm: ViewMode) => levelLights(inOption(id), vm).map((l) => l.kind);
    expect(kinds(a, 'existing')).toEqual(Array(6).fill('recessedLight'));
    expect(kinds(a, 'proposed').filter((k) => k === 'underCabinetLight')).toHaveLength(2);
    expect(kinds(b, 'proposed').filter((k) => k === 'pendant')).toHaveLength(2);
  });

  it('every saved view stands on open floor in every option and view, and the checks find no error', () => {
    for (const id of [a, b]) {
      const p = viewPlanOf(plan, id);
      for (const vm of ['existing', 'proposed'] as const) {
        const world = walkWorld(p, vm, [lid], true);
        for (const v of plan.views!) expect(blockedAt(world, v.at, getLevelElevations(p)[lid].floorTop), `${v.name} in ${id} ${vm}`).toBe(false);
      }
      expect(getIssues(p).filter((i) => i.severity === 'error')).toEqual([]);
    }
  });
});
