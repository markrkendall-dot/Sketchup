import { describe, expect, it } from 'vitest';
import { parseRoom } from '../../scripts/scan/roomplan';
import { buildDraftPlan, emitScanModule, fixtureKindFor, scanToDraft, type ScanDraft } from '../../scripts/scan/scanToPlan';
import { SCAN_CANNOT_SEE, tapeList } from '../../scripts/scan/tapeList';
import room from '../../scripts/scan/fixtures/synthetic-room/room.json';
import frames from '../../scripts/scan/fixtures/synthetic-room/frames.json';
import meta from '../../scripts/scan/fixtures/synthetic-room/meta.json';
import { migrate } from '../model/plan';
import { firstStructure } from '../model/structures';

const draft: ScanDraft = scanToDraft(parseRoom(room, frames, meta));
const wallOn = (side: string) => draft.walls.find((w) => w.side === side)!;
const Q = 0.25;

describe('scan to draft: the synthetic room (13 ft x 27\'6", 9 ft, scanned turned 17 degrees with noisy walls)', () => {
  it('comes out 156 x 330 x 108 within 1/4", four squared walls round four shared corners', () => {
    expect(Math.abs(draft.room.width - 156)).toBeLessThanOrEqual(Q);
    expect(Math.abs(draft.room.depth - 330)).toBeLessThanOrEqual(Q);
    expect(Math.abs(draft.room.ceiling - 108)).toBeLessThanOrEqual(Q);
    expect(draft.room.closed).toBe(true);
    expect(draft.walls).toHaveLength(4);
    expect(draft.walls.every((w) => w.squared)).toBe(true);
    expect(draft.walls.map((w) => w.side)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(draft.corners).toHaveLength(4);
    expect(draft.corners.every((c) => c.walls.length === 2 && c.how === 'intersect')).toBe(true);
    // Each wall's ends are corners (shared, not two nearby points).
    const at = new Set(draft.corners.map((c) => `${c.at.x},${c.at.y}`));
    for (const w of draft.walls) {
      expect(at.has(`${w.a.x},${w.a.y}`)).toBe(true);
      expect(at.has(`${w.b.x},${w.b.y}`)).toBe(true);
      expect(Math.abs(w.length - (w.side === 'top' || w.side === 'bottom' ? 156 : 330))).toBeLessThanOrEqual(Q);
    }
    expect(draft.chains).toEqual([{ walls: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], closed: true }]);
    expect(Math.abs(draft.tidy.rotation - 17)).toBeLessThan(0.1);
    // Every length is a whole 1/8".
    for (const v of [...draft.walls.flatMap((w) => [w.a.x, w.a.y, w.b.x, w.b.y, w.length]), ...draft.openings.flatMap((o) => [o.offset, o.width, o.height, o.sill])]) expect(v * 8).toBe(Math.round(v * 8));
    // The raw scanned numbers are kept: the walls were scanned long or short of the corners.
    expect(wallOn('right').raw.length).not.toBe(wallOn('right').length);
  });

  it('keeps the room as it stood: the walls run clockwise on the plan and the door is on the top wall (no mirror image)', () => {
    const top = wallOn('top');
    expect(top.a).toEqual({ x: 0, y: 0 });
    expect(top.b).toEqual({ x: 156, y: 0 });
    expect(top.inward).toEqual({ x: 0, y: 1 });
  });

  it('puts each opening on the right wall at the right offset from its a end', () => {
    const byType = (t: string) => draft.openings.find((o) => o.type === t)!;
    const door = byType('door');
    expect(door.wallId).toBe(wallOn('top').id);
    expect(Math.abs(door.offset - 100)).toBeLessThanOrEqual(Q);
    expect([door.width, door.height, door.sill]).toEqual([32, 80, 0]);
    // The left wall runs bottom to top (clockwise), so its a end is at y 330: the window centred at y 168 is 162 along it.
    const window = byType('window');
    expect(window.wallId).toBe(wallOn('left').id);
    expect(Math.abs(window.offset - 162)).toBeLessThanOrEqual(Q);
    expect([window.width, window.height, window.sill]).toEqual([36, 48, 42]);
    expect(window.nearCorner.end).toBe('a');
    // The bottom wall runs right to left: the opening centred at x 78 is 78 from x 156.
    const cased = byType('passage');
    expect(cased.wallId).toBe(wallOn('bottom').id);
    expect(Math.abs(cased.offset - 78)).toBeLessThanOrEqual(Q);
    expect(cased.confidence).toBe('low');
    expect(draft.openings.map((o) => o.id).sort()).toEqual(['door-1', 'opening-1', 'window-1']);
  });

  it('maps objects to fixture kinds and snaps their backs to the wall faces', () => {
    const kinds = Object.fromEntries(draft.fixtures.map((f) => [f.scanId, f.kind]));
    expect(kinds).toEqual({
      'B-1': 'base',
      'B-2': 'base',
      'B-3': 'base',
      'B-SINK': 'sink',
      'B-UPPER': 'wall',
      'B-TALL': 'tall',
      'A-STOVE': 'range',
      'A-FRIDGE': 'fridge',
      'X-TABLE': 'furniture',
      'X-FIRE': 'box',
    });
    const f = (id: string) => draft.fixtures.find((x) => x.scanId === id)!;
    // The left run: backs on the face x 0, facing +x, centred where they were scanned.
    for (const [id, y, w] of [['B-1', 72, 24], ['B-2', 102, 36], ['B-3', 135, 30], ['B-SINK', 168, 36]] as const) {
      expect(f(id).wallId).toBe(wallOn('left').id);
      expect(f(id).origin.x).toBe(0);
      expect(Math.abs(f(id).origin.y - y)).toBeLessThanOrEqual(Q);
      expect([f(id).direction, f(id).width, f(id).depth, f(id).elevation]).toEqual([0, w, 24, 0]);
    }
    expect([f('B-UPPER').elevation, f('B-UPPER').depth, f('B-UPPER').origin.x]).toEqual([54, 13, 0]);
    // The tall cabinet was scanned with its right axis across the wall: the snap swaps width and depth.
    expect(f('B-TALL')).toMatchObject({ wallId: wallOn('top').id, direction: 90, width: 30, depth: 24, height: 84 });
    expect(f('B-TALL').origin.y).toBe(0);
    // The appliances on the right wall face -x; the fridge stood 2" off the wall and is pulled back to it.
    expect(f('A-STOVE')).toMatchObject({ wallId: wallOn('right').id, direction: 180, width: 30, depth: 25, confidence: 'low' });
    expect(f('A-FRIDGE')).toMatchObject({ wallId: wallOn('right').id, direction: 180, width: 36, depth: 30, height: 70 });
    expect(f('A-FRIDGE').origin.x).toBe(156);
    // The table stands free; the fireplace has no kind of its own.
    expect(f('X-TABLE')).toMatchObject({ wallId: null, piece: 'diningTable' });
    expect(f('X-FIRE')).toMatchObject({ kind: 'box', label: 'Fireplace (scanned)', wallId: wallOn('bottom').id, direction: 270 });
    // Ids are readable and never clash with the walls'.
    expect(f('B-UPPER').id).toBe('wallCabinet-1');
  });

  it('groups the left wall\'s three cabinets and the sink into one run', () => {
    const run = draft.runs.find((r) => r.wallId === wallOn('left').id && r.tier === 'base')!;
    expect(run.fixtures.map((id) => draft.fixtures.find((f) => f.id === id)!.scanId).sort()).toEqual(['B-1', 'B-2', 'B-3', 'B-SINK']);
    expect(Math.abs(run.length - 126)).toBeLessThanOrEqual(Q);
    expect(run.confidence).toBe('medium');
  });

  it('maps storage by height and place, and names what has no kind', () => {
    expect(fixtureKindFor('storage', 0, 36).kind).toBe('base');
    expect(fixtureKindFor('storage', 0, 84).kind).toBe('tall');
    expect(fixtureKindFor('storage', 54, 30).kind).toBe('wall');
    expect(fixtureKindFor('oven', 0, 84).kind).toBe('wallOven');
    expect(fixtureKindFor('oven', 0, 36).kind).toBe('range');
    expect(fixtureKindFor('dishwasher', 0, 34).kind).toBe('dishwasher');
    expect(fixtureKindFor('washerDryer', 0, 38).kind).toBe('washer');
    expect(fixtureKindFor('television', 30, 30)).toEqual({ kind: 'box', label: 'Television (scanned)' });
  });

  it('turns each keyframe into a saved view standing where the camera stood, looking its way', () => {
    expect(draft.views).toHaveLength(2);
    const [a, b] = draft.views;
    // Frame 1 at (78, 300) looking at the top wall (-y, yaw 0), 5 degrees down; frame 2 at (40, 100) looking +x (yaw -pi/2).
    expect(Math.abs(a.at.x - 78)).toBeLessThan(0.5);
    expect(Math.abs(a.at.y - 300)).toBeLessThan(0.5);
    expect(a.yaw).toBeCloseTo(0, 2);
    expect(a.pitch).toBeCloseTo(-0.0873, 3);
    expect(b.yaw).toBeCloseTo(-Math.PI / 2, 2);
    expect([a.eyeHeight, b.eyeHeight]).toEqual([60, 62]);
    expect(a.fov.horizontal).toBeCloseTo(67.01, 1);
    expect(a.name).toBe('Keyframe 1 (0001.jpg)');
  });

  it('is plain data: it survives JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
  });
});

