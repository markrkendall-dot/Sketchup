import { describe, expect, it } from 'vitest';
import { IN_PER_M, parseFrames, parseMeta, parseRoom } from '../../scripts/scan/roomplan';
import { makeSyntheticBundle, OPENINGS, TURN } from '../../scripts/scan/fixtures/syntheticRoom';
import room from '../../scripts/scan/fixtures/synthetic-room/room.json';
import frames from '../../scripts/scan/fixtures/synthetic-room/frames.json';
import meta from '../../scripts/scan/fixtures/synthetic-room/meta.json';

/** An identity-oriented transform at a position (metres). */
const at = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const wall = (over: Record<string, unknown> = {}) => ({ id: 'w1', category: 'wall', parentId: null, confidence: 'high', dimensions: [3, 2.5, 0], transform: at(0, 1.25, 0), ...over });
const roomOf = (surfaces: unknown[], extra: Record<string, unknown> = {}) => ({ format: 1, story: 0, surfaces, objects: [], ...extra });
const signedArea = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);

describe('scan bundle parser: validation', () => {
  it('names the file, the element and the problem', () => {
    expect(() => parseRoom(null)).toThrow('room.json: must be a JSON object');
    expect(() => parseRoom({ format: 2, surfaces: [] })).toThrow('room.json format: unsupported format 2 (expected 1)');
    expect(() => parseRoom({ format: 1 })).toThrow('room.json surfaces: must be a list');
    expect(() => parseRoom(roomOf([]))).toThrow('room.json surfaces: has no walls');
    expect(() => parseRoom(roomOf([wall({ transform: [1, 2, 3] })]))).toThrow('room.json surfaces[0].transform: must be 16 finite numbers');
    expect(() => parseRoom(roomOf([wall({ dimensions: [3, -1, 0] })]))).toThrow('room.json surfaces[0].dimensions: must not be negative');
    expect(() => parseRoom(roomOf([wall({ confidence: 'sure' })]))).toThrow('room.json surfaces[0].confidence: must be low, medium or high (got "sure")');
    expect(() => parseRoom(roomOf([wall({ category: 'roof' })]))).toThrow('room.json surfaces[0].category: must be one of wall, door, window, opening, floor (got "roof")');
    expect(() => parseRoom(roomOf([wall(), wall()]))).toThrow('room.json surfaces[1].id: w1 is used twice');
    expect(() => parseRoom(roomOf([wall(), wall({ id: 'd1', category: 'door', parentId: 'nope' })]))).toThrow('room.json door d1 parentId: no surface nope');
    expect(() => parseRoom(roomOf([wall(), wall({ id: 'f1', category: 'floor' }), wall({ id: 'd1', category: 'door', parentId: 'f1' })]))).toThrow('f1 is not a wall');
    expect(() => parseRoom(roomOf([wall(), wall({ id: 'd1', category: 'window', transform: at(0, 1, 5) })]))).toThrow('room.json window d1: has no parentId and lies on no wall');
    // A wall standing on its end (its right axis vertical).
    expect(() => parseRoom(roomOf([wall({ transform: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })]))).toThrow('its right axis (the wall direction) is not horizontal');
    expect(() => parseRoom(roomOf([wall()], { objects: [{ id: 'o1', category: 'storage', confidence: 'high', dimensions: [1, 0, 1], transform: at(0, 0, 0) }] }))).toThrow('room.json objects[0].dimensions: must be positive');
    expect(() => parseMeta({ format: 1, kind: 'object', name: 'x' })).toThrow('meta.json kind: this is not a room bundle');
    expect(() => parseFrames({ format: 1, frames: [{ file: 'a.jpg', transform: at(0, 0, 0), intrinsics: [0, 1, 1, 1], imageSize: [10, 10] }] }, 0)).toThrow('focal lengths and image size must be positive');
  });

  it('puts an opening with no parent on the wall it lies on, and says so', () => {
    const s = parseRoom(roomOf([wall(), wall({ id: 'd1', category: 'door', dimensions: [0.9, 2, 0], transform: at(0.5, 1, 0.02) })]));
    expect(s.openings[0].wallId).toBe('w1');
    expect(s.openings[0].parentGiven).toBe(false);
    expect(s.notes.some((n) => n.includes('no parent wall'))).toBe(true);
  });
});

