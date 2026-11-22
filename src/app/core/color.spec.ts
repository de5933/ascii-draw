import { BLACK, WHITE, fromHex, packRgba, toCss, toHex, unpackRgba } from './color';

describe('color', () => {
  it('round-trips pack/unpack, including high red values (unsigned)', () => {
    const c = packRgba(255, 128, 1, 200);
    expect(c).toBeGreaterThan(0);
    expect(unpackRgba(c)).toEqual([255, 128, 1, 200]);
  });

  it('fits in a Uint32Array without changing', () => {
    const arr = new Uint32Array(1);
    arr[0] = packRgba(250, 10, 20);
    expect(unpackRgba(arr[0])).toEqual([250, 10, 20, 255]);
  });

  it('converts to and from hex', () => {
    expect(toHex(packRgba(255, 0, 170))).toBe('#ff00aa');
    expect(fromHex('#ff00aa')).toBe(packRgba(255, 0, 170));
    expect(fromHex('#f0a')).toBe(packRgba(255, 0, 170));
    expect(() => fromHex('nope')).toThrow();
  });

  it('formats css', () => {
    expect(toCss(BLACK)).toBe('rgb(0 0 0)');
    expect(toCss(WHITE)).toBe('rgb(255 255 255)');
    expect(toCss(packRgba(1, 2, 3, 0))).toBe('rgb(1 2 3 / 0.000)');
  });
});
