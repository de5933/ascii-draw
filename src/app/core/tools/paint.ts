import { PackedColor } from '../color';
import { AsciiDoc, Cell, DEFAULT_CELL, cellIndex, inBounds, setCell } from '../document';
import { EditRecorder } from '../history';
import { BrushShape, Point, brushOffsets, lineCells } from '../raster';

export type ToolId = 'brush' | 'eraser' | 'fill' | 'text' | 'select';

/** Which cell properties a tool writes. Each is independent. */
export interface Channels {
  fg: boolean;
  bg: boolean;
  ch: boolean;
}

export interface PaintSettings {
  fg: PackedColor;
  bg: PackedColor;
  ch: string;
  channels: Channels;
  size: number;
  shape: BrushShape;
}

/** The values a tool writes, limited to the enabled channels. */
export function paintValues(tool: ToolId, s: PaintSettings): Partial<Cell> {
  const src: Cell = tool === 'eraser' ? DEFAULT_CELL : { fg: s.fg, bg: s.bg, ch: s.ch };
  const out: Partial<Cell> = {};
  if (s.channels.fg) out.fg = src.fg;
  if (s.channels.bg) out.bg = src.bg;
  if (s.channels.ch) out.ch = src.ch;
  return out;
}

/**
 * One brush/eraser drag. Stamps the brush at each pointer position and along
 * the line between positions so fast strokes have no gaps.
 */
export class Stroke {
  private readonly recorder: EditRecorder;
  private readonly offsets: Point[];
  private readonly values: Partial<Cell>;
  private last: Point | null = null;

  constructor(
    private readonly doc: AsciiDoc,
    tool: ToolId,
    settings: PaintSettings,
  ) {
    this.recorder = new EditRecorder(doc);
    this.offsets = brushOffsets(settings.size, settings.shape);
    this.values = paintValues(tool, settings);
  }

  /** Paints from the previous point to (x, y); returns the indices of cells that changed. */
  to(x: number, y: number): number[] {
    const path = this.last ? lineCells(this.last.x, this.last.y, x, y) : [{ x, y }];
    this.last = { x, y };
    const changed: number[] = [];
    for (const p of path) {
      for (const o of this.offsets) {
        const cx = p.x + o.x;
        const cy = p.y + o.y;
        if (!inBounds(this.doc, cx, cy)) continue;
        const i = cellIndex(this.doc, cx, cy);
        this.recorder.touch(i);
        if (setCell(this.doc, cx, cy, this.values)) changed.push(i);
      }
    }
    return changed;
  }

  finish() {
    return this.recorder.finish();
  }
}
