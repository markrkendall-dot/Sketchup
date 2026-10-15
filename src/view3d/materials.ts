import { logEndColor, MEMBER_COLOR } from '../model/structure';
import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, MeshStandardMaterial, type Texture } from 'three';
import type { CasePart } from '../derive/casework';
import type { FillPart } from '../derive/openings3d';
import type { ChimneyPart } from '../derive/site';
import { APPLIANCE_COLOR, BASIN_COLOR, DEFAULT_CABINET_COLOR, DEFAULT_COUNTER_COLOR, KICK_COLOR } from '../model/casework';
import { CHECK_GROUND, CHIMNEY_CAP_COLOR, COLUMN_COLOR, DEFAULT_LEAF_COLOR, DEFAULT_SASH_COLOR, DECK_COLOR, DEFAULT_WEATHERING, defaultWallColor, FENCE_COLOR, RAILING_COLOR, SURFACE_COLOR, defaultWallFinish, isMetalRoof, ROOF_COLOR, TRIM_COLOR } from '../model/finish';
import type { Column, FloorFinish, Phase, RoofFinish, RoomWallFinish, SurfaceMaterial, WallFinish, WallKind } from '../model/types';
import { GRASS_COLOR, grassTexture, surfaceTexture } from './groundTexture';
import { brickTextures, interiorTextures, NORMAL_SCALE, newWorkColor, quantizeWeathering, roofTexture, sidingTexture, sidingTextures, type InteriorTexture } from './textures';

// Shared materials, created once. FrontSide everywhere: derive/meshes.ts guarantees outward
// winding, so a missing or black face is a geometry bug to fix, never something to paper over.
//
// A material that carries a texture records the colour it stands for in `userData.flatColor`
// (`#rrggbb`): the export is colours only (io/export3d.ts drops every map and uses that colour).

/**
 * The sky environment map (Scene3D's PMREM gradient) is carried only by materials that reflect it
 * (glass), at their own intensity; the rest take their sky light from the hemisphere light, which
 * costs far less per pixel (DESIGN.md "3D").
 */
export const GLASS_ENV_INTENSITY = 2;

let environment: Texture | null = null;
/** Materials that carry the environment map, kept current by setEnvironmentMap. */
const reflective = new Set<MeshStandardMaterial>();

/** The environment map Scene3D generated (null when the 3D view unmounts), for the materials that reflect it. */
export function setEnvironmentMap(map: Texture | null): void {
  environment = map;
  for (const m of reflective) {
    m.envMap = map;
    m.needsUpdate = true;
  }
}

/** Let a material reflect the sky environment at `intensity` (now and whenever it is regenerated). */
function reflectSky<M extends MeshStandardMaterial>(m: M, intensity: number): M {
  m.envMap = environment;
  m.envMapIntensity = intensity;
  reflective.add(m);
  return m;
}

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
      }
      if (finish === 'screen') {
        m.transparent = true;
        m.opacity = 0.4;
        m.depthWrite = false;
        m.side = DoubleSide;
      }
    }
    m.userData.flatColor = wallFlatColor(phase, finish, color);
    wallMaterials.set(key, m);
  }
  return m;
}

export const floorMaterial = make('#c9a77c'); // wood-ish tan

/**
 * The colour an interior finish shows without textures (export, and node): its colour, a check's
 * the colour blended a third of the way from its pale ground; new work pulled toward green like a
 * wall's.
 */
export function interiorFlatColor(phase: Phase, finish: RoomWallFinish | FloorFinish, color: string): string {
  const base = finish === 'check' ? `#${new Color(CHECK_GROUND).lerp(new Color(color), 0.4).getHexString()}` : color;
  if (phase !== 'new') return base;
  return finish === 'paint' || finish === 'plain' ? pullGreen(base) : newWorkColor(base);
}

const interiorMaterials = new Map<string, MeshStandardMaterial>();

/** The texture an interior finish draws, or null for a flat one (paint, a plain floor). */
const interiorTextureOf = (surface: 'wall' | 'floor', finish: RoomWallFinish | FloorFinish): InteriorTexture | null =>
  finish === 'paint' || finish === 'plain' ? null : (`${surface}-${finish}` as InteriorTexture);

