// Reproducible product assets from the app's SVG mark and bundled fonts.
import { chromium } from '@playwright/test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mark = await readFile(join(publicDir, 'icon.svg'), 'utf8');
const font = await readFile(join(publicDir, 'fonts/schibsted-grotesk-latin.woff2'));
const browser = await chromium.launch();
const scratch = await mkdtemp(join(tmpdir(), 'plotmerit-brand-'));
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const card = `<!doctype html><html><head><style>
    @font-face{font-family:Brand;src:url(data:font/woff2;base64,${font.toString('base64')})}
    *{box-sizing:border-box}body{margin:0;font-family:Brand,sans-serif;color:#fff;background:#103d30}
    main{width:1200px;height:630px;padding:70px 78px;background:radial-gradient(ellipse at 100% 100%,#226849,transparent 65%);position:relative}
    .lockup{display:flex;align-items:center;gap:22px;font-size:52px;font-weight:700;letter-spacing:-2px}.lockup svg{width:74px;height:74px}
    h1{font-size:65px;line-height:1.12;letter-spacing:-2px;font-weight:600;margin:60px 0 24px}
    p{font-size:25px;line-height:1.4;color:#d9e9df;margin:0;max-width:940px}
    footer{position:absolute;bottom:50px;font-size:17px;letter-spacing:2px;text-transform:uppercase;color:#b9d8c4}
  </style></head><body><main><div class="lockup">${mark}<span>PlotMerit</span></div>
  <h1>Know the value.<br>See the potential.</h1><p>Property appraisal &amp; development intelligence.</p>
  <footer>Evidence · Appraisals · Fieldwork · Reports</footer></main></body></html>`;
  const file = join(scratch, 'card.html'); await writeFile(file, card);
  await page.goto('file://' + file); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(publicDir, 'og.png') });
  await page.setViewportSize({ width: 180, height: 180 });
  await writeFile(file, `<!doctype html><style>html,body{margin:0;width:180px;height:180px;background:#14503b}svg{width:180px;height:180px}</style>${await readFile(join(publicDir, 'icon-maskable.svg'), 'utf8')}`);
  await page.reload();
  await page.screenshot({ path: join(publicDir, 'apple-touch-icon.png') });
} finally { await browser.close(); await rm(scratch, { recursive: true, force: true }); }
