/** Colors are packed as 0xRRGGBBAA in a uint32 so cells can live in typed arrays. */
export type PackedColor = number;

export function packRgba(r: number, g: number, b: number, a = 255): PackedColor {
  return ((r & 0xff) << 24 | (g & 0xff) << 16 | (b & 0xff) << 8 | (a & 0xff)) >>> 0;
}

export function unpackRgba(c: PackedColor): [r: number, g: number, b: number, a: number] {
  return [(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff];
}

/** CSS color string for a packed color, e.g. for canvas fillStyle. */
export function toCss(c: PackedColor): string {
  const [r, g, b, a] = unpackRgba(c);
  return a === 255 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
}

/** "#rrggbb" (alpha dropped), for <input type="color">. */
export function toHex(c: PackedColor): string {
  return '#' + ((c >>> 8) & 0xffffff).toString(16).padStart(6, '0');
}

/** Parses "#rgb" or "#rrggbb" into an opaque packed color. */
export function fromHex(hex: string): PackedColor {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = [...h].map((d) => d + d).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Invalid hex color: ${hex}`);
  return ((parseInt(h, 16) << 8) | 0xff) >>> 0;
}

export const BLACK = packRgba(0, 0, 0);
export const WHITE = packRgba(255, 255, 255);
