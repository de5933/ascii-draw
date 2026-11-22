import { packRgba } from './color';
import { DEFAULT_CELL, cloneDoc, createDoc, getCell, inBounds, setCell } from './document';

describe('AsciiDoc', () => {
  it('creates a doc filled with the default cell', () => {
    const doc = createDoc(3, 2, 'f');
    expect(doc.fg.length).toBe(6);
    expect(getCell(doc, 2, 1)).toEqual({ ...DEFAULT_CELL });
  });

  it('rejects invalid sizes', () => {
    expect(() => createDoc(0, 5, 'f')).toThrow();
    expect(() => createDoc(2.5, 5, 'f')).toThrow();
    expect(() => createDoc(5000, 5, 'f')).toThrow();
  });

  it('sets only the given properties and reports changes', () => {
    const doc = createDoc(4, 4, 'f');
    const red = packRgba(255, 0, 0);
    expect(setCell(doc, 1, 2, { fg: red, ch: 'A' })).toBe(true);
    expect(getCell(doc, 1, 2)).toEqual({ fg: red, bg: DEFAULT_CELL.bg, ch: 'A' });
    expect(setCell(doc, 1, 2, { fg: red, ch: 'A' })).toBe(false);
    // neighbours untouched (row-major indexing)
    expect(getCell(doc, 2, 1)).toEqual({ ...DEFAULT_CELL });
  });

  it('ignores out-of-bounds writes', () => {
    const doc = createDoc(2, 2, 'f');
    expect(inBounds(doc, 2, 0)).toBe(false);
    expect(setCell(doc, -1, 0, { ch: 'x' })).toBe(false);
    expect(setCell(doc, 0, 2, { ch: 'x' })).toBe(false);
  });

  it('clones deeply', () => {
    const doc = createDoc(2, 2, 'f');
    const copy = cloneDoc(doc);
    setCell(copy, 0, 0, { ch: 'Z' });
    expect(getCell(doc, 0, 0).ch).toBe(' ');
  });
});
