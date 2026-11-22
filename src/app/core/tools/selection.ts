import { AsciiDoc } from '../document';
import { CaretMove } from './text';

/**
 * A text selection over the whole document, in reading order (row by row,
 * like a terminal). `anchor` and `focus` are caret positions: boundaries
 * between cells as linear indices 0..width*height, where position p is just
 * before cell p. The selected cells are [min, max).
 */
export interface TextSelection {
  anchor: number;
  focus: number;
}

export function selectionRange(sel: TextSelection | null): [start: number, end: number] | null {
  if (!sel || sel.anchor === sel.focus) return null;
  return sel.anchor < sel.focus ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}

/** Selection covering every cell from one cell to another, inclusive, in either direction (mouse drag). */
export function selectCells(anchorCell: number, focusCell: number): TextSelection {
  return focusCell >= anchorCell
    ? { anchor: anchorCell, focus: focusCell + 1 }
    : { anchor: anchorCell + 1, focus: focusCell };
}

/** Moves a selection's focus by a caret move (Shift+arrow keys), clamped to the document. */
export function moveFocus(sel: TextSelection, move: CaretMove, doc: AsciiDoc): TextSelection {
  const w = doc.width;
  const n = w * doc.height;
  const f = sel.focus;
  // A position at a row boundary after the anchor belongs to the end of the previous row.
  const row = f % w === 0 && f > sel.anchor ? f / w - 1 : Math.floor(f / w);
  let next = f;
  switch (move) {
    case 'left':
      next = f - 1;
      break;
    case 'right':
      next = f + 1;
      break;
    case 'up':
      next = f - w;
      break;
    case 'down':
      next = f + w;
      break;
    case 'home':
      next = row * w;
      break;
    case 'end':
      next = (row + 1) * w;
      break;
  }
  return { anchor: sel.anchor, focus: Math.min(n, Math.max(0, next)) };
}

/**
 * The selected characters as plain text: one line per document row, with
 * trailing spaces trimmed.
 */
export function selectedText(doc: AsciiDoc, start: number, end: number): string {
  const lines: string[] = [];
  let line = '';
  for (let i = start; i < end; i++) {
    if (i > start && i % doc.width === 0) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += String.fromCharCode(doc.ch[i]);
  }
  lines.push(line.trimEnd());
  return lines.join('\n');
}

/** Selection of the word (run of non-space characters in the row) at a cell; just the cell if it's a space. */
export function wordAt(doc: AsciiDoc, x: number, y: number): TextSelection {
  const row = y * doc.width;
  const isSpace = (cx: number) => doc.ch[row + cx] === 32;
  if (isSpace(x)) return { anchor: row + x, focus: row + x + 1 };
  let s = x;
  let e = x;
  while (s > 0 && !isSpace(s - 1)) s--;
  while (e < doc.width - 1 && !isSpace(e + 1)) e++;
  return { anchor: row + s, focus: row + e + 1 };
}
