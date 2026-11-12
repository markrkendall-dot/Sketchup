import { describe, expect, it } from 'vitest';
import { makeThumbnail, THUMB_HEIGHT, THUMB_WIDTH, thumbnailLines } from '../io/thumbnail';
import { createEmptyPlan } from '../model/plan';
import { addStructureTo } from '../model/structureOps';
import type { Plan } from '../model/types';

describe('property thumbnails', () => {
  it('draws the ground-floor walls of every building at its site place, fitted to the picture', () => {
    const plan: Plan = createEmptyPlan('Two', 'single');
    addStructureTo(plan, { kind: 'shed', origin: { x: 0, y: 0 } });
    addStructureTo(plan, { kind: 'garage', origin: { x: 400, y: 0 } });
    const lines = thumbnailLines(plan);
    expect(lines).toHaveLength(8);
    const xs = lines.flatMap((l) => [l.a.x, l.b.x]);
    const ys = lines.flatMap((l) => [l.a.y, l.b.y]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(THUMB_WIDTH);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(THUMB_HEIGHT);
    // The garage (placed at x 400) is to the right of the shed.
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    expect(right - left).toBeGreaterThan(THUMB_WIDTH * 0.8);
  });

  it('leaves out demolished walls and new work of other options; nothing to draw is no lines', async () => {
    const plan: Plan = createEmptyPlan('Empty', 'single');
    expect(thumbnailLines(plan)).toEqual([]);
    // No canvas in the test environment and nothing drawn: no picture, the placeholder shows.
    expect(await makeThumbnail(plan)).toBeNull();
    const s = addStructureTo(plan, { kind: 'shed', origin: { x: 0, y: 0 } });
    const level = plan.levels[s.levelOrder[0]];
    const walls = Object.values(level.walls);
    walls[0].phase = 'demo';
    // Fresh objects each time: the option view is memoized per plan object, as the store's immer edits make them.
    expect(thumbnailLines(structuredClone(plan))).toHaveLength(3);
    plan.options.push({ id: 'b', name: 'B' });
    walls[1].phase = 'new';
    walls[1].optionIds = ['b'];
    expect(thumbnailLines(structuredClone(plan), 'option-a')).toHaveLength(2);
    expect(thumbnailLines(structuredClone(plan), 'b')).toHaveLength(3);
  });
});
