import { BLACK, WHITE, packRgba } from '../color';
import { createDoc, getCell, setCell } from '../document';
import { getFont, glyphsFor } from '../fonts/fonts';
import { DEFAULT_FILL, FillSettings, colorsClose, fillRegion, floodFill } from './fill';

const RED = packRgba(255, 0, 0);
const DARK_RED = packRgba(240, 0, 0);
const BLUE = packRgba(0, 0, 255);
const jb = glyphsFor(getFont('jetbrains-mono'), 400);
const settings = (o: Partial<FillSettings> = {}): FillSettings => ({ ...DEFAULT_FILL, ...o });

/** 5×3 blank doc split by a vertical wall of '#' at x = 2. */
function walled() {
  const doc = createDoc(5, 3, 'jetbrains-mono');
  for (let y = 0; y < 3; y++) setCell(doc, 2, y, { ch: '#' });
  return doc;
}

const cells = (mask: Uint8Array | null) => [...(mask ?? [])].flatMap((v, i) => (v ? [i] : []));

describe('paint bucket', () => {
  it('fills the connected region and stops at a wall', () => {
    const doc = walled();
    const touched: number[] = [];
    const written = floodFill(doc, 0, 0, { fg: RED, ch: '.' }, settings(), jb, (i) => touched.push(i));
    expect(written).toEqual([0, 1, 5, 6, 10, 11]);
    expect(touched).toEqual(written);
    expect(getCell(doc, 1, 2)).toEqual({ fg: RED, bg: BLACK, ch: '.' });
    expect(getCell(doc, 2, 0).ch).toBe('#');
    expect(getCell(doc, 3, 0)).toEqual({ fg: WHITE, bg: BLACK, ch: ' ' });
  });

  it('fills every matching cell when not contiguous', () => {
    const doc = walled();
    expect(cells(fillRegion(doc, 0, 0, settings({ contiguous: false }), jb))).toEqual([0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14]);
  });

  it('only compares the chosen match channels', () => {
    const doc = walled();
    // Matching only the background: the wall has the same black bg, so everything is one region.
    expect(cells(fillRegion(doc, 0, 0, settings({ match: { fg: false, bg: true, ch: false } }), jb))).toHaveLength(15);
  });

  it('is edge-connected only (no diagonal leaks)', () => {
    const doc = createDoc(2, 2, 'jetbrains-mono');
    setCell(doc, 1, 0, { ch: '#' });
    setCell(doc, 0, 1, { ch: '#' });
    expect(cells(fillRegion(doc, 0, 0, settings(), jb))).toEqual([0]);
  });

  it('accepts nearby colors and characters with tolerance', () => {
    expect(colorsClose(RED, DARK_RED, 0)).toBe(false);
    expect(colorsClose(RED, DARK_RED, 5)).toBe(true);
    expect(colorsClose(RED, BLUE, 50)).toBe(false);
    expect(colorsClose(RED, BLUE, 100)).toBe(true);

    const doc = createDoc(3, 1, 'jetbrains-mono');
    setCell(doc, 0, 0, { fg: RED });
    setCell(doc, 1, 0, { fg: DARK_RED });
    setCell(doc, 2, 0, { fg: BLUE });
    const fgOnly = { fg: true, bg: false, ch: false };
    expect(cells(fillRegion(doc, 0, 0, settings({ match: fgOnly }), jb))).toEqual([0]);
    expect(cells(fillRegion(doc, 0, 0, settings({ match: fgOnly, tolerance: 10 }), jb))).toEqual([0, 1]);

    const text = createDoc(3, 1, 'jetbrains-mono');
    [...'.,@'].forEach((c, x) => setCell(text, x, 0, { ch: c }));
    const chOnly = { fg: false, bg: false, ch: true };
    expect(cells(fillRegion(text, 0, 0, settings({ match: chOnly }), jb))).toEqual([0]);
    expect(cells(fillRegion(text, 0, 0, settings({ match: chOnly, tolerance: 20 }), jb))).toEqual([0, 1]);
  });

  it('does nothing outside the document or with no values', () => {
    const doc = walled();
    expect(floodFill(doc, 9, 0, { fg: RED }, settings(), jb)).toEqual([]);
    expect(floodFill(doc, 0, 0, {}, settings(), jb)).toEqual([]);
  });

  it('terminates when the fill matches what is already there', () => {
    const doc = walled();
    expect(floodFill(doc, 0, 0, { ch: ' ' }, settings(), jb)).toHaveLength(6);
  });
});
