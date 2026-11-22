import { FONTS, fontCss, getFont, glyphsFor, nearestWeight } from './fonts';

describe('font configs', () => {
  const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

  for (const font of FONTS) {
    it(`${font.id} has a brightness table per weight covering printable ASCII, darkest first`, () => {
      expect(font.weights).toContain(400);
      for (const w of font.weights) {
        const glyphs = font.glyphsByWeight[w];
        expect(glyphs.map((g) => g[0]).sort()).toEqual([...printable].sort());
        const values = glyphs.map((g) => g[1]);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(glyphs[0]).toEqual([' ', 0]);
        expect(values.at(-1)).toBe(1);
      }
    });
  }

  it('lists the weights each bundled font ships', () => {
    expect(getFont('jetbrains-mono').weights).toEqual([100, 200, 300, 400, 500, 600, 700, 800]);
    expect(getFont('ibm-plex-mono').weights).toEqual([100, 200, 300, 400, 500, 600, 700]);
    expect(getFont('fira-mono').weights).toEqual([400, 500, 700]);
  });

  it('falls back to the nearest available weight', () => {
    const fira = getFont('fira-mono');
    expect(nearestWeight(fira, 100)).toBe(400);
    expect(nearestWeight(fira, 600)).toBe(500); // tie goes lighter
    expect(nearestWeight(fira, 800)).toBe(700);
    expect(glyphsFor(fira, 800)).toBe(fira.glyphsByWeight[700]);
  });

  it('builds a canvas font string', () => {
    expect(fontCss(FONTS[0], 700, 14)).toBe('700 14px "JetBrains Mono", monospace');
  });
});
