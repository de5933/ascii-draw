import { Injectable, computed, signal } from '@angular/core';
import { AdjustLayers, AdjustSession, Adjustments } from '../core/adjust';
import { CHANNELS, ChannelRules, ChannelSet, channelOn, setChannel, toggleChannel } from '../core/channels';
import { BLACK, PackedColor, WHITE } from '../core/color';
import { NoiseSettings } from '../core/noise';
import { AsciiDoc, createDoc, getCell, inBounds } from '../core/document';
import { DEFAULT_FONT_ID, getFont, glyphsFor, nearestWeight } from '../core/fonts/fonts';
import { EditRecorder, HistoryEntry, History } from '../core/history';
import { BrushShape } from '../core/raster';
import { DEFAULT_FILL, FillSettings, floodFill } from '../core/tools/fill';
import { Channels, PaintSettings, Stroke, ToolId, paintValues } from '../core/tools/paint';
import {
  ALL_LAYERS,
  CellClip,
  Layer,
  Layers,
  Rect,
  canPasteInto,
  clearRect,
  copyRect,
  defaultPasteTargets,
  pasteClip,
  rectFromCells,
  rectIndices,
} from '../core/tools/clip';
import { TextSelection, moveFocus, selectCells, selectedText, selectionRange, wordAt } from '../core/tools/selection';
import { CaretMove, TextSession } from '../core/tools/text';

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
export const MAX_BRUSH_SIZE = 25;

export interface CellPos {
  x: number;
  y: number;
}

/** Where the text caret is, for drawing it. */
export interface TextCaret {
  x: number;
  y: number;
  /** Text origin: wrapped lines start at column x0. */
  x0: number;
  y0: number;
  rows: number;
}

/** App-wide editor state. */
@Injectable({ providedIn: 'root' })
export class EditorStore {
  readonly doc = signal<AsciiDoc>(createDoc(80, 40, DEFAULT_FONT_ID));
  /**
   * Bumped after in-place edits that need a full redraw.
   * (The doc's typed arrays are mutated directly for speed.)
   */
  readonly docVersion = signal(0);
  /** Bumped when specific cells changed; views fetch them with takeDirtyCells(). */
  readonly cellsVersion = signal(0);
  /** Used to name exported files: the imported image's name, or "untitled". */
  readonly docName = signal('untitled');
  readonly zoom = signal(1);
  readonly showGrid = signal(false);
  /** Cell currently under the pointer, if any. */
  readonly hoverCell = signal<CellPos | null>(null);

  // Tool settings
  readonly tool = signal<ToolId>('brush');
  readonly fg = signal<PackedColor>(WHITE);
  readonly bg = signal<PackedColor>(BLACK);
  readonly ch = signal('@');
  readonly channels = signal<Channels>({ fg: true, bg: true, ch: true });
  readonly brushSize = signal(1);
  readonly brushShape = signal<BrushShape>('square');
  /** Paint bucket: which channels must match, how closely, and whether the region must be connected. */
  readonly fillSettings = signal<FillSettings>({ ...DEFAULT_FILL, match: { ...DEFAULT_FILL.match } });

  /** Set while a text session is open. */
  readonly textCaret = signal<TextCaret | null>(null);
  /** Text selection over the document (text tool), or null. */
  readonly selection = signal<TextSelection | null>(null);
  /** Number of selected cells. */
  readonly selectionSize = computed(() => {
    const r = selectionRange(this.selection());
    return r ? r[1] - r[0] : 0;
  });

  /** Rectangular selection (select tool), or null. */
  readonly rect = signal<Rect | null>(null);
  /** Layers that copy, cut and delete act on. */
  readonly copyLayers = signal<Layers>({ ...ALL_LAYERS });
  /** The last cells copied or cut (or text pasted from outside). */
  readonly clipboard = signal<CellClip | null>(null);
  /** Layers a paste writes; reset to the clip's own layers whenever the clipboard changes. */
  readonly pasteTargets = signal<Layers>({ ...ALL_LAYERS });
  /** Cells covered by either kind of selection. */
  readonly selectedCellCount = computed(() => {
    const r = this.rect();
    return r ? r.width * r.height : this.selectionSize();
  });

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly font = computed(() => getFont(this.doc().fontId));
  readonly fontWeight = computed(() => this.doc().fontWeight);
  /** Characters of the document's font at its weight, darkest first. */
  readonly glyphs = computed(() => glyphsFor(this.font(), this.fontWeight()));
  readonly paintSettings = computed<PaintSettings>(() => ({
    fg: this.fg(),
    bg: this.bg(),
    ch: this.ch(),
    channels: this.channels(),
    size: this.brushSize(),
    shape: this.brushShape(),
  }));

