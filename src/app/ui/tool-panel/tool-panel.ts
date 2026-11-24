import { Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { fromHex, toCss, toHex } from '../../core/color';
import { clipLayers, describeClip } from '../../core/tools/clip';
import { ChannelToggle } from '../channel-toggle/channel-toggle';
import { EditorStore, MAX_BRUSH_SIZE } from '../../state/editor.store';

/** Left sidebar: tool, brush, channel toggles, colors and character. */
@Component({
  selector: 'app-tool-panel',
  imports: [ChannelToggle],
  template: `
    <section>
      <h3>Tool</h3>
      <div class="tools">
        <button type="button" [class.active]="store.tool() === 'brush'" (click)="store.setTool('brush')" title="Brush (B)">
          Brush
        </button>
        <button type="button" [class.active]="store.tool() === 'eraser'" (click)="store.setTool('eraser')" title="Eraser (E)">
          Eraser
        </button>
        <button type="button" [class.active]="store.tool() === 'text'" (click)="store.setTool('text')" title="Text (T)">
          Text
        </button>
        <button type="button" [class.active]="store.tool() === 'select'" (click)="store.setTool('select')" title="Select (M)">
          Select
        </button>
      </div>
      @if (store.tool() === 'text') {
        <p class="muted small">
          Click a cell and type. Lines wrap at the right edge and start at the column you clicked.
          Drag, Shift+arrows or double-click to select; Ctrl+A selects all. Ctrl+C / X / V copy, cut
          and paste. Esc finishes.
        </p>
      }
      @if (store.tool() === 'select') {
        <p class="muted small">
          Drag a rectangle; hold Ctrl for a square. Ctrl+A selects all. Ctrl+C / X / V copy, cut and
          paste (at the pointer, else the selection); Delete clears. Esc deselects.
        </p>
      }
    </section>

    @if (store.tool() === 'select') {
      <section>
        <h3>Copy, cut &amp; delete</h3>
        <app-channel-toggle [value]="store.copyLayers()" (valueChange)="store.setCopyLayers($event)" />
        <div class="row actions">
          <button type="button" [disabled]="!canCopy()" (click)="copy(false)" title="Copy (Ctrl+C)">Copy</button>
          <button type="button" [disabled]="!canCopy()" (click)="copy(true)" title="Cut (Ctrl+X)">Cut</button>
          <button type="button" [disabled]="!canCopy()" (click)="store.deleteRect()" title="Delete (Del)">Delete</button>
        </div>
      </section>
      <section>
        <h3>Paste into</h3>
        @if (store.clipboard(); as clip) {
          <p class="muted small clip">{{ clipLabel() }}</p>
          <app-channel-toggle
            [value]="store.pasteTargets()"
            (valueChange)="store.setPasteTargets($event)"
            [rules]="store.pasteRules()"
          />
          @if (single()) {
            <p class="muted small">One channel was copied, so it can go into any channels. Color into Txt picks characters by brightness.</p>
          }
          <div class="row actions">
            <button type="button" (click)="pasteHere()" title="Paste (Ctrl+V)">Paste</button>
          </div>
        } @else {
          <p class="muted small">Nothing copied yet.</p>
        }
      </section>
    }

    @if (store.tool() !== 'text' && store.tool() !== 'select') {
    <section>
      <h3>Size <span class="muted">{{ store.brushSize() }}</span></h3>
      <input
        type="range"
        min="1"
        [max]="maxSize"
        [value]="store.brushSize()"
        (input)="store.setBrushSize(+$any($event.target).value)"
        title="Brush size ([ and ])"
        aria-label="Brush size"
      />
      <div class="row">
        <button type="button" [class.active]="store.brushShape() === 'square'" (click)="store.brushShape.set('square')">
          Square
        </button>
        <button type="button" [class.active]="store.brushShape() === 'round'" (click)="store.brushShape.set('round')">
          Round
        </button>
      </div>
    </section>
    }

    @if (store.tool() !== 'select') {
      <section>
        <h3>Channels</h3>
        <app-channel-toggle
          label=""
          [value]="store.channels()"
          (valueChange)="store.setChannels($event)"
          [rules]="store.channelRules()"
          [hints]="channelHints"
        />
      </section>
    }

    <section>
      <h3>Colors</h3>
      <div class="colors">
        <label class="swatch fg" title="Foreground color">
          <input type="color" [value]="fgHex()" (input)="store.fg.set(hex($event))" aria-label="Foreground color" />
        </label>
        <label class="swatch bg" title="Background color">
          <input type="color" [value]="bgHex()" (input)="store.bg.set(hex($event))" aria-label="Background color" />
        </label>
        <div class="color-actions">
          <button type="button" (click)="store.swapColors()" title="Swap colors (X)">⇄</button>
          <button type="button" (click)="store.resetColors()" title="Reset to white on black (D)">↺</button>
        </div>
      </div>
      <div class="labels"><span>FG {{ fgHex() }}</span><span>BG {{ bgHex() }}</span></div>
    </section>

    <section>
      <h3>Character</h3>
      <div class="char-row">
        <div class="char-preview" [style.color]="fgCss()" [style.background]="bgCss()" [style.font-family]="store.font().family" [style.font-weight]="store.fontWeight()">
          {{ store.ch() }}
        </div>
        <input
          #charInput
          class="char-input"
          [value]="store.ch()"
          (input)="onCharInput($event)"
          (focus)="charInput.select()"
          (keydown.enter)="charInput.blur()"
          (keydown.escape)="charInput.blur()"
          title="Type a character (C)"
          aria-label="Character"
        />
      </div>
      <div class="glyphs" [style.font-family]="store.font().family" [style.font-weight]="store.fontWeight()">
        @for (g of glyphs(); track g[0]) {
          <button
            type="button"
            [class.active]="g[0] === store.ch()"
            (click)="store.setChar(g[0])"
            [title]="glyphTitle(g)"
          >{{ g[0] === ' ' ? '␣' : g[0] }}</button>
        }
      </div>
      <p class="muted small">Darkest → brightest. Alt+click the canvas to pick from a cell.</p>
    </section>
  `,
  styleUrl: './tool-panel.css',
})
export class ToolPanel {
  protected readonly store = inject(EditorStore);
  private readonly charInput = viewChild.required<ElementRef<HTMLInputElement>>('charInput');

  protected readonly maxSize = MAX_BRUSH_SIZE;
  protected readonly channelHints = { fg: 'shortcut 1', bg: 'shortcut 2', ch: 'shortcut 3' };
  protected readonly fgHex = computed(() => toHex(this.store.fg()));
  protected readonly bgHex = computed(() => toHex(this.store.bg()));
  protected readonly fgCss = computed(() => toCss(this.store.fg()));
  protected readonly bgCss = computed(() => toCss(this.store.bg()));
  protected readonly glyphs = this.store.glyphs;
  protected readonly canCopy = computed(() => !!this.store.rect() && Object.values(this.store.copyLayers()).some(Boolean));
  protected readonly single = computed(() => {
    const clip = this.store.clipboard();
    return !!clip && clipLayers(clip).length === 1;
  });
  protected readonly clipLabel = computed(() => {
    const clip = this.store.clipboard();
    return clip ? `Clipboard ${describeClip(clip)}` : '';
  });

  /** Panel buttons: the cells go to our clipboard; the text (if any) to the system one too. */
  protected copy(cut: boolean): void {
    const clip = cut ? this.store.cutRect() : this.store.copyRect();
    if (clip) navigator.clipboard?.writeText(clip.text).catch(() => {});
  }

  protected pasteHere(): void {
    const r = this.store.rect();
    this.store.paste(r ? { x: r.x, y: r.y } : { x: 0, y: 0 });
  }

  focusCharInput(): void {
    this.charInput().nativeElement.focus();
  }

  protected hex(e: Event): number {
    return fromHex((e.target as HTMLInputElement).value);
  }

  protected onCharInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    // The character just typed is the one before the caret; keep the field showing exactly one.
    const typed = [...input.value.slice(0, input.selectionStart ?? input.value.length)].at(-1);
    if (typed) this.store.setChar(typed);
    input.value = this.store.ch();
    input.select();
  }

  protected glyphTitle(g: readonly [string, number]): string {
    return `${g[0] === ' ' ? 'space' : g[0]} — brightness ${Math.round(g[1] * 100)}%`;
  }
}
