import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import type { Underlay, Vec2 } from '../model/types';
import {
  calibrateRotation,
  calibrateScale,
  fitWithin,
  formatPxScale,
  hitUnderlay,
  imageToPlan,
  nearestAxis,
  normalizeRotation,
  pixelDistance,
  placeUnderlay,
  planToImage,
  replaceUnderlayImage,
  rotateAbout,
  scaleAbout,
  underlayCenter,
  underlayCorners,
} from '../model/underlay';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const IMG = 'data:image/jpeg;base64,AAAA';

const underlay = (u: Partial<Underlay> = {}): Underlay => ({
  image: IMG,
  pixelWidth: 1600,
  pixelHeight: 1200,
  origin: { x: 10, y: -20 },
  scale: 0.3,
  rotation: 0,
  opacity: 0.6,
  locked: false,
  ...u,
});

const expectNear = (p: Vec2, q: Vec2, eps = 1e-9) => {
  expect(Math.abs(p.x - q.x)).toBeLessThan(eps);
  expect(Math.abs(p.y - q.y)).toBeLessThan(eps);
};

describe('underlay transforms', () => {
  it('pixel (0,0) is at the origin and each pixel is `scale` inches', () => {
    const u = underlay();
    expectNear(imageToPlan(u, { x: 0, y: 0 }), u.origin);
    expectNear(imageToPlan(u, { x: 100, y: 50 }), { x: 10 + 30, y: -20 + 15 });
  });

  it('rotates clockwise on the y-down plan, like SVG rotate()', () => {
    const u = underlay({ rotation: 90, origin: { x: 0, y: 0 }, scale: 1 });
    // +x in the image points down the screen (+y) after a 90 degree turn.
    expectNear(imageToPlan(u, { x: 10, y: 0 }), { x: 0, y: 10 });
    expectNear(imageToPlan(u, { x: 0, y: 10 }), { x: -10, y: 0 });
  });

  it('image -> plan -> image round-trips, including rotation', () => {
    for (const rotation of [0, 17.5, 90, 200, 359]) {
      const u = underlay({ rotation, scale: 0.173 });
      for (const p of [
        { x: 0, y: 0 },
        { x: 1600, y: 1200 },
        { x: 123.4, y: 987.6 },
        { x: -50, y: 20 },
      ]) {
        expectNear(planToImage(u, imageToPlan(u, p)), p, 1e-8);
        expectNear(imageToPlan(u, planToImage(u, p)), p, 1e-8);
      }
    }
  });

  it('corners, centre and hit test', () => {
    const u = underlay({ origin: { x: 0, y: 0 }, scale: 0.5 });
    expect(underlayCorners(u)).toEqual([
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 600 },
      { x: 0, y: 600 },
    ]);
    expectNear(underlayCenter(u), { x: 400, y: 300 });
    expect(hitUnderlay(u, { x: 400, y: 300 })).toBe(true);
    expect(hitUnderlay(u, { x: 801, y: 300 })).toBe(false);
    const r = underlay({ origin: { x: 0, y: 0 }, scale: 0.5, rotation: 90 });
    // Rotated 90 degrees about (0,0): the image now covers x in [-600, 0], y in [0, 800].
    expect(hitUnderlay(r, { x: -300, y: 400 })).toBe(true);
    expect(hitUnderlay(r, { x: 300, y: 400 })).toBe(false);
  });

  it('normalizes rotation to [0, 360)', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(725)).toBe(5);
    expect(Object.is(normalizeRotation(-0), 0)).toBe(true);
  });
});

describe('calibrateScale', () => {
  it('sets inches per pixel from two points and keeps the first point fixed', () => {
    const u = underlay();
    // Pixels (200,150) and (1400,150): 1200 px apart, really 20'.
    const p1 = imageToPlan(u, { x: 200, y: 150 });
    const p2 = imageToPlan(u, { x: 1400, y: 150 });
    const next = calibrateScale(u, p1, p2, 240)!;
    expect(next.scale).toBeCloseTo(0.2, 12);
    const moved = { ...u, ...next };
    expectNear(imageToPlan(moved, { x: 200, y: 150 }), p1, 1e-9);
    // The second pixel is now exactly 240" from the first.
    const q2 = imageToPlan(moved, { x: 1400, y: 150 });
    expect(Math.hypot(q2.x - p1.x, q2.y - p1.y)).toBeCloseTo(240, 9);
  });

  it('works on a rotated image', () => {
    const u = underlay({ rotation: 33, scale: 0.41 });
    const p1 = imageToPlan(u, { x: 100, y: 900 });
    const p2 = imageToPlan(u, { x: 700, y: 100 }); // 1000 px apart (600, 800)
    expect(pixelDistance(u, p1, p2)).toBeCloseTo(1000, 9);
    const next = calibrateScale(u, p1, p2, 500)!;
    expect(next.scale).toBeCloseTo(0.5, 12);
    expect(next.rotation).toBe(33);
    expectNear(imageToPlan({ ...u, ...next }, { x: 100, y: 900 }), p1, 1e-9);
  });

  it('rejects a zero distance or coincident points', () => {
    const u = underlay();
    const p = imageToPlan(u, { x: 10, y: 10 });
    expect(calibrateScale(u, p, imageToPlan(u, { x: 500, y: 10 }), 0)).toBeNull();
    expect(calibrateScale(u, p, imageToPlan(u, { x: 500, y: 10 }), Number.NaN)).toBeNull();
    expect(calibrateScale(u, p, imageToPlan(u, { x: 10.5, y: 10 }), 120)).toBeNull();
  });
});

