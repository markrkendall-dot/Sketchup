import { Group, Mesh, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { getLevelElevations } from '../derive/levels';
import type { CasePart } from '../derive/casework';
import type { FillPart } from '../derive/openings3d';
import { getDeckMeshes, getFloorOpeningMeshes, getLevelMeshes, getMemberMeshes, getSiteMeshes, getTerrainGeometry, openingPartColor } from '../derive/meshes';
import type { ChimneyPart } from '../derive/site';
import { counterColorOf, DEFAULT_CABINET_COLOR, DEFAULT_COUNTER_COLOR, FIXTURE_LABEL, isCabinet } from '../model/casework';
import { COLUMN_COLOR, DECK_COLOR, DEFAULT_LEAF_COLOR, DEFAULT_SASH_COLOR, defaultWallColor, defaultWallFinish, ROOF_COLOR, TRIM_COLOR } from '../model/finish';
import type { Column, FixtureKind, Phase, Plan, RoofFinish, ViewMode, WallFinish, WallKind } from '../model/types';
import type { UiState } from '../store/uiStore';
import { caseworkMaterial, chimneyPartMaterial, columnMaterial, counterMaterial, deckMaterial, fasciaMaterial, memberMaterial, railingMaterial, floorFinishMaterial, floorMaterial, openingMaterial, rafterMaterial, roofMaterial, roomWallMaterial, stairPartMaterial, stairsMaterial, terrainMaterial, wallMaterial } from '../view3d/materials';
import { visible3dLevels } from '../view3d/visibility';
import { downloadBlob, planFileName } from './file';

// 3D export (DESIGN.md "Persistence and export"). The export scene is built from the derived
// geometry (derive/meshes.ts), never from the live r3f scene, which also holds lights, the grid
// and control helpers. Pure apart from the download helpers at the bottom: testable in node.

/** glTF is in metres; the plan is in inches. */
export const METRES_PER_INCH = 0.0254;

/** The 3D view's level visibility (which levels the export includes). */
export type ExportLevelVisibility = Pick<UiState, 'hidden3dLevels' | 'only3dActiveAndBelow' | 'activeLevelId'> & Partial<Pick<UiState, 'siteMode'>>;

export type ExportFormat = 'glb' | 'obj';

/** Material names without spaces: OBJ `usemtl` and some importers stop at the first space. */
const wallMaterialName = (phase: Phase, kind: WallKind, finish: WallFinish, color: string) => {
  const base = `wall_${phase}_${kind}`;
  // The house's default look keeps the plain name; any other finish or colour is spelled out.
  if (phase === 'demo' || (finish === defaultWallFinish(kind) && color === defaultWallColor(kind))) return base;
  return `${base}_${finish}_${color.slice(1)}`;
};
/** A room's interior finish (DESIGN.md "Interior finishes"): `interior_<finish>_<hex>` on walls, `floor_<finish>_<hex>` on floors, then `_new`. */
const interiorMaterialName = (surface: 'interior' | 'floor', phase: Phase, finish: string, color: string) =>
  `${surface}_${finish}_${color.slice(1)}${phase === 'new' ? '_new' : ''}`;
const stairsMaterialName = (phase: Phase) => `stairs_${phase}`;
const roofMaterialName = (finish: RoofFinish, phase: Phase, color: string) =>
  phase === 'demo' || color === ROOF_COLOR[finish] ? `roof_${finish}_${phase}` : `roof_${finish}_${phase}_${color.slice(1)}`;
/** `fascia_<phase>` and `rafter_<phase>` in tan, `..._<hex>` in another board colour (a demolished one is red whatever its colour). */
const boardMaterialName = (part: 'fascia' | 'rafter', phase: Phase, color: string) =>
  phase === 'demo' || color === TRIM_COLOR ? `${part}_${phase}` : `${part}_${phase}_${color.slice(1)}`;
/** `deck_<phase>` and `deck_frame_<phase>` in the default wood, `..._<hex>` in another colour (a demolished deck is red whatever its colour). */
const deckMaterialName = (part: 'boards' | 'frame', phase: Phase, color: string) => {
  const base = part === 'frame' ? 'deck_frame' : 'deck';
  return phase === 'demo' || color === DECK_COLOR ? `${base}_${phase}` : `${base}_${phase}_${color.slice(1)}`;
};
const OPENING_MATERIAL: Record<FillPart, string> = { trim: 'trim', sash: 'sash', glass: 'glass', screen: 'screen', leaf: 'door_leaf', shutter: 'shutter' };
/** The default colour of the parts that can take their own (the leaf, the trim, the sash). */
const PART_DEFAULT: Partial<Record<FillPart, string>> = { leaf: DEFAULT_LEAF_COLOR, trim: TRIM_COLOR, sash: DEFAULT_SASH_COLOR };
/**
 * `door_leaf_<hex>`, `trim_<hex>` or `sash_<hex>` for a part not in its default colour (a demolished
 * one is red whatever its colour), then `_new` / `_demo`.
 */
const openingMaterialName = (part: FillPart, phase: Phase, color?: string) => {
  const def = PART_DEFAULT[part];
  const base = def && color && phase !== 'demo' && color !== def ? `${OPENING_MATERIAL[part]}_${color.slice(1)}` : OPENING_MATERIAL[part];
  return phase === 'existing' ? base : `${base}_${phase}`;
};
/** `column_<kind>_<phase>`, plus `_<hex>` in a colour other than the kind's default (a demolished one is red whatever its colour). */
const columnMaterialName = (kind: Column['kind'], phase: Phase, color: string) =>
  phase === 'demo' || color === COLUMN_COLOR[kind] ? `column_${kind}_${phase}` : `column_${kind}_${phase}_${color.slice(1)}`;
const chimneyPartMaterialName = (part: ChimneyPart, phase: Phase) => (part === 'hood' || part === 'stem' ? `flue_${part}_${phase}` : `chimney_${part}_${phase}`);
/** `cabinet`, `kick`, `appliance`, `basin` (plus `_<hex>` for cabinets not in the default colour), then `_<phase>` for other phases. */
const caseworkMaterialName = (part: CasePart, phase: Phase, color: string) => {
  const base = part === 'carcass' || part === 'front' ? (phase !== 'demo' && color !== DEFAULT_CABINET_COLOR ? `cabinet_${color.slice(1)}` : 'cabinet') : part;
  return phase === 'existing' ? base : `${base}_${phase}`;
};
const counterMaterialName = (phase: Phase, color: string) => {
  const base = phase !== 'demo' && color !== DEFAULT_COUNTER_COLOR ? `counter_${color.slice(1)}` : 'counter';
  return phase === 'existing' ? base : `${base}_${phase}`;
};
/** `Cabinet (base)`, `Appliance (range)`, `Sink`, `Box`. */
const fixtureMeshName = (kind: FixtureKind) => (isCabinet(kind) && kind !== 'sink' ? `Cabinet (${FIXTURE_LABEL[kind].replace(' cabinet', '').toLowerCase()})` : kind === 'sink' ? 'Sink' : kind === 'box' ? 'Box' : `Appliance (${FIXTURE_LABEL[kind].toLowerCase()})`);

/**
 * A fresh scene of what the 3D view shows: a root group named after the plan, scaled to metres,
 * with one group per visible level at its floor-top elevation holding `Wall <n> (<kind>, <phase>)`,
 * `Floor`, `Stairs`, `Roof` (with its `Fascia` boards and, under open eaves, its `Rafters`, materials
 * `fascia_<phase>` and `rafter_<phase>`, plus `_<hex>` in a board colour other than tan), `Deck`, `Deck framing` (with the
 * posts) and `Deck railing` (materials `deck_<phase>` and `deck_frame_<phase>`, plus `_<hex>` in a colour other than
 * the default wood), `Stair railing` and `Guard` (a flight's railings and the guard round a floor opening, material `railing_<phase>`), and `Window` / `Door` meshes (one per material part: `trim`, `sash`, `glass`, `screen`, `door_leaf` or `door_leaf_<hex>`, `shutter`). Colours only: no texture or normal map is exported, a textured material's flat colour (`userData.flatColor`) is. Levels with nothing to show are left out. A `Site` group (at
 * elevation 0, absolute heights) follows with the `Chimney`, `Flue` and `Post` meshes the view mode shows
 * (materials `column_<kind>_<phase>`, plus `_<hex>` in a colour other than the default; a capped
 * chimney's cap and spark arrestor are more `Chimney` meshes, `chimney_cap_<phase>` and
 * `chimney_arrestor_<phase>`; a capped flue's rain cap is two more `Flue` meshes, `flue_stem_<phase>` and `flue_hood_<phase>`) and, when the site has grade points, the `Terrain` (material `terrain`; without grade points the
 * ground is a flat plane at the slab and is left out). Geometries are clones (the
 * mesh cache owns the originals) and materials are clones of the live view's, one per phase/kind
 * combination; free both with disposeExportScene().
 */
export function buildExportScene(plan: Plan, viewMode: ViewMode, levelVisibility: ExportLevelVisibility): Group {
  const root = new Group();
  root.name = plan.name.trim() || 'HomePlan';
  root.scale.setScalar(METRES_PER_INCH);
  const elev = getLevelElevations(plan);
  const materials = new Map<string, MeshStandardMaterial>();
  // Colours only: every clone drops its textures and takes the flat colour a textured live
  // material records (view3d/materials.ts `userData.flatColor`).
  const material = (name: string, live: MeshStandardMaterial) => {
    let m = materials.get(name);
    if (!m) {
      m = live.clone();
      m.name = name;
      m.map = null;
      m.normalMap = null;
      const flat: unknown = live.userData.flatColor;
      if (typeof flat === 'string') m.color.set(flat);
      materials.set(name, m);
    }
    return m;
  };
  const mesh = (name: string, geometry: BufferGeometry, mat: Material) => {
    const m = new Mesh(geometry.clone(), mat);
    m.name = name;
    return m;
  };

  for (const id of visible3dLevels(plan.levelOrder, levelVisibility)) {
    const level = plan.levels[id];
    const meshes = getLevelMeshes(plan, id, viewMode);
    const decks = getDeckMeshes(plan, id, viewMode);
    const guards = getFloorOpeningMeshes(plan, id, viewMode);
    const members = getMemberMeshes(plan, id, viewMode);
    if (!level || (!members.length &&!meshes.walls.length && !meshes.floor && !meshes.floorFinishes.length && !meshes.stairs.length && !meshes.staircases.length && !meshes.roofs.length && !meshes.openings.length && !meshes.fixtures.length && !decks.length && !guards.length)) continue;
    const group = new Group();
    group.name = level.name;
    group.position.set(0, elev[id]?.floorTop ?? 0, 0);
    if (meshes.floor) group.add(mesh('Floor', meshes.floor, material('floor', floorMaterial)));
    const roomName = (id: string) => level.rooms[id]?.name ?? 'room';
    for (const f of meshes.floorFinishes) {
      group.add(mesh(`Floor finish (${roomName(f.roomId)})`, f.geometry, material(interiorMaterialName('floor', f.phase, f.finish, f.color), floorFinishMaterial(f.phase, f.finish, f.color))));
    }
    meshes.walls.forEach((w, i) => {
      // Colours only: the live material's siding texture is dropped and its flat colour used (material()).
      const mat = material(wallMaterialName(w.phase, w.kind, w.finish, w.color), wallMaterial(w.phase, w.kind, w.finish, w.color));
      const m = mesh(`Wall ${i + 1} (${w.kind}, ${w.phase})`, w.geometry, mat);
      // Translucent demolished walls draw after the opaque ones, as in the live view.
      if (w.phase === 'demo') m.renderOrder = 1;
      group.add(m);
      // The faces a room dresses: separate meshes, so both OBJ and glTF keep their materials.
      for (const f of w.faces ?? []) {
        group.add(mesh(`Wall ${i + 1} finish (${roomName(f.roomId)}${f.band === 'wainscot' ? ', wainscot' : ''})`, f.geometry, material(interiorMaterialName('interior', w.phase, f.finish, f.color), roomWallMaterial(w.phase, f.finish, f.color))));
      }
      // The outside face below an exterior band, in the band's finish and colour.
      if (w.band) {
        const { finish, color } = w.band;
        group.add(mesh(`Wall ${i + 1} lower band`, w.band.geometry, material(wallMaterialName(w.phase, w.kind, finish, color), wallMaterial(w.phase, w.kind, finish, color))));
      }
    });
    for (const s of meshes.stairs) {
      group.add(mesh('Stairs', s.geometry, material(stairsMaterialName(s.phase), stairsMaterial(s.phase))));
      if (s.railing) {
        const r = mesh('Stair railing', s.railing, material(`railing_${s.phase}`, railingMaterial(s.phase)));
        if (s.phase === 'demo') r.renderOrder = 1;
        group.add(r);
      }
    }
    // A staircase: its stair (treads, carcass), framing and railing, each in the tread colour or the paint.
    const STAIR_PART_NAME = { stair: 'Stairs', frame: 'Stair framing', rail: 'Stair railing' } as const;
    for (const sc of meshes.staircases) {
      for (const p of sc.parts) {
        const color = p.mat === 'tread' ? sc.treadColor : sc.paintColor;
        const name = sc.phase === 'demo' ? `stair_${p.mat}_demo` : `stair_${p.mat}_${sc.phase}_${color.slice(1)}`;
        const m = mesh(STAIR_PART_NAME[p.group], p.geometry, material(name, stairPartMaterial(p.mat, sc.phase, color)));
        if (sc.phase === 'demo') m.renderOrder = 1;
        group.add(m);
      }
    }
    for (const r of meshes.roofs) {
      const m = mesh('Roof', r.geometry, material(roofMaterialName(r.finish, r.phase, r.color), roofMaterial(r.finish, r.phase, r.color, r.weathering)));
      if (r.phase === 'demo') m.renderOrder = 1;
      group.add(m);
      if (r.fascia) {
        const f = mesh('Fascia', r.fascia, material(boardMaterialName('fascia', r.phase, r.boardColor), fasciaMaterial(r.phase, r.boardColor)));
        if (r.phase === 'demo') f.renderOrder = 1;
        group.add(f);
      }
      if (r.rafters) {
        const t = mesh('Rafters', r.rafters, material(boardMaterialName('rafter', r.phase, r.boardColor), rafterMaterial(r.phase, r.boardColor)));
        if (r.phase === 'demo') t.renderOrder = 1;
        group.add(t);
      }
    }
    // Decks: the boards, the framing with its posts, the railing.
    for (const d of decks) {
      for (const [name, geometry, part] of [
        ['Deck', d.boards, 'boards'],
        ['Deck framing', d.frame, 'frame'],
        ['Deck railing', d.railing, 'boards'],
      ] as const) {
        if (!geometry) continue;
        const m = mesh(name, geometry, material(deckMaterialName(part, d.phase, d.color), deckMaterial(part, d.phase, d.color)));
        if (d.phase === 'demo') m.renderOrder = 1;
        group.add(m);
      }
    }
    // The guards round floor openings.
    for (const g of guards) {
      // In an arriving staircase's style: its paint and its tread colour (the rail).
      const stairMat = (mat: 'tread' | 'paint', color: string) => material(g.phase === 'demo' ? `stair_${mat}_demo` : `stair_${mat}_${g.phase}_${color.slice(1)}`, stairPartMaterial(mat, g.phase, color));
      const m = mesh('Guard', g.railing, g.style ? stairMat('paint', g.style.paintColor) : material(`railing_${g.phase}`, railingMaterial(g.phase)));
      if (g.phase === 'demo') m.renderOrder = 1;
      group.add(m);
      if (g.rail && g.style) {
        const r = mesh('Guard', g.rail, stairMat('tread', g.style.treadColor));
        if (g.phase === 'demo') r.renderOrder = 1;
        group.add(r);
      }
    }
    // Beams, posts and footings.
    const MEMBER_NAME = { beam: 'Beam', post: 'Post', footing: 'Footing' } as const;
    for (const mm of members) {
      for (const [part, geometry] of [
        [mm.kind, mm.body],
        ['footing', mm.footing],
      ] as const) {
        if (!geometry) continue;
        const color = part === 'footing' || mm.phase === 'demo' ? undefined : mm.color;
        const m = mesh(MEMBER_NAME[part], geometry, material(`member_${part}_${mm.phase}${color ? `_${color.slice(1)}` : ''}`, memberMaterial(part, mm.phase, color)));
        if (mm.phase === 'demo') m.renderOrder = 1;
        group.add(m);
      }
    }
    // Windows and doors: one mesh per material part, named Window or Door.
    for (const o of meshes.openings) {
      for (const p of o.parts) {
        const m = mesh(o.type === 'door' ? 'Door' : 'Window', p.geometry, material(openingMaterialName(p.part, o.phase, openingPartColor(o, p.part)), openingMaterial(p.part, o.phase, openingPartColor(o, p.part))));
        if (o.phase === 'demo' || p.part === 'glass') m.renderOrder = 1;
        group.add(m);
      }
    }
    // Casework: one mesh per material part of each fixture, then the counter slabs.
    for (const f of meshes.fixtures) {
      for (const p of f.parts) {
        const m = mesh(fixtureMeshName(f.kind), p.geometry, material(caseworkMaterialName(p.part, f.phase, f.frontColor), caseworkMaterial(p.part, f.phase, f.frontColor)));
        if (f.phase === 'demo') m.renderOrder = 1;
        group.add(m);
      }
    }
    const counterColor = counterColorOf(level.finishes);
    for (const c of meshes.counters) {
      const m = mesh('Counter', c.geometry, material(counterMaterialName(c.phase, counterColor), counterMaterial(c.phase, counterColor)));
      if (c.phase === 'demo') m.renderOrder = 1;
      group.add(m);
    }
    root.add(group);
  }
  const site = new Group();
  site.name = 'Site';
  if (Object.keys(plan.site.gradePoints).length) {
    site.add(mesh('Terrain', getTerrainGeometry(plan, viewMode), material('terrain', terrainMaterial)));
  }
  for (const c of getSiteMeshes(plan, viewMode).columns) {
    const name = c.kind === 'chimney' ? 'Chimney' : c.kind === 'flue' ? 'Flue' : 'Post';
    const m = mesh(name, c.geometry, material(columnMaterialName(c.kind, c.phase, c.color), columnMaterial(c.kind, c.phase, c.color)));
    if (c.phase === 'demo') m.renderOrder = 1;
    site.add(m);
    // A capped chimney's cap and spark arrestor, a capped flue's rain cap: more meshes of its name, each in its own material.
    for (const p of c.parts ?? []) {
      const pm = mesh(name, p.geometry, material(chimneyPartMaterialName(p.part, c.phase), chimneyPartMaterial(p.part, c.phase)));
      if (c.phase === 'demo' || p.part === 'arrestor') pm.renderOrder = 1;
      site.add(pm);
    }
  }
  if (site.children.length) root.add(site);
  root.updateMatrixWorld(true);
  return root;
}

/** Dispose the cloned geometries and materials of an export scene. */
export function disposeExportScene(root: Group): void {
  const mats = new Set<Material>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    (o.geometry as BufferGeometry).dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m as Material);
  });
  for (const m of mats) m.dispose();
}

