import { Component, inject, output } from '@angular/core';
import { FONTS, WEIGHT_NAMES } from '../../core/fonts/fonts';
import { EditorStore } from '../../state/editor.store';

/** Top bar: document actions and view controls. */
@Component({
  selector: 'app-toolbar',
  template: `
    <span class="brand">ascii-draw</span>
    <button type="button" (click)="newDoc.emit()" title="New document (Alt+N)">New…</button>
    <button type="button" (click)="openImage.emit()" title="Open image (Ctrl+O), or drop a file anywhere">
      Open image…
    </button>
    <button type="button" (click)="export.emit()" title="Export as PNG or text (Ctrl+E)">Export…</button>
    <span class="sep"></span>
    <label class="field">
      Font
      <select [value]="store.doc().fontId" (change)="store.setFont($any($event.target).value)" aria-label="Document font">
        @for (f of fonts; track f.id) {
          <option [value]="f.id" [selected]="f.id === store.doc().fontId">{{ f.name }}</option>
        }
      </select>
    </label>
    <label class="field">
      Weight
      <select (change)="store.setFontWeight(+$any($event.target).value)" aria-label="Document font weight">
        @for (w of store.font().weights; track w) {
          <option [value]="w" [selected]="w === store.fontWeight()">{{ weightName(w) }}</option>
        }
      </select>
    </label>
    <span class="sep"></span>
    <button type="button" (click)="store.undo()" [disabled]="!store.canUndo()" title="Undo (Ctrl+Z)">Undo</button>
    <button type="button" (click)="store.redo()" [disabled]="!store.canRedo()" title="Redo (Ctrl+Shift+Z)">Redo</button>
    <span class="sep"></span>
    <button type="button" (click)="store.zoomOut()" title="Zoom out (-)">−</button>
    <span class="zoom">{{ store.zoom() * 100 }}%</span>
    <button type="button" (click)="store.zoomIn()" title="Zoom in (+)">+</button>
    <button type="button" (click)="store.setZoom(1)" title="Actual size (0)">1:1</button>
    <span class="sep"></span>
    <button type="button" [class.active]="store.showGrid()" (click)="store.toggleGrid()" title="Toggle grid (G)">
      Grid
    </button>
  `,
  styleUrl: './toolbar.css',
})
export class Toolbar {
  protected readonly store = inject(EditorStore);
  readonly newDoc = output<void>();
  readonly openImage = output<void>();
  readonly export = output<void>();
  protected readonly fonts = FONTS;

  protected weightName(w: number): string {
    return `${WEIGHT_NAMES[w] ?? ''} ${w}`.trim();
  }
}