describe('emitScanModule', () => {
  it('writes a generated, typed data module that says not to edit it', () => {
    const text = emitScanModule(draft, 'kitchen');
    expect(text.split('\n')[0]).toMatch(/^\/\/ GENERATED from a scan/);
    expect(text).toContain('Do not edit by hand');
    expect(text).toContain("import type { ScanDraft } from './scan/scanToPlan';");
    expect(text).toContain('export const SCAN: ScanDraft = {');
    const body = text.slice(text.indexOf('= {') + 2, text.lastIndexOf(';'));
    expect(JSON.parse(body)).toEqual(draft);
  });
});

describe('buildDraftPlan', () => {
  const { json, skipped } = buildDraftPlan(draft);
  const plan = JSON.parse(json);

  it('survives migrate byte for byte and is the same on a second run', () => {
    expect(JSON.stringify(migrate(plan), null, 2)).toBe(JSON.stringify(plan, null, 2));
    expect(buildDraftPlan(draft).json).toBe(json);
    expect(skipped).toEqual([]);
  });

  it('holds the walls on their centerlines round the faces, the openings, the fixtures and a view per keyframe', () => {
    const p = migrate(plan);
    const lvl = p.levels[firstStructure(p).levelOrder[0]];
    expect(lvl.wallHeight).toBe(draft.room.ceiling);
    expect(Object.keys(lvl.walls)).toHaveLength(4);
    const xs = Object.values(lvl.nodes).map((n) => n.x);
    const ys = Object.values(lvl.nodes).map((n) => n.y);
    // 6.5" walls: centerlines 3.25" outside the faces.
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-3.25, draft.room.width + 3.25, -3.25, draft.room.depth + 3.25]);
    expect(Object.values(lvl.openings).map((o) => o.type).sort()).toEqual(['door', 'passage', 'window']);
    expect(Object.keys(lvl.fixtures)).toHaveLength(draft.fixtures.length);
    expect(Object.values(lvl.fixtures).filter((f) => f.kind === 'fridge')).toHaveLength(1);
    expect(p.views?.map((v) => v.name)).toEqual(draft.views.map((v) => v.name));
    expect(p.id).toBe('plan-synthetic-kitchen-scan');
    expect(Object.values(lvl.rooms).map((r) => r.name)).toEqual(['Synthetic kitchen']);
  });
});