  private readonly history = new History();
  private stroke: Stroke | null = null;
  private text: TextSession | null = null;
  private adjust: AdjustSession | null = null;
  private dirty = new Set<number>();

  // ---- Document ----

  /** New blank document. Keeps the current weight if the font has it (else the nearest). */
  newDoc(width: number, height: number, fontId: string): void {
    const weight = nearestWeight(getFont(fontId), this.doc().fontWeight);
    this.loadDoc(createDoc(width, height, fontId, undefined, weight));
  }

  /** Replaces the current document (e.g. after importing an image). Clears undo history. */
  loadDoc(doc: AsciiDoc, name = 'untitled'): void {
    this.docName.set(name);
    const font = getFont(doc.fontId); // validate
    if (!font.weights.includes(doc.fontWeight)) doc = { ...doc, fontWeight: nearestWeight(font, doc.fontWeight) };
    this.stroke = null;
    this.text = null;
    this.textCaret.set(null);
    this.selection.set(null);
    this.rect.set(null);
    this.history.clear();
    this.syncHistory();
    this.dirty.clear();
    this.doc.set(doc);
    this.hoverCell.set(null);
  }

  /** Changes the whole document's font, keeping the weight (or the nearest the font has). */
  setFont(fontId: string): void {
    const font = getFont(fontId); // validates
    this.endText();
    this.doc.update((d) => ({ ...d, fontId, fontWeight: nearestWeight(font, d.fontWeight) }));
  }

  /** Changes the whole document's font weight. Must be one the font has. */
  setFontWeight(weight: number): void {
    if (!this.font().weights.includes(weight)) throw new Error(`${this.font().name} has no weight ${weight}`);
    this.endText();
    this.doc.update((d) => ({ ...d, fontWeight: weight }));
  }

  markDocChanged(): void {
    this.docVersion.update((v) => v + 1);
  }

  /** Returns and clears the cells changed since the last call. */
  takeDirtyCells(): number[] {
    const cells = [...this.dirty];
    this.dirty.clear();
    return cells;
  }

  private markCells(indices: Iterable<number>): void {
    let any = false;
    for (const i of indices) {
      this.dirty.add(i);
      any = true;
    }
    if (any) this.cellsVersion.update((v) => v + 1);
  }

  // ---- Painting ----

  setTool(tool: ToolId): void {
    if (tool !== 'text') {
      this.endText();
      this.selection.set(null);
    }
    if (tool !== 'select') this.rect.set(null);
    // Typing may run with only the (locked) text channel; other tools need one really on.
    const c = this.channels();
    if (tool !== 'text' && !c.fg && !c.bg && !c.ch) this.channels.set({ ...c, ch: true });
    this.tool.set(tool);
  }

  beginStroke(x: number, y: number): void {
    if (this.adjust) return;
    this.endText();
    this.stroke = new Stroke(this.doc(), this.tool(), this.paintSettings());
    this.markCells(this.stroke.to(x, y));
  }

  strokeTo(x: number, y: number): void {
    if (this.stroke) this.markCells(this.stroke.to(x, y));
  }

  endStroke(): void {
    const entry = this.stroke?.finish();
    this.stroke = null;
    if (entry) {
      this.history.push(entry);
      this.syncHistory();
    }
  }

  /** Paint bucket: fills the region around a cell with the current colors/char on the painting channels (one undo step). */
  fillAt(x: number, y: number): boolean {
    if (this.adjust || this.stroke) return false;
    this.endText();
    const doc = this.doc();
    const rec = new EditRecorder(doc);
    const values = paintValues('fill', this.paintSettings());
    const cells = floodFill(doc, x, y, values, this.fillSettings(), this.glyphs(), (i) => rec.touch(i));
    if (cells.length > 2000) this.markDocChanged();
    else this.markCells(cells);
    this.pushHistory(rec.finish());
    return cells.length > 0;
  }

  setFillMatch(match: ChannelSet): void {
    if (match.fg || match.bg || match.ch) this.fillSettings.update((s) => ({ ...s, match: { ...match } }));
  }

  setFillTolerance(t: number): void {
    const v = Math.min(100, Math.max(0, Math.round(t) || 0));
    this.fillSettings.update((s) => ({ ...s, tolerance: v }));
  }

  setFillContiguous(on: boolean): void {
    this.fillSettings.update((s) => ({ ...s, contiguous: on }));
  }

