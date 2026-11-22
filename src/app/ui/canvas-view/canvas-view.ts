import { Component, ElementRef, afterNextRender, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { loadFont } from '../../core/fonts/fonts';
import { brushOffsets } from '../../core/raster';
import { TextSelection, selectionRange } from '../../core/tools/selection';
import { CaretMove, MAX_PASTE } from '../../core/tools/text';
import { CanvasRenderer, CellSize } from '../../core/renderer';
import { CellPos, EditorStore, TextCaret } from '../../state/editor.store';

/**
 * Shows the document on a canvas and turns pointer input into tool actions.
 * Left-drag paints, Alt+click picks colors/char from a cell, middle-drag or
 * Space+drag pans, Ctrl+wheel zooms. With the text tool, a click places a
 * caret and keystrokes go through a hidden textarea (so key repeat, IME and
 * paste work natively).
 */
@Component({
  selector: 'app-canvas-view',
  template: `
    <div
      #viewport
      class="viewport"
      [class.panning]="panning()"
      [class.pan-ready]="spaceHeld()"
      [class.text-tool]="store.tool() === 'text'"
      (wheel)="onWheel($event)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (pointerleave)="store.hoverCell.set(null)"
      (contextmenu)="$event.preventDefault()"
      (mousedown)="$event.preventDefault()"
      (dblclick)="onDoubleClick($event)"
    >
      <div class="stage">
        <canvas #canvas></canvas>
        <canvas #overlay class="overlay"></canvas>
        <textarea
          #textInput
          class="text-input"
          aria-label="Text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          (beforeinput)="onBeforeInput($event)"
          (compositionend)="onCompositionEnd($event)"
          (input)="textInput.value = ''"
          (paste)="onPaste($event)"
          (copy)="onCopy($event, false)"
          (cut)="onCopy($event, true)"
          (keydown)="onTextKeydown($event)"
        ></textarea>
      </div>
    </div>
  `,
  styleUrl: './canvas-view.css',
  host: {
    '(window:keydown.space)': 'onSpace($event, true)',
    '(window:keyup.space)': 'onSpace($event, false)',
    '(window:blur)': 'spaceHeld.set(false)',
    '(window:paste)': 'onWindowPaste($event)',
    '(window:copy)': 'onWindowCopy($event, false)',
    '(window:cut)': 'onWindowCopy($event, true)',
    '(window:keydown)': 'onWindowKeydown($event)',
  },
})
export class CanvasView {
  protected readonly store = inject(EditorStore);
  private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly overlay = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly textInput = viewChild.required<ElementRef<HTMLTextAreaElement>>('textInput');
  private renderer?: CanvasRenderer;
  private renderToken = 0;
  /** True once the renderer is configured for the current doc/font/zoom. */
  private readonly ready = signal(false);

  protected readonly panning = signal(false);
  protected readonly spaceHeld = signal(false);
  private panStart?: { x: number; y: number; left: number; top: number };
  /** Text tool drag in progress: a click places the caret, a drag selects. */
  private textDrag?: { anchor: CellPos; extend: boolean; moved: boolean };

  constructor() {
    afterNextRender(() => {
      this.renderer = new CanvasRenderer(this.canvas().nativeElement);
      this.store.markDocChanged(); // trigger first render now that the canvas exists
    });

    // Full redraw when the document, font, zoom or grid changes.
    effect(() => {
      const doc = this.store.doc();
      const font = this.store.font();
      const zoom = this.store.zoom();
      const grid = this.store.showGrid();
      this.store.docVersion();
      const renderer = this.renderer;
      if (!renderer) return;
      const token = ++this.renderToken;
      untracked(() => {
        this.ready.set(false);
        loadFont(font, doc.fontWeight).then(() => {
          if (token !== this.renderToken) return; // superseded by a newer render
          renderer.showGrid = grid;
          renderer.configure(doc, font, zoom, window.devicePixelRatio || 1);
          this.store.takeDirtyCells(); // covered by the full redraw
          renderer.renderAll(doc);
          this.sizeOverlay();
          this.ready.set(true);
        });
      });
    });

    // Partial redraw of cells changed by painting or undo.
    effect(() => {
      this.store.cellsVersion();
      if (!this.ready() || !this.renderer) return;
      untracked(() => this.renderer!.renderCells(this.store.doc(), this.store.takeDirtyCells()));
    });

    // Brush outline under the pointer, or the text caret.
    effect(() => {
      const pos = this.store.hoverCell();
      const size = this.store.brushSize();
      const shape = this.store.brushShape();
      const tool = this.store.tool();
      const caret = this.store.textCaret();
      const selection = this.store.selection();
      if (!this.ready()) return;
      untracked(() => this.drawCursor(pos, size, shape, tool, caret, selection));
    });

    // Leave the hidden textarea when the text session ends (Esc, undo, tool change).
    effect(() => {
      if (!this.store.textCaret() && !this.store.selection() && document.activeElement === this.textInput()?.nativeElement) {
        this.textInput().nativeElement.blur();
      }
    });
  }

  protected onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) this.store.zoomIn();
    else if (e.deltaY > 0) this.store.zoomOut();
  }

  protected onSpace(e: Event, down: boolean): void {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    this.spaceHeld.set(down);
  }

  protected onPointerDown(e: PointerEvent): void {
    // Clicking the canvas leaves any text field, so tool shortcuts work again.
    if (isTypingTarget(document.activeElement)) (document.activeElement as HTMLElement).blur();
    const vp = this.viewport().nativeElement;
    if (e.button === 1 || (e.button === 0 && this.spaceHeld())) {
      e.preventDefault();
      vp.setPointerCapture(e.pointerId);
      this.panning.set(true);
      this.panStart = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      return;
    }
    if (e.button !== 0 || !this.ready()) return;
    const pos = this.cellFromEvent(e);
    if (!pos) return;
    e.preventDefault();
    if (e.altKey) {
      this.store.pickFrom(pos.x, pos.y);
      return;
    }
    if (this.store.tool() === 'text') {
      vp.setPointerCapture(e.pointerId);
      const extend = e.shiftKey && (this.store.typing || this.store.selection() !== null);
      this.textDrag = { anchor: pos, extend, moved: false };
      if (extend) this.store.extendSelectionToCell(pos);
      this.focusTextInput();
      return;
    }
    // Strokes may start just outside the doc; they're clipped per cell.
    vp.setPointerCapture(e.pointerId);
    this.store.beginStroke(pos.x, pos.y);
  }

  protected onPointerMove(e: PointerEvent): void {
    if (this.panning() && this.panStart) {
      const vp = this.viewport().nativeElement;
      vp.scrollLeft = this.panStart.left - (e.clientX - this.panStart.x);
      vp.scrollTop = this.panStart.top - (e.clientY - this.panStart.y);
      return;
    }
    const pos = this.cellFromEvent(e);
    if (this.textDrag && pos) {
      const d = this.textDrag;
      if (d.extend) this.store.extendSelectionToCell(pos);
      else if (d.moved || pos.x !== d.anchor.x || pos.y !== d.anchor.y) {
        d.moved = true;
        this.store.selectCellRange(d.anchor, pos);
      }
    }
    if (this.store.stroking && pos) this.store.strokeTo(pos.x, pos.y);
    this.updateHover(pos);
  }

  protected onPointerUp(e: PointerEvent): void {
    const vp = this.viewport().nativeElement;
    if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
    if (this.panning()) {
      this.panning.set(false);
      this.panStart = undefined;
    }
    if (this.store.stroking) this.store.endStroke();
    const drag = this.textDrag;
    this.textDrag = undefined;
    if (drag && !drag.extend && !drag.moved) {
      // Plain click: place the caret.
      this.store.startText(drag.anchor.x, drag.anchor.y);
      this.focusTextInput();
    }
  }

  protected onDoubleClick(e: MouseEvent): void {
    if (this.store.tool() !== 'text' || e.altKey) return;
    const pos = this.cellFromEvent(e);
    if (!pos) return;
    this.store.selectWordAt(pos.x, pos.y);
    this.focusTextInput();
  }

  // ---- Text tool ----

  private focusTextInput(): void {
    this.textInput().nativeElement.focus({ preventScroll: true });
  }

  protected onBeforeInput(e: InputEvent): void {
    if (!this.store.typing && !this.store.selection()) {
      e.preventDefault();
      return;
    }
    switch (e.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        if (e.data) this.store.typeText(e.data);
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        this.store.typeText('\n');
        break;
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
        this.store.textBackspace();
        break;
      case 'deleteContentForward':
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
        this.store.textDelete();
        break;
      case 'insertCompositionText':
        return; // IME in progress: let it run, insert on compositionend
    }
    e.preventDefault();
  }

  protected onCompositionEnd(e: CompositionEvent): void {
    if (e.data) this.store.typeText(e.data);
    this.textInput().nativeElement.value = '';
  }

  protected onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) this.store.typeText(text.slice(0, MAX_PASTE));
  }

  /** Ctrl+V outside a text field: switch to the text tool and paste at the pointer (or top-left). */
  protected onWindowPaste(e: ClipboardEvent): void {
    if (e.defaultPrevented || isTypingTarget(e.target)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (!this.store.typing && !this.store.selectionSize()) {
      const at = this.store.hoverCell() ?? { x: 0, y: 0 };
      this.store.setTool('text');
      this.store.startText(at.x, at.y);
    }
    this.store.typeText(text.slice(0, MAX_PASTE));
    this.focusTextInput();
  }

  /** Ctrl+C / Ctrl+X: copies the selection as plain text (and blanks it for cut). */
  protected onCopy(e: ClipboardEvent, cut: boolean): void {
    e.preventDefault();
    const text = this.store.selectedText();
    if (text === null || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', text);
    if (cut) this.store.deleteSelection();
  }

  /** Copy/cut while focus is elsewhere (e.g. after clicking a panel button) but text is selected. */
  protected onWindowCopy(e: ClipboardEvent, cut: boolean): void {
    if (e.defaultPrevented || isTypingTarget(e.target) || !this.store.selectionSize()) return;
    this.onCopy(e, cut);
    this.focusTextInput();
  }

  /** Ctrl+A anywhere outside a text field: switch to the text tool and select the whole image. */
  protected onWindowKeydown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
    e.preventDefault();
    this.store.setTool('text');
    this.store.selectAll();
    this.focusTextInput();
  }

  protected onTextKeydown(e: KeyboardEvent): void {
    const moves: Record<string, CaretMove> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Home: 'home',
      End: 'end',
    };
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (moves[e.key] && e.shiftKey) this.store.extendSelection(moves[e.key]);
    else if (moves[e.key]) this.store.moveTextCaret(moves[e.key]);
    else if (e.key === 'Escape') this.store.clearSelection();
    else if (mod && key === 'a') this.store.selectAll();
    else if (e.key === 'Tab') this.store.typeText('\t');
    else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) this.store.undo();
    else if ((e.ctrlKey || e.metaKey) && ((key === 'z' && e.shiftKey) || key === 'y')) this.store.redo();
    else return;
    e.preventDefault();
  }

  /** Cell under the pointer, unclamped (may be outside the doc). */
  private cellFromEvent(e: MouseEvent): { x: number; y: number } | null {
    if (!this.renderer) return null;
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    const cell = this.renderer.cellSize;
    return {
      x: Math.floor((e.clientX - rect.left) / cell.width),
      y: Math.floor((e.clientY - rect.top) / cell.height),
    };
  }

  private updateHover(pos: { x: number; y: number } | null): void {
    const doc = this.store.doc();
    const inside = pos && pos.x >= 0 && pos.y >= 0 && pos.x < doc.width && pos.y < doc.height ? pos : null;
    const prev = this.store.hoverCell();
    if (inside?.x !== prev?.x || inside?.y !== prev?.y) this.store.hoverCell.set(inside);
  }

  private sizeOverlay(): void {
    const main = this.canvas().nativeElement;
    const ov = this.overlay().nativeElement;
    ov.width = main.width;
    ov.height = main.height;
    ov.style.width = main.style.width;
    ov.style.height = main.style.height;
  }

  private drawCursor(
    pos: { x: number; y: number } | null,
    size: number,
    shape: 'square' | 'round',
    tool: string,
    caret: TextCaret | null,
    selection: TextSelection | null,
  ): void {
    const ov = this.overlay().nativeElement;
    const ctx = ov.getContext('2d');
    if (!ctx || !this.renderer) return;
    const dpr = ov.width / (parseFloat(ov.style.width) || ov.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = this.renderer.cellSize;
    if (tool === 'text') {
      const range = selectionRange(selection);
      if (range) drawSelection(ctx, cell, this.store.doc().width, range);
      if (caret) {
        drawCaret(ctx, cell, caret);
        // Keep the hidden textarea at the caret so IME popups appear there.
        const ta = this.textInput().nativeElement.style;
        ta.left = `${caret.x * cell.width}px`;
        ta.top = `${caret.y * cell.height}px`;
        ta.height = `${cell.height}px`;
      } else if (pos && !range) {
        drawFootprint(ctx, cell, pos, [{ x: 0, y: 0 }], false);
      }
      return;
    }
    if (pos) drawFootprint(ctx, cell, pos, brushOffsets(size, shape), tool === 'eraser');
  }
}

