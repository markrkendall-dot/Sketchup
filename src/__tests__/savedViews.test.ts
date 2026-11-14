import { beforeEach, describe, expect, it } from 'vitest';
import { stableIds } from '../../scripts/planLib';
import { createEmptyPlan, defaultLevelId, migrate } from '../model/plan';
import { clearHistory, undo, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { walkStart, walkStep } from '../view3d/walk';

const store = () => usePlanStore.getState();
const plan = () => store().plan;
const lid = () => defaultLevelId(plan());

beforeEach(() => {
  store().setPlan(createEmptyPlan('Kitchen', 'single'));
  clearHistory();
  useUiStore.setState({ walkFrom: null, cameraMode: 'orbit', layout: '2d' });
});

describe('saved viewpoints (Plan.views)', () => {
  it('are added, refused when unusable, removed, undone, and survive a save and load', () => {
    const id = store().addView({ name: ' From the dining room ', levelId: lid(), at: { x: 10, y: 20 }, yaw: 1, pitch: 9 })!;
    expect(plan().views).toEqual([{ id, name: 'From the dining room', levelId: lid(), at: { x: 10, y: 20 }, yaw: 1, pitch: 1.4 }]);
    expect(store().addView({ name: '', levelId: lid(), at: { x: 0, y: 0 }, yaw: 0, pitch: 0 })).toBeNull();
    expect(store().addView({ name: 'x', levelId: 'nope', at: { x: 0, y: 0 }, yaw: 0, pitch: 0 })).toBeNull();
    expect(store().addView({ name: 'x', levelId: lid(), at: { x: NaN, y: 0 }, yaw: 0, pitch: 0 })).toBeNull();
    expect(migrate(JSON.parse(JSON.stringify(plan()))).views).toEqual(plan().views);
    store().deleteView(id);
    expect(plan().views).toBeUndefined();
    undo();
    expect(plan().views).toHaveLength(1);
  });

  it('a file keeps only its usable views', () => {
    const doc = JSON.parse(JSON.stringify(plan()));
    const ok = { id: 'v1', name: 'A', levelId: lid(), at: { x: 1, y: 2 }, yaw: 0.5, pitch: 0 };
    doc.views = [ok, { ...ok }, { ...ok, id: 'v2', levelId: 'gone' }, { ...ok, id: 'v3', name: ' ' }, 'junk'];
    expect(migrate(doc).views).toEqual([ok]);
    doc.views = 'junk';
    expect(migrate(doc).views).toBeUndefined();
  });

  it('goToView walks from the view, on its level, looking its way', () => {
    const id = store().addView({ name: 'A', levelId: lid(), at: { x: 30, y: 40 }, yaw: Math.PI / 2, pitch: -0.2 })!;
    useUiStore.getState().goToView(plan().views!.find((v) => v.id === id)!);
    const ui = useUiStore.getState();
    expect(ui).toMatchObject({ cameraMode: 'walk', layout: '3d', activeLevelId: lid(), walkJump: 1 });
    const pose = walkStart(plan(), lid(), 'existing', [lid()], ui.walkFrom);
    expect(pose.at).toEqual({ x: 30, y: 40 });
    // Yaw 90 degrees looks along -x; a step forward goes the same way.
    expect(pose.dir.x).toBeCloseTo(-1);
    expect(pose.dir.y).toBeCloseTo(0);
    const [dx, dz] = walkStep(Math.PI / 2, 1, 0, 10);
    expect(dx).toBeCloseTo(-10);
    expect(dz).toBeCloseTo(0);
  });

  it('stableIds names them view-1, view-2', () => {
    store().addView({ name: 'A', levelId: lid(), at: { x: 0, y: 0 }, yaw: 0, pitch: 0 });
    store().addView({ name: 'B', levelId: lid(), at: { x: 0, y: 0 }, yaw: 0, pitch: 0 });
    expect(JSON.parse(stableIds(plan(), 'k')).views.map((v: { id: string }) => v.id)).toEqual(['view-1', 'view-2']);
  });
});

describe('the touch pad (walk.ts walkStep)', () => {
  it('a half push walks at half speed; a full diagonal is no faster than straight', () => {
    expect(Math.hypot(...walkStep(0, 0.5, 0, 10))).toBeCloseTo(5);
    expect(Math.hypot(...walkStep(0, 1, 1, 10))).toBeCloseTo(10);
    expect(walkStep(0, 0, 0, 10)).toEqual([0, 0]);
  });
});