  get stroking(): boolean {
    return this.stroke !== null;
  }

  /** Eyedropper: copies a cell's colors and character into the tool settings. */
  pickFrom(x: number, y: number): void {
    const doc = this.doc();
    if (!inBounds(doc, x, y)) return;
    const c = getCell(doc, x, y);
    this.fg.set(c.fg);
    this.bg.set(c.bg);
    this.ch.set(c.ch);
  }

  undo(): void {
    if (this.stroke || this.adjust) return;
    this.endText();
    const cells = this.history.undo(this.doc());
    if (cells) this.markCells(cells);
    this.syncHistory();
  }

  redo(): void {
    if (this.stroke || this.adjust) return;
    this.endText();
    const cells = this.history.redo(this.doc());
    if (cells) this.markCells(cells);
    this.syncHistory();
  }

  // ---- Rectangular selection and cell clipboard ----

  /** Selects the rectangle between two cells (inclusive), clipped to the document. */
  selectRect(a: CellPos, b: CellPos): void {
    this.rect.set(rectFromCells(a, b, this.doc()));
  }

  selectAllRect(): void {
    const d = this.doc();
    this.rect.set({ x: 0, y: 0, width: d.width, height: d.height });
  }

  clearRect(): void {
    this.rect.set(null);
  }

  setCopyLayer(layer: Layer, on: boolean): void {
    this.copyLayers.update((l) => setChannel(l, layer, on));
  }

  setCopyLayers(set: ChannelSet): void {
    if (set.fg || set.bg || set.ch) this.copyLayers.set({ ...set });
  }

  /** Paste channels a multi-channel clip doesn't have can't be chosen. */
  readonly pasteRules = computed<ChannelRules>(() => {
    const clip = this.clipboard();
    if (!clip) return {};
    return { unavailable: { fg: !canPasteInto(clip, 'fg'), bg: !canPasteInto(clip, 'bg'), ch: !canPasteInto(clip, 'ch') } };
  });

  setPasteTarget(layer: Layer, on: boolean): void {
    this.pasteTargets.update((l) => setChannel(l, layer, on, this.pasteRules()));
  }

  setPasteTargets(set: ChannelSet): void {
    if (set.fg || set.bg || set.ch) this.pasteTargets.set({ ...set });
  }

  /** Makes a clip the clipboard; paste targets go back to its own layers. */
  setClipboard(clip: CellClip): void {
    this.clipboard.set(clip);
    this.pasteTargets.set(defaultPasteTargets(clip));
  }

  /** Copies the chosen layers of the selected rectangle. Returns the clip, or null. */
  copyRect(): CellClip | null {
    const r = this.rect();
    if (!r) return null;
    const clip = copyRect(this.doc(), r, this.copyLayers());
    if (clip) this.setClipboard(clip);
    return clip;
  }

  cutRect(): CellClip | null {
    const clip = this.copyRect();
    if (clip) this.deleteRect();
    return clip;
  }

  /** Blanks the chosen layers of the selected rectangle (one undo step). */
  deleteRect(): boolean {
    const r = this.rect();
    if (!r || this.adjust || this.stroke) return false;
    this.endText();
    const rec = new EditRecorder(this.doc());
    this.markCells(clearRect(this.doc(), r, this.copyLayers(), (i) => rec.touch(i)));
    this.pushHistory(rec.finish());
    return true;
  }

  /**
   * Pastes a clip (default: the clipboard) with its top-left at `at`, into the
   * paste-target layers, as one undo step. The pasted area becomes the selection.
   */
  paste(at: CellPos, clip: CellClip | null = this.clipboard()): boolean {
    if (!clip || this.adjust || this.stroke) return false;
    this.endText();
    const doc = this.doc();
    const rec = new EditRecorder(doc);
    const cells = pasteClip(doc, clip, at.x, at.y, this.pasteTargets(), this.glyphs(), (i) => rec.touch(i));
    this.markCells(cells);
    this.pushHistory(rec.finish());
    this.rect.set(rectFromCells(at, { x: at.x + clip.width - 1, y: at.y + clip.height - 1 }, doc));
    return cells.length > 0;
  }

  private pushHistory(entry: HistoryEntry | null): void {
    if (!entry) return;
    this.history.push(entry);
    this.syncHistory();
  }

  // ---- Adjustments ----