describe('scan bundle parser: units and frames', () => {
  it('converts metres to inches and the ARKit frame to the plan: x = world x, y = world z, elevation = world y', () => {
    // A 3 m wall along world +x, centred at (1, 1.25, 2), floor at world y 0 (no floor surface: the wall bottom).
    const s = parseRoom(roomOf([wall({ transform: at(1, 1.25, 2) })]));
    const w = s.walls[0];
    expect(w.a.x).toBeCloseTo(-0.5 * IN_PER_M, 6);
    expect(w.b.x).toBeCloseTo(2.5 * IN_PER_M, 6);
    expect(w.a.y).toBeCloseTo(2 * IN_PER_M, 6);
    expect(w.length).toBeCloseTo(118.11, 2);
    expect(w.height).toBeCloseTo(98.43, 2);
    expect(w.base).toBeCloseTo(0, 6);
    expect(s.floorElevation).toBeCloseTo(0, 6);
  });

  it('measures the opening along its wall from the wall\'s a end, with its sill above the floor', () => {
    const s = parseRoom(roomOf([wall({ transform: at(0, 1.25, 0) }), wall({ id: 'f', category: 'floor', dimensions: [3, 3, 0], transform: at(0, -0.1, 0) }), wall({ id: 'n1', category: 'window', parentId: 'w1', dimensions: [1, 1.2, 0], transform: at(0.5, 1.5, 0) })]));
    const o = s.openings[0];
    // The wall runs x -1.5..1.5 m; the window's centre is 2 m from its a end.
    expect(o.offset).toBeCloseTo(2 * IN_PER_M, 6);
    expect(o.width).toBeCloseTo(IN_PER_M, 6);
    // Bottom at 0.9 m world, floor at -0.1 m.
    expect(o.sill).toBeCloseTo(1.0 * IN_PER_M, 6);
    expect(o.type).toBe('window');
  });

  it('does not mirror: the walls keep their turning sense from the world, seen from above, to the plan', () => {
    const s = parseRoom(room, frames, meta);
    // World (x, z) of each wall's centre, in the bundle's order, against the plan's.
    const worldPts = (room.surfaces as { category: string; transform: number[] }[]).filter((x) => x.category === 'wall').map((x) => ({ x: x.transform[12], y: x.transform[14] }));
    const planPts = s.walls.map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }));
    expect(Math.sign(signedArea(planPts))).toBe(Math.sign(signedArea(worldPts)));
    // And by name: the door is on the wall the truth puts at the top, the window on the left one. Undo the
    // scan's turn (about +Y by TURN: plan (x, y) turned by -TURN) and compare with the truth.
    const t = (TURN * Math.PI) / 180;
    const back = (p: { x: number; y: number }) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) });
    const door = back(s.openings.find((o) => o.type === 'door')!.center);
    const win = back(s.openings.find((o) => o.type === 'window')!.center);
    const truthDoor = OPENINGS.find((o) => o.category === 'door')!.at;
    const truthWin = OPENINGS.find((o) => o.category === 'window')!.at;
    // Same offsets between the two in the plan as in the truth: a mirror would flip one sign.
    expect(door.x - win.x).toBeCloseTo(truthDoor.x - truthWin.x, 0);
    expect(door.y - win.y).toBeCloseTo(truthDoor.y - truthWin.y, 0);
  });

  it('reads a keyframe\'s view direction (its -Z), height above the floor and intrinsics', () => {
    const s = parseRoom(room, frames, meta);
    expect(s.frames).toHaveLength(2);
    expect(s.frames[0].height).toBeCloseTo(60, 3);
    expect(s.frames[0].forward.z).toBeCloseTo(Math.sin((-5 * Math.PI) / 180), 6);
    expect(s.frames[1].intrinsics.fx).toBe(1450);
    expect(s.meta?.name).toBe('Synthetic kitchen');
  });

  it('the committed fixture is what syntheticRoom.ts makes (run scripts/scan/fixtures/makeSynthetic.ts after changing it)', () => {
    const b = makeSyntheticBundle();
    expect(b.room).toEqual(room);
    expect(b.frames).toEqual(frames);
    expect(b.meta).toEqual(meta);
  });
});
