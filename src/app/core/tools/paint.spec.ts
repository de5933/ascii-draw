import { packRgba } from '../color';
import { DEFAULT_CELL, createDoc, getCell, setCell } from '../document';
import { History } from '../history';
import { PaintSettings, Stroke, paintValues } from './paint';

const RED = packRgba(255, 0, 0);
const BLUE = packRgba(0, 0, 255);

function settings(over: Partial<PaintSettings> = {}): PaintSettings {
  return { fg: RED, bg: BLUE, ch: 'A', channels: { fg: true, bg: true, ch: true }, size: 1, shape: 'square', ...over };
}

describe('paintValues', () => {
  it('only includes enabled channels', () => {
    expect(paintValues('brush', settings({ channels: { fg: false, bg: true, ch: false } }))).toEqual({ bg: BLUE });
  });

  it('eraser writes the defaults', () => {
    expect(paintValues('eraser', settings())).toEqual({ ...DEFAULT_CELL });
  });
});

describe('Stroke', () => {
  it('paints red A on blue (the manifest example)', () => {
    const doc = createDoc(5, 5, 'f');
    new Stroke(doc, 'brush', settings()).to(2, 2);
    expect(getCell(doc, 2, 2)).toEqual({ fg: RED, bg: BLUE, ch: 'A' });
    expect(getCell(doc, 2, 3)).toEqual({ ...DEFAULT_CELL });
  });

  it('leaves disabled channels alone', () => {
    const doc = createDoc(3, 1, 'f');
    setCell(doc, 0, 0, { fg: BLUE, ch: 'z' });
    new Stroke(doc, 'brush', settings({ channels: { fg: false, bg: false, ch: true } })).to(0, 0);
    expect(getCell(doc, 0, 0)).toEqual({ fg: BLUE, bg: DEFAULT_CELL.bg, ch: 'A' });
  });

  it('fills gaps between distant pointer positions', () => {
    const doc = createDoc(10, 1, 'f');
    const s = new Stroke(doc, 'brush', settings());
    s.to(0, 0);
    s.to(9, 0);
    for (let x = 0; x < 10; x++) expect(getCell(doc, x, 0).ch).toBe('A');
  });

  it('clips at the document edges and reports changed cells', () => {
    const doc = createDoc(3, 3, 'f');
    const changed = new Stroke(doc, 'brush', settings({ size: 3 })).to(0, 0);
    expect(changed.sort()).toEqual([0, 1, 3, 4]);
  });

  it('erases back to defaults', () => {
    const doc = createDoc(3, 1, 'f');
    new Stroke(doc, 'brush', settings()).to(1, 0);
    new Stroke(doc, 'eraser', settings()).to(1, 0);
    expect(getCell(doc, 1, 0)).toEqual({ ...DEFAULT_CELL });
  });
});

describe('History', () => {
  it('undoes and redoes a whole stroke', () => {
    const doc = createDoc(6, 1, 'f');
    const history = new History();
    const s = new Stroke(doc, 'brush', settings());
    s.to(0, 0);
    s.to(3, 0);
    s.to(0, 0); // revisit cells: first-touch values must be kept
    history.push(s.finish()!);

    expect(history.undo(doc)?.length).toBe(4);
    for (let x = 0; x < 6; x++) expect(getCell(doc, x, 0)).toEqual({ ...DEFAULT_CELL });
    expect(history.canRedo).toBe(true);

    history.redo(doc);
    expect(getCell(doc, 3, 0).ch).toBe('A');
    expect(getCell(doc, 4, 0).ch).toBe(' ');
  });

  it('records nothing for a stroke that changed nothing', () => {
    const doc = createDoc(2, 1, 'f');
    const s = new Stroke(doc, 'eraser', settings());
    s.to(0, 0);
    expect(s.finish()).toBeNull();
  });

  it('a new edit clears redo, and the stack is bounded', () => {
    const doc = createDoc(4, 1, 'f');
    const history = new History(2);
    for (let x = 0; x < 3; x++) {
      const s = new Stroke(doc, 'brush', settings());
      s.to(x, 0);
      history.push(s.finish()!);
    }
    history.undo(doc);
    history.undo(doc);
    expect(history.canUndo).toBe(false); // oldest entry was dropped
    expect(getCell(doc, 0, 0).ch).toBe('A');
    const s = new Stroke(doc, 'brush', settings({ ch: 'B' }));
    s.to(3, 0);
    history.push(s.finish()!);
    expect(history.canRedo).toBe(false);
  });
});