/** Binary glTF (.glb) of an export scene. */
export async function toGlb(root: Group): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true, trs: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('glTF exporter returned JSON, expected binary');
  return out;
}

/**
 * Wavefront OBJ of an export scene, in inches (OBJ has no units; SketchUp asks for them on
 * import). The root's metre scale is undone and every mesh name is prefixed with its level's name,
 * because OBJExporter writes one flat `o <mesh name>` object per mesh and drops the groups.
 */
export function toObj(root: Group): string {
  root.scale.setScalar(1);
  for (const level of root.children) {
    for (const m of level.children) m.name = `${level.name} - ${m.name}`;
  }
  root.updateMatrixWorld(true);
  const header = `# ${root.name}, exported from HomePlan. Units: inches, Y up.\n`;
  return header + new OBJExporter().parse(root);
}

/**
 * Export what the 3D view shows (view mode and visible levels) and download it as
 * `<plan name>.glb` or `.obj`.
 */
export async function downloadExport(
  format: ExportFormat,
  plan: Plan,
  viewMode: ViewMode,
  levelVisibility: ExportLevelVisibility,
): Promise<void> {
  const root = buildExportScene(plan, viewMode, levelVisibility);
  try {
    if (!root.children.length) throw new Error('Nothing to export: the visible levels have no walls, floors, stairs, roofs, decks or site elements.');
    const blob =
      format === 'glb'
        ? new Blob([await toGlb(root)], { type: 'model/gltf-binary' })
        : new Blob([toObj(root)], { type: 'text/plain' });
    downloadBlob(blob, planFileName(plan, format));
  } finally {
    disposeExportScene(root);
  }
}