/** Highlights selected cells, one rectangle per row. */
function drawSelection(ctx: CanvasRenderingContext2D, cell: CellSize, docWidth: number, [start, end]: [number, number]): void {
  const { width: w, height: h } = cell;
  ctx.fillStyle = 'rgb(76 141 255 / 0.45)';
  for (let row = Math.floor(start / docWidth); row * docWidth < end; row++) {
    const x0 = Math.max(start, row * docWidth) - row * docWidth;
    const x1 = Math.min(end, (row + 1) * docWidth) - row * docWidth;
    ctx.fillRect(x0 * w, row * h, (x1 - x0) * w, h);
  }
}

/** Text caret bar, plus a faint guide at the left margin lines wrap back to. */
function drawCaret(ctx: CanvasRenderingContext2D, cell: CellSize, c: TextCaret): void {
  const { width: w, height: h } = cell;
  ctx.strokeStyle = 'rgb(76 141 255 / 0.6)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x0 * w + 0.5, c.y0 * h);
  ctx.lineTo(c.x0 * w + 0.5, (c.y0 + c.rows) * h);
  ctx.stroke();
  ctx.setLineDash([]);
  // A caret past the last column (end of a full line) is drawn just inside the edge.
  const cssWidth = ctx.canvas.width / ctx.getTransform().a;
  const x = Math.min(c.x * w, cssWidth - 2);
  ctx.fillStyle = 'rgb(0 0 0 / 0.7)';
  ctx.fillRect(x - 1, c.y * h, 4, h);
  ctx.fillStyle = 'rgb(255 255 255)';
  ctx.fillRect(x, c.y * h, 2, h);
}