function interiorMaterial(surface: 'wall' | 'floor', phase: Phase, finish: RoomWallFinish | FloorFinish, color: string): MeshStandardMaterial {
  // A demolished room's floor or a face of a demolished wall is never dressed (meshes.ts), so the
  // phase here is existing or new.
  const key = `${surface}|${phase === 'new' ? 'new' : 'existing'}|${finish}|${color}`;
  let m = interiorMaterials.get(key);
  if (!m) {
    const kind = interiorTextureOf(surface, finish);
    const tex = kind ? interiorTextures(kind, color, phase === 'new' ? 'new' : 'plain') : null;
    m = make(tex ? '#ffffff' : interiorFlatColor(phase, finish, color));
    if (tex) {
      m.map = tex.map;
      if (tex.normalMap) {
        m.normalMap = tex.normalMap;
        m.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
      }
    }
    if (surface === 'floor') {
      // The finish sits 1/16" over the slab top (meshes.ts FLOOR_FINISH_LIFT); the offset keeps it
      // in front of the slab from far away too, where depth precision is coarser than that.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -4;
    }
    m.userData.flatColor = interiorFlatColor(phase, finish, color);
    interiorMaterials.set(key, m);
  }
  return m;
}

/** The material of the wall faces a room dresses (DESIGN.md "Interior finishes"). */
export const roomWallMaterial = (phase: Phase, finish: RoomWallFinish, color: string): MeshStandardMaterial => interiorMaterial('wall', phase, finish, color);
/** The material of a room's floor finish. */
export const floorFinishMaterial = (phase: Phase, finish: FloorFinish, color: string): MeshStandardMaterial => interiorMaterial('floor', phase, finish, color);

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

/** The colour an existing or new roof shows without textures (export, and the fallback where no canvas exists). */
const roofFlatColor = (phase: Phase, color: string): string => (phase === 'new' ? pullGreen(color) : color);

/**
 * A roof's material: by finish, colour and (metal) weathering, quantized to 0.05 so a slider
 * shares materials and textures between steps. The roof texture (textures.ts roofTexture: metal
 * corrugated with rust streaks, shingle courses) is drawn in the colour under a white tint, with its
 * normal map; new work is drawn in the colour pulled toward green and without rust (a new roof is
 * not weathered). The flat colour is kept in `userData.flatColor` for the export. Metal has a
 * slight sheen (metalness 0.35, roughness 0.55). Demolished roofs are translucent red like walls.
 * Without a canvas (node, tests) the flat colour is used.
 */
export function roofMaterial(finish: RoofFinish, phase: Phase, color: string = ROOF_COLOR[finish], weathering: number = DEFAULT_WEATHERING): MeshStandardMaterial {
  // Only corrugated metal rusts; standing seam is drawn clean.
  const w = finish === 'metal' && phase !== 'new' ? quantizeWeathering(weathering) : 0;
  const key = phase === 'demo' ? 'demo' : `${finish}|${phase}|${color}|${w}`;
  let m = roofMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const flat = roofFlatColor(phase, color);
      const tex = roofTexture(finish, flat, w);
      m = make(tex ? '#ffffff' : flat);
      if (tex) {
        m.map = tex.map;
        if (tex.normalMap) {
          m.normalMap = tex.normalMap;
          m.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
        }
        m.userData.flatColor = flat;
      }
      if (isMetalRoof(finish)) {
        m.metalness = 0.35;
        m.roughness = 0.55;
      }
    }
    roofMaterials.set(key, m);
  }
  return m;
}

/** Fascia and rake boards: the roof's board colour, tan by default (demolished: red, new: pulled toward green). */
export function fasciaMaterial(phase: Phase, color: string = TRIM_COLOR): MeshStandardMaterial {
  return trimLike('fascia', color, phase);
}

/** Rafter tails under open eaves: the same colour as the roof's boards. */
export function rafterMaterial(phase: Phase, color: string = TRIM_COLOR): MeshStandardMaterial {
  return trimLike('rafter', color, phase);
}

/**
 * A deck's parts in its colour: the boards and the railing as is, the framing and posts 20% darker
 * (demolished: red, new: pulled toward green, like trim).
 */
export function deckMaterial(part: 'boards' | 'frame', phase: Phase, color: string = DECK_COLOR): MeshStandardMaterial {
  return trimLike(`deck-${part}`, part === 'frame' ? `#${new Color(color).multiplyScalar(0.8).getHexString()}` : color, phase);
}

/** A floor opening's guard and a stair's railings: stained wood (demolished: red, new: pulled toward green, like trim). */
export function railingMaterial(phase: Phase): MeshStandardMaterial {
  return trimLike('railing', RAILING_COLOR, phase);
}

/** A staircase's tread colour (treads, handrail, newel caps) or its paint (demolished: red, new: pulled toward green, like trim). */
export function stairPartMaterial(mat: 'tread' | 'paint', phase: Phase, color: string): MeshStandardMaterial {
  return trimLike(`stair-${mat}`, color, phase);
}

/**
 * Structure: LVL beams and posts as pale wood, footings as concrete, a round log's end grain its
 * colour mixed toward cut wood (logEndColor) (demolished: red, new: pulled toward green).
 */
