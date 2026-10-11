import { Group, Mesh, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { getLevelElevations } from '../derive/levels';
import { getLevelMeshes, getSiteMeshes, getTerrainGeometry } from '../derive/meshes';
import type { Column, Phase, Plan, RoofFinish, ViewMode, WallKind } from '../model/types';
import type { UiState } from '../store/uiStore';
import { columnMaterial, floorMaterial, roofMaterial, stairsMaterial, terrainMaterial, wallMaterial } from '../view3d/materials';
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
const wallMaterialName = (phase: Phase, kind: WallKind) => `wall_${phase}_${kind}`;
const stairsMaterialName = (phase: Phase) => `stairs_${phase}`;
const roofMaterialName = (finish: RoofFinish, phase: Phase) => `roof_${finish}_${phase}`;
const columnMaterialName = (kind: Column['kind'], phase: Phase) => `column_${kind}_${phase}`;

/**
 * A fresh scene of what the 3D view shows: a root group named after the plan, scaled to metres,
 * with one group per visible level at its floor-top elevation holding `Wall <n> (<kind>, <phase>)`,
 * `Floor`, `Stairs` and `Roof` meshes. Levels with nothing to show are left out. A `Site` group (at
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
  const material = (name: string, live: MeshStandardMaterial) => {
    let m = materials.get(name);
    if (!m) {
      m = live.clone();
      m.name = name;
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
    if (!level || (!meshes.walls.length && !meshes.floor && !meshes.stairs.length && !meshes.roofs.length)) continue;
    const group = new Group();
    group.name = level.name;
    group.position.set(0, elev[id]?.floorTop ?? 0, 0);
    if (meshes.floor) group.add(mesh('Floor', meshes.floor, material('floor', floorMaterial)));
    meshes.walls.forEach((w, i) => {
      const mat = material(wallMaterialName(w.phase, w.kind), wallMaterial(w.phase, w.kind));
      const m = mesh(`Wall ${i + 1} (${w.kind}, ${w.phase})`, w.geometry, mat);
      // Translucent demolished walls draw after the opaque ones, as in the live view.
      if (w.phase === 'demo') m.renderOrder = 1;
      group.add(m);
    });
    for (const s of meshes.stairs) {
      group.add(mesh('Stairs', s.geometry, material(stairsMaterialName(s.phase), stairsMaterial(s.phase))));
    }
    for (const r of meshes.roofs) {
      const m = mesh('Roof', r.geometry, material(roofMaterialName(r.finish, r.phase), roofMaterial(r.finish, r.phase)));
      if (r.phase === 'demo') m.renderOrder = 1;
      group.add(m);
    }
    root.add(group);
  }
  const site = new Group();
  site.name = 'Site';
  if (Object.keys(plan.site.gradePoints).length) {
    site.add(mesh('Terrain', getTerrainGeometry(plan), material('terrain', terrainMaterial)));
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
