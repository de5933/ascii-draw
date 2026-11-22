import { WHITE, packRgba, toCss } from './color';
import { createDoc, setCell } from './document';
import { describeExport, docToText, drawExport, exportFormat, pngSize, pngSizeOk } from './export';
import { FONTS } from './fonts/fonts';

const RED = packRgba(255, 0, 0);
const BLUE = packRgba(0, 0, 255);

/** Records fillRect / fillText calls with the fillStyle at the time. */
function recordingCtx() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    clearRect: () => calls.push('clear'),
    fillRect: (x: number, y: number) => calls.push(`rect ${x},${y} ${ctx.fillStyle}`),
    fillText: (t: string, x: number, y: number) => calls.push(`text ${t} ${x},${y} ${ctx.fillStyle}`),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function sample() {
  const doc = createDoc(2, 1, FONTS[0].id);
  setCell(doc, 0, 0, { ch: 'A', fg: RED, bg: BLUE }); // cell 1 stays a blank
  return doc;
}

describe('export', () => {
  const cell = { width: 10, height: 20 };

  it('picks text for text-only, PNG otherwise, nothing when empty', () => {
    expect(exportFormat({ ch: true, fg: false, bg: false })).toBe('txt');
    expect(exportFormat({ ch: true, fg: true, bg: true })).toBe('png');
    expect(exportFormat({ ch: true, fg: false, bg: true })).toBe('png');
    expect(exportFormat({ ch: false, fg: true, bg: false })).toBe('png');
    expect(exportFormat({ ch: false, fg: false, bg: false })).toBeNull();
  });

  it('exports text as full-width rows', () => {
    const doc = createDoc(5, 3, FONTS[0].id);
    [...'hi  x'].forEach((c, x) => setCell(doc, x, 0, { ch: c }));
    [...'ok'].forEach((c, x) => setCell(doc, x, 2, { ch: c }));
    expect(docToText(doc)).toBe('hi  x\n     \nok   \n');
  });

  it('draws everything by default', () => {
    const { ctx, calls } = recordingCtx();
    drawExport(ctx, sample(), FONTS[0], cell, 1, { ch: true, fg: true, bg: true });
    expect(calls).toEqual(['clear', `rect 0,0 ${toCss(BLUE)}`, `text A 5,10 ${toCss(RED)}`, `rect 10,0 ${toCss(packRgba(0, 0, 0))}`]);
  });

  it('leaves the background transparent when it is excluded', () => {
    const { ctx, calls } = recordingCtx();
    drawExport(ctx, sample(), FONTS[0], cell, 1, { ch: true, fg: true, bg: false });
    expect(calls).toEqual(['clear', `text A 5,10 ${toCss(RED)}`]);
  });

  it('draws text in white without foreground, and solid cells without text', () => {
    let r = recordingCtx();
    drawExport(r.ctx, sample(), FONTS[0], cell, 1, { ch: true, fg: false, bg: false });
    expect(r.calls).toContain(`text A 5,10 ${toCss(WHITE)}`);
    r = recordingCtx();
    drawExport(r.ctx, sample(), FONTS[0], cell, 1, { ch: false, fg: true, bg: false });
    expect(r.calls).toEqual(['clear', `rect 0,0 ${toCss(RED)}`, `rect 10,0 ${toCss(WHITE)}`]);
  });

  it('uses the document font weight', () => {
    const { ctx } = recordingCtx();
    const doc = sample();
    doc.fontWeight = 700;
    drawExport(ctx, doc, FONTS[0], cell, 2, { ch: true, fg: true, bg: true });
    expect(ctx.font).toBe('700 28px "JetBrains Mono", monospace');
  });

  it('sizes the PNG and rejects sizes browsers cannot handle', () => {
    expect(pngSize(createDoc(100, 40, 'f'), cell)).toEqual({ width: 1000, height: 800 });
    expect(pngSizeOk({ width: 1000, height: 800 })).toBe(true);
    expect(pngSizeOk({ width: 20000, height: 10 })).toBe(false);
    expect(pngSizeOk({ width: 12000, height: 12000 })).toBe(false);
  });

  it('describes the result', () => {
    expect(describeExport({ ch: true, fg: false, bg: false })).toMatch(/text file/i);
    expect(describeExport({ ch: true, fg: true, bg: false })).toMatch(/transparent/);
    expect(describeExport({ ch: false, fg: false, bg: false })).toMatch(/at least one/);
  });
});
