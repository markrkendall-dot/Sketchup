import { describe, expect, it } from 'vitest';
import { sunPosition } from '../derive/site';
import { migrate } from '../model/plan';
import { deleteStructureFrom } from '../model/structureOps';
import { planBox, shadowMapSizeFor, shadowTexel, SHADOW_TEXEL, sunShadowFit } from '../view3d/bounds';
import starter from '../../docs/examples/146-mick-road.json';

describe('shadow density with several buildings', () => {
  const plan = migrate(starter);
  const sun = sunPosition(plan.site.northAngle);
  const withGarage = sunShadowFit(planBox(plan), sun);
  const houseOnly = migrate(starter);
  const garage = houseOnly.structureOrder.find((id) => houseOnly.structures[id].kind === 'garage')!;
  deleteStructureFrom(houseOnly, garage);
  const alone = sunShadowFit(planBox(houseOnly), sun);

  it('keeps the house-alone texel (about 0.52") with the garage added, with a bigger map', () => {
    expect(shadowTexel(alone, 2048)).toBeLessThanOrEqual(SHADOW_TEXEL);
    // The garage spreads the 2048 map: about 0.87" a texel.
    expect(shadowTexel(withGarage, 2048)).toBeGreaterThan(0.8);
    expect(shadowMapSizeFor(alone)).toBe(2048);
    const size = shadowMapSizeFor(withGarage);
    expect(size).toBe(4096);
    expect(shadowTexel(withGarage, size)).toBeLessThanOrEqual(shadowTexel(alone, 2048));
  });

  it('never asks for more than the GPU takes', () => {
    expect(shadowMapSizeFor(withGarage, 2048)).toBe(2048);
    expect(shadowMapSizeFor({ half: 1e6 })).toBe(4096);
    expect(shadowMapSizeFor({ half: 10 })).toBe(2048);
  });
});
