import { AsciiDoc } from './document';

/** The cells one edit changed, with their values before and after. */
export interface HistoryEntry {
  indices: Uint32Array;
  before: { fg: Uint32Array; bg: Uint32Array; ch: Uint16Array };
  after: { fg: Uint32Array; bg: Uint32Array; ch: Uint16Array };
}

/**
 * Collects the original values of cells as an edit (e.g. a brush stroke)
 * touches them. Call `touch` before modifying a cell; `finish` builds the entry.
 */
export class EditRecorder {
  private readonly before = new Map<number, [fg: number, bg: number, ch: number]>();

  constructor(private readonly doc: AsciiDoc) {}

  touch(i: number): void {
    if (!this.before.has(i)) this.before.set(i, [this.doc.fg[i], this.doc.bg[i], this.doc.ch[i]]);
  }

  /** The value a cell had before this edit first touched it, if it has been touched. */
  original(i: number): { fg: number; bg: number; ch: number } | undefined {
    const v = this.before.get(i);
    return v && { fg: v[0], bg: v[1], ch: v[2] };
  }

  /** Returns the entry, or null if nothing actually changed. */
  finish(): HistoryEntry | null {
    const changed = [...this.before].filter(
      ([i, [fg, bg, ch]]) => this.doc.fg[i] !== fg || this.doc.bg[i] !== bg || this.doc.ch[i] !== ch,
    );
    if (changed.length === 0) return null;
    const n = changed.length;
    const e: HistoryEntry = {
      indices: new Uint32Array(n),
      before: { fg: new Uint32Array(n), bg: new Uint32Array(n), ch: new Uint16Array(n) },
      after: { fg: new Uint32Array(n), bg: new Uint32Array(n), ch: new Uint16Array(n) },
    };
    changed.forEach(([i, [fg, bg, ch]], k) => {
      e.indices[k] = i;
      e.before.fg[k] = fg;
      e.before.bg[k] = bg;
      e.before.ch[k] = ch;
      e.after.fg[k] = this.doc.fg[i];
      e.after.bg[k] = this.doc.bg[i];
      e.after.ch[k] = this.doc.ch[i];
    });
    return e;
  }
}

/** Undo/redo stacks for one document. */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Reverts the last edit; returns the changed cell indices, or null if nothing to undo. */
  undo(doc: AsciiDoc): Uint32Array | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    apply(doc, e.indices, e.before);
    this.redoStack.push(e);
    return e.indices;
  }

  redo(doc: AsciiDoc): Uint32Array | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    apply(doc, e.indices, e.after);
    this.undoStack.push(e);
    return e.indices;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

function apply(doc: AsciiDoc, indices: Uint32Array, v: HistoryEntry['before']): void {
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    doc.fg[i] = v.fg[k];
    doc.bg[i] = v.bg[k];
    doc.ch[i] = v.ch[k];
  }
}
