import { BLACK, WHITE, packRgba } from '../color';
import { createDoc, getCell, setCell } from '../document';
import { FONTS, getFont, glyphsFor } from '../fonts/fonts';
import {
  canPasteInto,
  clearRect,
  clipFromText,
  copyRect,
  defaultPasteTargets,
  pasteClip,
  rectFromCells,
  rectText,
  squareFocus,
} from './clip';

const RED = packRgba(255, 0, 0);
const jb = glyphsFor(getFont('jetbrains-mono'), 400);
const all = { fg: true, bg: true, ch: true };

function sample() {
  const doc = createDoc(4, 3, FONTS[0].id);
  [...'abcd'].forEach((c, x) => setCell(doc, x, 0, { ch: c, fg: RED }));
  [...'efgh'].forEach((c, x) => setCell(doc, x, 1, { ch: c, bg: RED }));
  return doc;
}

describe('cell clipboard', () => {
  it('builds rectangles from two cells in any order, clipped to the document', () => {
    const doc = sample();
    expect(rectFromCells({ x: 2, y: 2 }, { x: 1, y: 0 }, doc)).toEqual({ x: 1, y: 0, width: 2, height: 3 });
    expect(rectFromCells({ x: -5, y: 1 }, { x: 9, y: 9 }, doc)).toEqual({ x: 0, y: 1, width: 4, height: 2 });
    expect(rectFromCells({ x: 6, y: 0 }, { x: 9, y: 1 }, doc)).toBeNull();
  });

  it('squares a drag on screen for tall cells, in any direction', () => {
    const cell = { width: 10, height: 20 };
    expect(squareFocus({ x: 5, y: 5 }, { x: 9, y: 6 }, cell)).toEqual({ x: 9, y: 7 }); // 5 wide → 50px → 2.5 → 3 rows
    expect(squareFocus({ x: 5, y: 5 }, { x: 4, y: 1 }, cell)).toEqual({ x: -4, y: 1 }); // 5 rows → 100px → 10 cols, up-left
  });

  it('copies only the chosen layers, with text rows', () => {
    const doc = sample();
    const r = { x: 1, y: 0, width: 2, height: 2 };
    const clip = copyRect(doc, r, { fg: true, bg: false, ch: true })!;
    expect([...clip.fg!]).toEqual([RED, RED, WHITE, WHITE]);
    expect(clip.bg).toBeUndefined();
    expect(clip.text).toBe('bc\nfg');
    expect(rectText(doc, r)).toBe('bc\nfg');
    expect(copyRect(doc, r, { fg: false, bg: false, ch: false })).toBeNull();
    expect(copyRect(doc, r, { fg: true, bg: false, ch: false })!.text).toBe('');
  });

  it('pastes layers into the same layers, clipped at the edges', () => {
    const doc = sample();
    const clip = copyRect(doc, { x: 0, y: 0, width: 2, height: 2 }, all)!;
    const touched: number[] = [];
    const cells = pasteClip(doc, clip, 3, 2, defaultPasteTargets(clip), jb, (i) => touched.push(i));
    expect(cells).toEqual([11]);
    expect(touched).toEqual([11]);
    expect(getCell(doc, 3, 2)).toEqual({ ch: 'a', fg: RED, bg: BLACK });
  });

  it('only pastes a multi-layer clip into its own layers', () => {
    const doc = sample();
    const clip = copyRect(doc, { x: 0, y: 0, width: 1, height: 1 }, { fg: true, bg: false, ch: true })!;
    expect(canPasteInto(clip, 'bg')).toBe(false);
    pasteClip(doc, clip, 0, 2, all, jb);
    expect(getCell(doc, 0, 2)).toEqual({ ch: 'a', fg: RED, bg: BLACK });
  });

  it('pastes a single color layer into text by brightness: white is @ in JetBrains Mono', () => {
    const doc = createDoc(3, 1, 'jetbrains-mono');
    doc.fg.set([WHITE, BLACK, packRgba(128, 128, 128)]);
    const clip = copyRect(doc, { x: 0, y: 0, width: 3, height: 1 }, { fg: true, bg: false, ch: false })!;
    expect(canPasteInto(clip, 'ch')).toBe(true);
    pasteClip(doc, clip, 0, 0, { fg: false, bg: false, ch: true }, jb);
    const text = String.fromCharCode(...doc.ch);
    expect(text[0]).toBe('@');
    expect(text[1]).toBe(' ');
    expect(text[2]).not.toMatch(/[ @]/);
    expect([...doc.fg]).toEqual([WHITE, BLACK, packRgba(128, 128, 128)]); // untouched: not a target
  });

  it('pastes a single layer into other layers: color to color, text to gray', () => {
    const doc = createDoc(2, 1, 'jetbrains-mono');
    doc.fg[0] = RED;
    const fg = copyRect(doc, { x: 0, y: 0, width: 1, height: 1 }, { fg: true, bg: false, ch: false })!;
    pasteClip(doc, fg, 1, 0, { fg: false, bg: true, ch: false }, jb);
    expect(doc.bg[1]).toBe(RED);

    const text = clipFromText('@ é');
    pasteClip(doc, text, 0, 0, { fg: true, bg: false, ch: false }, jb);
    expect(doc.fg[0]).toBe(WHITE); // '@' is the brightest glyph
    expect(doc.fg[1]).toBe(BLACK); // space
  });

  it('turns outside text into a padded text-only clip', () => {
    const clip = clipFromText('ab\r\nc\tx\n');
    expect([clip.width, clip.height]).toEqual([6, 2]);
    expect(String.fromCharCode(...clip.ch!)).toBe('ab    c    x');
    expect(defaultPasteTargets(clip)).toEqual({ fg: false, bg: false, ch: true });
  });

  it('clears chosen layers to the blank cell', () => {
    const doc = sample();
    clearRect(doc, { x: 0, y: 0, width: 2, height: 1 }, { fg: false, bg: false, ch: true });
    expect(getCell(doc, 0, 0)).toEqual({ ch: ' ', fg: RED, bg: BLACK });
    expect(getCell(doc, 2, 0).ch).toBe('c');
  });
});
