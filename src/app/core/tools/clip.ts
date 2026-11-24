import { packRgba, unpackRgba } from '../color';
import { AsciiDoc, DEFAULT_CELL } from '../document';
import { GlyphTable } from '../fonts/fonts';
import { brightnessToChar, luminance } from '../import';
import { sanitizeText } from './text';

/** The three cell layers. */
export interface Layers {
  fg: boolean;
  bg: boolean;
  ch: boolean;
}
export type Layer = keyof Layers;
export const LAYERS: readonly Layer[] = ['fg', 'bg', 'ch'];
export const ALL_LAYERS: Readonly<Layers> = Object.freeze({ fg: true, bg: true, ch: true });

/** A rectangle of cells. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellPos {
  x: number;
  y: number;
}

/** Copied cells: a rectangle holding some of the layers. */
export interface CellClip {
  width: number;
  height: number;
  fg?: Uint32Array;
  bg?: Uint32Array;
  ch?: Uint16Array;
  /** The characters as plain text rows, for other apps ('' without the text layer). */
  text: string;
}

/** Rectangle spanning two cells (inclusive, either order), clipped to the document. Null if it misses it. */
export function rectFromCells(a: CellPos, b: CellPos, doc: AsciiDoc): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(doc.width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(doc.height - 1, Math.max(a.y, b.y));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Moves `focus` so the rectangle from `anchor` to it looks square on screen,
 * given the cell size (cells are usually taller than wide). The larger side wins.
 */
export function squareFocus(anchor: CellPos, focus: CellPos, cell: { width: number; height: number }): CellPos {
  const dx = focus.x - anchor.x;
  const dy = focus.y - anchor.y;
  const side = Math.max((Math.abs(dx) + 1) * cell.width, (Math.abs(dy) + 1) * cell.height);
  const w = Math.max(1, Math.round(side / cell.width));
  const h = Math.max(1, Math.round(side / cell.height));
  return { x: anchor.x + (dx < 0 ? -1 : 1) * (w - 1), y: anchor.y + (dy < 0 ? -1 : 1) * (h - 1) };
}

/** Document cell indices inside a rectangle, row by row. */
export function rectIndices(doc: AsciiDoc, r: Rect): Uint32Array {
  const out = new Uint32Array(r.width * r.height);
  let k = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) out[k++] = y * doc.width + x;
  return out;
}

/** Characters of a rectangle as text rows (full width, no trailing newline). */
export function rectText(doc: AsciiDoc, r: Rect): string {
  const rows: string[] = [];
  for (let y = r.y; y < r.y + r.height; y++) {
    const start = y * doc.width + r.x;
    rows.push(String.fromCharCode(...doc.ch.subarray(start, start + r.width)));
  }
  return rows.join('\n');
}

export function clipLayers(clip: CellClip): Layer[] {
  return LAYERS.filter((l) => clip[l] !== undefined);
}

/** Copies the chosen layers of a rectangle. Null if no layer is chosen. */
export function copyRect(doc: AsciiDoc, r: Rect, layers: Layers): CellClip | null {
  if (!layers.fg && !layers.bg && !layers.ch) return null;
  const idx = rectIndices(doc, r);
  const pick = <T extends Uint32Array | Uint16Array>(src: T, Ctor: new (n: number) => T): T => {
    const out = new Ctor(idx.length);
    idx.forEach((i, k) => (out[k] = src[i]));
    return out;
  };
  return {
    width: r.width,
    height: r.height,
    fg: layers.fg ? pick(doc.fg, Uint32Array) : undefined,
    bg: layers.bg ? pick(doc.bg, Uint32Array) : undefined,
    ch: layers.ch ? pick(doc.ch, Uint16Array) : undefined,
    text: layers.ch ? rectText(doc, r) : '',
  };
}

/** A text-only clip from plain text: one row per line, short lines padded with spaces. */
export function clipFromText(text: string): CellClip {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => sanitizeText(l));
  const width = Math.max(1, ...lines.map((l) => l.length));
  const ch = new Uint16Array(width * lines.length).fill(32);
  lines.forEach((l, y) => {
    for (let x = 0; x < l.length; x++) ch[y * width + x] = l.charCodeAt(x);
  });
  return { width, height: lines.length, ch, text };
}

