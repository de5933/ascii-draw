export interface Point {
  x: number;
  y: number;
}

export type BrushShape = 'square' | 'round';

/** Cells on the line from (x0,y0) to (x1,y1), inclusive, with no gaps (Bresenham). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Cell offsets covered by a brush of `size` cells across, centered on the
 * cursor cell (for even sizes the extra cell goes up/left).
 */
export function brushOffsets(size: number, shape: BrushShape): Point[] {
  const n = Math.max(1, Math.floor(size));
  const start = 0 - Math.floor(n / 2); // `0 -` avoids -0
  const c = (n - 1) / 2 + start; // exact center
  const r2 = (n / 2) ** 2;
  const out: Point[] = [];
  for (let y = start; y < start + n; y++) {
    for (let x = start; x < start + n; x++) {
      if (shape === 'round' && n > 2 && (x - c) ** 2 + (y - c) ** 2 > r2) continue;
      out.push({ x, y });
    }
  }
  return out;
}