export function memberMaterial(part: keyof typeof MEMBER_COLOR, phase: Phase, color?: string): MeshStandardMaterial {
  return trimLike(`member-${part}`, part === 'end' ? logEndColor(color) : (color ?? MEMBER_COLOR[part]), phase);
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
  sash: DEFAULT_SASH_COLOR,
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
 * The material of a window or door part. `color` is that part's colour where it has one of its own
 * (the door leaf's OpeningMesh.leafColor, the trim's and sash's trimColor and sashColor); the
 * shutters keep theirs.
 */
export function openingMaterial(part: FillPart, phase: Phase, color?: string): MeshStandardMaterial {
  if (part === 'screen') return screenMaterial(phase);
  if (part !== 'glass') return trimLike(part, part !== 'shutter' && color ? color : OPENING_COLOR[part], phase);
  const key = `glass|${phase}`;
  let m = partMaterials.get(key);
  if (!m) {
    m = glassMaterial(phase);
    partMaterials.set(key, m);
  }
  return m;
}

/** Window glass: dark blue-grey, so a pane reads dark with the sky in it, as in the photos. */
export const GLASS_COLOR = '#243139';
/**
 * How opaque glass is: the rooms behind it are lit by the same sky fill as the outside (nothing
 * occludes a hemisphere light), so at 0.65 they washed the panes out to a pale slate.
 */
export const GLASS_OPACITY = 0.75;

/**
 * Glass is physical (MeshPhysicalMaterial at its defaults: ior 1.5, no transmission pass): smooth,
 * see-through at GLASS_OPACITY, the sky reflected at GLASS_ENV_INTENSITY (strongest at a glancing
 * view, by Fresnel), no depth write (drawn after the opaque meshes, renderOrder 1). New glass is
 * pulled toward green; demolished glass is translucent red at 0.35 like every demolished part.
 */
function glassMaterial(phase: Phase): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: new Color(phase === 'demo' ? PHASE_COLOR.demo : phase === 'new' ? pullGreen(GLASS_COLOR) : GLASS_COLOR),
    roughness: 0.05,
    metalness: 0,
    flatShading: true,
    side: FrontSide,
    transparent: true,
    opacity: phase === 'demo' ? 0.35 : GLASS_OPACITY,
    depthWrite: false,
  });
  return reflectSky(m, GLASS_ENV_INTENSITY);
}

/**
 * The ground: the lawn texture (groundTexture.ts; the terrain's UVs are in inches) under a white
 * tint, matte, smooth shaded (the terrain geometry has smooth normals); the flat lawn colour where
 * there is no canvas.
 */
const lawn = grassTexture();
export const terrainMaterial = new MeshStandardMaterial({
  color: new Color(lawn ? '#ffffff' : GRASS_COLOR),
  map: lawn,
  roughness: 1,
  metalness: 0,
  side: FrontSide,
});
terrainMaterial.userData.flatColor = GRASS_COLOR;

/**
 * The far ground round the terrain: the same lawn, drawn a little toward the camera so that along
 * the seam it wins the depth tie with the top of the terrain's skirt (seen from outside the
 * terrain, the skirt's edge showed as a dark line there).
 */
export const farGroundMaterial = terrainMaterial.clone();
farGroundMaterial.polygonOffset = true;
farGroundMaterial.polygonOffsetFactor = -1;
farGroundMaterial.polygonOffsetUnits = -4;

/**
 * Casework (DESIGN.md "Casework"): painted cabinet carcasses and fronts in the fixture's front
 * colour, a dark toe kick, brushed steel appliances and sink basins, and the counter in the level's
 * counter colour with a slight stone sheen. Demolished parts are translucent red, new ones pulled
 * toward green, like everything else.
 */
export function caseworkMaterial(part: CasePart, phase: Phase, color: string = DEFAULT_CABINET_COLOR): MeshStandardMaterial {
  if (part === 'kick') return trimLike('kick', KICK_COLOR, phase);
  if (part === 'carcass' || part === 'front') return trimLike('cabinet', color, phase);
  const key = `${part}|${phase}`;
  let m = partMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const base = part === 'basin' ? BASIN_COLOR : APPLIANCE_COLOR;
      m = make(phase === 'new' ? pullGreen(base) : base);
      m.metalness = 0.6;
      m.roughness = 0.35;
    }
    partMaterials.set(key, m);
  }
  return m;
}

export function counterMaterial(phase: Phase, color: string = DEFAULT_COUNTER_COLOR): MeshStandardMaterial {
  const key = `counter|${phase}|${color}`;
  let m = partMaterials.get(key);
  if (!m) {
    m = phase === 'demo' ? make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 }) : make(phase === 'new' ? pullGreen(color) : color);
    if (phase !== 'demo') m.roughness = 0.45;
    partMaterials.set(key, m);
  }
  return m;
}

const columnMaterials = new Map<string, MeshStandardMaterial>();

