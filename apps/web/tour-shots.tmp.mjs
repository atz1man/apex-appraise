import { chromium } from '@playwright/test';
const BASE = 'http://localhost:8080';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
await page.goto(BASE + '/login');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Deal tools').waitFor();
await page.waitForTimeout(1200);

const dealId = await page.evaluate(async () => {
  const el = [...document.querySelectorAll('a')].find(a => a.href.includes('/deal/'));
  return el ? el.href.split('/deal/')[1].split('/')[0] : null;
});
const shots = [
  ['hub', '/', 'Deal tools'],
  ['board', '/board', 'Northgate'],
  ['appraisal', `/deal/${dealId}/appraisal`, 'Unit schedule'],
  ['sitepack', `/deal/${dealId}/sitepack`, 'Site pack'],
  ['costs', `/deal/${dealId}/costs`, 'Cost report'],
  ['report', `/deal/${dealId}/report`, 'Appraisal report'],
];
for (const [name, path, waitText] of shots) {
  await page.goto(BASE + path);
  await page.getByText(new RegExp(waitText)).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `public/tour/${name}.png` });
  console.log('shot', name);
}
await browser.close();
