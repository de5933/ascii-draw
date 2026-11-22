import { AsciiDoc, cellIndex, inBounds } from '../document';
import { EditRecorder, HistoryEntry } from '../history';
import { Point } from '../raster';

const SPACE = 32;

/** Spaces a tab expands to. */
export const TAB_SPACES = 4;
/** Longest text accepted in one paste. */
export const MAX_PASTE = 100_000;

export interface TextLayout {
  /** Where each character is drawn (relative to the text origin), or null if it isn't drawn (newline, wrapped space). */
  positions: (Point | null)[];
  /** Caret position before each character; carets[text.length] is the end. */
  carets: Point[];
}

/**
 * Lays text out like a textarea `width` cells wide: words wrap to the next
 * line whole, words longer than a line are broken, '\n' starts a new line,
 * and a space landing exactly at the right edge is absorbed by the wrap.
 */
export function layoutText(text: string, width: number): TextLayout {
  const w = Math.max(1, width);
  const n = text.length;
  const positions: (Point | null)[] = new Array(n);
  const carets: Point[] = new Array(n + 1);
  let col = 0;
  let row = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      carets[i] = { x: col, y: row };
      positions[i] = null;
      row++;
      col = 0;
      i++;
    } else if (c === ' ') {
      carets[i] = { x: col, y: row };
      if (col >= w) {
        positions[i] = null; // absorbed by the wrap
        row++;
        col = 0;
      } else {
        positions[i] = { x: col, y: row };
        col++;
      }
      i++;
    } else {
      let j = i;
      while (j < n && text[j] !== ' ' && text[j] !== '\n') j++;
      if (col > 0 && col + (j - i) > w) {
        row++;
        col = 0;
      }
      for (; i < j; i++) {
        if (col >= w) {
          row++;
          col = 0;
        }
        carets[i] = { x: col, y: row };
        positions[i] = { x: col, y: row };
        col++;
      }
    }
  }
  carets[n] = col >= w ? { x: 0, y: row + 1 } : { x: col, y: row };
  return { positions, carets };
}

/**
 * Makes text safe to put in cells: normalizes newlines, expands tabs, and
 * drops control characters and characters outside the 16-bit cell storage.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' '.repeat(TAB_SPACES))
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|[\ud800-\udfff]/g, '');
}

export interface CharStyle {
  fg?: number;
  bg?: number;
}

interface StyledChar extends CharStyle {
  ch: string;
}

export type CaretMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * One typing session: text placed at an origin cell and wrapped at the doc's
 * right edge. Every edit restores the cells it covered and lays the whole text
 * out again, so it behaves like a textarea. The session is one undo step.
 */
export class TextSession {
  private chars: StyledChar[] = [];
  private caretIndex = 0;
  private written: number[] = [];
  private layout: TextLayout = { positions: [], carets: [{ x: 0, y: 0 }] };
  private readonly recorder: EditRecorder;
  /** Cells blanked by clearCells: text moving off them restores the blank, not the original. */
  private readonly cleared = new Set<number>();

  constructor(
    private readonly doc: AsciiDoc,
    readonly x0: number,
    readonly y0: number,
  ) {
    this.recorder = new EditRecorder(doc);
  }

  get text(): string {
    return this.chars.map((c) => c.ch).join('');
  }

  get caret(): number {
    return this.caretIndex;
  }

  /** Caret position in doc coordinates (may be below the doc). */
  get caretPos(): Point {
    const p = this.layout.carets[this.caretIndex];
    return { x: this.x0 + p.x, y: this.y0 + p.y };
  }

  /** Number of rows the text currently spans. */
  get rows(): number {
    return Math.max(...this.layout.carets.map((c) => c.y)) + 1;
  }

  /** Inserts (sanitized) text at the caret; returns the indices of cells that changed. */
  insert(text: string, style: CharStyle): number[] {
    const clean = sanitizeText(text);
    if (!clean) return [];
    const added = [...clean].map((ch) => ({ ch, ...style }));
    this.chars.splice(this.caretIndex, 0, ...added);
    this.caretIndex += added.length;
    return this.relayout();
  }

  backspace(): number[] {
    if (this.caretIndex === 0) return [];
    this.chars.splice(--this.caretIndex, 1);
    return this.relayout();
  }

  deleteForward(): number[] {
    if (this.caretIndex >= this.chars.length) return [];
    this.chars.splice(this.caretIndex, 1);
    return this.relayout();
  }

  moveCaret(move: CaretMove): void {
    const carets = this.layout.carets;
    const cur = carets[this.caretIndex];
    const onRow = (y: number) => carets.map((c, i) => ({ c, i })).filter(({ c }) => c.y === y);
    switch (move) {
      case 'left':
        this.caretIndex = Math.max(0, this.caretIndex - 1);
        break;
      case 'right':
        this.caretIndex = Math.min(this.chars.length, this.caretIndex + 1);
        break;
      case 'home':
        this.caretIndex = onRow(cur.y)[0]?.i ?? this.caretIndex;
        break;
      case 'end':
        this.caretIndex = onRow(cur.y).at(-1)?.i ?? this.caretIndex;
        break;
      case 'up':
      case 'down': {
        const row = onRow(cur.y + (move === 'up' ? -1 : 1));
        if (row.length === 0) {
          this.caretIndex = move === 'up' ? 0 : this.chars.length;
          break;
        }
        // Closest column, preferring the left one on ties.
        let best = row[0];
        for (const r of row) if (Math.abs(r.c.x - cur.x) < Math.abs(best.c.x - cur.x)) best = r;
        this.caretIndex = best.i;
        break;
      }
    }
  }

  /**
   * If (x, y) is a cell this session's text occupies (or the cell just after
   * the end of a line), moves the caret there and returns true.
   */
  placeCaretAt(x: number, y: number): boolean {
    const i = this.layout.carets.findIndex((p) => p.x + this.x0 === x && p.y + this.y0 === y);
    if (i < 0) return false;
    this.caretIndex = i;
    return true;
  }

  /**
   * Blanks the characters of the given cells (colors are kept) as part of this
   * session, e.g. deleting a selection before typing over it. Returns the cells.
   */
  clearCells(indices: Iterable<number>): number[] {
    const out: number[] = [];
    for (const i of indices) {
      this.recorder.touch(i);
      this.doc.ch[i] = SPACE;
      this.cleared.add(i);
      out.push(i);
    }
    return out;
  }

  finish(): HistoryEntry | null {
    return this.recorder.finish();
  }

  /** Restores previously written cells, then writes the text in its new layout. */
  private relayout(): number[] {
    const { doc } = this;
    const changed = new Set<number>();
    for (const i of this.written) {
      const o = this.recorder.original(i)!;
      doc.fg[i] = o.fg;
      doc.bg[i] = o.bg;
      doc.ch[i] = this.cleared.has(i) ? SPACE : o.ch;
      changed.add(i);
    }
    this.layout = layoutText(this.text, doc.width - this.x0);
    this.written = [];
    this.layout.positions.forEach((p, k) => {
      if (!p) return;
      const x = this.x0 + p.x;
      const y = this.y0 + p.y;
      if (!inBounds(doc, x, y)) return;
      const i = cellIndex(doc, x, y);
      this.recorder.touch(i);
      const c = this.chars[k];
      doc.ch[i] = c.ch.charCodeAt(0);
      if (c.fg !== undefined) doc.fg[i] = c.fg;
      if (c.bg !== undefined) doc.bg[i] = c.bg;
      this.written.push(i);
      changed.add(i);
    });
    return [...changed];
  }
}
