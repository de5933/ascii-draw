import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_DOC_SIZE } from '../../core/document';
import { FONTS, getFont, nearestWeight } from '../../core/fonts/fonts';
import {
  DEFAULT_IMPORT_CHANNELS,
  DEFAULT_IMPORT_WIDTH,
  IMPORT_CHAR,
  ImportChannels,
  clampSize,
  downsampleArea,
  importCols,
  importRows,
  pixelsToDoc,
} from '../../core/import';
import { EditorStore } from '../../state/editor.store';
import { decodeImage, measureCellAspect, readPixels } from './image-loader';

/** Pre-shrink factor: the browser scales to at most this many source px per cell before area averaging. */
const OVERSAMPLE = 4;

/** Asks how big to make an imported image, then replaces the document with it. */
@Component({
  selector: 'app-import-dialog',
  imports: [FormsModule],
  template: `
    <dialog #dialog (close)="cleanup()">
      <form method="dialog" (submit)="doImport($event)">
        <h2>Import image</h2>
        @if (previewUrl()) {
          <img class="preview" [src]="previewUrl()" alt="Preview of the image to import" />
        }
        <p class="meta">{{ fileName() }} · {{ srcW() }} × {{ srcH() }} px</p>
        <label>
          Width (cells)
          <input type="number" name="cols" min="1" [max]="max" required
            [ngModel]="cols()" (ngModelChange)="setCols($event)" />
        </label>
        <label>
          Height (cells)
          <input type="number" name="rows" min="1" [max]="max" required
            [ngModel]="rows()" (ngModelChange)="setRows($event)" />
        </label>
        <label class="check">
          <input type="checkbox" name="lock" [ngModel]="lockAspect()" (ngModelChange)="setLock($event)" />
          Keep aspect ratio
        </label>
        <label>
          Font
          <select name="font" [ngModel]="fontId()" (ngModelChange)="setFont($event)">
            @for (f of fonts; track f.id) {
              <option [value]="f.id">{{ f.name }}</option>
            }
          </select>
        </label>
        <fieldset class="apply">
          <legend>Apply to…</legend>
          @for (o of applyOptions; track o.key) {
            <label class="check">
              <input type="checkbox" [name]="'apply-' + o.key" [ngModel]="apply()[o.key]" (ngModelChange)="setApply(o.key, $event)" />
              {{ o.label }}
            </label>
          }
          <p class="hint left">
            @if (!anyApplied()) {
              Choose at least one.
            } @else {
              {{ applySummary() }}
            }
          </p>
        </fieldset>
        <p class="hint">Replaces the current document.</p>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="primary" [disabled]="busy() || !anyApplied()">Import</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrls: ['../dialog.css', './import-dialog.css'],
})
export class ImportDialog {
  private readonly store = inject(EditorStore);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly fonts = FONTS;
  protected readonly max = MAX_DOC_SIZE;
  protected readonly fileName = signal('');
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly srcW = signal(0);
  protected readonly srcH = signal(0);
  protected readonly cols = signal(DEFAULT_IMPORT_WIDTH);
  protected readonly rows = signal(1);
  protected readonly lockAspect = signal(true);
  protected readonly fontId = signal(this.store.doc().fontId);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly applyOptions: { key: keyof ImportChannels; label: string }[] = [
    { key: 'ch', label: 'Text' },
    { key: 'fg', label: 'Foreground color' },
    { key: 'bg', label: 'Background color' },
  ];
  /** Kept between imports in a session. */
  protected readonly apply = signal<ImportChannels>({ ...DEFAULT_IMPORT_CHANNELS });
  protected readonly anyApplied = computed(() => Object.values(this.apply()).some(Boolean));
  protected readonly applySummary = computed(() => {
    const a = this.apply();
    const ch = a.ch ? 'characters by brightness' : `"${IMPORT_CHAR}" characters`;
    const fg = a.fg ? 'in image colors' : 'in white';
    const bg = a.bg ? 'on image colors' : 'on black';
    return `Result: ${ch} ${fg} ${bg}.`;
  });

  private bitmap?: ImageBitmap;
  private cellAspect = 2;

  /** Decodes the file and shows the dialog. Rejects if the file isn't a readable image. */
  async open(file: File): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodeImage(file);
    } catch {
      throw new Error(`Couldn't read "${file.name}" as an image.`);
    }
    this.cleanup();
    this.bitmap = bitmap;
    this.fileName.set(file.name);
    this.previewUrl.set(URL.createObjectURL(file));
    this.srcW.set(bitmap.width);
    this.srcH.set(bitmap.height);
    this.error.set('');
    this.lockAspect.set(true);
    this.fontId.set(this.store.doc().fontId);
    this.cellAspect = await measureCellAspect(getFont(this.fontId()), this.weight());
    this.cols.set(clampSize(Math.min(DEFAULT_IMPORT_WIDTH, bitmap.width)));
    this.updateRows();
    this.dialogEl().nativeElement.showModal();
  }

  /** The import uses the current document's weight, or the nearest the chosen font has. */
  private weight(): number {
    return nearestWeight(getFont(this.fontId()), this.store.doc().fontWeight);
  }

  protected setApply(key: keyof ImportChannels, on: boolean): void {
    this.apply.update((a) => ({ ...a, [key]: on }));
  }

  protected setCols(v: number): void {
    this.cols.set(v);
    if (this.lockAspect() && v >= 1) this.updateRows();
  }

  protected setRows(v: number): void {
    this.rows.set(v);
    if (this.lockAspect() && v >= 1) this.cols.set(importCols(this.srcW(), this.srcH(), v, this.cellAspect));
  }

  protected setLock(v: boolean): void {
    this.lockAspect.set(v);
    if (v) this.updateRows();
  }

  protected async setFont(id: string): Promise<void> {
    this.fontId.set(id);
    this.cellAspect = await measureCellAspect(getFont(id), this.weight());
    if (this.lockAspect()) this.updateRows();
  }

  private updateRows(): void {
    this.rows.set(importRows(this.srcW(), this.srcH(), Number(this.cols()), this.cellAspect));
  }

  protected doImport(e: Event): void {
    e.preventDefault();
    if (!this.bitmap || !this.anyApplied()) return;
    const cols = Number(this.cols());
    const rows = Number(this.rows());
    if (!(cols >= 1 && rows >= 1 && cols <= MAX_DOC_SIZE && rows <= MAX_DOC_SIZE)) {
      this.error.set(`Size must be between 1 and ${MAX_DOC_SIZE}.`);
      return;
    }
    this.busy.set(true);
    try {
      const src = readPixels(this.bitmap, cols * OVERSAMPLE, rows * OVERSAMPLE);
      const doc = pixelsToDoc(
        downsampleArea(src, Math.round(cols), Math.round(rows)),
        getFont(this.fontId()),
        this.apply(),
        this.weight(),
      );
      this.store.loadDoc(doc, this.fileName().replace(/\.[^.]*$/, '') || 'untitled');
      this.dialogEl().nativeElement.close();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected cleanup(): void {
    this.bitmap?.close();
    this.bitmap = undefined;
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
  }
}
