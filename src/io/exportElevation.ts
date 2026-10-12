import type { Plan } from '../model/types';
import { ELEVATION_FACES, type ElevationFace } from '../store/uiStore';
import { captureElevation } from '../view3d/capture';
import { downloadBlob, planFileName } from './file';

// Elevation export (DESIGN.md "3D"): the four sides rendered from the live 3D view
// (view3d/capture.ts), with shadows and siding textures, one PNG per side.

/** The images are this many times the 3D view's resolution. */
export const ELEVATION_SCALE = 2;

/** Why there is nothing to export: the elevations are rendered by the 3D view. */
export const NO_3D_VIEW = 'Open the 3D view first: the elevations are rendered from it.';

/** `<plan name>-north-elevation.png`: the plan's download name (file.ts planFileName) plus the side. */
export function elevationFileName(plan: Pick<Plan, 'name'>, face: ElevationFace): string {
  return planFileName(plan, 'png').replace(/\.png$/, `-${face}-elevation.png`);
}

/** The bytes of a base64 data URL (a canvas's `toDataURL`) as a Blob of its type. */
export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const header = url.slice(0, comma);
  if (!url.startsWith('data:') || comma < 0 || !header.endsWith(';base64')) throw new Error('Not a base64 data URL');
  const type = header.slice('data:'.length, -';base64'.length).split(';')[0];
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Render the north, south, east and west elevations of what the 3D view shows (its view mode and
 * levels) and download them as `<plan name>-<side>-elevation.png`. All four are rendered before the
 * first download, so the view redraws once. Throws NO_3D_VIEW when no 3D view is mounted.
 */
export function downloadElevations(plan: Plan, capture: (face: ElevationFace, scale: number) => string | null = captureElevation): void {
  const shots: { face: ElevationFace; url: string }[] = [];
  for (const face of ELEVATION_FACES) {
    const url = capture(face, ELEVATION_SCALE);
    if (!url) throw new Error(NO_3D_VIEW);
    shots.push({ face, url });
  }
  for (const { face, url } of shots) downloadBlob(dataUrlToBlob(url), elevationFileName(plan, face));
}
