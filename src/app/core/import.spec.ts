import { WHITE, packRgba } from './color';
import { getCell } from './document';
import { FONTS, glyphsFor } from './fonts/fonts';
import { Pixels, brightnessToChar, downsampleArea, importCols, importRows, luminance, pixelsToDoc } from './import';

function solid(w: number, h: number, rgba: number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

function px(p: Pixels, x: number, y: number): number[] {
  const o = (y * p.width + x) * 4;
  return [...p.data.slice(o, o + 4)];
}

describe('import sizing', () => {
  it('compensates for tall cells', () => {
    // 1000x500 image, 100 cols, cells twice as tall as wide -> 25 rows
    expect(importRows(1000, 500, 100, 2)).toBe(25);
    expect(importCols(1000, 500, 25, 2)).toBe(100);
  });

  it('never returns less than 1 or more than the max', () => {
    expect(importRows(10000, 1, 100, 2)).toBe(1);
    expect(importRows(1, 10000, 100, 2)).toBe(2000);
  });
});

describe('downsampleArea', () => {
  it('averages 2x2 blocks', () => {
    const src: Pixels = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]),
    };
    expect(px(downsampleArea(src, 1, 1), 0, 0)).toEqual([128, 0, 0, 255]);
  });

  it('handles non-integer ratios using fractional coverage', () => {
    // 3 px wide: white, black, white -> 2 px: each covers 1.5 source pixels
    const src: Pixels = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const out = downsampleArea(src, 2, 1);
    expect(px(out, 0, 0)).toEqual([170, 170, 170, 255]); // (1*255 + 0.5*0) / 1.5
    expect(px(out, 1, 0)).toEqual([170, 170, 170, 255]);
  });

  it('keeps solid colors exact', () => {
    const out = downsampleArea(solid(37, 23, [10, 200, 30, 255]), 7, 5);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) expect(px(out, x, y)).toEqual([10, 200, 30, 255]);
  });

  it('ignores the color of fully transparent pixels', () => {
    const src: Pixels = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 0]),
    };
    expect(px(downsampleArea(src, 1, 1), 0, 0)).toEqual([0, 0, 255, 128]);
  });
});

describe('brightness to character', () => {
  const font = FONTS[0];

  it('maps black to space and white to the brightest glyph', () => {
    const charFor = brightnessToChar(glyphsFor(font, 400));
    expect(charFor(0)).toBe(' ');
    expect(charFor(1)).toBe(glyphsFor(font, 400).at(-1)![0]);
  });

  it('picks the glyph with the closest brightness', () => {
    const charFor = brightnessToChar(glyphsFor(font, 400));
    for (const b of [0.1, 0.33, 0.5, 0.77]) {
      const chosen = glyphsFor(font, 400).find((g) => g[0] === charFor(b))![1];
      const best = Math.min(...glyphsFor(font, 400).map((g) => Math.abs(g[1] - b)));
      expect(Math.abs(chosen - b)).toBeCloseTo(best, 2);
    }
  });

  it('is monotonic: brighter input never gives a darker glyph', () => {
    const charFor = brightnessToChar(glyphsFor(font, 400));
    const level = (c: string) => glyphsFor(font, 400).find((g) => g[0] === c)![1];
    let prev = 0;
    for (let b = 0; b <= 1; b += 0.01) {
      expect(level(charFor(b))).toBeGreaterThanOrEqual(prev);
      prev = level(charFor(b));
    }
  });

  it('weights green most, blue least', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1);
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });
});

describe('pixelsToDoc', () => {
  const font = FONTS[0];
  // orange opaque, orange transparent, white, black
  const p: Pixels = {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 0, 255, 255, 255, 255, 0, 0, 0, 255]),
  };
  const BLACK = packRgba(0, 0, 0);
  const ORANGE = packRgba(200, 100, 50);

  it('defaults to foreground only: colored @ cells on black, alpha composited over black', () => {
    const doc = pixelsToDoc(p, font);
    expect(getCell(doc, 0, 0)).toEqual({ fg: ORANGE, bg: BLACK, ch: '@' });
    expect(getCell(doc, 1, 0).fg).toBe(BLACK);
  });

  it('text only: characters by brightness, white on black', () => {
    const doc = pixelsToDoc(p, font, { ch: true, fg: false, bg: false });
    expect(getCell(doc, 2, 0)).toEqual({ fg: WHITE, bg: BLACK, ch: glyphsFor(font, 400).at(-1)![0] });
    expect(getCell(doc, 3, 0).ch).toBe(' ');
    expect(getCell(doc, 1, 0).ch).toBe(' '); // transparent counts as black
    expect(getCell(doc, 0, 0).ch).toBe(brightnessToChar(glyphsFor(font, 400))(luminance(200, 100, 50)));
  });

  it('background only: image colors behind white @', () => {
    const doc = pixelsToDoc(p, font, { ch: false, fg: false, bg: true });
    expect(getCell(doc, 0, 0)).toEqual({ fg: WHITE, bg: ORANGE, ch: '@' });
  });

  it('all three', () => {
    const doc = pixelsToDoc(p, font, { ch: true, fg: true, bg: true });
    expect(getCell(doc, 0, 0).fg).toBe(ORANGE);
    expect(getCell(doc, 0, 0).bg).toBe(ORANGE);
    expect(getCell(doc, 0, 0).ch).not.toBe('@');
    expect(doc.fontId).toBe(font.id);
  });

  it('uses the brightness table for the requested weight', () => {
    // a mid-gray pixel can map to a different character at Thin vs Extra Bold
    const gray: Pixels = { width: 1, height: 1, data: new Uint8ClampedArray([110, 110, 110, 255]) };
    const thin = pixelsToDoc(gray, font, { ch: true, fg: false, bg: false }, 100);
    const bold = pixelsToDoc(gray, font, { ch: true, fg: false, bg: false }, 800);
    expect(thin.fontWeight).toBe(100);
    expect(bold.fontWeight).toBe(800);
    expect(getCell(thin, 0, 0).ch).toBe(brightnessToChar(glyphsFor(font, 100))(luminance(110, 110, 110)));
    expect(getCell(bold, 0, 0).ch).toBe(brightnessToChar(glyphsFor(font, 800))(luminance(110, 110, 110)));
  });
});
