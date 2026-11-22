import { Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { fromHex, toCss, toHex } from '../../core/color';
import { Layer, canPasteInto, clipLayers, describeClip } from '../../core/tools/clip';
import { Channels } from '../../core/tools/paint';
import { EditorStore, MAX_BRUSH_SIZE } from '../../state/editor.store';

/** Left sidebar: tool, brush, channel toggles, colors and character. */
@Component({
  selector: 'app-tool-panel',
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
        <div class="checks">
          @for (l of layerList; track l.key) {
            <label>
              <input type="checkbox" [checked]="store.copyLayers()[l.key]" (change)="store.setCopyLayer(l.key, $any($event.target).checked)" />
              {{ l.label }}
            </label>
          }
        </div>
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
          <div class="checks">
            @for (l of layerList; track l.key) {
              <label [class.disabled]="!pasteAllowed(l.key)">
                <input
                  type="checkbox"
                  [checked]="store.pasteTargets()[l.key] && pasteAllowed(l.key)"
                  [disabled]="!pasteAllowed(l.key)"
                  (change)="store.setPasteTarget(l.key, $any($event.target).checked)"
                />
                {{ l.label }}
              </label>
            }
          </div>
          @if (single()) {
            <p class="muted small">One layer was copied, so it can go into any layers. Color into text picks characters by brightness.</p>
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
      <h3>Affects</h3>
      <div class="row">
        @for (c of channelList; track c.key) {
          <button
            type="button"
            [class.active]="store.channels()[c.key] || (c.key === 'ch' && store.tool() === 'text')"
            [attr.aria-pressed]="store.channels()[c.key]"
            [disabled]="c.key === 'ch' && store.tool() === 'text'"
            (click)="store.toggleChannel(c.key)"
            [title]="c.key === 'ch' && store.tool() === 'text' ? 'Typing always writes characters' : c.title"
          >
            {{ c.label }}
          </button>
        }
      </div>
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
  protected readonly channelList: { key: keyof Channels; label: string; title: string }[] = [
    { key: 'fg', label: 'FG', title: 'Paint foreground color (1)' },
    { key: 'bg', label: 'BG', title: 'Paint background color (2)' },
    { key: 'ch', label: 'Char', title: 'Paint character (3)' },
  ];
  protected readonly fgHex = computed(() => toHex(this.store.fg()));
  protected readonly bgHex = computed(() => toHex(this.store.bg()));
  protected readonly fgCss = computed(() => toCss(this.store.fg()));
  protected readonly bgCss = computed(() => toCss(this.store.bg()));
  protected readonly glyphs = this.store.glyphs;
  protected readonly layerList: { key: Layer; label: string }[] = [
    { key: 'fg', label: 'Foreground color' },
    { key: 'bg', label: 'Background color' },
    { key: 'ch', label: 'Text' },
  ];
  protected readonly canCopy = computed(() => !!this.store.rect() && Object.values(this.store.copyLayers()).some(Boolean));
  protected readonly single = computed(() => {
    const clip = this.store.clipboard();
    return !!clip && clipLayers(clip).length === 1;
  });
  protected readonly clipLabel = computed(() => {
    const clip = this.store.clipboard();
    return clip ? `Clipboard ${describeClip(clip)}` : '';
  });

  protected pasteAllowed(layer: Layer): boolean {
    const clip = this.store.clipboard();
    return !!clip && canPasteInto(clip, layer);
  }

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
