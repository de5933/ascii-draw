#!/usr/bin/env node
/**
 * Generates src/app/core/fonts/brightness/<font-id>.ts for every supported font
 * and every weight it ships: how bright each character looks (fraction of its
 * cell covered by ink), normalized per weight so the brightest character is 1.
 * Weights are discovered from the @fontsource package's files.
 *
 * Renders each glyph in headless Chromium with the same self-hosted font files
 * the app uses. Run: npm run gen:fonts
 * Browser: $CHROME_PATH, else the newest Playwright headless shell in ~/.cache/ms-playwright.
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/app/core/fonts/brightness');

// Keep in sync with FONTS in src/app/core/fonts/fonts.ts.
const FONTS = [
  { id: 'jetbrains-mono', family: 'JetBrains Mono', pkg: 'jetbrains-mono', lineHeight: 1.2 },
  { id: 'ibm-plex-mono', family: 'IBM Plex Mono', pkg: 'ibm-plex-mono', lineHeight: 1.2 },
  { id: 'fira-mono', family: 'Fira Mono', pkg: 'fira-mono', lineHeight: 1.2 },
  { id: 'cascadia-mono', family: 'Cascadia Mono', pkg: 'cascadia-mono', lineHeight: 1.2 },
];

/** Weights a @fontsource package ships (latin subset, upright). */
function weightsOf(pkg) {
  const re = new RegExp(`^${pkg}-latin-(\\d+)-normal\\.woff2$`);
  return readdirSync(join(root, 'node_modules/@fontsource', pkg, 'files'))
    .map((f) => re.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Printable ASCII. */
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) {
    const exe = join(cache, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return undefined; // let Playwright try its default
}

/** Runs in the browser: measures ink coverage for each char in a cell. */
async function measure({ family, weight, lineHeight, chars }) {
  const size = 64;
  const font = `${weight} ${size}px "${family}"`;
  await document.fonts.load(font);
  if (!document.fonts.check(font)) throw new Error(`Font not loaded: ${font}`);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  const w = Math.round(ctx.measureText('M').width);
  const h = Math.round(size * lineHeight);
  c.width = w;
  c.height = h;
  const result = {};
  for (const ch of chars) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, h / 2); // same placement as the app's renderer
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i];
    result[ch] = sum / (255 * w * h);
  }
  return result;
}

const browser = await chromium.launch({ executablePath: findChrome() });
try {
  const page = await browser.newPage();
  const fontFaces = FONTS.flatMap((f) =>
    weightsOf(f.pkg).map(
      (w) => `@font-face { font-family: "${f.family}"; font-weight: ${w}; src: url(/fonts/${f.pkg}-latin-${w}-normal.woff2); }`,
    ),
  );
  await page.route('http://fonts.local/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/fonts/')) {
      const name = path.slice(7);
      const pkg = name.replace(/-latin-\d+-normal\.woff2$/, '');
      const file = join(root, 'node_modules/@fontsource', pkg, 'files', name);
      return route.fulfill({ body: readFileSync(file), contentType: 'font/woff2' });
    }
    return route.fulfill({ body: `<style>${fontFaces.join('\n')}</style>`, contentType: 'text/html' });
  });
  await page.goto('http://fonts.local/');

  for (const font of FONTS) {
    const tables = [];
    for (const weight of weightsOf(font.pkg)) {
      const coverage = await page.evaluate(measure, { family: font.family, weight, lineHeight: font.lineHeight, chars: CHARS });
      const max = Math.max(...Object.values(coverage));
      const entries = Object.entries(coverage)
        .map(([ch, v]) => [ch, Math.round((v / max) * 10000) / 10000])
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      tables.push(`  ${weight}: [\n${entries.map(([ch, b]) => `    [${JSON.stringify(ch)}, ${b}],`).join('\n')}\n  ],`);
      console.log(`${font.id} ${weight}: darkest ${JSON.stringify(entries[1][0])} brightest ${JSON.stringify(entries.at(-1)[0])} (max coverage ${max.toFixed(3)})`);
    }
    const ts =
      `// Generated by scripts/gen-font-brightness.mjs — do not edit by hand.\n` +
      `// Character brightness for ${font.family} by font weight, darkest first; 1 = brightest character.\n` +
      `export const GLYPH_BRIGHTNESS: Readonly<Record<number, readonly (readonly [string, number])[]>> = {\n${tables.join('\n')}\n};\n`;
    writeFileSync(join(outDir, `${font.id}.ts`), ts);
  }
} finally {
  await browser.close();
}
