import { createDoc } from './document';
import { FONTS } from './fonts/fonts';
import { cellAt, measureCell } from './renderer';

describe('renderer geometry', () => {
  it('maps pixel positions to cells', () => {
    const doc = createDoc(10, 5, 'f');
    const cell = { width: 8, height: 17 };
    expect(cellAt(doc, cell, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellAt(doc, cell, 15.9, 33.9)).toEqual({ x: 1, y: 1 });
    expect(cellAt(doc, cell, 79.9, 84.9)).toEqual({ x: 9, y: 4 });
    expect(cellAt(doc, cell, 80, 0)).toBeNull();
    expect(cellAt(doc, cell, -1, 0)).toBeNull();
  });

  it('measures cells from font metrics, rounded to whole pixels', () => {
    const ctx = { font: '', measureText: () => ({ width: 8.4 }) } as unknown as CanvasRenderingContext2D;
    const size = measureCell(ctx, FONTS[0], 14);
    expect(ctx.font).toContain('14px');
    expect(size).toEqual({ width: 8, height: Math.round(14 * FONTS[0].lineHeight) });
  });
});
