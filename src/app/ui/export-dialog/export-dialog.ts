import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_EXPORT_CHANNELS,
  DEFAULT_EXPORT_SCALE,
  EXPORT_SCALES,
  ExportChannels,
  describeExport,
  docToText,
  drawExport,
  exportCell,
  exportFormat,
  pngSize,
  pngSizeOk,
} from '../../core/export';
import { loadFont } from '../../core/fonts/fonts';
import { EditorStore } from '../../state/editor.store';

/** Asks what to include, then downloads the document as PNG or plain text. */
@Component({
  selector: 'app-export-dialog',
  imports: [FormsModule],
  template: `
    <dialog #dialog>
      <form method="dialog" (submit)="doExport($event)">
        <h2>Export</h2>
        <fieldset class="apply">
          <legend>Include…</legend>
          @for (o of options; track o.key) {
            <label class="check">
              <input type="checkbox" [name]="'include-' + o.key" [ngModel]="include()[o.key]" (ngModelChange)="setInclude(o.key, $event)" />
              {{ o.label }}
            </label>
          }
          <p class="hint left">{{ summary() }}</p>
        </fieldset>
        @if (format() === 'png') {
          <label>
            Scale
            <select name="scale" [ngModel]="scale()" (ngModelChange)="scale.set(+$event)">
              @for (s of scales; track s) {
                <option [value]="s" [disabled]="!sizeOk(s)">{{ s }}× — {{ sizeLabel(s) }}</option>
              }
            </select>
          </label>
        }
        <label>
          File name
          <span class="filename">
            <input name="filename" required [ngModel]="fileName()" (ngModelChange)="fileName.set($event)" />
            @if (format()) {
              <span class="ext">.{{ format() }}</span>
            }
          </span>
        </label>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="primary" [disabled]="!format() || busy() || (format() === 'png' && !sizeOk(scale()))">
            Export
          </button>
        </div>
      </form>
    </dialog>
  `,
  styleUrls: ['../dialog.css', '../import-dialog/import-dialog.css', './export-dialog.css'],
})
export class ExportDialog {
  private readonly store = inject(EditorStore);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly options: { key: keyof ExportChannels; label: string }[] = [
    { key: 'ch', label: 'Text' },
    { key: 'fg', label: 'Foreground color' },
    { key: 'bg', label: 'Background color' },
  ];
  protected readonly scales = EXPORT_SCALES;
  /** Kept between exports in a session. */
  protected readonly include = signal<ExportChannels>({ ...DEFAULT_EXPORT_CHANNELS });
  protected readonly scale = signal<number>(DEFAULT_EXPORT_SCALE);
  protected readonly fileName = signal('untitled');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly format = computed(() => exportFormat(this.include()));
  protected readonly summary = computed(() => describeExport(this.include()));

  private readonly measureCtx = document.createElement('canvas').getContext('2d');

  async open(): Promise<void> {
    this.store.endText(); // export what's on screen, including text being typed
    this.fileName.set(this.store.docName());
    this.error.set('');
    // Measure with the real font so the size labels are right.
    await loadFont(this.store.font(), this.store.fontWeight());
    this.dialogEl().nativeElement.showModal();
  }

  protected setInclude(key: keyof ExportChannels, on: boolean): void {
    this.include.update((c) => ({ ...c, [key]: on }));
  }

  private size(scale: number) {
    if (!this.measureCtx) return { width: 0, height: 0 };
    const doc = this.store.doc();
    return pngSize(doc, exportCell(this.measureCtx, doc, this.store.font(), scale));
  }

  protected sizeOk(scale: number): boolean {
    return pngSizeOk(this.size(scale));
  }

  protected sizeLabel(scale: number): string {
    const s = this.size(scale);
    return `${s.width} × ${s.height} px${pngSizeOk(s) ? '' : ' (too large)'}`;
  }

  protected async doExport(e: Event): Promise<void> {
    e.preventDefault();
    const format = this.format();
    const name = this.fileName().trim().replace(/[\\/:*?"<>|]/g, '_') || 'untitled';
    if (!format) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const doc = this.store.doc();
      let blob: Blob;
      if (format === 'txt') {
        blob = new Blob([docToText(doc)], { type: 'text/plain;charset=utf-8' });
      } else {
        const font = this.store.font();
        await loadFont(font, doc.fontWeight);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        const cell = exportCell(ctx, doc, font, this.scale());
        const size = pngSize(doc, cell);
        if (!pngSizeOk(size)) throw new Error('That size is too large for the browser. Choose a smaller scale.');
        canvas.width = size.width;
        canvas.height = size.height;
        drawExport(ctx, doc, font, cell, this.scale(), this.include());
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
        );
      }
      download(blob, `${name}.${format}`);
      this.dialogEl().nativeElement.close();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
