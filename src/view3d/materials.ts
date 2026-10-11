import { Color, FrontSide, MeshStandardMaterial } from 'three';
import type { Phase, RoofFinish, WallKind } from '../model/types';

// Shared materials, created once. FrontSide everywhere: derive/meshes.ts guarantees outward
// winding, so a missing or black face is a geometry bug to fix, never something to paper over.

const PHASE_COLOR: Record<Phase, string> = {
  existing: '#e4dfd6', // warm light grey
  demo: '#e0413a',
  new: '#a9dcb7', // light green
};

function make(color: string, opts: { transparent?: boolean; opacity?: number } = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
    side: FrontSide,
  });
  if (opts.transparent) {
    m.transparent = true;
    m.opacity = opts.opacity ?? 1;
    m.depthWrite = false;
  }
  return m;
}

/** Exterior walls a little darker than interior ones. */
const darker = (hex: string, f: number) => `#${new Color(hex).multiplyScalar(f).getHexString()}`;

const wallMaterials = new Map<string, MeshStandardMaterial>();

export function wallMaterial(phase: Phase, kind: WallKind): MeshStandardMaterial {
  const key = `${phase}|${kind}`;
  let m = wallMaterials.get(key);
  if (!m) {
    const base = PHASE_COLOR[phase];
    const color = kind === 'exterior' ? darker(base, 0.88) : base;
    m = phase === 'demo' ? make(color, { transparent: true, opacity: 0.35 }) : make(color);
    wallMaterials.set(key, m);
  }
  return m;
}

export const floorMaterial = make('#c9a77c'); // wood-ish tan

const stairsMaterials = new Map<Phase, MeshStandardMaterial>();

export function stairsMaterial(phase: Phase): MeshStandardMaterial {
  let m = stairsMaterials.get(phase);
  if (!m) {
    m = phase === 'demo' ? make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 }) : make(phase === 'new' ? '#9fc9aa' : '#9a9da3');
    stairsMaterials.set(phase, m);
  }
  return m;
}

/** Roof colours: standing-seam metal grey-brown with a slight sheen, asphalt shingle dark grey. */
const ROOF_COLOR: Record<RoofFinish, string> = { metal: '#6e6259', shingle: '#4a4a4a' };

const roofMaterials = new Map<string, MeshStandardMaterial>();

/** A roof's material: by finish; demolished translucent red like walls, new tinted green. */
export function roofMaterial(finish: RoofFinish, phase: Phase): MeshStandardMaterial {
  const key = `${finish}|${phase}`;
  let m = roofMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const base = new Color(ROOF_COLOR[finish]);
      // New roofs: the finish colour pulled toward the new-work green.
      const color = phase === 'new' ? `#${base.lerp(new Color('#3f8f5f'), 0.45).getHexString()}` : ROOF_COLOR[finish];
      m = make(color);
      if (finish === 'metal') {
        m.metalness = 0.4;
        m.roughness = 0.5;
      }
    }
    roofMaterials.set(key, m);
  }
  return m;
}