/**
 * A column's shaft: by kind, phase and colour (the column's own, else brick red for a chimney and
 * tan for a post, model/finish.ts COLUMN_COLOR). A chimney is brick (textures.ts brickTextures:
 * running bond in the colour, the mortar a little lighter, with its normal map) under a white tint;
 * a pier is fieldstone (the walls' stone texture, sidingTextures, on the column's box UVs) the same
 * way; a post is the flat colour; a flue is stainless steel (metal, smooth, reflecting the sky). Demolished: translucent red like walls; new: the colour pulled toward
 * the new-work green (the brick drawn in it). The flat colour is kept in `userData.flatColor` for
 * the export; without a canvas (node) it is the material's colour.
 */
export function columnMaterial(kind: Column['kind'], phase: Phase, color: string = COLUMN_COLOR[kind]): MeshStandardMaterial {
  const key = phase === 'demo' ? 'demo' : `${kind}|${phase}|${color}`;
  let m = columnMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const flat = phase === 'new' ? pullGreen(color) : color;
      const tex = kind === 'chimney' ? brickTextures(flat) : kind === 'pier' ? sidingTextures('stone', color, phase === 'new' ? 'new' : 'plain') : null;
      m = make(tex ? '#ffffff' : flat);
      // A flue is brushed stainless steel: metal that reflects the sky, shaded smooth round.
      if (kind === 'flue') {
        m.metalness = 0.8;
        m.roughness = 0.35;
        m.flatShading = false;
        reflectSky(m, 1);
      }
      if (tex) {
        m.map = tex.map;
        if (tex.normalMap) {
          m.normalMap = tex.normalMap;
          m.normalScale.set(NORMAL_SCALE, NORMAL_SCALE);
        }
      }
      m.userData.flatColor = flat;
    }
    columnMaterials.set(key, m);
  }
  return m;
}

/**
 * A capped chimney's parts: the cap in pale concrete (CHIMNEY_CAP_COLOR, demolished red and new
 * pulled toward green like trim) and the spark arrestor in the window screens' wire mesh
 * (see-through, no depth write, drawn after the opaque meshes; it casts no shadow).
 */
export function chimneyPartMaterial(part: ChimneyPart, phase: Phase): MeshStandardMaterial {
  if (part === 'hood' || part === 'stem') return columnMaterial('flue', phase);
  return part === 'cap' ? trimLike('chimney-cap', CHIMNEY_CAP_COLOR, phase) : screenMaterial(phase);
}

const surfaceMaterials = new Map<string, MeshStandardMaterial>();

/**
 * A ground surface (DESIGN.md "Site and terrain"): by material, phase and colour (the surface's own,
 * else SURFACE_COLOR). Gravel (speckled stones) and asphalt (fine grain) carry their canvas texture
 * (groundTexture.ts surfaceTexture) drawn in the colour under a white tint; stone is the walls'
 * fieldstone (sidingTextures) as flagstones; concrete is the flat colour. Matte. It lies 1" over the
 * terrain (site.ts SURFACE_LIFT) and is drawn a little toward the camera as well, so from far away,
 * where depth precision is coarser than that, the lawn never shows through. Demolished: translucent
 * red; new: the colour pulled toward green. The flat colour is kept in `userData.flatColor` for the
 * export; without a canvas (node) it is the material's colour.
 */
export function surfaceMaterial(material: SurfaceMaterial, phase: Phase, color: string = SURFACE_COLOR[material]): MeshStandardMaterial {
  const key = phase === 'demo' ? 'demo' : `${material}|${phase}|${color}`;
  let m = surfaceMaterials.get(key);
  if (!m) {
    if (phase === 'demo') m = make(PHASE_COLOR.demo, { transparent: true, opacity: 0.35 });
    else {
      const flat = phase === 'new' ? pullGreen(color) : color;
      const map = material === 'gravel' || material === 'asphalt' ? surfaceTexture(material, flat) : material === 'stone' ? (sidingTextures('stone', color, phase === 'new' ? 'new' : 'plain')?.map ?? null) : null;
      m = make(map ? '#ffffff' : flat);
      m.map = map;
      m.roughness = material === 'asphalt' ? 0.85 : 1;
      m.userData.flatColor = flat;
    }
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -4;
    surfaceMaterials.set(key, m);
  }
  return m;
}

/**
 * A split-rail fence's logs in its colour (weathered grey wood by default, FENCE_COLOR), their end
 * discs in the end grain's (logEndColor, like a log member's); demolished: red, new: pulled toward
 * green, like trim.
 */
export function fenceMaterial(part: 'body' | 'end', phase: Phase, color: string = FENCE_COLOR): MeshStandardMaterial {
  return trimLike(`fence-${part}`, part === 'end' ? logEndColor(color) : color, phase);
}