describe('calibrateRotation', () => {
  it('levels a nearly horizontal line, keeping the first point fixed', () => {
    const u = underlay({ rotation: 4 });
    // An image edge that is horizontal in the image, so 4 degrees off on the plan.
    const p1 = imageToPlan(u, { x: 200, y: 150 });
    const p2 = imageToPlan(u, { x: 1400, y: 150 });
    expect(nearestAxis(p1, p2).turn).toBeCloseTo(-4, 9);
    const next = calibrateRotation(u, p1, p2)!;
    expect(next.rotation).toBeCloseTo(0, 9);
    expect(next.scale).toBe(u.scale);
    const moved = { ...u, ...next };
    expectNear(imageToPlan(moved, { x: 200, y: 150 }), p1, 1e-9);
    const q2 = imageToPlan(moved, { x: 1400, y: 150 });
    expect(Math.abs(q2.y - p1.y)).toBeLessThan(1e-9);
  });

  it('makes a nearly vertical line vertical, either way round', () => {
    const u = underlay({ rotation: 10, origin: { x: 0, y: 0 }, scale: 1 });
    // A line that runs straight down the image (+y) is at 100 degrees on the plan: turn -10.
    const p1 = imageToPlan(u, { x: 500, y: 100 });
    const p2 = imageToPlan(u, { x: 500, y: 900 });
    const next = calibrateRotation(u, p1, p2)!;
    expect(next.rotation).toBeCloseTo(0, 9);
    // Clicked bottom to top (pointing up the screen, -y): same result.
    const back = calibrateRotation(u, p2, p1)!;
    expect(back.rotation).toBeCloseTo(0, 9);
    expectNear(imageToPlan({ ...u, ...back }, { x: 500, y: 900 }), p2, 1e-9);
  });

  it('turns the short way past 0 / 360', () => {
    const u = underlay({ rotation: 358 });
    const p1 = imageToPlan(u, { x: 0, y: 0 });
    const p2 = imageToPlan(u, { x: 1000, y: 0 });
    const next = calibrateRotation(u, p1, p2)!;
    expect(next.rotation).toBeCloseTo(0, 9);
  });

  it('rejects coincident points', () => {
    const u = underlay();
    const p = imageToPlan(u, { x: 10, y: 10 });
    expect(calibrateRotation(u, p, p)).toBeNull();
  });
});

describe('placement helpers', () => {
  it('places a new image centred, 40 feet wide, 60% opaque and unlocked', () => {
    const u = placeUnderlay(IMG, 1600, 1200, { x: 100, y: 50 });
    expect(u.pixelWidth * u.scale).toBeCloseTo(480, 9);
    expectNear(underlayCenter(u), { x: 100, y: 50 }, 1e-9);
    expect(u).toMatchObject({ rotation: 0, opacity: 0.6, locked: false });
  });

  it('scaleAbout and rotateAbout keep the pivot fixed', () => {
    const u = underlay({ rotation: 20 });
    const c = underlayCenter(u);
    expectNear(underlayCenter({ ...u, ...scaleAbout(u, 0.9, c) }), c, 1e-9);
    const r = rotateAbout(u, -30, c);
    expect(r.rotation).toBe(330);
    expectNear(underlayCenter({ ...u, ...r }), c, 1e-9);
  });

  it('replacing the image keeps its plan width and centre', () => {
    const u = underlay({ rotation: 15 });
    const next = replaceUnderlayImage(u, 'data:image/jpeg;base64,BBBB', 800, 800);
    expect(next.pixelWidth * next.scale).toBeCloseTo(u.pixelWidth * u.scale, 9);
    expectNear(underlayCenter(next), underlayCenter(u), 1e-9);
    expect(next.image).toBe('data:image/jpeg;base64,BBBB');
  });

  it('fitWithin keeps the longest side at most max and never upscales', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1000, 3000, 2048)).toEqual({ width: 683, height: 2048 });
    expect(fitWithin(1600, 1200, 2048)).toEqual({ width: 1600, height: 1200 });
  });

  it('formats the pixel scale', () => {
    expect(formatPxScale(0.2)).toBe('1 px = 0.200 in');
    expect(formatPxScale(2.5)).toBe('1 px = 2.50 in');
  });
});