  /**
   * Starts a live-preview adjustment of the selected cells (when `selectionOnly`
   * and there is a selection) or the whole image. Returns how many cells it covers.
   */
  beginAdjust(selectionOnly: boolean): number {
    if (this.adjust) this.cancelAdjust();
    this.endText();
    const rect = selectionOnly ? this.rect() : null;
    const r = selectionOnly && !rect ? selectionRange(this.selection()) : null;
    const indices = rect
      ? rectIndices(this.doc(), rect)
      : r
        ? Uint32Array.from({ length: r[1] - r[0] }, (_, k) => r[0] + k)
        : undefined;
    this.adjust = new AdjustSession(this.doc(), indices);
    return this.adjust.indices.length;
  }

  previewAdjust(a: Adjustments, layers: AdjustLayers): void {
    if (!this.adjust) return;
    this.adjust.preview(a, layers, this.glyphs());
    this.markAdjusted();
  }

  previewNoise(settings: NoiseSettings, layers: AdjustLayers): void {
    if (!this.adjust) return;
    this.adjust.previewNoise(settings, layers, this.glyphs());
    this.markAdjusted();
  }

  /** Keeps the previewed result as one undo step. */
  commitAdjust(): void {
    if (!this.adjust) return;
    const entry = this.adjust.finish();
    this.adjust = null;
    if (entry) {
      this.history.push(entry);
      this.syncHistory();
    }
  }

  cancelAdjust(): void {
    if (!this.adjust) return;
    this.adjust.cancel();
    this.markAdjusted();
    this.adjust = null;
  }

  get adjusting(): boolean {
    return this.adjust !== null;
  }

  private markAdjusted(): void {
    if (!this.adjust) return;
    // A full redraw is cheaper than tracking every cell of the image.
    if (this.adjust.wholeDoc) this.markDocChanged();
    else this.markCells(this.adjust.indices);
  }

  private syncHistory(): void {
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
  }

  // ---- Text ----

  get typing(): boolean {
    return this.text !== null;
  }

  /**
   * Places the text caret at a cell: inside the open session's text it just
   * moves the caret, otherwise it finishes that session and starts a new one.
   */
  startText(x: number, y: number): void {
    const doc = this.doc();
    if (!inBounds(doc, x, y)) return;
    this.selection.set(null);
    if (this.text?.placeCaretAt(x, y)) {
      this.syncCaret();
      return;
    }
    this.endText();
    this.text = new TextSession(doc, x, y);
    this.syncCaret();
  }

  /** Types or pastes text at the caret, replacing the selection if there is one. */
  typeText(text: string): void {
    if (this.selectionSize()) this.deleteSelection();
    if (!this.text) return;
    const ch = this.channels();
    this.markCells(this.text.insert(text, { fg: ch.fg ? this.fg() : undefined, bg: ch.bg ? this.bg() : undefined }));
    this.syncCaret();
  }

  textBackspace(): void {
    if (this.deleteSelection()) return;
    if (!this.text) return;
    this.markCells(this.text.backspace());
    this.syncCaret();
  }

  textDelete(): void {
    if (this.deleteSelection()) return;
    if (!this.text) return;
    this.markCells(this.text.deleteForward());
    this.syncCaret();
  }

  /** Arrow keys etc. A selection collapses to its start (left/up/home) or end. */
  moveTextCaret(move: CaretMove): void {
    const r = selectionRange(this.selection());
    if (r) {
      const toEnd = move === 'right' || move === 'down' || move === 'end';
      this.placeCaretAtIndex(toEnd ? r[1] : r[0]);
      return;
    }
    if (!this.text) return;
    this.text.moveCaret(move);
    this.syncCaret();
  }

  /** Finishes the open text session, recording it as one undo step. */
  endText(): void {
    if (!this.text) return;
    const entry = this.text.finish();
    this.text = null;
    this.textCaret.set(null);
    if (entry) {
      this.history.push(entry);
      this.syncHistory();
    }
  }

  // ---- Text selection ----

  /** Mouse drag: selects every cell from one cell to another, inclusive. */
  selectCellRange(anchor: CellPos, focus: CellPos): void {
    this.endText();
    this.selection.set(selectCells(this.clampIndex(anchor), this.clampIndex(focus)));
  }

  /** Shift+click: extends the selection (or a new one from the caret) to include a cell. */
  extendSelectionToCell(cell: CellPos): void {
    const anchor = this.selection()?.anchor ?? this.caretIndex();
    if (anchor === null) return;
    const i = this.clampIndex(cell);
    this.endText();
    this.selection.set(i >= anchor ? { anchor, focus: i + 1 } : { anchor, focus: i });
  }

