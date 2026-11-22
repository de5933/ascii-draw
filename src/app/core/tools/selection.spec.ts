import { AsciiDoc, createDoc } from '../document';
import { moveFocus, selectCells, selectedText, selectionRange, wordAt } from './selection';

function docFrom(lines: string[]): AsciiDoc {
  const doc = createDoc(lines[0].length, lines.length, 'f');
  lines.forEach((l, y) => [...l].forEach((c, x) => (doc.ch[y * doc.width + x] = c.charCodeAt(0))));
  return doc;
}

describe('selection', () => {
  const doc = docFrom(['hello world ', 'second line ', '            ']);

  it('normalizes ranges and treats empty selections as none', () => {
    expect(selectionRange({ anchor: 5, focus: 2 })).toEqual([2, 5]);
    expect(selectionRange({ anchor: 3, focus: 3 })).toBeNull();
    expect(selectionRange(null)).toBeNull();
  });

  it('mouse selections include both end cells in either direction', () => {
    expect(selectionRange(selectCells(2, 4))).toEqual([2, 5]);
    expect(selectionRange(selectCells(4, 2))).toEqual([2, 5]);
    expect(selectionRange(selectCells(3, 3))).toEqual([3, 4]);
  });

  it('copies in reading order, one line per row, trailing spaces trimmed', () => {
    // from "world" through "second"
    expect(selectedText(doc, 6, 18)).toBe('world\nsecond');
    expect(selectedText(doc, 0, 36)).toBe('hello world\nsecond line\n');
    expect(selectedText(doc, 0, 5)).toBe('hello');
  });

  it('moves the focus with Shift+arrows, clamped to the doc', () => {
    const w = doc.width;
    expect(moveFocus({ anchor: 3, focus: 3 }, 'right', doc).focus).toBe(4);
    expect(moveFocus({ anchor: 3, focus: 3 }, 'down', doc).focus).toBe(3 + w);
    expect(moveFocus({ anchor: 3, focus: 3 }, 'up', doc).focus).toBe(0);
    expect(moveFocus({ anchor: 3, focus: 5 }, 'home', doc).focus).toBe(0);
    expect(moveFocus({ anchor: 3, focus: 5 }, 'end', doc).focus).toBe(w);
    // focus at a row boundary after the anchor counts as the end of the previous row
    expect(moveFocus({ anchor: 3, focus: w }, 'end', doc).focus).toBe(w);
    expect(moveFocus({ anchor: 3, focus: w * 3 }, 'down', doc).focus).toBe(w * 3);
  });

  it('selects words on double-click', () => {
    expect(selectionRange(wordAt(doc, 8, 0))).toEqual([6, 11]); // "world"
    expect(selectionRange(wordAt(doc, 0, 1))).toEqual([12, 18]); // "second"
    expect(selectionRange(wordAt(doc, 5, 0))).toEqual([5, 6]); // a space: just that cell
  });
});
