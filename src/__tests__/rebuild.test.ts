import { describe, expect, it } from 'vitest';
import { buildRebuildJson } from '../../scripts/rebuild-plan';
import rebuild from '../../docs/examples/146-mick-road-rebuild.json';
import starter from '../../docs/examples/146-mick-road.json';
import { getIssues } from '../derive/checks';
import { getLevelElevations } from '../derive/levels';
import { faceAt, getFaces, roomDimensions } from '../derive/rooms';
import { flightSteps, floorToFloor, stairsHoleOutline } from '../derive/stairs';
import { getStaircaseLayout, heightAt } from '../derive/staircase';
import { migrate } from '../model/plan';
import type { Level, Plan, ViewMode } from '../model/types';
import { firstStructure } from '../model/structures';

const plan: Plan = migrate(rebuild);
const [bId, fId] = firstStructure(plan).levelOrder;
const [b, f, s] = firstStructure(plan).levelOrder.map((id) => plan.levels[id]);

/** The names of the rooms whose faces a view finds on a level, sorted. */
const roomNames = (level: Level, vm: ViewMode): string[] =>
  getFaces(level, vm)
    .faces.filter((x) => x.roomId)
    .map((x) => level.rooms[x.roomId!].name)
    .sort();

/** The face-to-face size of the room named, east-west by north-south, to the nearest 1/4". */
function sizeOf(level: Level, name: string, vm: ViewMode): [number, number] {
  const room = Object.values(level.rooms).find((r) => r.name === name);
  if (!room) throw new Error(`no room ${name}`);
  const set = getFaces(level, vm);
  const face = set.faces.find((x) => x.roomId === room.id);
  if (!face) throw new Error(`no face for ${name} in ${vm}`);
  // A rectangle's sides; an L (a bedroom with its closet) by its bounding box.
  const d = roomDimensions(face.netPolygon).rect ?? {
    width: Math.max(...face.netPolygon.map((p) => p.x)) - Math.min(...face.netPolygon.map((p) => p.x)),
    depth: Math.max(...face.netPolygon.map((p) => p.y)) - Math.min(...face.netPolygon.map((p) => p.y)),
  };
  return [Math.round(d.width * 4) / 4, Math.round(d.depth * 4) / 4];
}

