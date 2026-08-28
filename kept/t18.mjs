import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });
const p = await c.newPage();
const problems = [];
p.on('pageerror', e => problems.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type()==='error') problems.push('console: ' + m.text()); });

await p.goto('http://localhost:5183/app/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Skip' }).click();
await p.waitForTimeout(400);
// Five seeded receipts: below the threshold, so no box.
const hiddenAtFive = (await p.locator('#receipt-search').count()) === 0;

await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kept.v1'));
  const base = s.receipts[0];
  const extra = ['Sony WH-1000XM5', 'Dyson V15', 'Le Creuset casserole', 'Adidas Sambas'];
  s.receipts = s.receipts.concat(extra.map((item, i) => ({ ...base, id: 'e' + i, item, store: ['Currys','Argos','John Lewis','Sports Direct'][i], status: 'active' })));
  localStorage.setItem('kept.v1', JSON.stringify(s));
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
const shownAtNine = (await p.locator('#receipt-search').count()) === 1;
await p.screenshot({ path: '/tmp/shots/se1-search.png' });

await p.fill('#receipt-search', 'dyson');
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/shots/se2-filtered.png' });
const rowsWhenFiltered = await p.locator('li button').count();
const heroHidden = (await p.getByText('NEXT WINDOW TO CLOSE').count()) === 0;

await p.fill('#receipt-search', 'nothing like this');
await p.waitForTimeout(400);
const emptyMsg = await p.getByText(/Nothing matches/).isVisible();

await p.fill('#receipt-search', '');
await p.waitForTimeout(400);
const restored = await p.locator('li button').count();
const heroBack = await p.getByText('NEXT WINDOW TO CLOSE').isVisible();

console.log(JSON.stringify({ hiddenAtFive, shownAtNine, rowsWhenFiltered, heroHidden, emptyMsg, restored, heroBack, problems }, null, 2));
await b.close();
