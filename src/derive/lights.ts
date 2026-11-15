import { isLight } from '../model/casework';
import type { Fixture, Id, Level, ViewMode } from '../model/types';
import { fixtureFrame, fixturePoint } from './casework';
import { isVisible } from './phase';

// Interior lights (DESIGN.md "3D"): each light fixture (recessed, pendant, under-cabinet) lights the
// 3D view from where it is. The scene's units are inches and its lights fall off with the square of
// the distance, so a light's strength is what it gives a surface an inch away: a recessed can's
// 9000 is about 2.5 on a counter 60" below it, the sky's fill being 2.4.

export type LightKind = 'recessedLight' | 'pendant' | 'underCabinetLight';

export interface LevelLight {
  id: Id;
  kind: LightKind;
  /** Level-local three position (x, height above the floor top, plan y): just under the lens. */
  position: [number, number, number];
  intensity: number;
  /** Where it stops reaching, inches. */
  distance: number;
}

/** Strength and reach per kind. A recessed can throws a cone down; the others glow all round. */
export const LIGHT_SPEC: Record<LightKind, { intensity: number; distance: number }> = {
  recessedLight: { intensity: 9000, distance: 260 },
  pendant: { intensity: 3200, distance: 200 },
  underCabinetLight: { intensity: 500, distance: 60 },
};

/**
 * The most lights a level shines at once: every lit material pays for each, so a phone stays
 * smooth. Past it, the recessed cans come first, then pendants, then under-cabinet strips.
 */
export const MAX_LEVEL_LIGHTS = 12;

const ORDER: LightKind[] = ['recessedLight', 'pendant', 'underCabinetLight'];

/** The lights a level shines in a view: its visible light fixtures (not ones being demolished), at most MAX_LEVEL_LIGHTS. */
export function levelLights(level: Pick<Level, 'fixtures'>, viewMode: ViewMode): LevelLight[] {
  const out: LevelLight[] = [];
  for (const f of Object.values(level.fixtures ?? {}) as Fixture[]) {
    if (!isLight(f.kind) || f.phase === 'demo' || !isVisible(f.phase, viewMode)) continue;
    const kind = f.kind as LightKind;
    const c = fixturePoint(fixtureFrame(f), 0, f.depth / 2);
    out.push({ id: f.id, kind, position: [c.x, f.elevation - 0.5, c.y], ...LIGHT_SPEC[kind] });
  }
  if (out.length <= MAX_LEVEL_LIGHTS) return out;
  return out
    .map((l, i) => ({ l, i }))
    .sort((p, q) => ORDER.indexOf(p.l.kind) - ORDER.indexOf(q.l.kind) || p.i - q.i)
    .slice(0, MAX_LEVEL_LIGHTS)
    .map((x) => x.l);
}
