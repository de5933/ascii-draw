import { brushOffsets, lineCells } from './raster';

describe('lineCells', () => {
  it('includes both endpoints and has no gaps', () => {
    for (const [x0, y0, x1, y1] of [
      [0, 0, 7, 3],
      [5, 5, -2, 9],
      [3, 3, 3, -4],
      [0, 0, -6, -6],
    ]) {
      const pts = lineCells(x0, y0, x1, y1);
      expect(pts[0]).toEqual({ x: x0, y: y0 });
      expect(pts.at(-1)).toEqual({ x: x1, y: y1 });
      expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
      for (let i = 1; i < pts.length; i++) {
        expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('handles a single point', () => {
    expect(lineCells(2, 3, 2, 3)).toEqual([{ x: 2, y: 3 }]);
  });
});

describe('brushOffsets', () => {
  it('size 1 is the cursor cell only', () => {
    expect(brushOffsets(1, 'square')).toEqual([{ x: 0, y: 0 }]);
    expect(brushOffsets(1, 'round')).toEqual([{ x: 0, y: 0 }]);
  });

  it('square brushes are n×n, centered', () => {
    const o = brushOffsets(3, 'square');
    expect(o.length).toBe(9);
    expect(Math.min(...o.map((p) => p.x))).toBe(-1);
    expect(Math.max(...o.map((p) => p.x))).toBe(1);
    expect(brushOffsets(4, 'square').length).toBe(16);
  });

  it('round brushes drop the corners and stay symmetric', () => {
    const o = brushOffsets(5, 'round');
    const has = (x: number, y: number) => o.some((p) => p.x === x && p.y === y);
    expect(has(0, 0)).toBe(true);
    expect(has(2, 0) && has(-2, 0) && has(0, 2) && has(0, -2)).toBe(true);
    expect(has(2, 2) || has(-2, -2) || has(2, -2) || has(-2, 2)).toBe(false);
    expect(o.length).toBeLessThan(25);
  });
});