describe('underlay store actions', () => {
  const store = () => usePlanStore.getState();
  const levelId = () => defaultLevelId(store().plan);
  const level = () => store().plan.levels[levelId()];
  const pastLength = () => usePlanStore.temporal.getState().pastStates.length;

  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
  });

  it('setUnderlay adds and removes, one undo step each', () => {
    store().setUnderlay(levelId(), underlay());
    expect(level().underlay).toEqual(underlay());
    expect(pastLength()).toBe(1);
    store().setUnderlay(levelId(), undefined);
    expect(level().underlay).toBeUndefined();
    expect('underlay' in level()).toBe(false);
    expect(pastLength()).toBe(2);
    undo();
    expect(level().underlay).toEqual(underlay());
    undo();
    expect(level().underlay).toBeUndefined();
  });

  it('setUnderlay rejects invalid underlays and records nothing', () => {
    store().setUnderlay(levelId(), underlay({ scale: 0 }));
    store().setUnderlay(levelId(), underlay({ image: 'https://example.com/x.jpg' }));
    store().setUnderlay(levelId(), underlay({ opacity: 2 }));
    store().setUnderlay(levelId(), undefined);
    expect(level().underlay).toBeUndefined();
    expect(pastLength()).toBe(0);
  });

  it('updateUnderlay patches, normalizes rotation, and is one undo step', () => {
    store().setUnderlay(levelId(), underlay());
    const before = store().plan;
    store().updateUnderlay(levelId(), { scale: 0.2, origin: { x: 1, y: 2 }, rotation: -90 });
    expect(level().underlay).toMatchObject({ scale: 0.2, origin: { x: 1, y: 2 }, rotation: 270 });
    expect(pastLength()).toBe(2);
    // Untouched levels keep their identity.
    const other = before.levelOrder[0];
    expect(store().plan.levels[other]).toBe(before.levels[other]);
    undo();
    expect(level().underlay).toEqual(underlay());
  });

  it('updateUnderlay ignores no-ops, invalid values and levels without an image', () => {
    store().updateUnderlay(levelId(), { opacity: 0.5 });
    expect(pastLength()).toBe(0);
    store().setUnderlay(levelId(), underlay());
    store().updateUnderlay(levelId(), { opacity: 0.6 });
    store().updateUnderlay(levelId(), { origin: { x: 10, y: -20 } });
    store().updateUnderlay(levelId(), { scale: -1 });
    store().updateUnderlay(levelId(), { opacity: 1.5 });
    store().updateUnderlay(levelId(), { origin: { x: Number.NaN, y: 0 } });
    expect(level().underlay).toEqual(underlay());
    expect(pastLength()).toBe(1);
    store().updateUnderlay(levelId(), { locked: true });
    expect(level().underlay?.locked).toBe(true);
  });
});

describe('migrate with underlays', () => {
  it('accepts a plan without underlays', () => {
    const plan = createEmptyPlan();
    const out = migrate(JSON.parse(JSON.stringify(plan)));
    for (const id of out.levelOrder) expect('underlay' in out.levels[id]).toBe(false);
  });

  it('keeps a valid underlay through a JSON round trip', () => {
    const plan = createEmptyPlan();
    const id = defaultLevelId(plan);
    plan.levels[id].underlay = underlay({ rotation: 12.5, locked: true });
    const out = migrate(JSON.parse(JSON.stringify(plan)));
    expect(out.levels[id].underlay).toEqual(underlay({ rotation: 12.5, locked: true }));
  });

  it('fills defaults for missing fields and drops a broken underlay', () => {
    const plan = createEmptyPlan();
    const [a, b] = plan.levelOrder;
    const json = JSON.parse(JSON.stringify(plan));
    json.levels[a].underlay = { image: IMG, pixelWidth: 10, pixelHeight: 20, origin: { x: 0, y: 0 }, scale: 2 };
    json.levels[b].underlay = { image: IMG, pixelWidth: 10, pixelHeight: 20, origin: { x: 0 }, scale: 2 };
    const out = migrate(json);
    expect(out.levels[a].underlay).toEqual({
      image: IMG,
      pixelWidth: 10,
      pixelHeight: 20,
      origin: { x: 0, y: 0 },
      scale: 2,
      rotation: 0,
      opacity: 0.6,
      locked: false,
    });
    expect(out.levels[b].underlay).toBeUndefined();
    expect('underlay' in out.levels[b]).toBe(false);
  });
});
