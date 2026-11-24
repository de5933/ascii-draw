import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AdjustLayers, DEFAULT_ADJUST_LAYERS } from '../../core/adjust';
import { DEFAULT_NOISE, NoiseSettings, newSeed } from '../../core/noise';
import { EditorStore } from '../../state/editor.store';
import { ChannelToggle } from '../channel-toggle/channel-toggle';

type NumberKey = 'amount' | 'coverage';

/**
 * Adds random noise with a live preview on the canvas, to the chosen layers
 * of the selection or the whole image.
 */
@Component({
  selector: 'app-noise-dialog',
  imports: [ChannelToggle],
  template: `
    <dialog #dialog class="adjust" (cancel)="cancel($event)">
      <form method="dialog" (submit)="apply($event)">
        <h2>Add noise</h2>
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
              <input type="radio" name="noise-scope" [checked]="selectionOnly()" (change)="setScope(true)" />
              Selection ({{ selectionCells() }} cells)
            </label>
            <label class="check">
              <input type="radio" name="noise-scope" [checked]="!selectionOnly()" (change)="setScope(false)" />
              Whole image
            </label>
          </fieldset>
        }
        @for (s of sliders; track s.key) {
          <div class="slider">
            <label [for]="'noise-' + s.key">{{ s.label }}</label>
            <input
              type="range"
              [id]="'noise-' + s.key"
              [name]="s.key"
              [min]="s.min"
              max="100"
              step="1"
              [value]="settings()[s.key]"
              (input)="set(s.key, +$any($event.target).value)"
            />
            <input
              type="number"
              class="num"
              [attr.aria-label]="s.label + ' value'"
              [min]="s.min"
              max="100"
              [value]="settings()[s.key]"
              (change)="setClamped(s.key, s.min, $any($event.target))"
            />
            <span class="unit">%</span>
          </div>
        }
        <label class="check">
          <input
            type="checkbox"
            name="monochrome"
            [checked]="settings().monochrome"
            (change)="setMonochrome($any($event.target).checked)"
          />
          Monochrome (lighter/darker only, no color specks)
        </label>
        <div class="actions">
          <button type="button" (click)="reseed()" title="Try a different random pattern">New pattern</button>
          <span class="spacer"></span>
          <button type="button" (click)="cancel()">Cancel</button>
          <button type="submit" class="primary" [disabled]="settings().amount === 0 || settings().coverage === 0">
            Apply
          </button>
        </div>
      </form>
    </dialog>
  `,
  styleUrls: ['../dialog.css', '../import-dialog/import-dialog.css', '../adjust-dialog/adjust-dialog.css'],
})
export class NoiseDialog {
  private readonly store = inject(EditorStore);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly sliders: { key: NumberKey; label: string; min: number }[] = [
    { key: 'amount', label: 'Amount', min: 0 },
    { key: 'coverage', label: 'Coverage', min: 0 },
  ];

  /** Kept between uses in a session (a fresh pattern each time it opens). */
  protected readonly layers = signal<AdjustLayers>({ ...DEFAULT_ADJUST_LAYERS });
  protected readonly settings = signal<NoiseSettings>({ ...DEFAULT_NOISE });
  protected readonly selectionOnly = signal(true);
  protected readonly selectionCells = signal(0);
  protected readonly hint = computed(() => {
    const l = this.layers();
    if (l.ch) return 'Txt: characters are swapped for randomly brighter or darker ones.';
    return '';
  });

  private frame = 0;

  open(): void {
    if (this.dialogEl().nativeElement.open) return;
    this.settings.update((s) => ({ ...s, seed: newSeed() }));
    this.store.endText();
    this.selectionCells.set(this.store.selectedCellCount());
    this.selectionOnly.set(this.selectionCells() > 0);
    this.store.beginAdjust(this.selectionOnly());
    this.dialogEl().nativeElement.showModal();
    this.schedulePreview(); // the default amount shows right away
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

  protected set(key: NumberKey, value: number): void {
    this.settings.update((s) => ({ ...s, [key]: value }));
    this.schedulePreview();
  }

  protected setClamped(key: NumberKey, min: number, input: HTMLInputElement): void {
    const n = Math.round(Number(input.value));
    const v = Number.isFinite(n) ? Math.min(100, Math.max(min, n)) : min;
    input.value = String(v);
    this.set(key, v);
  }

  protected setMonochrome(on: boolean): void {
    this.settings.update((s) => ({ ...s, monochrome: on }));
    this.schedulePreview();
  }

  protected reseed(): void {
    this.settings.update((s) => ({ ...s, seed: newSeed() }));
    this.schedulePreview();
  }

  /** One preview per animation frame, however fast the slider moves. */
  private schedulePreview(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.store.previewNoise(this.settings(), this.layers());
    });
  }

  protected apply(e: Event): void {
    e.preventDefault();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.store.previewNoise(this.settings(), this.layers());
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
