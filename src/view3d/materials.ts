import { Color, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import type { FillPart } from '../derive/openings3d';
import { DEFAULT_LEAF_COLOR, defaultWallColor, defaultWallFinish, ROOF_COLOR, TRIM_COLOR } from '../model/finish';
import type { Column, Phase, RoofFinish, WallFinish, WallKind } from '../model/types';
import { NORMAL_SCALE, newWorkColor, sidingTexture, sidingTextures } from './textures';

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

/**
 * New work is green: a textured wall uses the texture's `new` variant (blended 50% toward the
 * new-work green, textures.ts) under a white tint, and its flat colour is the same blend; plain
 * walls, roofs and trim are pulled toward a darker green.
 */
const NEW_GREEN = '#3f8f5f';
const pullGreen = (hex: string) => `#${new Color(hex).lerp(new Color(NEW_GREEN), 0.45).getHexString()}`;

/** The colour a wall shows without textures (export, and the fallback where no canvas exists). */
export function wallFlatColor(phase: Phase, finish: WallFinish, color: string): string {
  if (phase === 'demo') return PHASE_COLOR.demo;
  if (finish === 'screen') return phase === 'new' ? newWorkColor('#4a4d4c') : '#4a4d4c';
  if (phase !== 'new') return color;
  return finish === 'plain' ? pullGreen(color) : newWorkColor(color);
}

/**
 * A wall's material. Exterior walls (and any wall given a finish) carry the procedural siding
 * texture of their finish and colour (textures.ts) and its normal map (the relief of laps, joints
 * and mortar); the wall mesh is one merged geometry, so both faces of an exterior wall show the
 * siding. Plain walls are a flat colour. Demolished walls stay translucent red whatever their
 * finish; new ones use the texture's green-washed `new` variant. A screen is a see-through mesh.
 * Textures exist only where a canvas does: elsewhere (node, tests) the flat colour is used. A
 * textured material keeps its flat colour in `userData.flatColor` for the export (colours only).
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
      const tex = textured ? sidingTextures(finish, color, phase === 'new' ? 'new' : 'plain') : null;
      m = make(tex ? '#ffffff' : wallFlatColor(phase, finish, color));
      if (tex) {
        m.map = tex.map;
        if (tex.normalMap) {
          m.normalMap = tex.normalMap;
          m.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
        }
        m.userData.flatColor = wallFlatColor(phase, finish, color);
      }
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
  // Keyed by colour too, so a leaf in a second colour gets its own material.
  const key = `${name}|${phase}|${color}`;
  let m = partMaterials.get(key);
  if (!m) {
    m = phase === 'demo' ? make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 }) : make(phase === 'new' ? pullGreen(color) : color);
    partMaterials.set(key, m);
  }
  return m;
}

/** Window and door parts: tan trim, white sash and muntins, dark green leaf (unless coloured), green shutters. */
const OPENING_COLOR: Record<Exclude<FillPart, 'glass' | 'screen'>, string> = {
  trim: TRIM_COLOR,
  sash: '#f4f1ea',
  leaf: DEFAULT_LEAF_COLOR,
  shutter: '#3f6f5f',
};

/** Insect screen: the dark grey of the screen siding's mesh. */
const SCREEN_COLOR = '#4a4d4c';
/** A screen's opacity over its texture's own alpha (the mesh is about 3/4 opaque on its own). */
const SCREEN_OPACITY = 0.85;

/**
 * The screen of a screened window or door: the siding's screen mesh (textures.ts), transparent with
 * no depth write and drawn after the opaque meshes like glass. FrontSide: the pane is a closed box,
 * so one face of it shows from either side (both faces at once would double the mesh's darkness).
 */
function screenMaterial(phase: Phase): MeshStandardMaterial {
  const key = `screen|${phase}`;
  let m = partMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const flat = phase === 'new' ? newWorkColor(SCREEN_COLOR) : SCREEN_COLOR;
      const tex = sidingTexture('screen', SCREEN_COLOR, phase === 'new' ? 'new' : 'plain');
      // Without a canvas (node), a flat translucent grey.
      m = make(tex ? '#ffffff' : flat, { transparent: true, opacity: tex ? SCREEN_OPACITY : 0.6 });
      if (tex) {
        m.map = tex;
        m.userData.flatColor = flat;
      }
    }
    partMaterials.set(key, m);
  }
  return m;
}

/**
 * The material of a window or door part. `color` is the door leaf's colour (OpeningMesh.leafColor);
 * the other parts keep theirs.
 */
export function openingMaterial(part: FillPart, phase: Phase, color?: string): MeshStandardMaterial {
  if (part === 'screen') return screenMaterial(phase);
  if (part !== 'glass') return trimLike(part, part === 'leaf' && color ? color : OPENING_COLOR[part], phase);
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
