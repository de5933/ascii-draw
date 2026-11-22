import { packRgba } from '../color';
import { AsciiDoc, DEFAULT_CELL, createDoc, getCell, setCell } from '../document';
import { History } from '../history';
import { TextSession, layoutText, sanitizeText } from './text';

/** Renders a layout as lines of text, for readable assertions. */
function render(text: string, width: number): string[] {
  const { positions } = layoutText(text, width);
  const lines: string[][] = [];
  positions.forEach((p, i) => {
    if (!p) return;
    (lines[p.y] ??= [])[p.x] = text[i];
  });
  return Array.from(lines, (l) => Array.from(l ?? [], (c) => c ?? ' ').join(''));
}

function row(doc: AsciiDoc, y: number): string {
  let s = '';
  for (let x = 0; x < doc.width; x++) s += getCell(doc, x, y).ch;
  return s;
}

describe('layoutText', () => {
  it('wraps whole words', () => {
    expect(render('the quick brown fox', 10)).toEqual(['the quick ', 'brown fox']);
  });

  it('breaks words longer than a line', () => {
    expect(render('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(render('hi abcdefghij', 4)).toEqual(['hi ', 'abcd', 'efgh', 'ij']);
  });

  it('honors newlines, including blank lines', () => {
    expect(render('a\n\nb', 5)).toEqual(['a', '', 'b']);
  });

  it('absorbs a space that lands exactly at the edge', () => {
    const { positions } = layoutText('abcd efg', 4);
    expect(positions[4]).toBeNull();
    expect(render('abcd efg', 4)).toEqual(['abcd', 'efg']);
  });

  it('gives a caret position for every index, including the end', () => {
    const { carets } = layoutText('ab\ncd', 10);
    expect(carets).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    // a full line puts the end caret on the next line
    expect(layoutText('abcd', 4).carets[4]).toEqual({ x: 0, y: 1 });
  });
});

describe('sanitizeText', () => {
  it('normalizes newlines, expands tabs, drops control and astral chars', () => {
    expect(sanitizeText('a\r\nb\rc\td\u0007e😀f')).toBe('a\nb\nc    def');
  });
});

describe('TextSession', () => {
  const RED = packRgba(255, 0, 0);

  it('types at the origin and wraps back to the origin column', () => {
    const doc = createDoc(12, 4, 'f');
    const t = new TextSession(doc, 4, 1);
    t.insert('hello big world', { fg: RED });
    expect(row(doc, 1)).toBe('    hello   ');
    expect(row(doc, 2)).toBe('    big     ');
    expect(row(doc, 3)).toBe('    world   ');
    expect(getCell(doc, 4, 1)).toEqual({ fg: RED, bg: DEFAULT_CELL.bg, ch: 'h' });
    expect(t.caretPos).toEqual({ x: 9, y: 3 });
  });

  it('re-wraps and restores the cells underneath when text shrinks', () => {
    const doc = createDoc(6, 3, 'f');
    for (let x = 0; x < 6; x++) setCell(doc, x, 1, { ch: '#' });
    const t = new TextSession(doc, 0, 0);
    t.insert('abc defg', {});
    expect([row(doc, 0), row(doc, 1)]).toEqual(['abc   ', 'defg##']);
    for (let i = 0; i < 4; i++) t.backspace();
    expect([row(doc, 0), row(doc, 1)]).toEqual(['abc   ', '######']);
  });

  it('inserts in the middle using caret moves', () => {
    const doc = createDoc(10, 2, 'f');
    const t = new TextSession(doc, 0, 0);
    t.insert('ac', {});
    t.moveCaret('left');
    t.insert('b', {});
    expect(row(doc, 0).trimEnd()).toBe('abc');
    t.moveCaret('home');
    t.deleteForward();
    expect(row(doc, 0).trimEnd()).toBe('bc');
    t.moveCaret('end');
    expect(t.caret).toBe(2);
  });

  it('moves up and down between lines by column', () => {
    const doc = createDoc(10, 3, 'f');
    const t = new TextSession(doc, 0, 0);
    t.insert('abcdef\nxy', {});
    t.moveCaret('up'); // from end of "xy" (col 2) to col 2 of line 0
    expect(t.caret).toBe(2);
    t.moveCaret('down');
    expect(t.caret).toBe(9);
    t.moveCaret('down'); // no line below: go to end
    expect(t.caret).toBe(9);
  });

  it('places the caret by clicking on its text', () => {
    const doc = createDoc(10, 2, 'f');
    const t = new TextSession(doc, 2, 0);
    t.insert('abc', {});
    expect(t.placeCaretAt(3, 0)).toBe(true);
    expect(t.caret).toBe(1);
    expect(t.placeCaretAt(5, 0)).toBe(true); // just after the end
    expect(t.placeCaretAt(8, 1)).toBe(false);
  });

  it('clips text that runs off the bottom', () => {
    const doc = createDoc(3, 1, 'f');
    const t = new TextSession(doc, 0, 0);
    expect(() => t.insert('abcdefgh', {})).not.toThrow();
    expect(row(doc, 0)).toBe('abc');
  });

  it('is undone as a single step', () => {
    const doc = createDoc(8, 2, 'f');
    const t = new TextSession(doc, 0, 0);
    t.insert('one', {});
    t.insert(' two', {});
    t.backspace();
    const history = new History();
    history.push(t.finish()!);
    history.undo(doc);
    expect(row(doc, 0)).toBe('        ');
  });
});
