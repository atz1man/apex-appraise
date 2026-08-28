/**
 * Renders the PWA's PNG icons from the single SVG source in public/icons.
 * Kept in the repo so the icon set can be regenerated from the mark rather
 * than maintained as four files that quietly drift apart.
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const EXEC = process.env.CHROMIUM_PATH;
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');

// The maskable variant: platforms crop up to 20% off every edge, so the mark
// is inset to survive a circular or squircle mask on any launcher.
const maskable = svg
  .replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512" rx="0"')
  .replace('translate(146 92) scale(5.55)', 'translate(176 130) scale(4.2)');

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();

for (const [name, size, source] of [
  ['icon-180.png', 180, svg],
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  const buf = await page.screenshot({ omitBackground: true });
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), buf);
  console.log(`${name} ${size}x${size} ${buf.length}b`);
}

await browser.close();