/**
 * Which layers a paste writes by default: a clip's own layers. (A clip with
 * one layer may be pasted into any layers; see pasteClip.)
 */
export function defaultPasteTargets(clip: CellClip): Layers {
  return { fg: clip.fg !== undefined, bg: clip.bg !== undefined, ch: clip.ch !== undefined };
}

/** Whether a paste can write a layer: a single-layer clip goes anywhere; otherwise only its own layers. */
export function canPasteInto(clip: CellClip, layer: Layer): boolean {
  return clipLayers(clip).length === 1 || clip[layer] !== undefined;
}

/**
 * Pastes a clip with its top-left at (x, y), clipped to the document.
 * Each target layer takes the clip's same layer, or the clip's only layer:
 * color into text picks the character closest in brightness (in the given
 * font table); text into color becomes the gray of the character's brightness.
 * `touch(i)` is called before a cell is modified. Returns the cells written.
 */
export function pasteClip(
  doc: AsciiDoc,
  clip: CellClip,
  x0: number,
  y0: number,
  targets: Layers,
  glyphs: GlyphTable,
  touch: (i: number) => void = () => {},
): number[] {
  const layers = clipLayers(clip);
  const sourceFor = (t: Layer): Layer | null =>
    clip[t] !== undefined ? t : layers.length === 1 ? layers[0] : null;
  const plan = LAYERS.filter((t) => targets[t]).map((t) => [t, sourceFor(t)] as const).filter(([, s]) => s !== null);
  if (plan.length === 0) return [];

  const charFor = brightnessToChar(glyphs);
  const glyphBrightness = new Map(glyphs.map(([c, b]) => [c.charCodeAt(0), b]));
  const colorToChar = (c: number) => {
    const [r, g, b] = unpackRgba(c);
    return charFor(luminance(r, g, b)).charCodeAt(0);
  };
  const charToColor = (code: number) => {
    const b = glyphBrightness.get(code);
    if (b === undefined) return undefined; // not in the font table: leave the cell alone
    const v = Math.round(b * 255);
    return packRgba(v, v, v);
  };

  const written: number[] = [];
  for (let cy = 0; cy < clip.height; cy++) {
    const y = y0 + cy;
    if (y < 0 || y >= doc.height) continue;
    for (let cx = 0; cx < clip.width; cx++) {
      const x = x0 + cx;
      if (x < 0 || x >= doc.width) continue;
      const i = y * doc.width + x;
      const k = cy * clip.width + cx;
      touch(i);
      for (const [target, source] of plan) {
        const v = clip[source!]![k];
        if (target === 'ch') doc.ch[i] = source === 'ch' ? v : colorToChar(v);
        else if (source === 'ch') {
          const c = charToColor(v);
          if (c !== undefined) doc[target][i] = c;
        } else doc[target][i] = v;
      }
      written.push(i);
    }
  }
  return written;
}

/** Resets the chosen layers of a rectangle to the blank cell. Returns the cells written. */
export function clearRect(doc: AsciiDoc, r: Rect, layers: Layers, touch: (i: number) => void = () => {}): number[] {
  const idx = [...rectIndices(doc, r)];
  const space = DEFAULT_CELL.ch.charCodeAt(0);
  for (const i of idx) {
    touch(i);
    if (layers.fg) doc.fg[i] = DEFAULT_CELL.fg;
    if (layers.bg) doc.bg[i] = DEFAULT_CELL.bg;
    if (layers.ch) doc.ch[i] = space;
  }
  return idx;
}

export function describeClip(clip: CellClip): string {
  const names: Record<Layer, string> = { fg: 'Fg', bg: 'Bg', ch: 'Txt' };
  const l = clipLayers(clip).map((k) => names[k]);
  return `${clip.width} × ${clip.height}: ${l.length === 3 ? 'all channels' : l.join(' + ')}`;
}
