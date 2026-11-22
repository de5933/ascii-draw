import { FontConfig, fontCss, loadFont } from '../../core/fonts/fonts';
import { Pixels } from '../../core/import';

/** Decodes an image file (PNG, JPEG, GIF, WebP, BMP, ...), honoring EXIF orientation. */
export function decodeImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Reads an image's pixels. Images much larger than needed are first shrunk by
 * the browser (high-quality smoothing) to at most `maxW` x `maxH`, keeping the
 * later area-average fast without losing quality.
 */
export function readPixels(img: CanvasImageSource & { width: number; height: number }, maxW: number, maxH: number): Pixels {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/**
 * Cell height / width for a font, measured at a large size so rounding
 * doesn't skew it.
 */
export async function measureCellAspect(font: FontConfig, weight: number): Promise<number> {
  await loadFont(font, weight);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 2;
  const size = 100;
  ctx.font = fontCss(font, weight, size);
  const advance = ctx.measureText('M').width;
  return advance > 0 ? (size * font.lineHeight) / advance : 2;
}
