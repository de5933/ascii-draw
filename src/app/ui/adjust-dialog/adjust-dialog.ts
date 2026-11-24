import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AdjustLayers, Adjustments, DEFAULT_ADJUST_LAYERS, NO_ADJUSTMENTS, isIdentity } from '../../core/adjust';
import { EditorStore } from '../../state/editor.store';
import { ChannelToggle } from '../channel-toggle/channel-toggle';

interface Slider {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  unit: string;
}

/**
 * Brightness/contrast and hue/saturation/lightness with a live preview on the
 * canvas, applied to the chosen layers of the selection or the whole image.
 */
@Component({
  selector: 'app-adjust-dialog',
  imports: [ChannelToggle],
  template: `
    <dialog #dialog class="adjust" (cancel)="cancel($event)">
      <form method="dialog" (submit)="apply($event)">
        <h2>Adjust colors</h2>
        <fieldset class="apply">
          <legend>Channels</legend>
          <app-channel-toggle label="" [value]="layers()" (valueChange)="setLayers($event)" />
          @if (hint(); as h) {
            <p class="hint left">{{ h }}</p>
          }
        </fieldset>
        @if (selectionCells()) {
          <fieldset class="apply scope">
            <legend>Cells</legend>
            <label class="check">
              <input type="radio" name="scope" [checked]="selectionOnly()" (change)="setScope(true)" />
              Selection ({{ selectionCells() }} cells)
            </label>
            <label class="check">
              <input type="radio" name="scope" [checked]="!selectionOnly()" (change)="setScope(false)" />
              Whole image
            </label>
          </fieldset>
        }
        @for (s of sliders; track s.key) {
          @if (s.key === 'hue') {
            <hr />
          }
          <div class="slider">
            <label [for]="'adj-' + s.key">{{ s.label }}</label>
            <input
              type="range"
              [id]="'adj-' + s.key"
              [name]="s.key"
              [min]="s.min"
              [max]="s.max"
              step="1"
              [value]="values()[s.key]"
              (input)="set(s.key, +$any($event.target).value)"
              (dblclick)="set(s.key, 0)"
            />
            <input
              type="number"
              class="num"
              [attr.aria-label]="s.label + ' value'"
              [min]="s.min"
              [max]="s.max"
              [value]="values()[s.key]"
              (change)="setClamped(s, $any($event.target))"
            />
            <span class="unit">{{ s.unit }}</span>
          </div>
        }
        <div class="actions">
          <button type="button" (click)="reset()" [disabled]="identity()">Reset</button>
          <span class="spacer"></span>
          <button type="button" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="identity()">Apply</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrls: ['../dialog.css', '../import-dialog/import-dialog.css', './adjust-dialog.css'],
})
export class AdjustDialog {
  private readonly store = inject(EditorStore);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly sliders: Slider[] = [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, unit: '' },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, unit: '' },
    { key: 'hue', label: 'Hue', min: -180, max: 180, unit: '°' },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, unit: '' },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, unit: '' },
  ];

  /** Kept between uses in a session. */
  protected readonly layers = signal<AdjustLayers>({ ...DEFAULT_ADJUST_LAYERS });
  protected readonly values = signal<Adjustments>({ ...NO_ADJUSTMENTS });
  protected readonly selectionOnly = signal(true);
  protected readonly selectionCells = signal(0);
  protected readonly identity = computed(() => isIdentity(this.values()));
  protected readonly hint = computed(() => {
    const l = this.layers();
    const v = this.values();
    if (l.ch && !l.fg && !l.bg && (v.hue || v.saturation)) return "Hue and saturation don't change Txt.";
    if (l.ch) return 'Txt: characters are swapped for brighter or darker ones.';
    return '';
  });

  private frame = 0;

  open(): void {
    if (this.dialogEl().nativeElement.open) return;
    this.values.set({ ...NO_ADJUSTMENTS });
    this.store.endText();
    this.selectionCells.set(this.store.selectedCellCount());
    this.selectionOnly.set(this.selectionCells() > 0);
    this.store.beginAdjust(this.selectionOnly());
    this.dialogEl().nativeElement.showModal();
  }

  protected setLayers(layers: AdjustLayers): void {
    this.layers.set(layers);
    this.schedulePreview();
  }

  protected setScope(selectionOnly: boolean): void {
    this.selectionOnly.set(selectionOnly);
    this.store.cancelAdjust();
    this.store.beginAdjust(selectionOnly);
    this.schedulePreview();
  }

  protected set(key: keyof Adjustments, value: number): void {
    this.values.update((v) => ({ ...v, [key]: value }));
    this.schedulePreview();
  }

  protected setClamped(s: Slider, input: HTMLInputElement): void {
    const n = Math.round(Number(input.value));
    const v = Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : 0;
    input.value = String(v);
    this.set(s.key, v);
  }

  protected reset(): void {
    this.values.set({ ...NO_ADJUSTMENTS });
    this.schedulePreview();
  }

  /** One preview per animation frame, however fast the slider moves. */
  private schedulePreview(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.store.previewAdjust(this.values(), this.layers());
    });
  }

  private flushPreview(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.store.previewAdjust(this.values(), this.layers());
  }

  protected apply(e: Event): void {
    e.preventDefault();
    this.flushPreview();
    this.store.commitAdjust();
    this.dialogEl().nativeElement.close();
  }

  protected cancel(e?: Event): void {
    e?.preventDefault(); // Esc: close ourselves after restoring
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.store.cancelAdjust();
    this.dialogEl().nativeElement.close();
  }
}
