import { PackedColor, packRgba, unpackRgba } from './color';
import { GlyphTable } from './fonts/fonts';
import { brightnessToChar } from './import';

export interface NoiseSettings {
  /** Strength, 0..100: at 100 a channel can move by up to the full range. */
  amount: number;
  /** Share of cells that get noise, 0..100. */
  coverage: number;
  /** Same offset for R, G and B (lighter/darker only) instead of per channel. */
  monochrome: boolean;
  /** Picks the random pattern; the same seed always gives the same noise. */
  seed: number;
}

export const DEFAULT_NOISE: Readonly<NoiseSettings> = Object.freeze({ amount: 25, coverage: 100, monochrome: false, seed: 1 });

export function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0 || 1;
}

/** Integer hash → uniform 0..1. Deterministic per (seed, cell, stream). */
export function hash01(seed: number, cell: number, stream: number): number {
  let h = (seed ^ Math.imul(cell + 1, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Noise in -1..1, peaked around 0 (sum of two uniforms). */
function noise(seed: number, cell: number, stream: number): number {
  return hash01(seed, cell, stream) + hash01(seed, cell, stream + 101) - 1;
}

/** Streams keep layers and channels independent of each other. */
const STREAM = { gate: 0, fg: 10, bg: 20, ch: 30 } as const;

function covered(s: NoiseSettings, cell: number): boolean {
  return s.coverage >= 100 || hash01(s.seed, cell, STREAM.gate) < s.coverage / 100;
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** Adds noise to a color for one cell (alpha is kept). `layer` picks an independent pattern. */
export function noiseColor(c: PackedColor, cell: number, layer: 'fg' | 'bg', s: NoiseSettings): PackedColor {
  if (s.amount <= 0 || !covered(s, cell)) return c;
  const [r, g, b, a] = unpackRgba(c);
  const scale = (s.amount / 100) * 255;
  const base = STREAM[layer];
  const nr = noise(s.seed, cell, base) * scale;
  const ng = s.monochrome ? nr : noise(s.seed, cell, base + 1) * scale;
  const nb = s.monochrome ? nr : noise(s.seed, cell, base + 2) * scale;
  return packRgba(clamp255(r + nr), clamp255(g + ng), clamp255(b + nb), a);
}

/**
 * Character noise: shifts each character's brightness in the font by a random
 * amount and picks the closest character. Characters not in the font table
 * are left alone.
 */
export function charNoiser(glyphs: GlyphTable, s: NoiseSettings): (code: number, cell: number) => number {
  const brightness = new Map(glyphs.map(([c, b]) => [c.charCodeAt(0), b]));
  const pick = brightnessToChar(glyphs);
  return (code, cell) => {
    if (s.amount <= 0 || !covered(s, cell)) return code;
    const b = brightness.get(code);
    if (b === undefined) return code;
    return pick(b + noise(s.seed, cell, STREAM.ch) * (s.amount / 100)).charCodeAt(0);
  };
}
