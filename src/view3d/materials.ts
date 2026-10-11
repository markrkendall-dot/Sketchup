import { Color, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import type { FillPart } from '../derive/openings3d';
import { defaultWallColor, defaultWallFinish, ROOF_COLOR, TRIM_COLOR } from '../model/finish';
import type { Column, Phase, RoofFinish, WallFinish, WallKind } from '../model/types';
import { sidingTexture } from './textures';

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

const wallMaterials = new Map<string, MeshStandardMaterial>();

/** New work is tinted green: multiplied over a texture, pulled toward green on a flat colour. */
const NEW_TINT = '#b4e4c2';
const NEW_GREEN = '#3f8f5f';
const pullGreen = (hex: string) => `#${new Color(hex).lerp(new Color(NEW_GREEN), 0.45).getHexString()}`;

/** The colour a wall shows without textures (export, and the fallback where no canvas exists). */
export function wallFlatColor(phase: Phase, finish: WallFinish, color: string): string {
  if (phase === 'demo') return PHASE_COLOR.demo;
  if (finish === 'screen') return phase === 'new' ? pullGreen('#4a4d4c') : '#4a4d4c';
  return phase === 'new' ? pullGreen(color) : color;
}

/**
 * A wall's material. Exterior walls (and any wall given a finish) carry the procedural siding
 * texture of their finish and colour (textures.ts); the wall mesh is one merged geometry, so both
 * faces of an exterior wall show the siding. Plain walls are a flat colour. Demolished walls stay
 * translucent red whatever their finish; new ones are tinted green over the texture. A screen is
 * a see-through mesh. Textures exist only where a canvas does: elsewhere (node, tests) the flat
 * colour is used.
 */
export function wallMaterial(
  phase: Phase,
  kind: WallKind,
  finish: WallFinish = defaultWallFinish(kind),
  color: string = defaultWallColor(kind),
): MeshStandardMaterial {
  const textured = phase !== 'demo' && finish !== 'plain';
  const key = phase === 'demo' ? 'demo' : `${phase}|${finish}|${color}`;
  let m = wallMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const tex = textured ? sidingTexture(finish, color) : null;
      m = make(tex ? (phase === 'new' ? NEW_TINT : '#ffffff') : wallFlatColor(phase, finish, color));
      if (tex) m.map = tex;
      if (finish === 'screen') {
        m.transparent = true;
        m.opacity = 0.4;
        m.depthWrite = false;
        m.side = DoubleSide;
      }
    }
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

const roofMaterials = new Map<string, MeshStandardMaterial>();

/**
 * A roof's material: by finish and colour (default by finish: metal grey-brown with a slight
 * sheen, shingle dark grey); demolished translucent red like walls, new tinted toward green.
 */
export function roofMaterial(finish: RoofFinish, phase: Phase, color: string = ROOF_COLOR[finish]): MeshStandardMaterial {
  const key = phase === 'demo' ? 'demo' : `${finish}|${phase}|${color}`;
  let m = roofMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      m = make(phase === 'new' ? pullGreen(color) : color);
      if (finish === 'metal') {
        m.metalness = 0.4;
        m.roughness = 0.5;
      }
    }
    roofMaterials.set(key, m);
  }
  return m;
}

/** Fascia and rake boards: tan trim colour (demolished: red, new: pulled toward green). */
export function fasciaMaterial(phase: Phase): MeshStandardMaterial {
  return trimLike('fascia', TRIM_COLOR, phase);
}

const partMaterials = new Map<string, MeshStandardMaterial>();

function trimLike(name: string, color: string, phase: Phase): MeshStandardMaterial {
  const key = `${name}|${phase}`;
  let m = partMaterials.get(key);
  if (!m) {
    m = phase === 'demo' ? make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 }) : make(phase === 'new' ? pullGreen(color) : color);
    partMaterials.set(key, m);
  }
  return m;
}

/** Window and door parts: tan trim, white sash and muntins, glass, dark green leaf, green shutters. */
const OPENING_COLOR: Record<Exclude<FillPart, 'glass'>, string> = {
  trim: TRIM_COLOR,
  sash: '#f4f1ea',
  leaf: '#2f3a33',
  shutter: '#3f6f5f',
};

export function openingMaterial(part: FillPart, phase: Phase): MeshStandardMaterial {
  if (part !== 'glass') return trimLike(part, OPENING_COLOR[part], phase);
  const key = `glass|${phase}`;
  let m = partMaterials.get(key);
  if (!m) {
    m = make(phase === 'demo' ? PHASE_COLOR.demo : phase === 'new' ? '#a8d8c4' : '#bcd4e6', { transparent: true, opacity: 0.35 });
    m.roughness = 0.1;
    partMaterials.set(key, m);
  }
  return m;
}

/** The ground: grass green, matte, smooth shaded (the terrain geometry has smooth normals). */
export const terrainMaterial = new MeshStandardMaterial({
  color: new Color('#7f9a63'),
  roughness: 1,
  metalness: 0,
  side: FrontSide,
});

/** Column colours: brick red for chimneys, trim tan for posts. */
const COLUMN_COLOR: Record<Column['kind'], string> = { chimney: '#7a4a3e', post: '#c9b58c' };

const columnMaterials = new Map<string, MeshStandardMaterial>();

/** A column's material: by kind; demolished translucent red like walls, new pulled toward the new-work green. */
export function columnMaterial(kind: Column['kind'], phase: Phase): MeshStandardMaterial {
  const key = `${kind}|${phase}`;
  let m = columnMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const base = new Color(COLUMN_COLOR[kind]);
      m = make(phase === 'new' ? `#${base.lerp(new Color('#3f8f5f'), 0.45).getHexString()}` : COLUMN_COLOR[kind]);
    }
    columnMaterials.set(key, m);
  }
  return m;
}
