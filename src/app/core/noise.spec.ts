import { AdjustSession } from './adjust';
import { WHITE, packRgba, unpackRgba } from './color';
import { createDoc } from './document';
import { FONTS, glyphsFor } from './fonts/fonts';
import { DEFAULT_NOISE, charNoiser, hash01, noiseColor } from './noise';

const GRAY = packRgba(128, 128, 128, 200);
const s = (o: Partial<typeof DEFAULT_NOISE>) => ({ ...DEFAULT_NOISE, ...o });

describe('noise', () => {
  it('hashes deterministically into 0..1', () => {
    const v = Array.from({ length: 1000 }, (_, i) => hash01(7, i, 0));
    expect(v.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(hash01(7, 3, 0)).toBe(hash01(7, 3, 0));
    expect(hash01(7, 3, 0)).not.toBe(hash01(8, 3, 0));
    const mean = v.reduce((a, b) => a + b) / v.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('does nothing at zero amount or coverage', () => {
    expect(noiseColor(GRAY, 5, 'fg', s({ amount: 0 }))).toBe(GRAY);
    expect(noiseColor(GRAY, 5, 'fg', s({ coverage: 0 }))).toBe(GRAY);
  });

  it('varies colors per cell within the amount, keeping alpha', () => {
    const out = Array.from({ length: 200 }, (_, i) => unpackRgba(noiseColor(GRAY, i, 'fg', s({ amount: 20 }))));
    expect(out.every(([r, g, b, a]) => a === 200 && [r, g, b].every((v) => Math.abs(v - 128) <= 51))).toBe(true);
    expect(new Set(out.map((c) => c[0])).size).toBeGreaterThan(20);
    expect(out.some(([r, g]) => r !== g)).toBe(true); // color specks
  });

  it('monochrome moves all channels together', () => {
    for (let i = 0; i < 50; i++) {
      const [r, g, b] = unpackRgba(noiseColor(GRAY, i, 'bg', s({ amount: 50, monochrome: true })));
      expect(r === g && g === b).toBe(true);
    }
  });

  it('coverage limits the share of cells touched', () => {
    let changed = 0;
    for (let i = 0; i < 2000; i++) if (noiseColor(GRAY, i, 'fg', s({ amount: 100, coverage: 25 })) !== GRAY) changed++;
    expect(changed / 2000).toBeGreaterThan(0.18);
    expect(changed / 2000).toBeLessThan(0.3);
  });

  it('swaps characters for nearby brightness, leaving unknown ones', () => {
    const glyphs = glyphsFor(FONTS[0], 400);
    const noisy = charNoiser(glyphs, s({ amount: 30 }));
    const at = '@'.charCodeAt(0);
    const out = Array.from({ length: 100 }, (_, i) => noisy(at, i));
    expect(new Set(out).size).toBeGreaterThan(3);
    expect(noisy('é'.charCodeAt(0), 1)).toBe('é'.charCodeAt(0));
  });

  it('previews through the adjust session and only touches chosen layers', () => {
    const doc = createDoc(10, 10, FONTS[0].id);
    const session = new AdjustSession(doc);
    session.previewNoise(s({ amount: 50 }), { fg: false, bg: true, ch: false }, glyphsFor(FONTS[0], 400));
    expect(doc.fg.every((c) => c === WHITE)).toBe(true);
    expect(doc.bg.some((c) => c !== packRgba(0, 0, 0))).toBe(true);
    session.cancel();
    expect(doc.bg.every((c) => c === packRgba(0, 0, 0))).toBe(true);
  });
});