  /** Shift+arrow keys. */
  extendSelection(move: CaretMove): void {
    const sel = this.selection() ?? (() => {
      const c = this.caretIndex();
      return c === null ? null : { anchor: c, focus: c };
    })();
    if (!sel) return;
    const next = moveFocus(sel, move, this.doc());
    if (next.anchor === next.focus) {
      this.placeCaretAtIndex(next.focus);
      return;
    }
    this.endText();
    this.selection.set(next);
  }

  selectAll(): void {
    const doc = this.doc();
    this.endText();
    this.selection.set({ anchor: 0, focus: doc.width * doc.height });
  }

  selectWordAt(x: number, y: number): void {
    const doc = this.doc();
    if (!inBounds(doc, x, y)) return;
    this.endText();
    this.selection.set(wordAt(doc, x, y));
  }

  /** The selection as plain text (rows joined by newlines), or null if nothing is selected. */
  selectedText(): string | null {
    const r = selectionRange(this.selection());
    return r && selectedText(this.doc(), r[0], r[1]);
  }

  /**
   * Blanks the selected characters (colors are kept; nothing shifts) and puts
   * the caret where the selection started. Text typed next joins the same
   * undo step. Returns false if nothing was selected.
   */
  deleteSelection(): boolean {
    const r = selectionRange(this.selection());
    if (!r) return false;
    const doc = this.doc();
    this.endText();
    this.selection.set(null);
    this.text = new TextSession(doc, r[0] % doc.width, Math.floor(r[0] / doc.width));
    const cells = Array.from({ length: r[1] - r[0] }, (_, k) => r[0] + k);
    this.markCells(this.text.clearCells(cells));
    this.syncCaret();
    return true;
  }

  /** Clears the selection and finishes typing (Esc). */
  clearSelection(): void {
    this.selection.set(null);
    this.endText();
  }

  /** Caret position as a linear boundary index, from the open text session. */
  private caretIndex(): number | null {
    const c = this.textCaret();
    if (!c) return null;
    const doc = this.doc();
    return Math.min(doc.width * doc.height, Math.max(0, c.y * doc.width + c.x));
  }

  private placeCaretAtIndex(i: number): void {
    const doc = this.doc();
    const cell = Math.min(i, doc.width * doc.height - 1);
    this.selection.set(null);
    this.endText();
    this.startText(cell % doc.width, Math.floor(cell / doc.width));
  }

  private clampIndex(p: CellPos): number {
    const doc = this.doc();
    const x = Math.min(doc.width - 1, Math.max(0, p.x));
    const y = Math.min(doc.height - 1, Math.max(0, p.y));
    return y * doc.width + x;
  }

  private syncCaret(): void {
    const t = this.text;
    this.textCaret.set(t && { ...t.caretPos, x0: t.x0, y0: t.y0, rows: t.rows });
  }

  // ---- Tool settings ----

  setChar(ch: string): void {
    const c = [...ch][0];
    if (c && c.length === 1 && c >= ' ') this.ch.set(c); // single UTF-16 unit, printable
  }

  /** The text tool always writes characters. */
  readonly channelRules = computed<ChannelRules>(() => (this.tool() === 'text' ? { locked: { ch: true } } : {}));

  /** Toggles a painting channel; the last one on stays on. */
  toggleChannel(channel: keyof Channels): void {
    this.channels.update((c) => toggleChannel(c, channel, this.channelRules()));
  }

  setChannels(set: ChannelSet): void {
    const rules = this.channelRules();
    if (CHANNELS.some((k) => channelOn(set, k, rules))) this.channels.set({ ...set });
  }

  setBrushSize(size: number): void {
    this.brushSize.set(Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(size) || 1)));
  }

  swapColors(): void {
    const fg = this.fg();
    this.fg.set(this.bg());
    this.bg.set(fg);
  }

  resetColors(): void {
    this.fg.set(WHITE);
    this.bg.set(BLACK);
  }

  // ---- View ----

  setZoom(zoom: number): void {
    this.zoom.set(Math.min(ZOOM_LEVELS.at(-1)!, Math.max(ZOOM_LEVELS[0], zoom)));
  }

  zoomIn(): void {
    const z = this.zoom();
    this.setZoom(ZOOM_LEVELS.find((l) => l > z) ?? z);
  }

  zoomOut(): void {
    const z = this.zoom();
    this.setZoom([...ZOOM_LEVELS].reverse().find((l) => l < z) ?? z);
  }

  toggleGrid(): void {
    this.showGrid.update((g) => !g);
  }
}
