// An object bundle (docs/scan/FORMAT.md, meta.json kind "object"): `npm run scan` only describes
// it. The model itself, object.usdz, is imported in the app (File, Import scanned object...).
import { IN_PER_M } from './roomplan';
import { feetInches } from './tapeList';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What an object bundle is and what to do with it: its size as scanned, and how to import it. */
export function describeObject(meta: Record<string, unknown>, usdzPath: string, usdzExists: boolean): string[] {
  const b = meta.bounds;
  const name = typeof meta.name === 'string' && meta.name ? meta.name : 'The object';
  const out: string[] = [];
  if (Array.isArray(b) && b.length === 3 && b.every(isNum)) {
    // bounds are [width, height, depth] in metres.
    const [w, h, d] = b.map((m) => m * IN_PER_M);
    out.push(`${name}: ${feetInches(w)} wide x ${feetInches(d)} deep x ${feetInches(h)} high, as scanned.`);
  } else {
    out.push(`${name}: meta.json gives no bounds.`);
  }
  out.push(usdzExists ? `Import ${usdzPath} in the app through File, "Import scanned object...".` : `${usdzPath} is missing: the bundle has no model to import.`);
  out.push('Then check one dimension with a tape and use "Rescale by known dimension" in its panel if it is off.');
  return out;
}
