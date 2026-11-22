import { Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_DOC_SIZE } from '../../core/document';
import { FONTS } from '../../core/fonts/fonts';
import { EditorStore } from '../../state/editor.store';

/** Modal for creating a blank document. Call open() to show it. */
@Component({
  selector: 'app-new-doc-dialog',
  imports: [FormsModule],
  template: `
    <dialog #dialog (close)="closed.emit()">
      <form method="dialog" (submit)="create($event)">
        <h2>New document</h2>
        <label>
          Width (cells)
          <input type="number" name="width" min="1" [max]="max" required [(ngModel)]="width" />
        </label>
        <label>
          Height (cells)
          <input type="number" name="height" min="1" [max]="max" required [(ngModel)]="height" />
        </label>
        <label>
          Font
          <select name="font" [(ngModel)]="fontId">
            @for (f of fonts; track f.id) {
              <option [value]="f.id">{{ f.name }}</option>
            }
          </select>
        </label>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="primary">Create</button>
        </div>
      </form>
    </dialog>
  `,
  styleUrl: '../dialog.css',
})
export class NewDocDialog {
  private readonly store = inject(EditorStore);
  private readonly dialogEl = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly closed = output<void>();

  protected readonly fonts = FONTS;
  protected readonly max = MAX_DOC_SIZE;
  protected width = 80;
  protected height = 40;
  protected fontId = this.store.doc().fontId;
  protected readonly error = signal('');

  open(): void {
    const doc = this.store.doc();
    this.width = doc.width;
    this.height = doc.height;
    this.fontId = doc.fontId;
    this.error.set('');
    this.dialogEl().nativeElement.showModal();
  }

  protected create(e: Event): void {
    e.preventDefault();
    try {
      this.store.newDoc(Number(this.width), Number(this.height), this.fontId);
      this.dialogEl().nativeElement.close();
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }
}
