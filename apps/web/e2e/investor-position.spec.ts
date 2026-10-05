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

test('every outstanding capital call is shown, overdue or not, and none of them as paid', async ({ page }) => {
  await signInAsInvestor(page);
  const p = (await position(page)) as {
    openCapitalCalls: Array<{ deal: string | null; label: string; amount: number; due: string; overdue: boolean }>;
    cashflows: Array<{ kind: string; label: string }>;
  };

  /**
   * This spec used to read `openCapitalCall` — one notice — and assert its due
   * date was still ahead:
   *
   *     expect(new Date(due).getTime()).toBeGreaterThan(Date.now())
   *
   * which was the defect written down as a requirement. A call was "open" only
   * while `date > now`, so on the day a drawdown notice fell due it left the
   * panel and joined the LP's payment history as money they had sent. An
   * outstanding call is now one nobody has FUNDED, however old, and the panel
   * says overdue when its date has passed.
   */
  const open = page.getByText(/Capital call (open|overdue)/);
  if (p.openCapitalCalls.length === 0) {
    // no notice on the record, so no demand for money on the screen
    await expect(open).toHaveCount(0);
  } else {
    await expect(open).toHaveCount(p.openCapitalCalls.length);
    for (const call of p.openCapitalCalls) {
      const rail = page.locator('section', { hasText: call.label });
      await expect(rail.first()).toBeVisible();
      const text = await rail.first().innerText();
      if (call.deal) expect(text).toContain(call.deal);
      // the wording follows the date rather than hiding it
      expect(text).toContain(call.overdue ? 'Capital call overdue' : 'Capital call open');
      expect(text).toContain(call.overdue ? 'was due' : 'due');
    }
  }

  /**
   * And no outstanding notice is in the statement. The history is money that has
   * MOVED — a funded call or a paid distribution — which is the claim the date
   * filter could not make.
   */
  const history = page.locator('section', { has: page.getByRole('heading', { name: 'Cashflow history' }) });
  await expect(history).toBeVisible();
  for (const call of p.openCapitalCalls) {
    await expect(
      history.getByText(call.label, { exact: false }),
      `an outstanding demand appeared as a payment: ${call.label}`,
    ).toHaveCount(0);
    expect(p.cashflows.map((c) => c.label)).not.toContain(call.label);
  }
});
