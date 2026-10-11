import { formatLength, formatLengthCompact } from '../model/units';
import type { WallPreview } from '../store/uiStore';

/**
 * The length text of the wall being drawn. With "Lengths to" set to a face and a square corner it
 * names both numbers, e.g. `30'-11" inside (31'-5 1/2" centerline)`, so a typed face-to-face length
 * does not look like an error next to the centerline the wall is drawn on. Otherwise just the
 * (compact) centerline length.
 */
export function wallPreviewText(preview: WallPreview, denom: number, compact = true): string {
  const face = preview.face;
  if (!face || Math.abs(face.length - preview.length) < 1e-6) return compact ? formatLengthCompact(preview.length, denom) : formatLength(preview.length, denom);
  return `${formatLength(face.length, denom)} ${face.measureTo} (${formatLength(preview.length, denom)} centerline)`;
}
