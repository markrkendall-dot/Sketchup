import { useEffect, useRef, type ChangeEvent } from 'react';
import { switchTool } from '../editor2d/tools';
import { DEFAULT_SCAN_OPACITY, MESH_ACCEPT } from '../model/meshAsset';
import type { Id } from '../model/types';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

// Importing meshes (DESIGN.md "Mesh assets"): a scanned object to place as a mesh fixture (File,
// Import scanned object), or a room scan as a level's overlay (the level's panel, Load scan
// overlay). io/meshImport.ts does the reading; it is loaded on first use.

/** What the picker is for: an object to place, or a scan overlay for a level. */
export type MeshRequest = { mode: 'object' } | { mode: 'scan'; levelId: Id };

let picker: ((req: MeshRequest) => void) | null = null;

/** Open the mesh file picker (the one hidden input MeshFileInput mounts). */
export function requestMeshFile(req: MeshRequest): void {
  picker?.(req);
}

/**
 * Read a mesh file and use it: an object is stored as an asset and the scanned object tool starts
 * with it (click to place, as with a cabinet); a scan becomes the level's overlay at the level's
 * origin, its own origin kept.
 */
export async function loadMeshFile(file: File, req: MeshRequest): Promise<void> {
  const ui = useUiStore.getState();
  ui.patchDraft({ error: false, message: `Reading ${file.name}...` });
  let imported;
  try {
    const { importMeshFile } = await import('../io/meshImport');
    imported = await importMeshFile(file, { recentre: req.mode === 'object' });
  } catch (err) {
    useUiStore.getState().patchDraft({ message: null });
    window.alert(err instanceof Error ? err.message : String(err));
    return;
  }
  const { asset, triangles } = imported;
  const store = usePlanStore.getState();
  const mb = (asset.bytes / 1024 / 1024).toFixed(2);
  if (req.mode === 'scan') {
    const level = getPlan().levels[req.levelId];
    if (!level) return;
    const ok = store.setLevelScan(level.id, { assetId: asset.id, origin: { x: 0, y: 0 }, rotation: 0, elevation: 0, opacity: DEFAULT_SCAN_OPACITY, visible: true }, asset);
    useUiStore.getState().patchDraft({ error: !ok, message: ok ? `Scan overlay loaded on ${level.name} (${triangles.toLocaleString()} triangles, ${mb} MB). See it in 3D; nudge it in the level's panel.` : 'Could not use that scan.' });
    if (ok) useUiStore.getState().setShowScan(true);
    return;
  }
  if (!store.addAsset(asset)) {
    useUiStore.getState().patchDraft({ error: true, message: `Could not use ${file.name}.` });
    return;
  }
  useUiStore.getState().patchDraft({ meshAssetId: asset.id });
  switchTool('meshObject');
  useUiStore.getState().patchDraft({
    error: false,
    message: `${asset.name}: ${triangles.toLocaleString()} triangles, ${mb} MB. Click to place it (its back snaps to a wall; Shift places it free, Tab turns it).`,
  });
}

/** The one hidden file input for meshes; requestMeshFile() opens it. */
export function MeshFileInput() {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<MeshRequest | null>(null);
  useEffect(() => {
    picker = (req) => {
      pending.current = req;
      input.current?.click();
    };
    return () => {
      picker = null;
    };
  }, []);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const req = pending.current ?? { mode: 'object' };
    pending.current = null;
    if (file) void loadMeshFile(file, req);
  };
  return <input ref={input} className="mesh-file-input" type="file" accept={MESH_ACCEPT} aria-label="Mesh file" hidden onChange={onChange} />;
}
