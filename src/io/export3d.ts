import { Group, Mesh, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { getLevelElevations } from '../derive/levels';
import type { FillPart } from '../derive/openings3d';
import { getLevelMeshes, getSiteMeshes, getTerrainGeometry } from '../derive/meshes';
import { DEFAULT_LEAF_COLOR, defaultWallColor, defaultWallFinish, ROOF_COLOR } from '../model/finish';
import type { Column, Phase, Plan, RoofFinish, ViewMode, WallFinish, WallKind } from '../model/types';
import type { UiState } from '../store/uiStore';
import { columnMaterial, fasciaMaterial, floorMaterial, openingMaterial, roofMaterial, stairsMaterial, terrainMaterial, wallFlatColor, wallMaterial } from '../view3d/materials';
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
const stairsMaterialName = (phase: Phase) => `stairs_${phase}`;
const roofMaterialName = (finish: RoofFinish, phase: Phase, color: string) =>
  phase === 'demo' || color === ROOF_COLOR[finish] ? `roof_${finish}_${phase}` : `roof_${finish}_${phase}_${color.slice(1)}`;
const OPENING_MATERIAL: Record<FillPart, string> = { trim: 'trim', sash: 'sash', glass: 'glass', screen: 'screen', leaf: 'door_leaf', shutter: 'shutter' };
/** `door_leaf_<hex>` for a leaf not in the default colour (a demolished one is red whatever its colour), then `_new` / `_demo`. */
const openingMaterialName = (part: FillPart, phase: Phase, color: string = DEFAULT_LEAF_COLOR) => {
  const base = part === 'leaf' && phase !== 'demo' && color !== DEFAULT_LEAF_COLOR ? `${OPENING_MATERIAL[part]}_${color.slice(1)}` : OPENING_MATERIAL[part];
  return phase === 'existing' ? base : `${base}_${phase}`;
};
const columnMaterialName = (kind: Column['kind'], phase: Phase) => `column_${kind}_${phase}`;

/**
 * A fresh scene of what the 3D view shows: a root group named after the plan, scaled to metres,
 * with one group per visible level at its floor-top elevation holding `Wall <n> (<kind>, <phase>)`,
 * `Floor`, `Stairs`, `Roof` (with its tan `Fascia`), and `Window` / `Door` meshes (one per material part: `trim`, `sash`, `glass`, `screen`, `door_leaf` or `door_leaf_<hex>`, `shutter`). Colours only: siding textures are not exported. Levels with nothing to show are left out. A `Site` group (at
 * elevation 0, absolute heights) follows with the `Chimney` and `Post` meshes the view mode shows
 * and, when the site has grade points, the `Terrain` (material `terrain`; without grade points the
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
  const material = (name: string, live: MeshStandardMaterial, adjust?: (m: MeshStandardMaterial) => void) => {
    let m = materials.get(name);
    if (!m) {
      m = live.clone();
      m.name = name;
      adjust?.(m);
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
    if (!level || (!meshes.walls.length && !meshes.floor && !meshes.stairs.length && !meshes.roofs.length && !meshes.openings.length)) continue;
    const group = new Group();
    group.name = level.name;
    group.position.set(0, elev[id]?.floorTop ?? 0, 0);
    if (meshes.floor) group.add(mesh('Floor', meshes.floor, material('floor', floorMaterial)));
    meshes.walls.forEach((w, i) => {
      // Colours only: the live material's siding texture is dropped and its flat colour used.
      const mat = material(wallMaterialName(w.phase, w.kind, w.finish, w.color), wallMaterial(w.phase, w.kind, w.finish, w.color), (m) => {
        m.map = null;
        m.normalMap = null;
        m.color.set(wallFlatColor(w.phase, w.finish, w.color));
      });
      const m = mesh(`Wall ${i + 1} (${w.kind}, ${w.phase})`, w.geometry, mat);
      // Translucent demolished walls draw after the opaque ones, as in the live view.
      if (w.phase === 'demo') m.renderOrder = 1;
      group.add(m);
    });
    for (const s of meshes.stairs) {
      group.add(mesh('Stairs', s.geometry, material(stairsMaterialName(s.phase), stairsMaterial(s.phase))));
    }
    for (const r of meshes.roofs) {
      const m = mesh('Roof', r.geometry, material(roofMaterialName(r.finish, r.phase, r.color), roofMaterial(r.finish, r.phase, r.color)));
      if (r.phase === 'demo') m.renderOrder = 1;
      group.add(m);
      if (r.fascia) {
        const f = mesh('Fascia', r.fascia, material(`fascia_${r.phase}`, fasciaMaterial(r.phase)));
        if (r.phase === 'demo') f.renderOrder = 1;
        group.add(f);
      }
    }
    // Windows and doors: one mesh per material part, named Window or Door.
    for (const o of meshes.openings) {
      for (const p of o.parts) {
        const m = mesh(o.type === 'door' ? 'Door' : 'Window', p.geometry, material(openingMaterialName(p.part, o.phase, o.leafColor), openingMaterial(p.part, o.phase, o.leafColor)));
        if (o.phase === 'demo' || p.part === 'glass') m.renderOrder = 1;
        group.add(m);
      }
    }
    root.add(group);
  }
  const site = new Group();
  site.name = 'Site';
  if (Object.keys(plan.site.gradePoints).length) {
    site.add(mesh('Terrain', getTerrainGeometry(plan, viewMode), material('terrain', terrainMaterial)));
  }
  for (const c of getSiteMeshes(plan, viewMode).columns) {
    const m = mesh(c.kind === 'chimney' ? 'Chimney' : 'Post', c.geometry, material(columnMaterialName(c.kind, c.phase), columnMaterial(c.kind, c.phase)));
    if (c.phase === 'demo') m.renderOrder = 1;
    site.add(m);
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
    if (!root.children.length) throw new Error('Nothing to export: the visible levels have no walls, floors, stairs, roofs or site elements.');
    const blob =
      format === 'glb'
        ? new Blob([await toGlb(root)], { type: 'model/gltf-binary' })
        : new Blob([toObj(root)], { type: 'text/plain' });
    downloadBlob(blob, planFileName(plan, format));
  } finally {
    disposeExportScene(root);
  }
}
