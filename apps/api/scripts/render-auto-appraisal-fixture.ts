/** Regenerate the checked-in synthetic sheet. No model call or customer content. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const source = new URL('../test/fixtures/auto-appraisal/drawing-sheet.svg', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>body{margin:0}</style>${readFileSync(source, 'utf8')}`);
  await page.screenshot({ path: fileURLToPath(new URL('drawing-sheet.png', source)) });
} finally { await browser.close(); }