describe('docs/examples/146-mick-road-rebuild.json', () => {
  it('is what scripts/build-example.ts writes (run npm run build:example after changing the script)', () => {
    expect(JSON.parse(buildRebuildJson())).toEqual(rebuild);
  });

  it('loads through migrate() byte for byte', () => {
    expect(JSON.stringify(plan, null, 2) + '\n').toBe(buildRebuildJson());
  });

  it('is a second plan on the same levels and foundation as the starter', () => {
    expect(plan.id).toBe('plan-146-mick-road-rebuild');
    expect(plan.name).toBe('146 Mick Road (rebuilt on the foundation, design study)');
    expect(firstStructure(plan).levelOrder.map((id) => plan.levels[id].name)).toEqual(['Basement', 'First Floor', 'Second Floor']);
    expect([b.wallHeight, b.floorThickness, f.wallHeight, f.floorThickness, s.wallHeight, s.floorThickness]).toEqual([90, 4, 96, 12, 96, 12]);
    expect(firstStructure(plan).baseFloorElevation).toBe(-100);
    expect(getLevelElevations(plan)[fId].floorTop).toBe(2);
  });

  it('shows the house as it stands in the Existing view, with the same rooms as the starter', () => {
    const old = migrate(starter);
    for (const [i, id] of firstStructure(plan).levelOrder.entries()) {
      expect(roomNames(plan.levels[id], 'existing'), plan.levels[id].name).toEqual(roomNames(old.levels[firstStructure(old).levelOrder[i]], 'existing'));
    }
  });

  it('keeps only the block ring, the girders, the retaining wall and the yard; everything else above the foundation is demolished', () => {
    // Every First and Second Floor wall of today's house is marked demolished and no longer bearing.
    for (const level of [f, s]) {
      const old = Object.values(level.walls).filter((w) => w.phase !== 'new');
      expect(old.length).toBeGreaterThan(15);
      expect(old.every((w) => w.phase === 'demo' && w.bearing === false)).toBe(true);
      expect(Object.values(level.stairs).filter((x) => x.phase === 'existing')).toHaveLength(0);
      expect(Object.values(level.roofs).filter((x) => x.phase === 'existing')).toHaveLength(0);
      expect(Object.values(level.fixtures).filter((x) => x.phase === 'existing')).toHaveLength(0);
    }
    // The basement: the 8" block ring stays (the four walls of the main block), the bump under the
    // wing goes with its walkout door, the retaining wall stays, and new block walls stand under the suite.
    const walls = Object.values(b.walls);
    // Five pieces: the bump's north wall split the ring's east wall when the house was drawn.
    const ring = walls.filter((w) => w.phase === 'existing' && w.finish === 'block');
    expect(ring).toHaveLength(5);
    const bump = walls.filter((w) => w.phase === 'demo');
    expect(bump).toHaveLength(3);
    expect(bump.every((w) => w.bearing === false)).toBe(true);
    expect(walls.filter((w) => w.phase === 'new' && w.finish === 'block')).toHaveLength(3);
    expect(walls.filter((w) => w.phase === 'existing' && w.thickness === 10).length).toBeGreaterThan(0);
    const doors = Object.values(b.openings);
    expect(doors.map((o) => [o.phase, o.width])).toEqual(expect.arrayContaining([['demo', 72], ['new', 72]]));
    // The masonry chimney goes; today's porch pad and stones go; the grade points stay.
    expect(Object.values(plan.site.columns).filter((c) => c.kind === 'chimney').map((c) => c.phase)).toEqual(['demo']);
    expect(Object.values(plan.site.surfaces).filter((x) => x.material === 'concrete').map((x) => x.phase)).toEqual(['demo']);
    expect(Object.keys(plan.site.gradePoints).length).toBeGreaterThan(49);
  });

  it('has the rooms of the rebuild in the Proposed view', () => {
    expect(roomNames(b, 'proposed')).toEqual(['Basement (unpartitioned, est.)', 'Basement under the suite (new, walkout)']);
    expect(roomNames(f, 'proposed')).toEqual(
      [
        'Basement stair (new)',
        'Coat closet (new)',
        'Entry hall (new)',
        'Great room (new)',
        'Kitchen / dining (new)',
        'Laundry (new)',
        'Master bath (new)',
        'Master bedroom (new)',
        'Pantry (new)',
        'Powder room (new)',
        'Screen room (new)',
        'Suite hall (new)',
        'Walk-in closet (new)',
      ].sort(),
    );
    expect(roomNames(s, 'proposed')).toEqual(['Bath (new)', 'Bedroom east (new)', 'Bedroom west (new)', 'East closet (new)', 'Hall (new)', 'Linen closet (new)', 'West closet (new)'].sort());
  });

  it('has the rooms at the plan\'s sizes (face to face, east-west x north-south)', () => {
    // The main block's new 2x6 walls on the old centerlines: inside 304 1/2" x 301 1/2".
    expect(sizeOf(f, 'Great room (new)', 'proposed')).toEqual([162.25, 201.5]);
    expect(sizeOf(f, 'Kitchen / dining (new)', 'proposed')).toEqual([137.75, 201.5]);
    expect(sizeOf(f, 'Coat closet (new)', 'proposed')).toEqual([67.5, 23.75]);
    expect(sizeOf(f, 'Powder room (new)', 'proposed')).toEqual([52, 60]);
    expect(sizeOf(f, 'Pantry (new)', 'proposed')).toEqual([52, 31]);
    // The suite, 14' out: 13'5 3/4" inside; its bath 7', the band 5', the bedroom 12'4 1/2".
    expect(sizeOf(f, 'Master bath (new)', 'proposed')).toEqual([161.75, 84]);
    expect(sizeOf(f, 'Master bedroom (new)', 'proposed')).toEqual([161.75, 148.5]);
    expect(sizeOf(f, 'Walk-in closet (new)', 'proposed')).toEqual([57, 60]);
    expect(sizeOf(f, 'Laundry (new)', 'proposed')).toEqual([59.75, 60]);
    expect(sizeOf(f, 'Screen room (new)', 'proposed')).toEqual([89.75, 131]);
    // Upstairs: the bath 6' x 7'9 1/2", the bedrooms either side of the partition.
    expect(sizeOf(s, 'Bath (new)', 'proposed')).toEqual([72, 95.5]);
    expect(sizeOf(s, 'Bedroom west (new)', 'proposed')).toEqual([161.5, 201.5]);
    expect(sizeOf(s, 'Bedroom east (new)', 'proposed')).toEqual([138.5, 201.5]);
  });

  it('has no open wall ends but the retaining wall\'s free west end in any view, and no orphan labels in the Existing and Proposed views', () => {
    for (const vm of ['existing', 'proposed', 'all'] as const) {
      for (const id of firstStructure(plan).levelOrder) {
        const level = plan.levels[id];
        const set = getFaces(level, vm);
        const ends = set.openEnds.map((n) => [level.nodes[n].x, level.nodes[n].y]);
        expect(ends, `${level.name} ${vm}`).toEqual(id === bId ? [[-388, 489]] : []);
        // In the All view the old rooms and the new ones coincide (the great room over the Living),
        // so the two labels share a face there and the old one keeps it.
        if (vm !== 'all') expect(set.orphanRoomIds, `${level.name} ${vm}`).toHaveLength(0);
      }
    }
  });

  it('stacks the basement stair under the stair up, both 36" wide along the north wall, with headroom', () => {
    const up = Object.values(f.stairs).find((x) => x.phase === 'new')!;
    const down = Object.values(b.stairs).find((x) => x.phase === 'new' && x.direction === 0)!;
    expect(up).toMatchObject({ direction: 0, width: 36, run: 140, risers: 15, railings: { right: true } });
    expect(flightSteps(up, floorToFloor(plan, fId)).rise).toBeCloseTo(7.2);
    expect(down).toMatchObject({ direction: 0, width: 36, run: 130, risers: 14, cutsFloorAbove: true });
    expect(up.origin.x + up.run).toBe(down.origin.x + down.run);
    expect(up.origin.y).toBe(down.origin.y);
    // The hole the basement stair cuts in the First Floor lies under the stair up.
    const hole = stairsHoleOutline(down, floorToFloor(plan, bId), b.wallHeight)!;
    const xs = hole.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(up.origin.x);
    expect(Math.max(...xs)).toBe(up.origin.x + up.run);
    // The stair up's framed underside is at least 80" over the basement stair's nosings all the way.
    const layout = getStaircaseLayout(plan, fId, up.staircaseId!, 'proposed')!;
    const soffit = layout.undersides[up.id]!;
    const downSteps = flightSteps(down, floorToFloor(plan, bId));
    const ftf = floorToFloor(plan, bId);
    for (let d = 0; d <= down.run; d += 10) {
      const x = down.origin.x + d;
      if (x < Math.min(...xs)) continue;
      const nosing = downSteps.rise + (d * downSteps.rise * downSteps.risers) / down.run - ftf;
      expect(heightAt(soffit, { x, y: up.origin.y }) - nosing, `at x ${x}`).toBeGreaterThanOrEqual(80);
    }
    // No wall under the stair rises into it.
    expect(layout.wallsThrough).toHaveLength(0);
  });

  it('has two bedrooms and a full bath upstairs, each bedroom with a closet and a window to climb out of', () => {
    const bedrooms = ['Bedroom west (new)', 'Bedroom east (new)'];
    for (const name of bedrooms) {
      const room = Object.values(s.rooms).find((r) => r.name === name)!;
      const face = getFaces(s, 'proposed').faces.find((x) => x.roomId === room.id)!;
      const windows = Object.values(s.openings).filter((o) => o.type === 'window' && o.phase === 'new' && face.wallIds.includes(o.wallId));
      expect(windows.length, name).toBeGreaterThanOrEqual(2);
      expect(windows.some((o) => o.sill <= 44 && o.height >= 24), name).toBe(true);
    }
    const bath = Object.values(s.fixtures).filter((x) => x.phase === 'new' && (x.label === 'Tub / shower' || x.label === 'WC' || x.kind === 'sink'));
    expect(bath.length).toBeGreaterThanOrEqual(3);
  });

  it('passes the code and structure checks in the Proposed view but for header notes', () => {
    const issues = getIssues(plan);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(issues.every((i) => i.code === 'structure.opening-header')).toBe(true);
  });

  it('labels the kitchen face where the island and the table stand', () => {
    const set = getFaces(f, 'proposed');
    const kitchen = Object.values(f.rooms).find((r) => r.name === 'Kitchen / dining (new)')!;
    for (const p of [
      { x: 258, y: 160 },
      { x: 239, y: 258 },
    ]) {
      expect(faceAt(set, p)?.roomId).toBe(kitchen.id);
    }
  });
});
