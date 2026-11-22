import { WHITE, toCss } from './color';
import { AsciiDoc } from './document';
import { FontConfig, fontCss } from './fonts/fonts';
import { BASE_FONT_SIZE, CellSize, measureCell } from './renderer';

/** Which cell properties an export includes. */
export interface ExportChannels {
  ch: boolean;
  fg: boolean;
  bg: boolean;
}

export const DEFAULT_EXPORT_CHANNELS: Readonly<ExportChannels> = Object.freeze({ ch: true, fg: true, bg: true });

export type ExportFormat = 'png' | 'txt';

export const EXPORT_SCALES = [1, 2, 3, 4] as const;
export const DEFAULT_EXPORT_SCALE = 2;

/** Browsers refuse canvases much bigger than this. */
export const MAX_EXPORT_SIDE = 16384;
export const MAX_EXPORT_AREA = 100_000_000;

/** Text only → plain text file; anything else → PNG. Null if nothing is included. */
export function exportFormat(c: ExportChannels): ExportFormat | null {
  if (!c.ch && !c.fg && !c.bg) return null;
  return c.ch && !c.fg && !c.bg ? 'txt' : 'png';
}

/** The document's characters, one line per row, every row full width. */
export function docToText(doc: AsciiDoc): string {
  const lines: string[] = [];
  for (let y = 0; y < doc.height; y++) {
    const row = doc.ch.subarray(y * doc.width, (y + 1) * doc.width);
    lines.push(String.fromCharCode(...row));
  }
  return lines.join('\n') + '\n';
}

export function exportFontSize(scale: number): number {
  return BASE_FONT_SIZE * scale;
}

export function pngSize(doc: AsciiDoc, cell: CellSize): { width: number; height: number } {
  return { width: doc.width * cell.width, height: doc.height * cell.height };
}

export function pngSizeOk(size: { width: number; height: number }): boolean {
  return size.width <= MAX_EXPORT_SIDE && size.height <= MAX_EXPORT_SIDE && size.width * size.height <= MAX_EXPORT_AREA;
}

/** Cell size for an export at a scale (the font must already be loaded). */
export function exportCell(ctx: CanvasRenderingContext2D, doc: AsciiDoc, font: FontConfig, scale: number): CellSize {
  return measureCell(ctx, font, exportFontSize(scale), doc.fontWeight);
}

/**
 * Draws the document for a PNG export onto a canvas already sized
 * pngSize(doc, cell). Excluded properties: no background → transparent;
 * no foreground → text in white; no text → each cell's foreground color
 * fills the cell as a solid block.
 */
export function drawExport(
  ctx: CanvasRenderingContext2D,
  doc: AsciiDoc,
  font: FontConfig,
  cell: CellSize,
  scale: number,
  c: ExportChannels,
): void {
  const { width: w, height: h } = cell;
  ctx.clearRect(0, 0, doc.width * w, doc.height * h);
  ctx.font = fontCss(font, doc.fontWeight, exportFontSize(scale));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const white = toCss(WHITE);
  for (let i = 0; i < doc.ch.length; i++) {
    const x = (i % doc.width) * w;
    const y = Math.floor(i / doc.width) * h;
    if (c.bg) {
      ctx.fillStyle = toCss(doc.bg[i]);
      ctx.fillRect(x, y, w, h);
    }
    if (c.ch) {
      const code = doc.ch[i];
      if (code === 32) continue;
      ctx.fillStyle = c.fg ? toCss(doc.fg[i]) : white;
      ctx.fillText(String.fromCharCode(code), x + w / 2, y + h / 2);
    } else if (c.fg) {
      ctx.fillStyle = toCss(doc.fg[i]);
      ctx.fillRect(x, y, w, h);
    }
  }
}

/** Short description of what the export will produce, for the dialog. */
export function describeExport(c: ExportChannels): string {
  const format = exportFormat(c);
  if (!format) return 'Choose at least one.';
  if (format === 'txt') return 'Plain text file, one line per row.';
  const parts: string[] = [];
  if (c.ch) parts.push(c.fg ? 'characters in their colors' : 'characters in white');
  else if (c.fg) parts.push(c.bg ? 'solid foreground-color cells (they cover the background)' : 'solid foreground-color cells');
  parts.push(c.bg ? 'on their background colors' : 'on a transparent background');
  return `PNG image: ${parts.join(' ')}.`;
}