/** Outlines the brush footprint: tinted cells plus a border around its outer edge. */
function drawFootprint(
  ctx: CanvasRenderingContext2D,
  cell: CellSize,
  pos: { x: number; y: number },
  offsets: { x: number; y: number }[],
  eraser: boolean,
): void {
  const set = new Set(offsets.map((o) => `${o.x},${o.y}`));
  const { width: w, height: h } = cell;
  ctx.fillStyle = eraser ? 'rgb(255 90 90 / 0.18)' : 'rgb(255 255 255 / 0.18)';
  ctx.beginPath();
  for (const o of offsets) {
    const x = (pos.x + o.x) * w;
    const y = (pos.y + o.y) * h;
    ctx.fillRect(x, y, w, h);
    if (!set.has(`${o.x},${o.y - 1}`)) (ctx.moveTo(x, y), ctx.lineTo(x + w, y));
    if (!set.has(`${o.x},${o.y + 1}`)) (ctx.moveTo(x, y + h), ctx.lineTo(x + w, y + h));
    if (!set.has(`${o.x - 1},${o.y}`)) (ctx.moveTo(x, y), ctx.lineTo(x, y + h));
    if (!set.has(`${o.x + 1},${o.y}`)) (ctx.moveTo(x + w, y), ctx.lineTo(x + w, y + h));
  }
  // Dark then light line so the outline shows on any color.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgb(0 0 0 / 0.7)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = eraser ? 'rgb(255 140 140)' : 'rgb(255 255 255)';
  ctx.stroke();
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
