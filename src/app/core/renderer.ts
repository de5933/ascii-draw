import { toCss } from './color';
import { AsciiDoc } from './document';
import { DEFAULT_FONT_WEIGHT, FontConfig, fontCss } from './fonts/fonts';

export interface CellSize {
  width: number;
  height: number;
}

/** Base font size (CSS px) at zoom 1. */
export const BASE_FONT_SIZE = 14;

export function fontSizeForZoom(zoom: number): number {
  return BASE_FONT_SIZE * zoom;
}

/** Measures the cell size in CSS px for a font at a font size. Rounded to whole px to avoid seams. */
export function measureCell(
  ctx: CanvasRenderingContext2D,
  font: FontConfig,
  fontSize: number,
  weight = DEFAULT_FONT_WEIGHT,
): CellSize {
  ctx.font = fontCss(font, weight, fontSize);
  const advance = ctx.measureText('M').width;
  return {
    width: Math.max(1, Math.round(advance)),
    height: Math.max(1, Math.round(fontSize * font.lineHeight)),
  };
}

/** Converts a point in canvas CSS px to a cell coordinate, or null if outside the doc. */
export function cellAt(doc: AsciiDoc, cell: CellSize, px: number, py: number): { x: number; y: number } | null {
  const x = Math.floor(px / cell.width);
  const y = Math.floor(py / cell.height);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  return { x, y };
}

const GRID_COLOR = 'rgb(128 128 128 / 0.35)';

/**
 * Draws an AsciiDoc onto a canvas. Call `configure` whenever the doc size,
 * font, zoom or device pixel ratio changes, then `renderAll` or `renderCells`.
 */
export class CanvasRenderer {
  private cell: CellSize = { width: 1, height: 1 };
  private fontSize = BASE_FONT_SIZE;
  private font!: FontConfig;
  showGrid = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get cellSize(): CellSize {
    return this.cell;
  }

  configure(doc: AsciiDoc, font: FontConfig, zoom: number, dpr = 1): void {
    this.font = font;
    this.fontSize = fontSizeForZoom(zoom);
    const ctx = this.context();
    this.cell = measureCell(ctx, font, this.fontSize, doc.fontWeight);
    const cssW = doc.width * this.cell.width;
    const cssH = doc.height * this.cell.height;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    // Resizing resets context state, so set it up afterwards.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = fontCss(font, doc.fontWeight, this.fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  renderAll(doc: AsciiDoc): void {
    const n = doc.width * doc.height;
    for (let i = 0; i < n; i++) this.drawCell(doc, i);
  }

  /** Redraws only the given cell indices. */
  renderCells(doc: AsciiDoc, indices: Iterable<number>): void {
    for (const i of indices) this.drawCell(doc, i);
  }

  private drawCell(doc: AsciiDoc, i: number): void {
    const ctx = this.context();
    const { width: w, height: h } = this.cell;
    const x = (i % doc.width) * w;
    const y = Math.floor(i / doc.width) * h;
    ctx.fillStyle = toCss(doc.bg[i]);
    ctx.fillRect(x, y, w, h);
    const code = doc.ch[i];
    if (code !== 32) {
      ctx.fillStyle = toCss(doc.fg[i]);
      ctx.fillText(String.fromCharCode(code), x + w / 2, y + h / 2);
    }
    if (this.showGrid) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  }

  private context(): CanvasRenderingContext2D {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    return ctx;
  }
}
