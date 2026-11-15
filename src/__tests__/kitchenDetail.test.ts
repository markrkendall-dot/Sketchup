import { describe, expect, it } from 'vitest';
import { fixtureBoxes, fixtureSymbol } from '../derive/casework';
import { buildFurnitureParts } from '../derive/meshes';
import { levelLights, LIGHT_SPEC, MAX_LEVEL_LIGHTS } from '../derive/lights';
import { FIXTURE_DEFAULTS, isLight, isOverhead } from '../model/casework';
import { createEmptyPlan, defaultLevelId, fixtureProblem, migrate } from '../model/plan';
import type { Fixture, FixtureKind } from '../model/types';

const fx = (kind: FixtureKind, extra: Partial<Fixture> = {}): Fixture => ({ id: kind, kind, origin: { x: 0, y: 0 }, direction: 90, ...FIXTURE_DEFAULTS[kind], phase: 'existing', ...extra }) as Fixture;
const parts = (f: Fixture) => fixtureBoxes(f).map((b) => b.part);
const count = (f: Fixture, part: string) => parts(f).filter((p) => p === part).length;

describe('kitchen detail', () => {
  it('a sink has a chrome tap behind its basin, reaching over the bowl above the counter', () => {
    const boxes = fixtureBoxes(fx('sink')).filter((b) => b.part === 'chrome');
    expect(boxes).toHaveLength(4);
    const counterTop = 34.5 + 1.5;
    expect(Math.min(...boxes.map((b) => b.y0))).toBeCloseTo(counterTop);
    expect(Math.max(...boxes.map((b) => b.y1))).toBeCloseTo(counterTop + 12);
    // Inside the cabinet's footprint.
    for (const b of boxes) expect(b.d0 >= 0 && b.d1 <= 24).toBe(true);
  });

  it('a cooktop lies on the counter with five grates and knobs at 36", four at 30"; the plan draws its burners', () => {
    const wide = fx('cooktop');
    expect(count(wide, 'dark')).toBe(5);
    expect(count(wide, 'chrome')).toBe(5);
    expect(count(fx('cooktop', { width: 30 }), 'dark')).toBe(4);
    for (const b of fixtureBoxes(wide)) expect(b.s0 >= -18 - 1e-9 && b.s1 <= 18 + 1e-9 && b.d0 >= -1e-9 && b.d1 <= 21 + 1e-9 && b.y0 >= 36 - 1e-9 && b.y1 <= 37.5 + 1e-9).toBe(true);
    expect(fixtureSymbol(wide).burners).toHaveLength(4);
  });

  it("a refrigerator's doors: French door is two doors over a drawer with three bar handles, side by side two doors; the default is as before", () => {
    const plain = fx('fridge');
    expect(parts(plain)).toEqual(['appliance', 'appliance', 'appliance']);
    const french = fx('fridge', { fridgeStyle: 'frenchDoor' });
    expect(count(french, 'appliance')).toBe(4);
    expect(count(french, 'handle')).toBe(3);
    const side = fx('fridge', { fridgeStyle: 'sideBySide' });
    expect(count(side, 'appliance')).toBe(3);
    expect(count(side, 'handle')).toBe(2);
  });

  it('the new fields are kept only on the kinds that take them', () => {
    expect(fixtureProblem(fx('fridge', { fridgeStyle: 'frenchDoor', applianceFinish: 'black' }))).toBeNull();
    expect(fixtureProblem(fx('base', { applianceFinish: 'black' }))).toMatch(/applianceFinish/);
    expect(fixtureProblem(fx('range', { fridgeStyle: 'frenchDoor' }))).toMatch(/fridgeStyle/);
    const plan = createEmptyPlan('K', 'single');
    const doc = JSON.parse(JSON.stringify(plan));
    const lid = defaultLevelId(plan);
    doc.levels[lid].fixtures = {
      a: { ...fx('fridge'), id: 'a', fridgeStyle: 'frenchDoor', applianceFinish: 'white' },
      b: { ...fx('base'), id: 'b', fridgeStyle: 'frenchDoor', applianceFinish: 'chartreuse' },
      c: { ...fx('pendant'), id: 'c', applianceFinish: 'black' },
    };
    const out = migrate(doc).levels[lid].fixtures;
    expect(out.a).toMatchObject({ fridgeStyle: 'frenchDoor', applianceFinish: 'white' });
    expect(out.b.fridgeStyle).toBeUndefined();
    expect(out.b.applianceFinish).toBeUndefined();
    expect(out.c.applianceFinish).toBe('black');
  });

  it('a counter stool is a seat on four legs with a footrest', () => {
    const stool = { ...fx('furniture', { width: 16, depth: 16, height: 25 }), piece: 'stool' } as Fixture;
    expect(fixtureProblem(stool)).toBeNull();
    expect(buildFurnitureParts(stool).length).toBeGreaterThan(0);
  });
});

describe('interior lights (derive/lights.ts)', () => {
  it('each light fixture has a glowing lens, is overhead on the plan, and shines from just under it', () => {
    for (const kind of ['recessedLight', 'pendant', 'underCabinetLight'] as const) {
      expect(isLight(kind) && isOverhead(kind)).toBe(true);
      expect(count(fx(kind), 'lamp')).toBe(1);
    }
    const can = fx('recessedLight', { origin: { x: 100, y: 50 }, direction: 90 });
    const [l] = levelLights({ fixtures: { can } }, 'existing');
    expect(l).toMatchObject({ kind: 'recessedLight', ...LIGHT_SPEC.recessedLight });
    // The middle of the 6" can (its origin is the back edge's middle), half an inch under its lens.
    expect(l.position).toEqual([100, 95, 53]);
  });

  it('follows the view, leaves out a light being demolished, and shines at most a dozen, recessed first', () => {
    const fixtures: Record<string, Fixture> = {
      old: fx('pendant', { id: 'old', phase: 'demo' }),
      next: fx('pendant', { id: 'next', phase: 'new' }),
      base: fx('base', { id: 'base' }),
    };
    expect(levelLights({ fixtures }, 'existing')).toHaveLength(0);
    expect(levelLights({ fixtures }, 'proposed').map((l) => l.id)).toEqual(['next']);
    expect(levelLights({ fixtures }, 'all').map((l) => l.id)).toEqual(['next']);
    const many: Record<string, Fixture> = {};
    for (let i = 0; i < 10; i++) many[`u${i}`] = fx('underCabinetLight', { id: `u${i}` });
    for (let i = 0; i < 8; i++) many[`r${i}`] = fx('recessedLight', { id: `r${i}` });
    const lit = levelLights({ fixtures: many }, 'existing');
    expect(lit).toHaveLength(MAX_LEVEL_LIGHTS);
    expect(lit.filter((l) => l.kind === 'recessedLight')).toHaveLength(8);
  });
});
