import { expect, test, type Page } from '@playwright/test';

/**
 * What an LP reads on their own position page.
 *
 * Two of the five headline figures were constants in the router — Net IRR 21.4%
 * and Net MOIC 1.42× — printed for every investor of every firm. Measured on
 * this workspace: that LP had £3,788,400 called and £2,640,000 back, which is
 * 0.70×, not 1.42×.
 *
 * And the "Capital call open" panel was hardcoded end to end: one deal, one
 * amount, one due date, for everybody. By the time anybody looked, that fixed
 * date had passed, so an LP was reading an overdue demand for £495,000 that
 * nobody had issued.
 *
 * These assert AGREEMENT with the record, so a change to the fixture cannot
 * make them wrong.
 */

const signInAsInvestor = async (page: Page) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill('investor@demo.co.uk');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  /**
   * Wait for the SIGNED-IN state, not for the words "Investor portal" — the
   * login page carries that phrase too, so asserting it passed while the login
   * request was still in flight and every read after it came back UNAUTHORIZED.
   */
  await page.waitForURL('**/portal/investor');
  await expect(page.getByText(/share of the LP base/)).toBeVisible();
};

const position = (page: Page) =>
  page.evaluate(() =>
    fetch(`/trpc/investors.myPosition?input=${encodeURIComponent(JSON.stringify({ json: null }))}`, {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    })
      .then((r) => r.json())
      .then((j) => {
        // never resolve to a shape the assertions can silently skip over
        if (!j.result?.data?.json) throw new Error(`myPosition failed: ${j.error?.json?.message ?? 'no result'}`);
        return j.result.data.json;
      }),
  );

/**
 * The figure printed under a stat card's label.
 *
 * Via the label's PARENT: `locator('div', { has: getByText(label) })` also
 * matches the label element itself, so `.last()` returned the label and every
 * comparison was against an empty string.
 */
const stat = async (page: Page, label: string) => {
  const card = page.getByText(label, { exact: true }).locator('xpath=..');
  const lines = (await card.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  // the labels render uppercase through `label-mono`, so innerText is not the
  // string the locator matched on
  const at = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  return lines[at + 1] ?? '';
};

test('the return figures are this investor’s own, not a constant', async ({ page }) => {
  await signInAsInvestor(page);
  const p = (await position(page)) as {
    position: { called: number; distributed: number; dpi: number | null; portfolioIrr: number | null };
  };

  // DPI is distributed per pound called — checkable against the two cards beside it
  expect(p.position.dpi).toBeCloseTo(p.position.distributed / p.position.called, 6);
  expect(await stat(page, 'DPI')).toBe(`${p.position.dpi!.toFixed(2)}×`);

  // and it is emphatically not the constant that used to be printed here
  expect(await stat(page, 'DPI')).not.toBe('1.42×');
  await expect(page.getByText('Net MOIC')).toHaveCount(0);
  await expect(page.getByText('Net IRR')).toHaveCount(0);

  const irr = await stat(page, 'Portfolio IRR');
  expect(irr).toMatch(/^\d+\.\d%$/);
  expect(irr).not.toBe('21.4%');
});

test('a capital call is shown only while one is outstanding, and says whose it is', async ({ page }) => {
  await signInAsInvestor(page);
  const p = (await position(page)) as {
    openCapitalCall: { deal: string | null; label: string; amount: number; due: string } | null;
  };

  const panel = page.getByText('Capital call open');
  if (!p.openCapitalCall) {
    // no notice on the record, so no demand for money on the screen
    await expect(panel).toHaveCount(0);
    return;
  }

  await expect(panel).toBeVisible();
  const rail = page.locator('section', { has: panel });
  const text = await rail.innerText();
  expect(text).toContain(p.openCapitalCall.label);
  if (p.openCapitalCall.deal) expect(text).toContain(p.openCapitalCall.deal);

  // the thing that made the hardcoded one indefensible: it went overdue and stayed
  expect(
    new Date(p.openCapitalCall.due).getTime(),
    'an outstanding capital call was already past its due date',
  ).toBeGreaterThan(Date.now());

  // and the notice is a demand, not a payment: the statement's history is money
  // that has moved, and the same call must not lead it a month early in red
  const history = page.locator('section', { has: page.getByRole('heading', { name: 'Cashflow history' }) });
  await expect(history).toBeVisible();
  await expect(history.getByText(p.openCapitalCall.label, { exact: false })).toHaveCount(0);
});