describe('tapeList', () => {
  const md = tapeList(draft);
  const lines = md.split('\n');
  const numbered = lines.filter((l) => /^\d+\. /.test(l));

  it('starts with the room width, depth and ceiling, in feet and inches to the 1/8', () => {
    expect(md).toContain('## Still to measure');
    expect(numbered[0]).toBe('1. Room width, left wall to right wall, face to face: scan reads 13\'-0" (156").');
    expect(numbered[1]).toBe('2. Room depth, top wall to bottom wall, face to face: scan reads 27\'-6" (330").');
    expect(numbered[2]).toMatch(/^3\. Ceiling height, floor to ceiling: scan reads 9'-0" \(108"\)\./);
  });

  it('lists each wall, opening, cabinet run and appliance, the ones below high confidence first in each group', () => {
    const section = (title: string) => {
      const i = lines.indexOf(`### ${title}`);
      const rest = lines.slice(i + 1);
      const end = rest.findIndex((l) => l.startsWith('#'));
      return rest.slice(0, end < 0 ? undefined : end).filter((l) => /^\d+\. /.test(l));
    };
    const walls = section('Walls, face to face');
    expect(walls).toHaveLength(4);
    expect(walls[0]).toContain('Wall 2 (right)');
    expect(walls[0]).toContain('**Check first: medium confidence.**');
    expect(walls.slice(1).some((l) => l.includes('Check first'))).toBe(false);

    const openings = section('Openings (inside the trim)');
    expect(openings).toHaveLength(3);
    expect(openings[0]).toMatch(/Opening 1 in Wall 3 \(bottom\).*low confidence/);
    expect(openings[1]).toMatch(/Window 1 in Wall 4 \(left\): width 3'-0" \(36"\), height 4'-0" \(48"\), sill 3'-6" \(42"\) above the floor; its near edge .* from the corner with Wall 3 \(bottom\)\..*medium confidence/);
    expect(openings[2]).toMatch(/^\d+\. Door 1 in Wall 1 \(top\): width 2'-8" \(32"\), height 6'-8" \(80"\); its near edge/);
    expect(openings[2]).not.toContain('Check first');

    const runs = section('Cabinet runs');
    expect(runs[0]).toMatch(/Base run on Wall 4 \(left\) \(4 pieces.*total length 10'-6" \(126"\).*medium confidence/);

    const appliances = section('Appliances');
    expect(appliances).toHaveLength(2);
    expect(appliances[0]).toMatch(/Range on Wall 2 \(right\): width 2'-6" \(30"\)\. \*\*Check first: low confidence\.\*\*/);
    expect(appliances[1]).toMatch(/Refrigerator on Wall 2 \(right\): width 3'-0" \(36"\)\.$/);
  });

  it('ends with what a scan cannot see, numbered on from the rest', () => {
    const tail = numbered.slice(-SCAN_CANNOT_SEE.length);
    expect(tail.map((l) => l.replace(/^\d+\. /, ''))).toEqual([...SCAN_CANNOT_SEE]);
    numbered.forEach((l, i) => expect(l.startsWith(`${i + 1}. `)).toBe(true));
    for (const word of ['door and drawer splits', 'Toe kicks', 'overhang', 'thickness', 'Backsplash height', 'model sizes', 'Outlets and switches', 'gas', 'trim']) expect(md).toContain(word);
  });

  it('uses no em dashes or double hyphens', () => {
    expect(md).not.toMatch(/—|--/);
  });
});
