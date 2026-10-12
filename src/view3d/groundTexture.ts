import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { seeded } from './textures';

// The lawn on the terrain (DESIGN.md "Site and terrain"). One 512 x 512 canvas stands for 96" x 96"
// of ground (a texel is 3/16"); the terrain's UVs are in inches (meshes.ts buildTerrainGeometry) and
// the texture repeats every 96". Drawn once, seeded, so every load looks the same. Every mark wraps
// round the tile's edges, so the repeat has no seam.

/** Pixels per side of the lawn tile. */
export const GRASS_PX = 512;
/** Inches of ground one tile covers. */
export const GRASS_TILE_INCHES = 96;
/**
 * The lawn's average colour, measured on the drawn tile: the terrain's flat colour for the export
 * and wherever there is no canvas (node, tests).
 */
export const GRASS_COLOR = '#495427';

type Rgb = [number, number, number];
// Muted, slightly olive greens: the photos' lawn in the fall.
const DARK: Rgb = [46, 58, 25];
const LIGHT: Rgb = [95, 108, 50];
const BLADE_DARK = 'rgba(36, 48, 20, 0.75)';
const BLADE_LIGHT = 'rgba(112, 124, 60, 0.7)';
const SOIL = 'rgba(84, 66, 42, 0.85)';
const STRAW = 'rgba(150, 136, 88, 0.85)';

/**
 * Tileable value noise: a random value on each node of an n x n lattice that wraps at the tile's
 * edge, smoothly interpolated, in [0, 1].
 */
function valueNoise(n: number, rand: () => number): (x: number, y: number) => number {
  const v = Array.from({ length: n * n }, () => rand());
  const at = (i: number, j: number) => v[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / GRASS_PX) * n;
    const fy = (y / GRASS_PX) * n;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = smooth(fx - i);
    const ty = smooth(fy - j);
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}

/** Draw `mark` at (x, y) and again a tile away wherever it would cross an edge (reach in pixels). */
function wrapped(x: number, y: number, reach: number, mark: (x: number, y: number) => void): void {
  for (const dx of [-GRASS_PX, 0, GRASS_PX]) {
    if (x + dx < -reach || x + dx > GRASS_PX + reach) continue;
    for (const dy of [-GRASS_PX, 0, GRASS_PX]) {
      if (y + dy < -reach || y + dy > GRASS_PX + reach) continue;
      mark(x + dx, y + dy);
    }
  }
}

function drawLawn(ctx: CanvasRenderingContext2D): void {
  const rand = seeded(9173);
  // Ground colour: two greens mixed by noise at three scales (24", 6" and 1.5" across).
  const coarse = valueNoise(4, rand);
  const mid = valueNoise(16, rand);
  const fine = valueNoise(64, rand);
  const img = ctx.createImageData(GRASS_PX, GRASS_PX);
  for (let y = 0; y < GRASS_PX; y++) {
    for (let x = 0; x < GRASS_PX; x++) {
      const t = Math.min(1, Math.max(0, 0.2 * coarse(x, y) + 0.35 * mid(x, y) + 0.3 * fine(x, y) + 0.3 * rand() - 0.08));
      const k = (y * GRASS_PX + x) * 4;
      for (let c = 0; c < 3; c++) img.data[k + c] = Math.round(DARK[c] + (LIGHT[c] - DARK[c]) * t);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Blades: short strokes of a darker and a lighter green, 1/2" to 1 1/2" long, any direction.
  ctx.lineCap = 'round';
  ctx.lineWidth = 1;
  const blade = (color: string, count: number) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let n = 0; n < count; n++) {
      const x = rand() * GRASS_PX;
      const y = rand() * GRASS_PX;
      const len = 3 + rand() * 5;
      const a = rand() * Math.PI * 2;
      const ex = Math.cos(a) * len;
      const ey = Math.sin(a) * len;
      wrapped(x, y, len, (px, py) => {
        ctx.moveTo(px, py);
        ctx.lineTo(px + ex, py + ey);
      });
    }
    ctx.stroke();
  };
  blade(BLADE_DARK, 9000);
  blade(BLADE_LIGHT, 7000);
  // Specks of soil and straw, 1 to 2 px.
  const specks = (color: string, count: number) => {
    ctx.fillStyle = color;
    for (let n = 0; n < count; n++) {
      const x = rand() * GRASS_PX;
      const y = rand() * GRASS_PX;
      const w = 1 + Math.floor(rand() * 2);
      const h = 1 + Math.floor(rand() * 2);
      wrapped(x, y, 2, (px, py) => ctx.fillRect(Math.floor(px), Math.floor(py), w, h));
    }
  };
  specks(SOIL, 1600);
  specks(STRAW, 1400);
}

let cached: CanvasTexture | null | undefined;

/**
 * The lawn texture, drawn once and cached: sRGB, repeating, `repeat` 1/96 so the terrain's inch
 * UVs give one tile per 96". Null wherever there is no DOM canvas (node, tests), where the terrain
 * is the flat GRASS_COLOR.
 */
export function grassTexture(): CanvasTexture | null {
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = GRASS_PX;
  canvas.height = GRASS_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (cached = null);
  drawLawn(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1 / GRASS_TILE_INCHES, 1 / GRASS_TILE_INCHES);
  tex.minFilter = LinearMipmapLinearFilter;
  // The lawn fills half the view and is seen at glancing angles, where anisotropic filtering takes
  // the most samples: at 8 the lawn's texture cost about 100 ms a frame in headless SwiftShader.
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return (cached = tex);
}
