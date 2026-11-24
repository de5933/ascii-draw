import { packRgba } from './color';
import { AsciiDoc, DEFAULT_CELL, MAX_DOC_SIZE, createDoc } from './document';
import { DEFAULT_FONT_WEIGHT, FontConfig, GlyphTable, glyphsFor } from './fonts/fonts';

export const DEFAULT_IMPORT_WIDTH = 200;
export const IMPORT_CHAR = '@';

/** Which cell properties an import takes from the image. Unchecked ones get defaults. */
export interface ImportChannels {
  /** Characters chosen by pixel brightness (otherwise IMPORT_CHAR). */
  ch: boolean;
  /** Foreground = pixel color (otherwise white). */
  fg: boolean;
  /** Background = pixel color (otherwise black). */
  bg: boolean;
}

export const DEFAULT_IMPORT_CHANNELS: Readonly<ImportChannels> = Object.freeze({ ch: false, fg: true, bg: false });

/** RGBA pixels, 4 bytes per pixel, row-major (same layout as ImageData). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Number of cell rows for an import `cols` cells wide, preserving the image's
 * aspect ratio. Cells are taller than wide (cellAspect = cell height / width),
 * so fewer rows than pixels-per-column are needed.
 */
export function importRows(imgWidth: number, imgHeight: number, cols: number, cellAspect: number): number {
  const rows = Math.round((cols * imgHeight) / imgWidth / cellAspect);
  return clampSize(rows);
}

/** Inverse of importRows: columns for a given row count. */
export function importCols(imgWidth: number, imgHeight: number, rows: number, cellAspect: number): number {
  const cols = Math.round((rows * cellAspect * imgWidth) / imgHeight);
  return clampSize(cols);
}

export function clampSize(n: number): number {
  return Math.min(MAX_DOC_SIZE, Math.max(1, Math.round(n) || 1));
}

/**
 * Downscales by area averaging (box filter with fractional coverage), so every
 * source pixel contributes to the result. Colors are alpha-weighted so
 * transparent pixels don't drag the color towards black; the output alpha is
 * the average coverage.
 */
export function downsampleArea(src: Pixels, dw: number, dh: number): Pixels {
  const { width: sw, height: sh, data: s } = src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * sy;
    const y1 = y0 + sy;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * sx;
      const x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let py = Math.floor(y0); py < Math.min(sh, Math.ceil(y1)); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        for (let px = Math.floor(x0); px < Math.min(sw, Math.ceil(x1)); px++) {
          const w = (Math.min(x1, px + 1) - Math.max(x0, px)) * wy;
          const i = (py * sw + px) * 4;
          const wa = w * s[i + 3];
          r += s[i] * wa;
          g += s[i + 1] * wa;
          b += s[i + 2] * wa;
          a += wa;
          area += w;
        }
      }
      const o = (dy * dw + dx) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = area > 0 ? a / area : 0;
    }
  }
  return { width: dw, height: dh, data: out };
}

/** Perceived brightness 0..1 of an sRGB color (Rec. 709 luma weights). */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Returns a function mapping brightness 0..1 to the font's character with the
 * closest brightness. Uses a 256-step lookup table, so it's fast per pixel.
 */
export function brightnessToChar(glyphs: GlyphTable): (brightness: number) => string {
  const table: string[] = new Array(256);
  let g = 0;
  for (let level = 0; level < 256; level++) {
    const b = level / 255;
    // glyphs are sorted darkest first: advance while the next one is at least as close
    while (g + 1 < glyphs.length && Math.abs(glyphs[g + 1][1] - b) <= Math.abs(glyphs[g][1] - b)) g++;
    table[level] = glyphs[g][0];
  }
  return (brightness) => table[Math.min(255, Math.max(0, Math.round(brightness * 255)))];
}

/**
 * Builds a document from image pixels. Each pixel is first composited over
 * black (the default background). Per the channels: foreground and/or
 * background take the pixel color, and the character is picked by brightness
 * from the font's table for that weight. Unselected properties get the defaults: IMPORT_CHAR,
 * white foreground, black background.
 */
export function pixelsToDoc(
  px: Pixels,
  font: FontConfig,
  channels: ImportChannels = DEFAULT_IMPORT_CHANNELS,
  fontWeight = DEFAULT_FONT_WEIGHT,
): AsciiDoc {
  const doc = createDoc(px.width, px.height, font.id, { ...DEFAULT_CELL, ch: IMPORT_CHAR }, fontWeight);
  const charFor = channels.ch ? brightnessToChar(glyphsFor(font, fontWeight)) : null;
  const d = px.data;
  for (let i = 0; i < doc.fg.length; i++) {
    const o = i * 4;
    const alpha = d[o + 3] / 255;
    const r = Math.round(d[o] * alpha);
    const g = Math.round(d[o + 1] * alpha);
    const b = Math.round(d[o + 2] * alpha);
    const color = packRgba(r, g, b);
    if (channels.fg) doc.fg[i] = color;
    if (channels.bg) doc.bg[i] = color;
    if (charFor) doc.ch[i] = charFor(luminance(r, g, b)).charCodeAt(0);
  }
  return doc;
}
