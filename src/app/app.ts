import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { EditorStore } from './state/editor.store';
import { AdjustDialog } from './ui/adjust-dialog/adjust-dialog';
import { CanvasView, dialogOpen, isTypingTarget } from './ui/canvas-view/canvas-view';
import { ExportDialog } from './ui/export-dialog/export-dialog';
import { ImportDialog } from './ui/import-dialog/import-dialog';
import { NewDocDialog } from './ui/new-doc-dialog/new-doc-dialog';
import { StatusBar } from './ui/status-bar/status-bar';
import { ToolPanel } from './ui/tool-panel/tool-panel';
import { Toolbar } from './ui/toolbar/toolbar';

@Component({
  selector: 'app-root',
  imports: [Toolbar, ToolPanel, CanvasView, StatusBar, NewDocDialog, ImportDialog, ExportDialog, AdjustDialog],
  template: `
    <app-toolbar (newDoc)="newDocDialog().open()" (openImage)="fileInput.click()" (export)="exportDialog().open()"
      (adjust)="adjustDialog().open()"
    />
    <app-tool-panel />
    <app-canvas-view />
    <app-status-bar />
    <app-new-doc-dialog />
    <app-import-dialog />
    <app-export-dialog />
    <app-adjust-dialog />
    <input #fileInput type="file" accept="image/*" hidden (change)="onFilePicked(fileInput)" />
    @if (dragging()) {
      <div class="drop-overlay">Drop an image to import it</div>
    }
    @if (notice(); as n) {
      <div class="notice" role="alert">
        {{ n }}
        <button type="button" (click)="notice.set(null)" aria-label="Dismiss">×</button>
      </div>
    }
  `,
  styleUrl: './app.css',
  host: {
    '(window:keydown)': 'onKeydown($event)',
    '(window:dragover)': 'onDragOver($event)',
    '(window:dragleave)': 'onDragLeave($event)',
    '(window:drop)': 'onDrop($event)',
  },
})
export class App {
  private readonly store = inject(EditorStore);
  protected readonly newDocDialog = viewChild.required(NewDocDialog);
  private readonly importDialog = viewChild.required(ImportDialog);
  protected readonly exportDialog = viewChild.required(ExportDialog);
  protected readonly adjustDialog = viewChild.required(AdjustDialog);
  private readonly toolPanel = viewChild.required(ToolPanel);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly dragging = signal(false);
  protected readonly notice = signal<string | null>(null);

  protected onFilePicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (file) this.importFile(file);
  }

  private importFile(file: File): void {
    this.notice.set(null);
    this.importDialog()
      .open(file)
      .catch((err: Error) => this.notice.set(err.message));
  }

  protected onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected onDragLeave(e: DragEvent): void {
    // relatedTarget is null when the drag leaves the window entirely
    if (!e.relatedTarget) this.dragging.set(false);
  }

  protected onDrop(e: DragEvent): void {
    this.dragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    this.importFile(file);
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (dialogOpen()) return;
    const key = e.key.toLowerCase();
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    // Not text-editing keys, so these work even while typing.
    if (ctrl && (key === 'o' || key === 'e' || key === 'u')) {
      e.preventDefault();
      if (key === 'o') this.fileInput().nativeElement.click();
      else if (key === 'e') this.exportDialog().open();
      else this.adjustDialog().open();
      return;
    }
    if (isTypingTarget(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (key === 'z' && !e.shiftKey) this.store.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') this.store.redo();
      else return;
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey) {
      if (key === 'n') {
        e.preventDefault();
        this.newDocDialog().open();
      }
      return;
    }
    switch (e.key) {
      case '+':
      case '=':
        this.store.zoomIn();
        break;
      case '-':
        this.store.zoomOut();
        break;
      case '0':
        this.store.setZoom(1);
        break;
      case 'g':
      case 'G':
        this.store.toggleGrid();
        break;
      case 'b':
      case 'B':
        this.store.setTool('brush');
        break;
      case 'e':
      case 'E':
        this.store.setTool('eraser');
        break;
      case 'x':
      case 'X':
        this.store.swapColors();
        break;
      case 'd':
      case 'D':
        this.store.resetColors();
        break;
      case '[':
        this.store.setBrushSize(this.store.brushSize() - 1);
        break;
      case ']':
        this.store.setBrushSize(this.store.brushSize() + 1);
        break;
      case '1':
        this.store.toggleChannel('fg');
        break;
      case '2':
        this.store.toggleChannel('bg');
        break;
      case '3':
        this.store.toggleChannel('ch');
        break;
      case 't':
      case 'T':
        this.store.setTool('text');
        break;
      case 'm':
      case 'M':
        this.store.setTool('select');
        break;
      case 'Delete':
      case 'Backspace':
        if (this.store.tool() !== 'select' || !this.store.deleteRect()) return;
        break;
      case 'Escape':
        if (this.store.tool() !== 'select' || !this.store.rect()) return;
        this.store.clearRect();
        break;
      case 'c':
      case 'C':
        this.toolPanel().focusCharInput();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
