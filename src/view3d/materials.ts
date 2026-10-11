import { Color, FrontSide, MeshStandardMaterial } from 'three';
import type { Phase, WallKind } from '../model/types';

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
