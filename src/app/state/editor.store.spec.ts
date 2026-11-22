import { TestBed } from '@angular/core/testing';
import { packRgba } from '../core/color';
import { getCell } from '../core/document';
import { FONTS } from '../core/fonts/fonts';
import { EditorStore, ZOOM_LEVELS } from './editor.store';

describe('EditorStore', () => {
  let store: EditorStore;
  beforeEach(() => (store = TestBed.inject(EditorStore)));

  it('steps through zoom levels and clamps at the ends', () => {
    store.setZoom(1);
    store.zoomIn();
    expect(store.zoom()).toBe(1.5);
    store.zoomOut();
    store.zoomOut();
    expect(store.zoom()).toBe(0.75);
    store.setZoom(100);
    expect(store.zoom()).toBe(ZOOM_LEVELS.at(-1));
    store.zoomIn();
    expect(store.zoom()).toBe(ZOOM_LEVELS.at(-1));
  });

  it('creates new documents', () => {
    store.newDoc(12, 7, FONTS[1].id);
    expect(store.doc().width).toBe(12);
    expect(store.font()).toBe(FONTS[1]);
  });

  it('rejects unknown fonts', () => {
    expect(() => store.setFont('comic-sans')).toThrow();
  });

  it('paints strokes, tracks dirty cells, and undoes/redoes them', () => {
    store.newDoc(10, 10, FONTS[0].id);
    store.fg.set(packRgba(255, 0, 0));
    store.setChar('A');
    store.beginStroke(1, 1);
    store.strokeTo(4, 1);
    expect(store.stroking).toBe(true);
    store.endStroke();
    expect(store.takeDirtyCells().length).toBe(4);
    expect(getCell(store.doc(), 3, 1).ch).toBe('A');
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(getCell(store.doc(), 3, 1).ch).toBe(' ');
    expect(store.takeDirtyCells().length).toBe(4);
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(getCell(store.doc(), 3, 1).ch).toBe('A');
  });

  it('loading a document clears history', () => {
    store.beginStroke(0, 0);
    store.endStroke();
    expect(store.canUndo()).toBe(true);
    store.newDoc(5, 5, FONTS[0].id);
    expect(store.canUndo()).toBe(false);
  });

  it('picks colors and char from a cell', () => {
    store.newDoc(3, 3, FONTS[0].id);
    store.fg.set(packRgba(1, 2, 3));
    store.bg.set(packRgba(4, 5, 6));
    store.setChar('#');
    store.beginStroke(1, 1);
    store.endStroke();
    store.resetColors();
    store.setChar('x');
    store.pickFrom(1, 1);
    expect([store.fg(), store.bg(), store.ch()]).toEqual([packRgba(1, 2, 3), packRgba(4, 5, 6), '#']);
  });

  it('validates character and brush size input', () => {
    store.setChar('');
    store.setChar('\n');
    store.setChar('😀'); // outside the 16-bit cell storage
    expect(store.ch()).toBe('@');
    store.setChar('Q');
    expect(store.ch()).toBe('Q');
    store.setBrushSize(0);
    expect(store.brushSize()).toBe(1);
    store.setBrushSize(999);
    expect(store.brushSize()).toBe(25);
  });

  describe('text selection', () => {
    function row(y: number): string {
      const d = store.doc();
      let s = '';
      for (let x = 0; x < d.width; x++) s += getCell(d, x, y).ch;
      return s;
    }

    beforeEach(() => {
      store.newDoc(10, 3, FONTS[0].id);
      store.setTool('text');
      store.startText(0, 0);
      store.typeText('hello you\nthere');
      store.endText();
    });

    it('selects all and copies the image as text', () => {
      store.selectAll();
      expect(store.selectionSize()).toBe(30);
      expect(store.selectedText()).toBe('hello you\nthere\n');
    });

    it('deletes a selection by blanking it, keeping colors, as one undo step', () => {
      const fgBefore = getCell(store.doc(), 1, 0).fg;
      store.selectCellRange({ x: 1, y: 0 }, { x: 3, y: 0 });
      expect(store.selectedText()).toBe('ell');
      store.textBackspace();
      expect(row(0)).toBe('h   o you ');
      expect(getCell(store.doc(), 1, 0).fg).toBe(fgBefore);
      expect(store.selection()).toBeNull();
      expect(store.textCaret()).toMatchObject({ x: 1, y: 0 });
      store.undo();
      expect(row(0)).toBe('hello you ');
    });

    it('typing replaces the selection, and undoes in one step', () => {
      store.selectWordAt(7, 0); // "you"
      store.typeText('me');
      expect(row(0)).toBe('hello me  ');
      store.typeText('!');
      expect(row(0)).toBe('hello me! ');
      store.undo();
      expect(row(0)).toBe('hello you ');
    });

    it('extends with Shift+arrows from the caret, and collapses with arrows', () => {
      store.startText(0, 1);
      store.extendSelection('right');
      store.extendSelection('right');
      expect(store.selectedText()).toBe('th');
      store.extendSelection('end');
      expect(store.selectedText()).toBe('there');
      store.moveTextCaret('left');
      expect(store.selection()).toBeNull();
      expect(store.textCaret()).toMatchObject({ x: 0, y: 1 });
    });

    it('extends to a shift-clicked cell', () => {
      store.startText(6, 0);
      store.extendSelectionToCell({ x: 2, y: 1 });
      expect(store.selectedText()).toBe('you\nthe');
    });

    it('switching tools clears the selection', () => {
      store.selectAll();
      store.setTool('brush');
      expect(store.selection()).toBeNull();
    });
  });

  describe('document font', () => {
    it('changes font and weight for the whole document, keeping the cells', () => {
      store.newDoc(5, 2, 'jetbrains-mono');
      store.beginStroke(1, 1);
      store.endStroke();
      const cells = store.doc().ch;
      store.setFontWeight(800);
      expect(store.fontWeight()).toBe(800);
      expect(store.glyphs()).toBe(store.font().glyphsByWeight[800]);
      store.setFont('ibm-plex-mono'); // has no 800: nearest is 700
      expect([store.doc().fontId, store.fontWeight()]).toEqual(['ibm-plex-mono', 700]);
      store.setFont('fira-mono');
      expect(store.fontWeight()).toBe(700);
      expect(store.doc().ch).toBe(cells); // same cell data, just restyled
      expect(store.canUndo()).toBe(true); // font changes don't touch paint history
    });

    it('rejects weights the font does not have', () => {
      store.newDoc(5, 2, 'fira-mono');
      expect(() => store.setFontWeight(300)).toThrow();
    });

    it('new documents keep the current weight when the font has it', () => {
      store.newDoc(5, 2, 'jetbrains-mono');
      store.setFontWeight(300);
      store.newDoc(5, 2, 'ibm-plex-mono');
      expect(store.fontWeight()).toBe(300);
      store.newDoc(5, 2, 'fira-mono');
      expect(store.fontWeight()).toBe(400);
    });

    it('finishes an open text session first, as its own undo step', () => {
      store.newDoc(10, 2, 'jetbrains-mono');
      store.setTool('text');
      store.startText(0, 0);
      store.typeText('hi');
      store.setFontWeight(700);
      expect(store.typing).toBe(false);
      store.undo();
      expect(getCell(store.doc(), 0, 0).ch).toBe(' ');
      expect(store.fontWeight()).toBe(700);
    });
  });
});
