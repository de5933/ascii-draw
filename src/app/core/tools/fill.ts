import { ChannelSet } from '../channels';
import { unpackRgba } from '../color';
import { AsciiDoc, Cell, cellIndex, inBounds } from '../document';
import { GlyphTable } from '../fonts/fonts';

/** How the paint bucket decides which cells belong to the clicked cell's region. */
export interface FillSettings {
  /** Channels a cell must match (the clicked cell's) to be filled. */
  match: ChannelSet;
  /** 0 = exact; 100 = anything. Colors by RGB distance, characters by brightness. */
  tolerance: number;
  /** Only cells connected to the clicked one (edge to edge); otherwise every matching cell. */
  contiguous: boolean;
}

export const DEFAULT_FILL: Readonly<FillSettings> = Object.freeze({
  match: Object.freeze({ fg: true, bg: true, ch: true }),
  tolerance: 0,
  contiguous: true,
});

const MAX_RGB_DISTANCE = Math.sqrt(3 * 255 * 255);

/** Whether two colors are within a tolerance (0–100) of each other. */
export function colorsClose(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  if (tolerance <= 0) return false;
  const [r1, g1, b1] = unpackRgba(a);
  const [r2, g2, b2] = unpackRgba(b);
  const d = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  return d <= (tolerance / 100) * MAX_RGB_DISTANCE;
}

/**
 * The cells the bucket would fill from (x, y), as a mask over the document
 * (1 = in the region). Null if (x, y) is outside the document.
 */
export function fillRegion(doc: AsciiDoc, x: number, y: number, s: FillSettings, glyphs: GlyphTable): Uint8Array | null {
  if (!inBounds(doc, x, y)) return null;
  const seed = cellIndex(doc, x, y);
  const n = doc.width * doc.height;
  const { fg, bg, ch } = doc;
  const tol = s.tolerance;
  const brightness = new Map(glyphs.map(([c, b]) => [c.charCodeAt(0), b]));
  const seedFg = fg[seed];
  const seedBg = bg[seed];
  const seedCh = ch[seed];
  const seedB = brightness.get(seedCh);

  const charMatches = (c: number): boolean => {
    if (c === seedCh) return true;
    if (tol <= 0 || seedB === undefined) return false;
    const b = brightness.get(c);
    return b !== undefined && Math.abs(b - seedB) <= tol / 100;
  };
  const matches = (i: number): boolean =>
    (!s.match.fg || colorsClose(fg[i], seedFg, tol)) &&
    (!s.match.bg || colorsClose(bg[i], seedBg, tol)) &&
    (!s.match.ch || charMatches(ch[i]));

  const mask = new Uint8Array(n);
  if (!s.contiguous) {
    for (let i = 0; i < n; i++) if (matches(i)) mask[i] = 1;
    return mask;
  }

  // Flood from the seed through edge-adjacent matching cells.
  const seen = new Uint8Array(n);
  const stack = [seed];
  seen[seed] = 1;
  const w = doc.width;
  const visit = (j: number) => {
    if (!seen[j]) {
      seen[j] = 1;
      stack.push(j);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    if (!matches(i)) continue;
    mask[i] = 1;
    const cx = i % w;
    if (cx > 0) visit(i - 1);
    if (cx < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < n) visit(i + w);
  }
  return mask;
}

/**
 * Paint bucket: writes `values` into every cell of the region from (x, y).
 * `touch(i)` is called before a cell is modified. Returns the cells written.
 */
export function floodFill(
  doc: AsciiDoc,
  x: number,
  y: number,
  values: Partial<Cell>,
  s: FillSettings,
  glyphs: GlyphTable,
  touch: (i: number) => void = () => {},
): number[] {
  if (values.fg === undefined && values.bg === undefined && values.ch === undefined) return [];
  const mask = fillRegion(doc, x, y, s, glyphs);
  if (!mask) return [];
  const code = values.ch?.charCodeAt(0);
  const written: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    touch(i);
    if (values.fg !== undefined) doc.fg[i] = values.fg;
    if (values.bg !== undefined) doc.bg[i] = values.bg;
    if (code !== undefined) doc.ch[i] = code;
    written.push(i);
  }
  return written;
}
