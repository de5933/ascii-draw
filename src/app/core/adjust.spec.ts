import { AdjustSession, NO_ADJUSTMENTS, adjustColor, adjustGray, charMapper, hslToRgb, isIdentity, rgbToHsl } from './adjust';
import { packRgba, unpackRgba } from './color';
import { createDoc, setCell } from './document';
import { FONTS, glyphsFor } from './fonts/fonts';

const adj = (a: Partial<typeof NO_ADJUSTMENTS>) => ({ ...NO_ADJUSTMENTS, ...a });
const RED = packRgba(255, 0, 0);
const GRAY = packRgba(100, 100, 100);

describe('adjust', () => {
  it('leaves colors alone with no adjustment', () => {
    expect(isIdentity(NO_ADJUSTMENTS)).toBe(true);
    for (const c of [RED, GRAY, packRgba(12, 200, 77, 128)]) expect(adjustColor(c, NO_ADJUSTMENTS)).toBe(c);
  });

  it('round-trips HSL', () => {
    const samples: [number, number, number][] = [[255, 0, 0], [12, 200, 77], [100, 100, 100], [0, 0, 0], [255, 255, 255]];
    for (const rgb of samples) {
      expect(hslToRgb(...rgbToHsl(...rgb))).toEqual([...rgb]);
    }
  });

  it('brightness and lightness push toward white or black', () => {
    expect(adjustGray(100, adj({ brightness: 100 }))).toBe(255);
    expect(adjustGray(100, adj({ brightness: -100 }))).toBe(0);
    expect(adjustGray(100, adj({ brightness: 50 }))).toBe(178);
    expect(unpackRgba(adjustColor(RED, adj({ lightness: 100 })))).toEqual([255, 255, 255, 255]);
    expect(unpackRgba(adjustColor(RED, adj({ lightness: -100 })))).toEqual([0, 0, 0, 255]);
  });

  it('contrast spreads values from mid-gray; -100 flattens them', () => {
    expect(adjustGray(100, adj({ contrast: 50 }))).toBeLessThan(100);
    expect(adjustGray(160, adj({ contrast: 50 }))).toBeGreaterThan(160);
    expect(adjustGray(10, adj({ contrast: -100 }))).toBe(128);
    expect(adjustGray(240, adj({ contrast: -100 }))).toBe(128);
  });

  it('rotates hue and changes saturation, keeping alpha', () => {
    expect(unpackRgba(adjustColor(RED, adj({ hue: 120 })))).toEqual([0, 255, 0, 255]);
    expect(unpackRgba(adjustColor(RED, adj({ hue: -120 })))).toEqual([0, 0, 255, 255]);
    expect(unpackRgba(adjustColor(packRgba(255, 0, 0, 77), adj({ saturation: -100 })))).toEqual([128, 128, 128, 77]);
    expect(adjustColor(GRAY, adj({ hue: 90, saturation: 50 }))).toBe(GRAY); // gray has no hue to boost
    const [, s0] = rgbToHsl(150, 100, 100);
    const [, s1] = rgbToHsl(...unpackRgba(adjustColor(packRgba(150, 100, 100), adj({ saturation: 50 }))).slice(0, 3) as [number, number, number]);
    expect(s1).toBeCloseTo(s0 * 2.5, 1);
  });

  it('swaps characters for brighter or darker ones in the font', () => {
    const glyphs = glyphsFor(FONTS[0], 400);
    const code = (c: string) => c.charCodeAt(0);
    const brighter = charMapper(glyphs, adj({ brightness: 100 }));
    expect(brighter(code('.'))).toBe(glyphs.at(-1)![0].charCodeAt(0));
    const darker = charMapper(glyphs, adj({ brightness: -100 }));
    expect(darker(code('@'))).toBe(code(' '));
    expect(darker(code('é'))).toBe(code('é')); // not in the table: untouched
  });

  it('previews from the original values, cancels and records one undo entry', () => {
    const doc = createDoc(3, 1, FONTS[0].id);
    setCell(doc, 0, 0, { fg: RED, ch: '@' });
    const glyphs = glyphsFor(FONTS[0], 400);
    const s = new AdjustSession(doc, Uint32Array.of(0, 1));
    s.preview(adj({ hue: 60 }), { fg: true, bg: false, ch: false }, glyphs);
    s.preview(adj({ hue: 120 }), { fg: true, bg: false, ch: false }, glyphs); // not cumulative
    expect(unpackRgba(doc.fg[0])).toEqual([0, 255, 0, 255]);
    const e = s.finish()!;
    expect([...e.indices]).toEqual([0]); // cell 1 is white: hue has no effect
    expect(e.before.fg[0]).toBe(RED);

    const t = new AdjustSession(doc);
    expect(t.wholeDoc).toBe(true);
    t.preview(adj({ brightness: -100 }), { fg: true, bg: true, ch: true }, glyphs);
    expect(doc.ch[0]).toBe(32);
    t.cancel();
    expect(String.fromCharCode(doc.ch[0])).toBe('@');
    expect(t.finish()).toBeNull();
  });
});
