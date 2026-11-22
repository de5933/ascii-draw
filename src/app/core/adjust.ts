import { PackedColor, packRgba, unpackRgba } from './color';
import { AsciiDoc } from './document';
import { GlyphTable } from './fonts/fonts';
import { HistoryEntry } from './history';
import { brightnessToChar } from './import';

/** Slider values. All are -100..100 except hue, which is -180..180 degrees. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
  lightness: number;
}

export const NO_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  brightness: 0,
  contrast: 0,
  hue: 0,
  saturation: 0,
  lightness: 0,
});

/** Which cell layers an adjustment changes. */
export interface AdjustLayers {
  fg: boolean;
  bg: boolean;
  ch: boolean;
}

export const DEFAULT_ADJUST_LAYERS: Readonly<AdjustLayers> = Object.freeze({ fg: true, bg: true, ch: false });

export function isIdentity(a: Adjustments): boolean {
  return a.brightness === 0 && a.contrast === 0 && a.hue === 0 && a.saturation === 0 && a.lightness === 0;
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** Positive amounts move toward `hi`, negative toward `lo`, proportionally. */
function push(v: number, amount: number, lo: number, hi: number): number {
  return amount >= 0 ? v + (hi - v) * (amount / 100) : v + (v - lo) * (amount / 100);
}

/** Brightness then contrast on one 0..255 channel value. */
function brightnessContrast(v: number, a: Adjustments): number {
  if (a.brightness) v = push(v, a.brightness, 0, 255);
  if (a.contrast) {
    // Standard contrast curve around mid-gray; +100 is a hard threshold, -100 flat gray.
    const c = Math.min(254, a.contrast * 2.55);
    const f = (259 * (c + 255)) / (255 * (259 - c));
    v = f * (v - 128) + 128;
  }
  return v;
}

/**
 * Adjusts a gray level (0..255): brightness, contrast and lightness.
 * Hue and saturation have no effect on gray.
 */
export function adjustGray(v: number, a: Adjustments): number {
  v = clamp255(brightnessContrast(v, a));
  if (a.lightness) v = clamp255(push(v, a.lightness, 0, 255));
  return v;
}

/** Adjusts a color: brightness, contrast, then hue/saturation/lightness. Alpha is kept. */
export function adjustColor(c: PackedColor, a: Adjustments): PackedColor {
  const [r0, g0, b0, alpha] = unpackRgba(c);
  let r = clamp255(brightnessContrast(r0, a));
  let g = clamp255(brightnessContrast(g0, a));
  let b = clamp255(brightnessContrast(b0, a));
  if (a.hue || a.saturation || a.lightness) {
    let [h, s, l] = rgbToHsl(r, g, b);
    h = (((h + a.hue) % 360) + 360) % 360;
    // Raising saturation scales it (up to 4× at +100) so grays stay gray.
    if (a.saturation > 0) s = Math.min(1, s * (1 + (3 * a.saturation) / 100));
    else if (a.saturation < 0) s = push(s, a.saturation, 0, 1);
    if (a.lightness) l = push(l, a.lightness, 0, 1);
    [r, g, b] = hslToRgb(h, s, l);
  }
  return packRgba(r, g, b, alpha);
}

/** h in degrees 0..360, s and l 0..1. */
export function rgbToHsl(r: number, g: number, b: number): [h: number, s: number, l: number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [r: number, g: number, b: number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

/**
 * Character mapping for the text layer: each character's brightness in the
 * font is adjusted like a gray level and the closest-brightness character is
 * picked. Characters the font table doesn't list are left alone.
 */
export function charMapper(glyphs: GlyphTable, a: Adjustments): (code: number) => number {
  const brightness = new Map(glyphs.map(([c, b]) => [c.charCodeAt(0), b]));
  const pick = brightnessToChar(glyphs);
  const cache = new Map<number, number>();
  return (code) => {
    let out = cache.get(code);
    if (out === undefined) {
      const b = brightness.get(code);
      out = b === undefined ? code : pick(adjustGray(b * 255, a) / 255).charCodeAt(0);
      cache.set(code, out);
    }
    return out;
  };
}

/**
 * Live-preview adjustments on a document (or some of its cells): each
 * preview recomputes from the original values; cancel restores them and
 * finish returns one undo entry.
 */
export class AdjustSession {
  /** Cell indices being adjusted. */
  readonly indices: Uint32Array;
  private readonly orig: { fg: Uint32Array; bg: Uint32Array; ch: Uint16Array };

  constructor(
    private readonly doc: AsciiDoc,
    indices?: Uint32Array,
  ) {
    this.indices = indices ?? Uint32Array.from({ length: doc.ch.length }, (_, i) => i);
    const n = this.indices.length;
    this.orig = { fg: new Uint32Array(n), bg: new Uint32Array(n), ch: new Uint16Array(n) };
    this.indices.forEach((i, k) => {
      this.orig.fg[k] = doc.fg[i];
      this.orig.bg[k] = doc.bg[i];
      this.orig.ch[k] = doc.ch[i];
    });
  }

  get wholeDoc(): boolean {
    return this.indices.length === this.doc.ch.length;
  }

  /** Writes the adjusted values into the document. */
  preview(a: Adjustments, layers: AdjustLayers, glyphs: GlyphTable): void {
    const { doc, indices, orig } = this;
    const identity = isIdentity(a);
    const colorCache = new Map<number, number>();
    const color = (c: number) => {
      let out = colorCache.get(c);
      if (out === undefined) colorCache.set(c, (out = adjustColor(c, a)));
      return out;
    };
    const mapChar = layers.ch && !identity ? charMapper(glyphs, a) : null;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      doc.fg[i] = layers.fg && !identity ? color(orig.fg[k]) : orig.fg[k];
      doc.bg[i] = layers.bg && !identity ? color(orig.bg[k]) : orig.bg[k];
      doc.ch[i] = mapChar ? mapChar(orig.ch[k]) : orig.ch[k];
    }
  }

  cancel(): void {
    const { doc, indices, orig } = this;
    indices.forEach((i, k) => {
      doc.fg[i] = orig.fg[k];
      doc.bg[i] = orig.bg[k];
      doc.ch[i] = orig.ch[k];
    });
  }

  /** The undo entry for what the last preview changed, or null if nothing did. */
  finish(): HistoryEntry | null {
    const { doc, indices, orig } = this;
    const changed: number[] = [];
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (doc.fg[i] !== orig.fg[k] || doc.bg[i] !== orig.bg[k] || doc.ch[i] !== orig.ch[k]) changed.push(k);
    }
    if (changed.length === 0) return null;
    const n = changed.length;
    const e: HistoryEntry = {
      indices: new Uint32Array(n),
      before: { fg: new Uint32Array(n), bg: new Uint32Array(n), ch: new Uint16Array(n) },
      after: { fg: new Uint32Array(n), bg: new Uint32Array(n), ch: new Uint16Array(n) },
    };
    changed.forEach((k, j) => {
      const i = indices[k];
      e.indices[j] = i;
      e.before.fg[j] = orig.fg[k];
      e.before.bg[j] = orig.bg[k];
      e.before.ch[j] = orig.ch[k];
      e.after.fg[j] = doc.fg[i];
      e.after.bg[j] = doc.bg[i];
      e.after.ch[j] = doc.ch[i];
    });
    return e;
  }
}
