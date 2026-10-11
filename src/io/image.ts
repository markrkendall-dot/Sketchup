import { fitWithin } from '../model/underlay';

/** Longest side of an underlay image after import, px (DESIGN.md "Persistence and export"). */
export const MAX_UNDERLAY_PX = 2048;
export const UNDERLAY_JPEG_QUALITY = 0.85;
/** What the file picker offers; HEIC only works where the browser can decode it (Safari). */
export const UNDERLAY_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,application/pdf';

export interface ImportedImage {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
}

export const isPdfFile = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to <img>, which can decode a few formats createImageBitmap rejects.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Decode an image file, downscale it so the longest side is at most 2048 px, and encode it as a
 * JPEG data URL (quality 0.85, transparent areas become white). Throws a readable Error for PDFs
 * and for files the browser cannot decode.
 */
export async function importImage(file: File): Promise<ImportedImage> {
  if (isPdfFile(file)) {
    throw new Error(`${file.name} is a PDF. Export the PDF page as an image first (PNG or JPEG), then load that.`);
  }
  let img: Awaited<ReturnType<typeof decode>>;
  try {
    img = await decode(file);
  } catch {
    throw new Error(`Could not read ${file.name} as an image. Use a JPEG, PNG or WebP file (HEIC only where the browser can open it).`);
  }
  try {
    if (!(img.width > 0 && img.height > 0)) throw new Error(`${file.name} has no pixels.`);
    const { width, height } = fitWithin(img.width, img.height, MAX_UNDERLAY_PX);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw images (no 2D canvas).');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', UNDERLAY_JPEG_QUALITY);
    return { dataUrl, pixelWidth: width, pixelHeight: height };
  } finally {
    img.close();
  }
}
