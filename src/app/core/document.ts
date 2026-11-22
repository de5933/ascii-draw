import { BLACK, PackedColor, WHITE } from './color';
import { DEFAULT_FONT_WEIGHT } from './fonts/fonts';

/**
 * An ASCII-art document: a grid of cells, each with a foreground color,
 * background color and character. The whole document uses one font face and weight.
 * Cells are stored row-major in parallel typed arrays.
 */
export interface AsciiDoc {
  readonly width: number;
  readonly height: number;
  fontId: string;
  /** CSS font weight (100–900), one of the font's available weights. */
  fontWeight: number;
  readonly fg: Uint32Array;
  readonly bg: Uint32Array;
  readonly ch: Uint16Array;
}

export interface Cell {
  fg: PackedColor;
  bg: PackedColor;
  ch: string;
}

export const DEFAULT_CELL: Readonly<Cell> = Object.freeze({ fg: WHITE, bg: BLACK, ch: ' ' });

export const MAX_DOC_SIZE = 2000;

export function createDoc(
  width: number,
  height: number,
  fontId: string,
  fill: Cell = DEFAULT_CELL,
  fontWeight = DEFAULT_FONT_WEIGHT,
): AsciiDoc {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid document size ${width}x${height}`);
  }
  if (width > MAX_DOC_SIZE || height > MAX_DOC_SIZE) {
    throw new Error(`Document size ${width}x${height} exceeds ${MAX_DOC_SIZE}x${MAX_DOC_SIZE}`);
  }
  const n = width * height;
  return {
    width,
    height,
    fontId,
    fontWeight,
    fg: new Uint32Array(n).fill(fill.fg),
    bg: new Uint32Array(n).fill(fill.bg),
    ch: new Uint16Array(n).fill(fill.ch.charCodeAt(0)),
  };
}

export function inBounds(doc: AsciiDoc, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

export function cellIndex(doc: AsciiDoc, x: number, y: number): number {
  return y * doc.width + x;
}

export function getCell(doc: AsciiDoc, x: number, y: number): Cell {
  const i = cellIndex(doc, x, y);
  return { fg: doc.fg[i], bg: doc.bg[i], ch: String.fromCharCode(doc.ch[i]) };
}

/**
 * Writes the given properties of a cell; omitted properties are left alone.
 * Returns true if anything actually changed. Out-of-bounds writes are ignored.
 */
export function setCell(doc: AsciiDoc, x: number, y: number, cell: Partial<Cell>): boolean {
  if (!inBounds(doc, x, y)) return false;
  const i = cellIndex(doc, x, y);
  let changed = false;
  if (cell.fg !== undefined && doc.fg[i] !== cell.fg) {
    doc.fg[i] = cell.fg;
    changed = true;
  }
  if (cell.bg !== undefined && doc.bg[i] !== cell.bg) {
    doc.bg[i] = cell.bg;
    changed = true;
  }
  if (cell.ch !== undefined) {
    const code = cell.ch.charCodeAt(0);
    if (doc.ch[i] !== code) {
      doc.ch[i] = code;
      changed = true;
    }
  }
  return changed;
}

export function cloneDoc(doc: AsciiDoc): AsciiDoc {
  return {
    width: doc.width,
    height: doc.height,
    fontId: doc.fontId,
    fontWeight: doc.fontWeight,
    fg: doc.fg.slice(),
    bg: doc.bg.slice(),
    ch: doc.ch.slice(),
  };
}
