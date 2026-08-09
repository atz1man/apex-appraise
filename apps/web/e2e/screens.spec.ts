import { expect, test, type Page } from '@playwright/test';

/**
 * Per-screen happy-path coverage (BUILD_PLAN cross-cutting acceptance).
 * Assumes the dev stack is running with the seeded demo dataset.
 */

async function loginInternal(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

async function northgateId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
}

test.describe('internal screens', () => {
  test.beforeEach(async ({ page }) => loginInternal(page));

  test('auto-appraisal generates an indicative result', async ({ page }) => {
    test.setTimeout(120_000); // live LLM extraction can take ~15-40s
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/auto`);
    await page.getByRole('button', { name: /Generate appraisal/ }).click();
    // live LLM extraction when ANTHROPIC_API_KEY is set takes ~15-40s; demo mode is instant
    await expect(page.getByText('Extracted accommodation')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Proceed|Caution|Decline/).first()).toBeVisible();
  });

  test('comparables derives a supported rate', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/comparables`);
    await expect(page.getByText('Sales comparison — adjustment grid')).toBeVisible();
    await expect(page.getByText('Weighted supported value')).toBeVisible();
  });

  test('scenarios compares three options with best-per-row', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/scenarios`);
    await expect(page.getByText('Compare scheme options').first()).toBeVisible();
    await expect(page.getByText('Option A — consented scheme').first()).toBeVisible();
    await expect(page.getByText('BEST').first()).toBeVisible();
    // AI risk commentary is offered below the grid (not clicked here — see the dedicated test)
    await expect(page.getByRole('button', { name: 'Draft risk commentary' })).toBeVisible();
  });

  test('scenarios drafts AI risk commentary', async ({ page }) => {
    test.setTimeout(120_000); // live LLM drafting can take ~15-40s
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/scenarios`);
    await page.getByRole('button', { name: 'Draft risk commentary' }).click();
    // live LLM drafting when ANTHROPIC_API_KEY is set takes ~15-40s; demo mode is instant
    await expect(page.getByText('AI-drafted — for discussion, not advice.')).toBeVisible({ timeout: 90_000 });
  });

  test('cost monitoring shows variance rollup', async ({ page }) => {
    await page.goto('/board');
    await page.getByRole('link', { name: /Harbour Reach/ }).first().click();
    const url = page.url();
    const dealId = url.match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/costs`);
    await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();
    await expect(page.getByText('Variance alerts')).toBeVisible();
  });

  test('sales CRM tracks units and opens the drawer', async ({ page }) => {
    await page.goto('/board');
    await page.getByRole('link', { name: /Harbour Reach/ }).first().click();
    const dealId = page.url().match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/sales`);
    await expect(page.getByText('Unit sales tracker')).toBeVisible();
    // a row in the tracker, not a link — the role rewrite that fixed the deal
    // cards does not apply here
    await page.getByText('Plot 3').first().click();
    await expect(page.getByText('Sales progression')).toBeVisible();
  });

  test('data room lists documents with extraction status', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/dataroom`);
    await expect(page.getByText('All documents').first()).toBeVisible();
    await expect(page.getByText('Recent activity')).toBeVisible();
    await expect(page.getByText('Ask the workfile')).toBeVisible();
  });

  test('data room answers a question from an uploaded document', async ({ page }) => {
    test.setTimeout(120_000); // live document Q&A can take a while when a key is set
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/dataroom`);
    await page.getByPlaceholder('e.g. What does the cost plan allow for M&E?').fill('What documents can you see?');
    await page.getByRole('button', { name: 'Ask' }).click();
    // seeded documents are metadata-only (no stored files) → the workfile has nothing readable
    await expect(page.getByText('Upload PDFs or images and the AI can answer from them.')).toBeVisible({ timeout: 90_000 });
  });

  test('benchmarking renders percentile strips', async ({ page }) => {
    await page.goto('/benchmarking');
    await expect(page.getByText('How your deals compare to the market')).toBeVisible();
    await expect(page.getByText('Build cost trend — £/ft²')).toBeVisible();
  });

  test('integrations catalogue with statuses', async ({ page }) => {
    await page.goto('/integrations');
    await expect(page.getByText('Connect your data sources')).toBeVisible();
    await expect(page.getByText('HM Land Registry')).toBeVisible();
    // self-serve key flow: Companies House opens a credentials drawer, not a demo connect
    await expect(page.getByText('Companies House')).toBeVisible();
    const chCard = page.locator('.rounded-card', { hasText: 'Companies House' }).first();
    await chCard.getByRole('button', { name: /Connect|Manage/ }).click();
    await expect(page.getByRole('heading', { name: 'Connect Companies House' })).toBeVisible();
    await expect(page.getByLabel('API key')).toBeVisible();
    // save is gated until a key is entered; escape closes without saving
    await expect(page.getByRole('button', { name: /Validate & connect|Replace key/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('API key')).toHaveCount(0);
  });

  test('workbench reconciles market value', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/workbench`);
    await expect(page.getByText('Valuation reconciliation')).toBeVisible();
  });

  test('appraisal report paginates A4 pages', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/report`);
    await expect(page.locator('.a4-page').first()).toBeVisible();
    expect(await page.locator('.a4-page').count()).toBeGreaterThanOrEqual(6);
  });

  test('red book report renders market value statement', async ({ page }) => {
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/redbook`);
    await expect(page.locator('.a4-page').first()).toBeVisible();
    await expect(page.getByText('Market Value').first()).toBeVisible();
    // comparable evidence page carries the adjustment ladder with the supported rate
    await expect(page.getByTestId('comps-ladder')).toBeVisible();
    await expect(page.getByTestId('comps-ladder').getByText(/Supported £\d+\/ft²/)).toBeVisible();
    // AI narrative drafting is offered from the screen toolbar (not clicked here — see the dedicated test)
    await expect(page.getByRole('button', { name: 'Draft narrative with AI' })).toBeVisible();
  });

  test('red book narrative drafts via AI', async ({ page }) => {
    test.setTimeout(120_000); // live LLM drafting can take ~15-40s
    const id = await northgateId(page);
    await page.goto(`/deal/${id}/redbook`);
    await page.getByRole('button', { name: 'Draft narrative with AI' }).click();
    // live LLM drafting when ANTHROPIC_API_KEY is set takes ~15-40s; demo mode is instant
    await expect(page.getByText('AI-drafted — valuer to review').first()).toBeVisible({ timeout: 90_000 });
    // drafted prose gets its own sheet; scope to it — the AI-use disclosure on the
    // final page names the same sections, so unscoped text matches collide (M2)
    const commentary = page.locator('.a4-page', { hasText: 'Valuation commentary' });
    await expect(commentary.getByText('Valuation rationale')).toBeVisible();
    await expect(commentary.getByText('Market commentary')).toBeVisible();
    await expect(commentary.getByText('Risk commentary')).toBeVisible();
    await expect(page.getByText('Use of artificial intelligence')).toBeVisible();
    await expect(page.getByText(/Report narrative — drafted the market commentary/)).toBeVisible();
    await expect(page.getByText(/No artificial intelligence system computed, adjusted or approved any figure/)).toBeVisible();
    await expect(page.locator('.a4-page')).toHaveCount(7);
    await expect(page.getByText(/Page 7 of 7/)).toBeVisible();
  });

  test('field app frames the mobile companion', async ({ page }) => {
    await page.goto('/field');
    await expect(page.getByText('Appraisals').first()).toBeVisible();
    await expect(page.getByText(/Field companion app/)).toBeVisible();
  });
});

test('landing page renders the marketing site', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByText('From the front door to the signed report — one workfile.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('whats new page lists recent shipping', async ({ page }) => {
  await page.goto('/whats-new'); // public — no sign-in
  await expect(page.getByRole('heading', { name: "What's new" })).toBeVisible();
  await expect(page.getByText('Ask the workfile').first()).toBeVisible();
});

test('buyer portal signs a document (persisted)', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Buyer portal/ }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Your new home at/)).toBeVisible();
  const signButtons = page.getByRole('button', { name: /Review & sign/ });
  if (await signButtons.count()) {
    await signButtons.first().click();
    await expect(page.getByText('SIGNED').first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('SIGNED').first()).toBeVisible(); // persisted, not local state
  }
});

test('public surface: SEO meta, share image, robots and branded 404', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /development appraisals/i);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', '/og.png');
  const og = await page.request.get('/og.png');
  expect(og.status()).toBe(200);
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Disallow: /deal/');
  // branded 404 for signed-out visitors — no silent redirect
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByText('404')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apex Appraise home' })).toBeVisible();
});

test('landing product tour opens, steps through slides and closes', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: /Watch the 60-second tour/ }).click();
  const tour = page.getByRole('dialog', { name: 'Product tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('One home for the whole workfile')).toBeVisible();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('Pipeline board')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tour.getByText('Development appraisal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
});

test('landing live engine card computes real figures as sliders move', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByText('Try the engine — live')).toBeVisible();
  const gdvBefore = await page.getByTestId('live-gdv').innerText();
  await page.getByLabel('Homes').fill('30');
  const gdvAfter = await page.getByTestId('live-gdv').innerText();
  expect(gdvAfter).not.toBe(gdvBefore);
  // engine sanity: 30 homes × 850ft² × £450 = £11.475m GDV (fM shows 1dp above £10m)
  expect(gdvAfter).toBe('£11.5m');
  await expect(page.getByText('Profit on cost', { exact: true })).toBeVisible();
  // feature mock peek opens the tour at the matching slide
  await page.getByRole('button', { name: /See Documents in\. Investment-grade appraisal out\. in the product/ }).click();
  const tour = page.getByRole('dialog', { name: 'Product tour' });
  await expect(tour.getByText('Development appraisal')).toBeVisible();
});

test('theme toggle switches to dark mode and persists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(16, 20, 18)');
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(16, 20, 18)');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(243, 244, 241)');
});

/**
 * Investment method — Kingsway is seeded with a mixed exit (one pod sold, the
 * parade held and let), so the appraisal must show the capitalisation ladder and
 * fold the capitalised value into GDV.
 */
test('appraisal capitalises a rent roll into GDV', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Investment', exact: true }).click();

  // rent roll totals — 6 × 1,650 ft² + 3 × 900 ft² = 12,600 ft² at £213,300 pa gross
  await expect(page.getByLabel('Tenancy 1 label')).toHaveValue('Retail units (ground floor)');
  await expect(page.getByText('12,600 ft²')).toBeVisible();
  await expect(page.getByText('£213,300 pa')).toBeVisible();

  // the ladder ends at the capitalised value that enters GDV. The parade is
  // reversionary (let below ERV, reviewed in three years), so the value carries
  // a term and a deferred reversion — see the term & reversion tests in the engine
  await expect(page.getByText('Investment value in GDV', { exact: true })).toBeVisible();
  await expect(page.getByText('£2,588,358').first()).toBeVisible();
  await expect(page.getByText('Term — passing rent')).toBeVisible();
  await expect(page.getByText('Reversion — ERV deferred')).toBeVisible();
  // the three yields a valuer quotes: on passing, on ERV, and the single
  // equivalent rate between them
  await expect(page.getByText('6.90%')).toBeVisible();
  await expect(page.getByText('8.05%')).toBeVisible();
  await expect(page.getByText('7.56%')).toBeVisible();

  // and the right-rail residual breakdown states the GDV composition
  await expect(page.getByText('— capitalised investment value')).toBeVisible();
  await expect(page.getByText('— units sold')).toBeVisible();

  // live engine: a sharper term yield lifts the value of the term
  await page.getByLabel('All-risks yield (%)').fill('6');
  await expect(page.getByText('£2,597,470').first()).toBeVisible();
});

test('appraisal without a held element offers to add a rent roll', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Investment', exact: true }).click();
  await expect(page.getByText('No held element')).toBeVisible();
  await page.getByRole('button', { name: 'Add a rent roll' }).click();
  await expect(page.getByText('Investment value in GDV', { exact: true })).toBeVisible();
});


/**
 * AI-use disclosure — RICS professional standards require the valuer to state
 * whether and how AI was used. Kingsway has had no AI run against it, so the
 * report must say so explicitly rather than staying silent.
 */
test('reports disclose that no AI was used when none was', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });

  await page.goto(`/deal/${id}/redbook`);
  await expect(page.getByText('Use of artificial intelligence')).toBeVisible();
  await expect(page.getByText('No artificial intelligence was used in the preparation of this valuation.')).toBeVisible();
  // no drafted commentary → no extra sheet, and the footers say so
  await expect(page.locator('.a4-page')).toHaveCount(6);
  // the footer carries the FIRM's name now, so assert the pagination, not the brand
  await expect(page.getByText(/Page 6 of 6 · ©/)).toBeVisible();

  // and the valuer can see the same record in-product before issuing
  await page.goto(`/deal/${id}`);
  await expect(page.getByText('AI use on this deal')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('No AI has been used on this deal. The reports say so explicitly.')).toBeVisible();
});

/**
 * Terms of engagement (RICS VPS 1) — Northgate is seeded with accepted terms,
 * so the document and the Red Book must both reflect them.
 */
test('accepted terms of engagement are documented and cited by the Red Book', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });

  await page.goto(`/deal/${id}/engagement`);
  await expect(page.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('Halewood Asset Finance Ltd');
  // accepted terms are locked against editing
  await expect(page.getByLabel('Client', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw & revise' })).toBeVisible();

  await page.goto(`/deal/${id}/engagement/document`);
  await expect(page.locator('.a4-page')).toHaveCount(3);
  await expect(page.getByText(/Issued 18 May 2026 · Accepted 21 May 2026/)).toBeVisible();
  await expect(page.getByText('Use of artificial intelligence')).toBeVisible();
  await expect(page.getByText(/Page 3 of 3/)).toBeVisible();

  // the valuation report is written under those terms and says so
  await page.goto(`/deal/${id}/redbook`);
  await expect(page.getByText(/terms of engagement accepted by R. Halewood on 21 May 2026/)).toBeVisible();
});

test('terms of engagement run draft → issued → accepted', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Elm Grove')).id;
  });

  await page.goto(`/deal/${id}/engagement`);
  // idempotent: a previous run may have left this deal's terms issued/accepted.
  // Wait for the status panel to render before deciding — checking too early
  // reads "no withdraw button" on a page that simply hasn't loaded yet.
  // .first(): an issued record now shows BOTH 'Record acceptance' and 'Withdraw'
  await expect(page.getByRole('button', { name: /Issue to client|Record acceptance|Withdraw & revise/ }).first()).toBeVisible();
  const withdraw = page.getByRole('button', { name: 'Withdraw & revise' });
  if (await withdraw.count()) await withdraw.click();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();

  // the draft arrives prefilled from the deal — the valuer edits, never types it out
  await expect(page.getByLabel('Purpose of the valuation')).not.toBeEmpty();
  await expect(page.getByLabel('Stated to the client before the work starts')).toContainText(
    'No artificial intelligence system computed',
  );

  // clear first: re-running against a deal that already holds this value would
  // fire no change event, leave the form pristine, and never show Save terms
  const client = page.getByLabel('Client', { exact: true });
  await client.fill('');
  await client.fill('Marchmont Estates LLP');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Issue to client' }).click();
  await expect(page.getByText('ISSUED', { exact: true })).toBeVisible();

  await page.getByLabel('Accepted by').fill('J. Marchmont');
  await page.getByRole('button', { name: 'Record acceptance' }).click();
  await expect(page.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await expect(page.getByText(/J\. Marchmont/)).toBeVisible();
});

/**
 * Cashflow depth — the ledger reads monthly, quarterly or annually, and cost
 * lines fall when they are timed to (Kingsway markets after practical
 * completion, so spend continues past the build).
 */
test('cashflow rolls up to quarters and years, and honours cost timing', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Cashflow', exact: true }).click();

  // monthly by default — 12 build months + 4 letting months
  await expect(page.getByText('Monthly cashflow')).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(16 + 5); // ledger + sensitivity grid rows

  await page.getByRole('tab', { name: 'Quarterly', exact: true }).click();
  await expect(page.getByText('Quarterly cashflow')).toBeVisible();
  await expect(page.getByText("Q1 · Jul–Sep '26")).toBeVisible();
  await expect(page.getByText("Q3 · Jan–Mar '27")).toBeVisible();

  await page.getByRole('tab', { name: 'Annual', exact: true }).click();
  await expect(page.getByText('Annual cashflow')).toBeVisible();
  await expect(page.getByText("Year 1 · Jul '26–Jun '27")).toBeVisible();

  // marketing is timed into the letting period, so cost continues after the build
  await page.getByRole('button', { name: 'Other Costs', exact: true }).click();
  // cost labels are inputs, not text (same trap as the rent roll — assert the value)
  await expect(page.getByLabel('Cost 2 label')).toHaveValue('Marketing & letting fees');
  await expect(page.getByText(/Start month and duration control when each line is spent/)).toBeVisible();
  // it is timed to start in month 13 — after the 12-month build — and run 4 months
  const timingRow = page.locator('div').filter({ has: page.getByLabel('Cost 2 label') }).last();
  await expect(timingRow.getByLabel('Start month')).toHaveValue('13');
  await expect(timingRow.getByLabel('Months')).toHaveValue('4');
});

/**
 * Multi-phase schemes — Harbour Reach is seeded as two overlapping blocks, so
 * phase A sells while phase B is still on site.
 */
test('phased scheme shows its programme and reports sane returns', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);

  // returns must be positive: a phase selling before the last one completes used
  // to drop those receipts from the IRR series and report a negative return
  // labels are uppercased by CSS, so match the DOM text and read the card's value
  const irrCard = page.getByText('Project IRR', { exact: true }).locator('..');
  await expect(irrCard).toBeVisible();
  await expect(irrCard).not.toContainText('−'); // true minus: a negative IRR
  await expect(irrCard).not.toContainText('N/A');

  await page.getByRole('button', { name: 'Phases', exact: true }).click();
  // 'Programme' is also a Kv label and the tasks-panel aspect — scope to the heading
  await expect(page.getByRole('heading', { name: 'Programme', exact: true })).toBeVisible();
  await expect(page.getByLabel('Phase 1 name')).toHaveValue('Phase A — quayside block');
  await expect(page.getByLabel('Phase 2 name')).toHaveValue('Phase B — courtyard block');
  await expect(page.getByText(/Phases share one facility/)).toBeVisible();
  // phase A completes in month 14 and sells over 6
  await expect(page.getByLabel('Starts month').first()).toHaveValue('1');
  await expect(page.getByLabel('Build (months)').first()).toHaveValue('14');

  // and the revenue tab admits it is no longer the source of truth
  await page.getByRole('button', { name: 'Revenue', exact: true }).click();
  await expect(page.getByText(/This scheme is phased/)).toBeVisible();
});

test('an unphased scheme offers to split into phases', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Phases', exact: true }).click();
  await expect(page.getByText('Single-phase scheme')).toBeVisible();
  await page.getByRole('button', { name: 'Split into phases' }).click();
  // the existing accommodation moves onto phase 1 rather than being retyped
  await expect(page.getByLabel('Phase 1 name')).toHaveValue('Phase 1');
  await expect(page.getByLabel('Phase 1 unit 1 label')).toHaveValue('Trade counter units');
});

/**
 * Phase-level cost overrides — the quayside block is piled and marine-grade, so
 * it prices above the courtyard block and carries the remediation itself.
 */
test('phases price independently and carry their own costs', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Phases', exact: true }).click();

  // phase A prices off the scheme and overrides the contingency; phase B inherits.
  // The single blended-rate input this used to assert on became a read-only rate
  // plus a full trade breakdown, so the same intent is checked on the new UI.
  await expect(page.getByText('£206').first()).toBeVisible();
  await expect(page.getByText('phase rates').first()).toBeVisible();
  await expect(page.getByLabel('Phase A — quayside block contingency')).toHaveValue('7');
  await expect(page.getByText('scheme rates').first()).toBeVisible();
  await expect(page.getByText('Trades — inherited from the scheme')).toBeVisible();

  // the remediation is booked to phase A, timed from the phase's own month 1
  await expect(page.getByLabel('Phase A — quayside block cost 1 label')).toHaveValue('Quayside remediation');
  await expect(page.getByLabel('Phase A — quayside block cost 1 amount')).toHaveValue('180000');
  await expect(page.getByText(/Timing here runs from the phase's own first month/).first()).toBeVisible();

  // the blended scheme rate sits between the two phase rates
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const rate = await page.getByText(/^£\d+\/ft²$/).first().innerText();
  const blended = parseInt(rate.replace(/[^\d]/g, ''), 10);
  expect(blended).toBeGreaterThan(170);
  expect(blended).toBeLessThan(206);
});

/**
 * The appraisal PDF for a phased scheme: the accommodation schedule reads from
 * the phases (it used to read the empty top-level units array and print nothing)
 * and a phasing table states each phase's programme, rate and value.
 */
test('appraisal report schedules a phased scheme by phase', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${id}/report`);

  const accommodation = page.locator('.a4-page').filter({ hasText: 'Accommodation schedule' });
  await expect(accommodation).toBeVisible();
  // units are grouped under their phase, with that phase's programme
  // each phase name appears twice on this page: as the schedule's group header
  // and as a row of the phasing table
  await expect(accommodation.getByText('Phase A — quayside block')).toHaveCount(2);
  await expect(accommodation.getByText('Phase B — courtyard block')).toHaveCount(2);
  await expect(accommodation.getByText(/on site .* · sells to/).first()).toBeVisible();
  // and the schedule is not empty — the regression that prompted this
  await expect(accommodation.getByText('1-bed apartments')).toBeVisible();
  await expect(accommodation.getByText('3-bed duplexes')).toBeVisible();
  await expect(accommodation.getByText('£14,924,700').first()).toBeVisible();

  // the phasing table states each phase's own rate
  await expect(accommodation.getByText('Phasing')).toBeVisible();
  await expect(accommodation.getByText('£206', { exact: true })).toBeVisible();
  await expect(accommodation.getByText('£170', { exact: true })).toBeVisible();
  await expect(accommodation.getByText(/delivered in 2 phases over 32 months/)).toBeVisible();

  // page numbering still matches what prints
  const pages = await page.locator('.a4-page').count();
  await expect(page.getByText(`Page ${pages} of ${pages}`)).toBeVisible();
});

/**
 * E-signature on the terms of engagement. The client has no account: the link
 * the valuer sends IS the credential, and signing records an evidence trail.
 */
test('client signs the terms through a public link', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Southbourne')).id;
  });

  // issue a fresh set of terms (idempotent: withdraw anything left by a prior run)
  await page.goto(`/deal/${id}/engagement`);
  // .first(): an issued record now shows BOTH 'Record acceptance' and 'Withdraw'
  await expect(page.getByRole('button', { name: /Issue to client|Record acceptance|Withdraw & revise/ }).first()).toBeVisible();
  const withdraw = page.getByRole('button', { name: 'Withdraw & revise' });
  if (await withdraw.count()) await withdraw.click();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  const client = page.getByLabel('Client', { exact: true });
  await client.fill('');
  await client.fill('Southbourne Holdings Ltd');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Issue to client' }).click();
  await expect(page.getByText('ISSUED', { exact: true })).toBeVisible();

  // the valuer gets a link to send
  await expect(page.getByText('Signing link — send this to the client')).toBeVisible();
  const link = await page.getByText(/\/terms\/[0-9a-f]{48}/).innerText();
  const signPath = new URL(link.trim()).pathname;

  // the client opens it in a SEPARATE browser context — genuinely no session,
  // and clearing storage on a shared context would sign the valuer out instead
  const clientContext = await browser.newContext();
  const clientPage = await clientContext.newPage();
  await clientPage.goto(signPath);
  await expect(clientPage.evaluate(() => localStorage.getItem('apex_token'))).resolves.toBeNull();
  await expect(clientPage.getByText('Sign these terms')).toBeVisible();
  await expect(clientPage.locator('.a4-page')).toHaveCount(3); // the document, in full
  await expect(clientPage.getByText('Southbourne Holdings Ltd').first()).toBeVisible();

  // signing needs both a name and an explicit agreement
  const signBtn = clientPage.getByRole('button', { name: 'Sign and return' });
  await expect(signBtn).toBeDisabled();
  await clientPage.getByLabel('Full name').fill('Jane Marchmont');
  await expect(signBtn).toBeDisabled(); // name alone is not agreement
  await clientPage.getByLabel('I agree to these terms of engagement').check();
  await expect(signBtn).toBeEnabled();
  await signBtn.click();

  await expect(clientPage.getByText('Thank you — these terms are signed')).toBeVisible();
  await expect(clientPage.getByText(/Signed electronically by Jane Marchmont/)).toBeVisible();

  // and the valuer sees the signature with its evidence
  await page.reload();
  await expect(page.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await expect(page.getByText('Signed electronically')).toBeVisible();
  await expect(page.getByText(/Jane Marchmont/).first()).toBeVisible();
  await clientContext.close();
});

test('a revoked or unknown signing link cannot be used', async ({ page }) => {
  await page.goto('/terms/' + 'f'.repeat(48));
  await expect(page.getByText('This signing link is no longer valid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign and return' })).toHaveCount(0);
});

/**
 * Firm-level policy: the AI note the reports carry, and the house style new
 * terms of engagement draft from.
 */
/**
 * DEPENDS ON A PRISTINE DEAL: it asserts that a FRESH draft inherits the firm's
 * defaults, which only happens while Clovelly has no saved terms row. Any test
 * (or hand-poke) that saves terms there breaks this until the next reseed.
 */
test('firm policy sets the AI note and the terms house style', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Valuation policy' })).toBeVisible();
  // the factual statement about the engine is not something a firm can edit
  await expect(page.getByText(/is not editable — it is a fact about how the engine works/)).toBeVisible();

  const note = 'All AI-assisted text is reviewed and adopted by the signing valuer before issue.';
  await page.getByLabel('AI policy note').fill(note);

  // house style for new terms lives behind a disclosure
  await page.getByRole('button', { name: /Terms of engagement — house style/ }).click();
  await page.getByLabel('Purpose of the valuation').fill('Internal investment appraisal, as instructed.');
  await page.getByLabel('Basis of fees').fill('A fixed fee of £4,750 plus VAT, payable on delivery.');
  await page.getByLabel('Valuer registration line').fill('MRICS · RICS Registered Valuer no. 1148207');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Firm policy saved — new terms will draft from it')).toBeVisible();

  // a deal with no terms yet drafts from the house style…
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Clovelly')).id;
  });
  await page.goto(`/deal/${id}/engagement`);
  await expect(page.getByLabel('Purpose of the valuation')).toHaveValue('Internal investment appraisal, as instructed.');
  await expect(page.getByLabel('Basis of fees')).toHaveValue('A fixed fee of £4,750 plus VAT, payable on delivery.');
  await expect(page.getByLabel('Registration')).toHaveValue('MRICS · RICS Registered Valuer no. 1148207');
  // …while a field left blank still gets Apex's own wording
  await expect(page.getByLabel('Other intended users')).toContainText('addressee client only');

  // and the report carries the note after the standing statement, not instead of it
  const northgate = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
  await page.goto(`/deal/${northgate}/redbook`);
  await expect(page.getByText('Use of artificial intelligence')).toBeVisible();
  await expect(page.getByText(/No artificial intelligence/).first()).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();
});

/**
 * Firm logo — client-facing documents carry the firm's mark and name, not the
 * product's. The app chrome stays Apex.
 */
test('firm logo brands the client-facing documents', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));

  // upload a logo through the real endpoint
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAAXklEQVR42u3QMQEAAAgDoC251a3gLwSgOZLKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysoPWx0AAWvpTMkAAAAASUVORK5CYII=',
    'base64',
  );
  const up = await request.post('/uploads/logo', {
    headers: { authorization: `Bearer ${token}` },
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } },
  });
  expect(up.ok()).toBeTruthy();
  const { url } = (await up.json()) as { url: string };
  expect(url).toMatch(/^\/uploads\/files\/logo-/);

  // the uploaded file is reachable from the WEB origin, not just the API's —
  // in production an nginx regex location used to swallow /uploads/*.png
  const fetched = await request.get(url);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()['content-type']).toContain('image/png');

  // settings shows the mark and offers to replace it
  await page.goto('/settings');
  await expect(page.getByText('Firm logo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace logo' })).toBeVisible();

  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });

  // both reports carry the firm's mark and name
  for (const route of ['report', 'redbook']) {
    await page.goto(`/deal/${id}/${route}`);
    const cover = page.locator('.a4-page').first();
    await expect(cover.getByAltText(/logo/i)).toBeVisible();
    await expect(cover.getByText('Brookfield Developments').first()).toBeVisible();
  }

  // and only an admin may change it
  const nonAdmin = await request.post('/uploads/logo', {
    headers: { authorization: 'Bearer not-a-token' },
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } },
  });
  expect(nonAdmin.status()).toBe(401);
});

/**
 * Reversionary income — a tenancy let below its ERV is worth more than its
 * passing rent, and the valuer can switch between the vertical and horizontal
 * splits.
 */
test('reversionary rent roll values term and reversion, and switches method', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Investment', exact: true }).click();

  // the rent roll carries an ERV, a review date and a per-tenancy yield
  await expect(page.getByLabel(/Retail units .* estimated rental value/)).toHaveValue('21.5');
  await expect(page.getByLabel(/Retail units .* years to review/)).toHaveValue('3');
  // no bracketed suffix on this label, so no wildcard between name and column
  await expect(page.getByLabel(/First-floor offices tenancy yield/)).toHaveValue('8');

  // hardcore restates the same income as a core plus a deferred top slice
  await page.getByRole('tab', { name: 'Hardcore', exact: true }).click();
  await expect(page.getByText('Top slice — deferred uplift')).toBeVisible();
  await expect(page.getByText(/uplift to ERV is a top slice deferred to review/)).toBeVisible();

  // and perpetuity ignores the reversion entirely — a different value on the same rent
  const investmentRow = page.locator('div').filter({ hasText: /^— capitalised investment value/ });
  const reversionaryValue = await investmentRow.innerText();
  await page.getByRole('tab', { name: 'Perpetuity', exact: true }).click();
  await expect(page.getByText(/Years purchase @/)).toBeVisible();
  await expect(investmentRow).not.toHaveText(reversionaryValue);
});

/**
 * Branding reaches the surfaces i61 left behind: the workbook and the portals a
 * client logs into.
 */
test('firm branding reaches the workbook and the portals', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));

  // ensure a logo exists (this suite may run before the branding test)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAAXklEQVR42u3QMQEAAAgDoC251a3gLwSgOZLKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysoPWx0AAWvpTMkAAAAASUVORK5CYII=',
    'base64',
  );
  await request.post('/uploads/logo', {
    headers: { authorization: `Bearer ${token}` },
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: png } },
  });

  // the workbook downloads and is named for the deal — its contents are asserted
  // in the node-side workbook tests, which can open the file
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Northgate')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export .xlsx' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  // a buyer leads with their development, under the firm's mark — never ours
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill('buyer@demo.co.uk');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Harbour Reach').first()).toBeVisible();
  await expect(page.getByAltText(/logo/i).first()).toBeVisible();
  await expect(page.getByText('Apex Appraise')).toHaveCount(0);

  // an investor sees the firm's name in the lockup where an internal user sees Apex
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill('investor@demo.co.uk');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Investor portal').first()).toBeVisible();
  await expect(page.getByText('Brookfield Developments').first()).toBeVisible();
  await expect(page.getByText('Apex Appraise')).toHaveCount(0);
});

/**
 * Dark-mode legibility of the brand green. #14503B measures 1.84:1 on the dark
 * panel — this asserts the theme-aware token resolves per theme AND that the
 * rendered contrast actually clears AA, rather than trusting the token swap.
 */
test('brand emphasis text is legible in both themes', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });

  /** contrast of an element's text against the first opaque background behind it */
  const measure = (text: string) =>
    page.evaluate((needle) => {
      const el = [...document.querySelectorAll('div,span')].find(
        (n) => n.children.length === 0 && n.textContent?.trim() === needle,
      );
      if (!el) return null;
      const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const opaque = (s: string) => !!s && !s.includes('rgba(0, 0, 0, 0)') && s !== 'transparent';
      let bgEl: Element | null = el;
      let bg = '';
      while (bgEl) {
        const c = getComputedStyle(bgEl).backgroundColor;
        if (opaque(c)) { bg = c; break; }
        bgEl = bgEl.parentElement;
      }
      const lum = (c: number[]) => {
        const f = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };
      const fg = rgb(getComputedStyle(el).color);
      const b = rgb(bg);
      const [hi, lo] = [lum(fg), lum(b)].sort((x, y) => y - x);
      return { color: fg, background: b, ratio: (hi + 0.05) / (lo + 0.05) };
    }, text);

  await page.goto(`/deal/${id}/appraisal`);
  // Polling on body alone is not enough: body can reach its final colour while
  // the PANEL behind the measured text is still transitioning, which reads as
  // the dark brand ink on a light surface (~2.26:1). Freeze animation instead.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.getByRole('button', { name: 'Investment', exact: true }).click();
  await expect(page.getByText('Investment value in GDV', { exact: true })).toBeVisible();

  // light: the brand green is unchanged and already comfortable
  const light = await measure('Investment value in GDV');
  expect(light).not.toBeNull();
  expect(light!.color).toEqual([20, 80, 59]);
  expect(light!.ratio).toBeGreaterThan(4.5);

  // dark: the token resolves to the lighter brand green and clears AA
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(16, 20, 18)');
  const dark = await measure('Investment value in GDV');
  expect(dark).not.toBeNull();
  // assert the guarantee, not the constant: the token must resolve to something
  // OTHER than the light value and must clear AA. Pinning the exact triplet made
  // this fail the moment the value was tuned, which is not a regression.
  expect(dark!.color).not.toEqual([20, 80, 59]);
  expect(dark!.ratio).toBeGreaterThan(4.5);

  // and the old colour survives nowhere on the page. Polled, because
  // `transition-colors` means a scan fired immediately after the toggle reads
  // the PRE-transition colour and reports a failure that fixes itself.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .filter((n) => getComputedStyle(n).color === 'rgb(20, 80, 59)')
            .map((n) => `${n.tagName}.${(n.className || '').toString().slice(0, 40)}: ${(n.textContent || '').trim().slice(0, 30)}`),
        ),
      { message: 'elements still rendering the light-mode brand green in dark mode' },
    )
    .toEqual([]);

  // the segmented-control rail was a hardcoded light grey in both themes: a
  // white bar on a dark page, with unselected labels failing AA in LIGHT too
  const rail = await page.evaluate(() => {
    const track = document.querySelector('[role="tablist"]') as HTMLElement | null;
    const label = track?.querySelector('button[aria-selected="false"]') as HTMLElement | null;
    if (!track || !label) return null;
    const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const f = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const trackBg = rgb(getComputedStyle(track).backgroundColor);
    const canvas = rgb(getComputedStyle(document.body).backgroundColor);
    return { labelOnRail: contrast(rgb(getComputedStyle(label).color), trackBg), railOnCanvas: contrast(trackBg, canvas) };
  });
  expect(rail).not.toBeNull();
  expect(rail!.labelOnRail).toBeGreaterThan(4.5); // was 3.34 in dark, 2.76 in light
  expect(rail!.railOnCanvas).toBeLessThan(2); // was 15.69 — a light bar on a dark page

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 244, 241)');
  // polled for the same reason as the sweep above: `transition-colors` means an
  // immediate read returns the dark label colour against the light rail
  const measureRail = () => page.evaluate(() => {
    const track = document.querySelector('[role="tablist"]') as HTMLElement;
    const label = track.querySelector('button[aria-selected="false"]') as HTMLElement;
    const rgb = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const f = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const [hi, lo] = [lum(rgb(getComputedStyle(label).color)), lum(rgb(getComputedStyle(track).backgroundColor))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  });
  await expect.poll(measureRail, { message: 'unselected toggle label on the light rail' }).toBeGreaterThan(4.5);
});

/**
 * Per-phase trade breakdown — a phase inherits the scheme's trades until it
 * needs its own, and each of its trades can carry a window timed from the
 * phase's first month on site.
 */
test('a phase breaks down by trade, or inherits the scheme', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);
  await page.getByRole('button', { name: 'Phases', exact: true }).click();

  // phase A prices off the scheme and states so
  await expect(page.getByText('Trades — this phase')).toBeVisible();
  await expect(page.getByLabel('Phase A — quayside block trade 1 label')).toHaveValue('Piling & basement');
  await expect(page.getByLabel('Phase A — quayside block Piling & basement rate per sq ft')).toHaveValue('38');
  // phase B inherits, so its trades are shown but not editable
  await expect(page.getByText('Trades — inherited from the scheme')).toBeVisible();
  await expect(page.getByLabel('Phase B — courtyard block trade 1 label')).toHaveCount(0);

  // breaking phase B down seeds a copy of the scheme's trades to edit
  await page.getByRole('button', { name: 'Break down by trade' }).click();
  await expect(page.getByLabel('Phase B — courtyard block trade 1 label')).toHaveValue('Groundworks & substructure');
  await expect(page.getByText('Trades — inherited from the scheme')).toHaveCount(0);

  // and reverting hands it back to the scheme
  await page.getByRole('button', { name: 'Use scheme trades' }).last().click();
  await expect(page.getByText('Trades — inherited from the scheme')).toBeVisible();
});

/**
 * Growth-explicit DCF — the cross-check on the capitalisation. It must never
 * move GDV: the reported value stays on the all-risks capitalisation.
 */
test('the DCF cross-checks the capitalisation without moving GDV', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${id}/appraisal`);

  const gdvBefore = await page.getByText('Gross development value').locator('..').innerText();

  await page.getByRole('button', { name: 'Investment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Growth-explicit DCF' })).toBeVisible();
  await expect(page.getByLabel('Hold (years)')).toHaveValue('10');
  await expect(page.getByLabel('Rental growth (% pa)')).toHaveValue('2.5');
  await expect(page.getByText('Net present value')).toBeVisible();
  await expect(page.getByText('Equated yield', { exact: true })).toBeVisible();
  // Reviews are marked where they land. Two lines on different cycles: the
  // retail units review at 3 then 8 (they carry yearsToReview 3), the offices
  // have none stated so they take the 5-year cycle — 5 then 10.
  // exact: the containing cell also matches a substring search, double-counting
  await expect(page.getByText('REVIEW', { exact: true })).toHaveCount(4);
  await expect(page.getByText(/GDV stays on the capitalisation/)).toBeVisible();

  // changing a DCF input moves the NPV but NOT the reported GDV
  const npvAt2point5 = await page.getByText('Net present value', { exact: true }).locator('..').innerText();
  await page.getByLabel('Rental growth (% pa)').fill('5');
  await expect
    .poll(() => page.getByText('Net present value', { exact: true }).locator('..').innerText())
    .not.toBe(npvAt2point5); // the DCF moved
  // ...and the reported value did not (innerText both sides: toHaveText normalises differently)
  expect(await page.getByText('Gross development value').locator('..').innerText()).toBe(gdvBefore);

  /**
   * Growth is what separates the two methods, so removing it must pull the
   * equated yield down toward the all-risks yield. The exact identity between
   * DCF and capitalisation is an engine property — proven there on a single-rate
   * roll; this roll carries per-line yields, its own reversion yield and a
   * let-up deduction, so a single-rate DCF is NOT expected to match it.
   */
  const yieldAt = async () => {
    const t = await page.getByText('Equated yield', { exact: true }).locator('..').innerText();
    return Number(t.replace(/[^\d.]/g, ''));
  };
  const withGrowth = await yieldAt();
  await page.getByLabel('Rental growth (% pa)').fill('0');
  await expect.poll(yieldAt).not.toBe(withGrowth);
  expect(await yieldAt()).toBeLessThan(withGrowth);
});

/**
 * Signing links expire. A link is a bearer credential — one sitting in an old
 * email must stop working on its own, not only when someone remembers to
 * withdraw it.
 */
test('a signing link expires, and an expired one cannot sign', async ({ page, browser }) => {
  test.setTimeout(90_000); // two browser contexts and a full issue → sign → revoke walk
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  /**
   * This test SAVES terms, so it needs a deal no other test reads as a fresh
   * draft. Currently claimed: Northgate, Kingsway, Harbour (appraisals),
   * Westover (contrast sweep), Clovelly (firm-policy defaults), Southbourne
   * (signing walk), Elm Grove. Stour Valley is this test's.
   */
  const id = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Stour')).id;
  });

  const issue = async (dealId: string) =>
    page.evaluate(async (deal) => {
      const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
      const terms = {
        clientName: 'Expiry Test Ltd', clientAddress: '', otherUsers: 'None.', purpose: 'Loan security.',
        interest: 'Freehold.', basisOfValue: 'Market Value', valuationDate: null,
        extentOfInvestigation: 'Inspection.', sourcesOfInformation: 'Client.', assumptions: 'Standard.',
        specialAssumptions: 'None.', reportFormat: 'PDF.', restrictionsOnUse: 'None.', feeBasis: 'Fixed.',
        liabilityCap: null, complaintsProcedure: 'RICS.', aiUse: 'May be used.',
        valuerName: 'Dana Whitlock MRICS', valuerReg: 'RICS Registered Valuer',
      };
      await fetch('/trpc/engagement.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: { dealId: deal, terms } }) });
      const res = await fetch('/trpc/engagement.issue', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ json: { dealId: deal, expiryDays: 7 } }),
      });
      const j = await res.json();
      return j.result.data.json as { signToken: string; signTokenExpiresAt: string };
    }, dealId);

  const first = await issue(id);
  expect(first.signToken).toBeTruthy();
  // the window is recorded, roughly seven days out
  const days = (new Date(first.signTokenExpiresAt).getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);

  // the valuer sees when it dies
  await page.goto(`/deal/${id}/engagement`);
  await expect(page.getByText('Valid until', { exact: false })).toBeVisible();
  await expect(page.getByText(/It stops working on/)).toBeVisible();

  // a live link signs fine
  const client = await browser.newContext();
  const clientPage = await client.newPage();
  await clientPage.goto(`/terms/${first.signToken}`);
  await expect(clientPage.getByText('Sign these terms')).toBeVisible();

  // revoking expires it immediately — the valuer's own kill switch
  await page.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText(/EXPIRED, the client cannot sign/)).toBeVisible();

  // the client's page now says so, and signing is refused
  await clientPage.goto(`/terms/${first.signToken}`);
  await expect(clientPage.getByText('This signing link has expired')).toBeVisible();
  const refused = await clientPage.evaluate(async (token) => {
    const res = await fetch('/trpc/engagement.sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { token, name: 'Someone Late', agreed: true } }),
    });
    return (await res.json()).error?.json?.message ?? 'no error';
  }, first.signToken);
  expect(refused).toMatch(/expired/i);

  // reissuing mints a NEW link and the old token stays dead
  const second = await issue(id);
  expect(second.signToken).not.toBe(first.signToken);
  await clientPage.goto(`/terms/${second.signToken}`);
  await expect(clientPage.getByText('Sign these terms')).toBeVisible();
  await clientPage.goto(`/terms/${first.signToken}`);
  await expect(clientPage.getByText(/no longer valid|has expired/)).toBeVisible();

  /**
   * A signed document survives its link expiring. Expiry stops SIGNING, not a
   * client reading the copy they already executed — they are entitled to it,
   * and holding the token proves they were the signatory.
   */
  await clientPage.goto(`/terms/${second.signToken}`);
  await clientPage.getByLabel('Full name').fill('Jane Marchmont');
  await clientPage.getByLabel('I agree to these terms of engagement').check();
  await clientPage.getByRole('button', { name: 'Sign and return' }).click();
  await expect(clientPage.getByText('Thank you — these terms are signed')).toBeVisible();

  // revoke through the API: once the terms are ACCEPTED the button is gone from
  // the screen, which is correct — there is nothing left to sign
  await page.evaluate(async (dealId) => {
    await fetch('/trpc/engagement.revokeLink', {
      method: 'POST',
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ json: dealId }),
    });
  }, id);
  await clientPage.goto(`/terms/${second.signToken}`);
  await expect(clientPage.getByText('Thank you — these terms are signed')).toBeVisible();
  await client.close();
});

/**
 * Red Book approaches panel — it runs the shared engine now, and its weights
 * follow the scheme rather than sitting at a fixed 70/20/10.
 */
test('the approaches panel weights the investment method by how income-led the scheme is', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const ids = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const deals = j.result.data.json.deals as Array<{ id: string; name: string }>;
    const by = (p: string) => deals.find((d) => d.name.startsWith(p))!.id;
    return { income: by('Kingsway'), sales: by('Northgate') };
  });

  const weights = async () => {
    const txt = await page.locator('.a4-page').filter({ hasText: 'Valuation methodology' }).innerText();
    return [...txt.matchAll(/Weight (\d+)%/g)].map((m) => Number(m[1]));
  };

  // an income-led scheme: most of its GDV is a held-and-let element
  await page.goto(`/deal/${ids.income}/redbook`);
  await page.waitForSelector('.a4-page');
  const led = await weights();
  expect(led).toHaveLength(3);
  expect(led.reduce((a, b) => a + b, 0)).toBe(100);
  expect(led[2]).toBeGreaterThanOrEqual(30); // investment carries material weight
  await expect(page.getByText(/investment method.*afforded material weight|A substantial part of the scheme is held and let/)).toBeVisible();
  // stated growth-explicitly, with the equated yield the two methods agree at
  await expect(page.getByText(/equated yield of/)).toBeVisible();
  await expect(page.getByText(/DCF at 2\.5% growth · equated/)).toBeVisible();

  // a pure sales scheme reverts to the conventional split and prose
  await page.goto(`/deal/${ids.sales}/redbook`);
  await page.waitForSelector('.a4-page');
  expect(await weights()).toEqual([70, 20, 10]);
  await expect(page.getByText(/afforded limited weight/)).toBeVisible();
  await expect(page.getByText(/equated yield of/)).toHaveCount(0);
});

/**
 * The appraisal PDF gains an Investment section when the scheme holds space —
 * and the page numbering is derived, so inserting it must not desync the
 * "Page n of N" footers the PDF is printed from.
 */
test('the appraisal report prints an investment section without desyncing pagination', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const ids = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const deals = j.result.data.json.deals as Array<{ id: string; name: string }>;
    const by = (p: string) => deals.find((d) => d.name.startsWith(p))!.id;
    return { income: by('Kingsway'), sales: by('Northgate') };
  });

  /**
   * page count, any page that will not print on one A4 sheet, and the footers.
   *
   * The page box is min-height 1122, so content that does not fit GROWS the box
   * instead of clipping it: scrollHeight === clientHeight and an overflow probe
   * reads clean while chromium quietly prints a second sheet. Measure the box.
   */
  const measure = () =>
    page.evaluate(() => {
      const pages = [...document.querySelectorAll('.a4-page')];
      return {
        count: pages.length,
        overflowing: pages.filter((p) => p.getBoundingClientRect().height > 1123).length,
        feet: pages.map((p) => (p.textContent?.match(/Page (\d+) of (\d+)/) ?? []).slice(1).join('/')).filter(Boolean),
      };
    });

  // a scheme that holds space: the section appears, and it fits on one page
  await page.goto(`/deal/${ids.income}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('4 · Investment valuation')).toBeVisible();
  await expect(page.getByText('Growth-explicit cross-check')).toBeVisible();
  await expect(page.getByText('Equated yield')).toBeVisible();
  // the reported value stays the capitalisation, and the page says so
  await expect(page.getByText(/the reported value remains the capitalisation/)).toBeVisible();
  const withInv = await measure();
  expect(withInv.overflowing).toBe(0);
  // footers run 2..N contiguously and agree with the number of pages rendered
  expect(withInv.feet).toEqual(
    Array.from({ length: withInv.count - 1 }, (_, i) => `${i + 2}/${withInv.count}`),
  );

  // a pure sales scheme has no such section, and everything shifts back
  await page.goto(`/deal/${ids.sales}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('Investment valuation')).toHaveCount(0);
  await expect(page.getByText('4 · Sensitivity — profit on cost')).toBeVisible();
  const noInv = await measure();
  expect(noInv.overflowing).toBe(0);
  // TWO sheets separate them now: the investment valuation and, since the scheme
  // carries a DCF, its growth × exit-yield grid
  await expect(page.getByText('DCF sensitivity')).toHaveCount(0);
  expect(noInv.count).toBe(withInv.count - 2);
  expect(noInv.feet).toEqual(Array.from({ length: noInv.count - 1 }, (_, i) => `${i + 2}/${noInv.count}`));
});

/**
 * Version comparison in the drawer a reviewer actually opens.
 *
 * OWNS 'Southbourne Grove'. It saves versions, so it must not touch a deal any
 * other test reads.
 */
test('a reviewer can see what changed between versions, and why', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  /**
   * Versions accumulate: this test saves two every run, so a fixed label matches
   * more of them each time and the assertion fails on the SECOND run with a
   * strict-mode error that reads like a missing element. Each run labels its own.
   */
  const run = `${Date.now()}`.slice(-6);
  const dealId = await page.evaluate(async (tag) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const id = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Southbourne')).id;
    const input = {
      units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
      efficiency: 85,
      trades: [{ label: 'Superstructure', rate: 110 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
    };
    const save = (body: unknown) =>
      fetch('/trpc/appraisal.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: body }) });
    await save({ dealId: id, input, label: `Base ${tag}` });
    await save({
      dealId: id,
      input: { ...input, trades: [{ label: 'Superstructure', rate: 130 }] },
      asNewVersion: true,
      label: `Post-tender ${tag}`,
      note: `Rebased on the tender return ${tag}`,
    });
    return id;
  }, run);

  await page.goto(`/deal/${dealId}/appraisal`);
  await page.getByRole('button', { name: /^Versions/ }).click();
  await expect(page.getByText(`Post-tender ${run}`)).toBeVisible();
  // the reason is on the record next to the version it explains
  await expect(page.getByText(`“Rebased on the tender return ${run}”`)).toBeVisible();

  // the newest non-current version is this run's Base, which is what we compare
  await page.getByRole('button', { name: 'What changed' }).first().click();
  /**
   * Scoped to the diff block. The appraisal behind the drawer carries several of
   * the same labels — "Residual land" among them — so an unscoped assertion
   * matches two elements and fails strict mode with an error that reads exactly
   * like the element being absent.
   */
  const diff = page.locator('[data-version-diff]');
  await expect(diff.getByText('Trade — Superstructure')).toBeVisible();
  await expect(diff.getByText('£110', { exact: true })).toBeVisible();
  await expect(diff.getByText('£130', { exact: true })).toBeVisible();
  // and the consequence a reviewer is actually judging
  await expect(diff.getByText('Residual land', { exact: true })).toBeVisible();
});

/**
 * Review and approval through the UI a director would actually use.
 *
 * OWNS 'Old Brewery Quarter' — it approves a version, and an approved version
 * cannot be edited, so no other test may share this deal. (Elm Grove would have
 * been wrong: the terms-of-engagement walk already uses it.)
 */
test('a version can be submitted, approved, and then not quietly edited', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const run = `${Date.now()}`.slice(-6);
  const dealId = await page.evaluate(async (tag) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const id = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Old Brewery')).id;
    const input = {
      units: [{ label: '2-bed apartments', count: 8, area: 750, cap: 430 }],
      efficiency: 85,
      trades: [{ label: 'Superstructure', rate: 115 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
    };
    await fetch('/trpc/appraisal.save', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ json: { dealId: id, input, asNewVersion: true, label: `For review ${tag}` } }),
    });
    return id;
  }, run);

  await page.goto(`/deal/${dealId}/appraisal`);
  await page.getByRole('button', { name: /^Versions/ }).click();
  await expect(page.getByText(`For review ${run}`)).toBeVisible();

  /**
   * Scoped to THIS run's version row. `.first()` matched a previous run's
   * approved version, so the APPROVED assertion passed instantly against a stale
   * row while this version was still in review — and the save below then raced
   * ahead of the approval and was allowed. The test reported a broken lock that
   * was not broken.
   */
  const row = page.locator(`[data-version="For review ${run}"]`);
  await expect(row).toHaveCount(1);

  await row.getByRole('button', { name: 'Submit for review' }).click();
  await expect(row.getByText('IN REVIEW')).toBeVisible();

  // sending it back needs a reason — the button stays disabled until there is one
  await expect(row.getByRole('button', { name: 'Request changes' })).toBeDisabled();

  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row.getByText('APPROVED')).toBeVisible();
  // one person did both halves here, and the record says so rather than leaving
  // a reader to notice the names match
  await expect(row.getByText(/\(their own work\)/)).toBeVisible();

  /**
   * The rule the whole feature rests on: the approved figures cannot be changed
   * without a new version. Asked of the API directly, because the point is that
   * the SERVER refuses — a UI that merely hides the button protects nothing.
   */
  const refused = await page.evaluate(async (id) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const r = await fetch('/trpc/appraisal.save', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        json: {
          dealId: id,
          input: {
            units: [{ label: '2-bed apartments', count: 8, area: 750, cap: 430 }],
            efficiency: 85,
            trades: [{ label: 'Superstructure', rate: 999 }],
            profFeePct: 11,
            contingencyPct: 5,
            otherCosts: [],
            finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
            site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
            disposal: { agentPct: 1.5, legalPct: 0.5 },
            targetProfitOnGdvPct: 20,
          },
        },
      }),
    });
    return (await r.json()).error?.json?.message ?? 'NOT REFUSED';
  }, dealId);
  expect(refused).toMatch(/approved and cannot be edited/);
});

/**
 * The cross-deal review queue on the Hub.
 *
 * Shares 'Stour Valley Logistics' with the signing walk, which only touches that
 * deal's engagement terms — but this test SELF-CLEANS anyway: it approves the
 * version it submitted, so it leaves no work sitting in a customer-facing demo
 * queue, and proves the queue empties as well as fills.
 */
test('the hub shows what is waiting on you, and stops showing it once decided', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const run = `${Date.now()}`.slice(-6);
  const versionId = await page.evaluate(async (tag) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const id = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Stour Valley')).id;
    const input = {
      units: [{ label: 'Units', count: 6, area: 900, cap: 400 }], efficiency: 85,
      trades: [{ label: 'Build', rate: 120 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 16, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 }, disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
    };
    const r = await fetch('/trpc/appraisal.save', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ json: { dealId: id, input, asNewVersion: true, label: `Queue ${tag}` } }),
    });
    const vid = (await r.json()).result.data.json.id;
    await fetch('/trpc/appraisal.submitForReview', { method: 'POST', headers: auth, body: JSON.stringify({ json: { versionId: vid } }) });
    return vid;
  }, run);

  // the Hub is the root route
  await page.goto('/');
  const queue = page.locator('[data-review-queue]');
  await expect(queue).toBeVisible();
  await expect(queue.getByText('Waiting on you')).toBeVisible();
  await expect(queue.getByText(`Queue ${run}`)).toBeVisible();
  // the figures a reviewer decides on are on the card, not one click away
  await expect(queue.getByText('GDV').first()).toBeVisible();

  // decide it, and the queue lets it go
  await page.evaluate(async (vid) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    await fetch('/trpc/appraisal.review', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ json: { versionId: vid, decision: 'approve', note: 'Checked' } }),
    });
  }, versionId);

  await page.goto('/');
  await page.waitForTimeout(600);
  await expect(page.getByText(`Queue ${run}`)).toHaveCount(0);
});

/**
 * Portfolio debt exposure on the board — the lender's question, which no
 * per-deal figure answers. Read-only: it computes from deals other tests own, so
 * it asserts SHAPE and INTERNAL CONSISTENCY rather than fixed figures, which
 * would break every time another test re-saves an appraisal.
 */
test('the board states the book’s debt exposure and its largest concentration', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.goto('/board');

  const panel = page.locator('[data-exposure]');
  await expect(panel).toBeVisible();
  // exact: getByText with a string matches case-INSENSITIVE substrings, so plain
  // 'Facility' also matches the "over facility" warning next to it
  await expect(panel.getByText('Facility', { exact: true })).toBeVisible();
  await expect(panel.getByText('Utilisation', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Largest concentration:/)).toBeVisible();

  const read = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.exposure', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json as {
      positions: Array<{ facility: number }>;
      totals: { facility: number; drawn: number; undrawn: number; utilisation: number };
      byRegion: Array<{ share: number }>;
      largest: { share: number } | null;
    };
  });

  // the book adds up to the deals it summarises
  const summed = read.positions.reduce((a, p) => a + p.facility, 0);
  expect(Math.round(summed)).toBe(Math.round(read.totals.facility));
  expect(read.byRegion.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 6);
  // undrawn is never negative, however over-drawn the book is
  expect(read.totals.undrawn).toBeGreaterThanOrEqual(0);
  expect(read.largest!.share).toBeLessThanOrEqual(1);

  // an over-drawn book says so in words rather than leaving a bare percentage
  // that reads like a rounding fault
  if (read.totals.utilisation > 1) await expect(panel.getByText('over facility')).toBeVisible();

  /**
   * A deal drawing ahead of its works is named, not merely counted: "one deal is
   * overspending" is not actionable, "Harbour Reach is £3.4m ahead of its works"
   * is. Conditional because it depends on cost monitoring other tests may change.
   */
  const overspending = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.exposure', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const d = (await r.json()).result.data.json as { positions: Array<{ name: string; drawdown: { status: string } | null }> };
    return d.positions.filter((p) => p.drawdown?.status === 'overspending').map((p) => p.name);
  });
  if (overspending.length) {
    await expect(panel.getByText('Drawn ahead of works')).toBeVisible();
    await expect(panel.getByText(new RegExp(overspending[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
  }
});

/**
 * Facility covenants: not tested until the firm sets its own limits.
 *
 * SELF-CLEANING — it sets a limit, asserts the breach, and clears it again, so it
 * leaves no invented covenant on a customer-facing demo. Sets it through the real
 * Settings form rather than the API, because "can an admin actually enter this"
 * is half of what is being tested.
 */
test('covenants are judged only once the firm sets them, and can be cleared again', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  /**
   * Establish the precondition rather than assume it. A previous run — or a demo
   * left mid-configuration — can have a limit already saved, and a test that
   * merely hopes for a clean slate fails on the state someone else left.
   */
  await page.goto('/settings');
  await page.getByLabel('Max loan to GDV (%)').fill('');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await page.waitForTimeout(1000);

  // nothing set: the board shows the ratios and judges none of them
  await page.goto('/board');
  await expect(page.locator('[data-exposure]')).toBeVisible();
  await expect(page.getByText('Covenant breaches')).toHaveCount(0);

  await page.goto('/settings');
  const limit = page.getByLabel('Max loan to GDV (%)');
  // the placeholder offers the market-standard figure without applying it
  await expect(limit).toHaveAttribute('placeholder', /typically 65/);
  await limit.fill('20');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await page.waitForTimeout(1000);

  await page.goto('/board');
  const panel = page.locator('[data-exposure]');
  await expect(panel.getByText('Covenant breaches')).toBeVisible();
  // named, measured, and against the limit the firm actually set. .first():
  // several deals genuinely breach at this limit, and asserting the format of one
  // is the point — the COUNT is checked against the API below instead.
  await expect(panel.getByText(/Loan to GDV .* against a maximum of 20%/).first()).toBeVisible();
  const breaching = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.exposure', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const d = (await r.json()).result.data.json as { positions: Array<{ covenants: { breaches: unknown[] } }> };
    return d.positions.filter((p) => p.covenants.breaches.length > 0).length;
  });
  // every breaching deal is listed — a panel that showed only the first would let
  // the rest of the book go unmentioned
  await expect(panel.getByText(/against a maximum of 20%/)).toHaveCount(breaching);

  // clear it: a covenant that cannot be removed is one nobody will risk setting
  await page.goto('/settings');
  await page.getByLabel('Max loan to GDV (%)').fill('');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await page.waitForTimeout(1000);
  await page.goto('/board');
  await expect(page.locator('[data-exposure]')).toBeVisible();
  await expect(page.getByText('Covenant breaches')).toHaveCount(0);
});

/**
 * The portfolio funding pack — the book as a lender receives it.
 *
 * Read-only over deals other tests own, so it asserts structure and internal
 * consistency rather than fixed figures. Pagination is exercised with a
 * deliberately long book, because the demo has three schemes and would never
 * reach a second page.
 */
test('the funding pack states the book, its exceptions, and paginates honestly', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  await page.goto('/portfolio/pack');
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('Portfolio funding pack').first()).toBeVisible();
  // exceptions come BEFORE the table: a reader who has to find them among the
  // rows will not find them
  await expect(page.getByText('Exceptions')).toBeVisible();

  const real = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.a4-page')];
    return {
      pages: p.length,
      overflowing: p.filter((x) => x.getBoundingClientRect().height > 1123).length,
      feet: p.map((x) => (x.textContent ?? '').match(/Page (\d+) of (\d+)/)?.[0]),
      totals: p.filter((x) => /schemes? · \d+ postcode/.test(x.textContent ?? '')).length,
    };
  });
  expect(real.overflowing).toBe(0);
  expect(real.feet).toEqual(Array.from({ length: real.pages }, (_, i) => `Page ${i + 1} of ${real.pages}`));
  // the book totals once, on the last sheet
  expect(real.totals).toBe(1);

  /**
   * Pagination, forced. The demo book is three schemes; a pack that only ever
   * renders one page has never had its page break exercised, and the first
   * customer with thirty schemes would be the one to find out.
   */
  await page.route('**/trpc/deals.exposure*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // tRPC batches, so a response may be an ARRAY of envelopes rather than one
    const envelope = Array.isArray(body) ? body[0] : body;
    const data = envelope.result.data.json;
    const one = data.positions[0];
    data.positions = Array.from({ length: 40 }, (_, i) => ({ ...one, dealId: `synthetic-${i}`, name: `Scheme ${i + 1}` }));
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/portfolio/pack');
  await page.waitForSelector('.a4-page');
  await page.waitForTimeout(600);

  const long = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.a4-page')];
    return {
      pages: p.length,
      overflowing: p.filter((x) => x.getBoundingClientRect().height > 1123).length,
      feet: p.map((x) => (x.textContent ?? '').match(/Page (\d+) of (\d+)/)?.[0]),
      rows: p.reduce((a, x) => a + ((x.textContent ?? '').match(/Scheme \d+/g)?.length ?? 0), 0),
      totals: p.filter((x) => /schemes? · \d+ postcode/.test(x.textContent ?? '')).length,
    };
  });
  expect(long.pages).toBeGreaterThan(1);
  expect(long.overflowing).toBe(0);
  expect(long.feet).toEqual(Array.from({ length: long.pages }, (_, i) => `Page ${i + 1} of ${long.pages}`));
  // every scheme appears exactly once — a page break that DROPS rows is worse
  // than one that overflows, because nothing on the page says so
  expect(long.rows).toBe(40);
  expect(long.totals).toBe(1);
});

/**
 * Time to value for a brand-new signup.
 *
 * The trial promise is "documents in, appraisal out". This walks it as a stranger
 * would and counts the clicks, because the flow was one click longer than it
 * looked: the Hub's primary call to action landed on the board, where the SAME
 * words appeared again as a button, so a new user clicked "New deal from
 * documents" twice to reach one form.
 *
 * Registers its own workspace, so it owns everything it touches.
 */
test('a new signup reaches the appraisal form in one click, on its own deal', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}`.slice(-7);

  await page.goto('/register');
  /**
   * Filled by LABEL, and only once the form has rendered. An earlier version
   * filled inputs by index as soon as the page loaded; under a parallel run the
   * values landed before React hydrated and were discarded, so the form
   * submitted empty and the failure looked like the Hub never appearing.
   */
  await expect(page.getByRole('heading', { name: 'Start your organisation' })).toBeVisible();
  await page.getByLabel(/Organisation name/i).fill(`Trial Firm ${stamp}`);
  await page.getByLabel(/Your name/i).fill('Sam Trial');
  await page.getByLabel(/^Email/i).fill(`trial${stamp}@example.test`);
  await page.getByLabel(/^Password/i).fill('a-strong-trial-password');
  await page.getByLabel(/Confirm password/i).fill('a-strong-trial-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // lands in a workspace of their own, with nothing in it yet
  await expect(page.getByText('Add your first deal')).toBeVisible({ timeout: 30_000 });

  /**
   * ONE click to the form. A link, not a button — it is styled as one, which is
   * why an earlier version of this test looked for the wrong role.
   */
  await page.getByRole('link', { name: /New deal from documents/i }).first().click();
  await expect(page.getByText('New deal', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create & appraise from documents/i })).toBeVisible();

  // the deep-link parameter is cleaned up, so a refresh does not reopen the form
  await expect(page).toHaveURL(/\/board$/);

  // and the form leads where it says: straight into Auto-Appraisal on their deal
  await page.getByLabel(/deal name/i).fill(`Trial Scheme ${stamp}`);
  await page.getByLabel(/address/i).fill('1 Trial Street, Bournemouth');
  await page.getByRole('button', { name: /Create & appraise from documents/i }).click();
  await expect(page).toHaveURL(/\/deal\/[^/]+\/auto/, { timeout: 30_000 });

  /**
   * The money moment, in the same journey rather than a second registration:
   * one click produces a full appraisal even with no AI key configured, which is
   * the self-hosted and CI case.
   */
  await page.getByRole('button', { name: /Generate appraisal/i }).click();
  await expect(page.getByText('Auto-generated appraisal')).toBeVisible({ timeout: 60_000 });

  /**
   * But it must not let the reader believe those figures came from their text.
   * Without a key the scheme, areas and values are the built-in worked example
   * and only S106, CIL and the asking price are read from what was pasted — said
   * ABOVE the figures, because a caveat underneath arrives after the damage.
   */
  const notice = page.locator('[data-sample-notice]');
  if ((await notice.count()) === 0) return; // a keyed server really did read the text
  await expect(notice).toBeVisible();
  await expect(notice.getByText(/worked example, not your text/i)).toBeVisible();
  await expect(notice.getByText(/Manual entry/)).toBeVisible();
});

/**
 * The root route serves both audiences.
 *
 * It used to serve only one: `/` was the protected workspace, so a stranger who
 * typed the domain was bounced to a login form — complete with demo credentials —
 * and the marketing page with the pricing on it sat at /welcome, reachable only
 * by someone who already knew the URL. The pitch cannot convert anyone who never
 * sees it.
 */
test('the root shows the pitch to a stranger and the workspace to a user', async ({ page }) => {
  // signed out: the product and its pricing, not a login form
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Start free/ }).first()).toBeVisible();
  await expect(page.getByText(/EMAIL/)).toHaveCount(0);

  // signed in: straight to the workspace, and it survives a reload
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Deal tools')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Deal tools')).toBeVisible();

  // /welcome still works, since existing links and bookmarks point at it
  await page.goto('/welcome');
  await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible();
});

/**
 * The DCF sensitivity matrix. Growth and the exit yield are the two assumptions
 * a hold is least certain about, so the report prints a grid over both — on its
 * own sheet, because the investment page has about 46px spare.
 *
 * OWNS 'Parkstone Mews'. It writes an appraisal whose DCF deliberately FAILS to
 * support the capitalisation, which is the case the dagger exists for and which
 * no seeded deal produces.
 */
test('the report grids the DCF over growth and exit yield, and marks what it does not support', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  // the seeded income scheme: a grid, on its own sheet, without desyncing anything
  const kingsway = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Kingsway')).id;
  });
  await page.goto(`/deal/${kingsway}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('4 · DCF sensitivity')).toBeVisible();
  const seeded = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.a4-page')];
    const grid = pages.find((p) => (p.querySelector('span')?.textContent ?? '').includes('DCF sensitivity'))!;
    const rows = [...(grid.querySelectorAll('.border-border-faint') ?? [])];
    return {
      count: pages.length,
      overflowing: pages.filter((p) => p.getBoundingClientRect().height > 1123).length,
      feet: pages.map((p) => (p.textContent ?? '').match(/Page (\d+) of (\d+)/)?.slice(1).join('/')).filter(Boolean),
      // 5 growth rows, each of 5 exit yields, plus the base cell outlined once.
      // Counted by CONTENT, not css class: a class-name count is a test of the
      // stylesheet, and it broke the moment the header shared a class.
      rowCount: rows.length,
      money: [...grid.querySelectorAll('div')].filter((d) => !d.children.length && /^£[\d,]+/.test((d.textContent ?? '').trim())).length,
      yields: [...grid.querySelectorAll('div')].filter((d) => !d.children.length && /^\d+\.\d{2}%$/.test((d.textContent ?? '').trim())).length,
      // computed, not the inline style string: the browser normalises the shorthand
      outlined: [...grid.querySelectorAll('div')].filter((d) => {
        const cs = getComputedStyle(d);
        return cs.outlineStyle === 'solid' && parseFloat(cs.outlineWidth) >= 2;
      }).length,
    };
  });
  expect(seeded.overflowing).toBe(0);
  expect(seeded.feet).toEqual(Array.from({ length: seeded.count - 1 }, (_, i) => `${i + 2}/${seeded.count}`));
  expect(seeded.rowCount).toBe(5);
  expect(seeded.money).toBe(25);
  expect(seeded.yields).toBe(5);
  expect(seeded.outlined).toBe(1);

  /**
   * A hold whose DCF does NOT support the capitalisation: a 4% all-risks yield
   * capitalises high, while nil growth and a 7% exit price it far lower.
   */
  const own = await page.evaluate(async () => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const dealId = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Parkstone')).id;
    const input = {
      units: [{ label: 'Houses', count: 6, area: 1100, cap: 420 }],
      efficiency: 85,
      trades: [{ label: 'Build', rate: 165 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 14, salesMonths: 5, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
      income: {
        lines: [{ label: 'Parade shops', count: 4, area: 1200, rentPsf: 18 }],
        nonRecoverablePct: 3,
        yieldPct: 4,
        purchaserCostsPct: 6.8,
      },
      dcf: { holdYears: 10, rentalGrowthPct: 0, discountRatePct: 8, exitYieldPct: 7 },
    };
    const out = await fetch('/trpc/appraisal.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: { dealId, input } }) });
    const body = await out.json();
    return { dealId, ok: !body.error, err: body.error?.json?.message?.slice(0, 140) ?? null };
  });
  expect(own, `save failed: ${own.err}`).toMatchObject({ ok: true });

  await page.goto(`/deal/${own.dealId}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('4 · DCF sensitivity')).toBeVisible();
  // the shortfall is stated in words, not left to the colour of a cell
  await expect(page.getByText(/below the capitalised/)).toBeVisible();
  await expect(page.getByText(/† marks the \d+ cells? where the growth-explicit view does not support/)).toBeVisible();
  const failing = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('.a4-page')].find((p) => (p.querySelector('span')?.textContent ?? '').includes('DCF sensitivity'))!;
    const cells = [...grid.querySelectorAll('.fig.text-center')].filter((c) => (c.textContent ?? '').includes('£'));
    return {
      daggered: cells.filter((c) => (c.textContent ?? '').includes('†')).length,
      stated: Number((grid.textContent ?? '').match(/† marks the (\d+) cell/)?.[1] ?? -1),
      overflowing: [...document.querySelectorAll('.a4-page')].filter((p) => p.getBoundingClientRect().height > 1123).length,
    };
  });
  expect(failing.daggered).toBeGreaterThan(0);
  // the count in the prose is the count on the grid — not two independent claims
  expect(failing.stated).toBe(failing.daggered);
  expect(failing.overflowing).toBe(0);
});

/**
 * Accommodation schedule pagination. A scheme with more units than one sheet
 * holds used to run silently past A4 — and because the page box grows rather
 * than clips, nothing on screen said so; it printed sheets the footers denied.
 *
 * OWNS 'Westover Yard'. It writes an eight-phase appraisal, so it must not touch
 * Harbour Reach (the small case, which four other tests read).
 */
test('the accommodation schedule paginates instead of running off the sheet', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const own = await page.evaluate(async () => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const dealId = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Westover')).id;
    const units = [
      { label: '1-bed apartments', count: 8, area: 520, cap: 400 },
      { label: '2-bed apartments', count: 6, area: 760, cap: 385 },
      { label: '3-bed houses', count: 4, area: 1150, cap: 360 },
    ];
    const input = {
      units: [],
      // eight phases of three unit types: 32 schedule rows, more than one sheet
      phases: Array.from({ length: 8 }, (_, i) => ({
        name: `Phase ${i + 1} — block ${String.fromCharCode(65 + i)}`,
        start: 1 + i * 3,
        buildMonths: 8,
        salesMonths: 4,
        units,
      })),
      efficiency: 85,
      trades: [{ label: 'Build', rate: 150 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 30, salesMonths: 6, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
    };
    const out = await fetch('/trpc/appraisal.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: { dealId, input } }) });
    const body = await out.json();
    return { dealId, ok: !body.error, err: body.error?.json?.message?.slice(0, 140) ?? null };
  });
  expect(own, `save failed: ${own.err}`).toMatchObject({ ok: true });

  await page.goto(`/deal/${own.dealId}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('2 · Accommodation schedule (2 of 2)')).toBeVisible();
  // the phasing block cannot share the last schedule sheet at this size
  await expect(page.getByText('2 · Phasing')).toBeVisible();

  const audit = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.a4-page')];
    return {
      count: pages.length,
      // height, not scrollHeight: an over-full page grows past A4 rather than clipping
      overflowing: pages.filter((p) => p.getBoundingClientRect().height > 1123).length,
      feet: pages.map((p) => (p.textContent?.match(/Page (\d+) of (\d+)/) ?? []).slice(1).join('/')).filter(Boolean),
      // the sheet the first schedule page points the reader at
      note: pages.find((p) => (p.textContent ?? '').includes('Schedule continues on page'))?.textContent?.match(/continues on page (\d+)/)?.[1],
      // scoped to the schedule's own sheets: the residual appraisal opens with a
      // "Gross development value" line too, and counting that is not the same test
      totals: pages
        .filter((p) => (p.querySelector('span')?.textContent ?? '').startsWith('2 · Accommodation schedule'))
        .filter((p) => (p.textContent ?? '').includes('Gross development value')).length,
    };
  });
  expect(audit.overflowing).toBe(0);
  expect(audit.feet).toEqual(Array.from({ length: audit.count - 1 }, (_, i) => `${i + 2}/${audit.count}`));
  // the schedule totals ONCE — a running total on each sheet would be wrong on all but one
  expect(audit.totals).toBe(1);
  // and the "continues on" note names the sheet the reader will actually turn to
  expect(audit.note).toBe('4');
  // a phase split across sheets says so, rather than leaving orphaned rows unattributed
  await expect(page.getByText('(continued)')).toBeVisible();
});

/**
 * Phase cost overrides in the report. They get their own continuation sheet —
 * the accommodation page had ~200px spare, nothing like enough. The workbook
 * prints every trade line; a fixed-height page cannot, so the budget is explicit
 * and the WORST case (more phases AND more lines than fit) must still print a
 * sheet that fits A4 and says what it left out.
 *
 * OWNS 'Morgan Furniture Factory'. It writes a phased appraisal, so it must not
 * touch Harbour Reach, which three other tests read (programme, trade
 * breakdown, graphics sweep). A saved mutation outlives the test.
 */
test('the report prints phase cost overrides and states what it could not fit', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  // height, not scrollHeight: an over-full page grows past A4 rather than clipping
  const measure = () =>
    page.evaluate(() => {
      const pages = [...document.querySelectorAll('.a4-page')];
      return {
        count: pages.length,
        overflowing: pages.filter((p) => p.getBoundingClientRect().height > 1123).length,
        feet: pages.map((p) => (p.textContent?.match(/Page (\d+) of (\d+)/) ?? []).slice(1).join('/')).filter(Boolean),
      };
    });

  // the seeded phased scheme: one phase prices off the scheme, trades itemised
  const harbour = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Harbour')).id;
  });
  await page.goto(`/deal/${harbour}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('2 · Phase cost overrides')).toBeVisible();
  await expect(page.getByText('Piling & basement')).toBeVisible();
  await expect(page.getByText('Envelope — marine grade')).toBeVisible();
  // only the differing rate is named — phase A overrides contingency, not fees
  await expect(page.getByText(/contingency 7\.0% \(scheme 5%\) — set on this phase/)).toBeVisible();
  await expect(page.getByText(/professional fees .* — set on this phase/)).toHaveCount(0);
  await expect(page.getByText(/further trade line/)).toHaveCount(0); // nothing dropped
  // phase B inherits, so the sheet may say so
  await expect(page.getByText(/Every other phase inherits the scheme's 12% fees/)).toBeVisible();

  /**
   * The reconciliation has to TIE: every phase, plus anything priced outside the
   * phase schedule, adding to the construction line the residual appraisal uses.
   * A column of plausible figures that does not add up is worse than no column.
   */
  await expect(page.getByText('Construction reconciliation')).toBeVisible();
  const reconcile = () =>
    page.evaluate(() => {
      const head = [...document.querySelectorAll('*')].find((e) => e.textContent?.trim() === 'Construction reconciliation');
      // walk to the table rather than assuming it is the next sibling — a caption
      // sits between them, and a positional probe silently reads the wrong node
      let el = head?.nextElementSibling ?? null;
      while (el && !(el.children.length > 1 && (el.textContent ?? '').includes('£'))) el = el.nextElementSibling;
      const rows = [...(el?.children ?? [])];
      const money = (el: Element) => Number((el.textContent ?? '').replace(/[^0-9.]/g, '')) || 0;
      const cell = (r: Element) => money(r.children[r.children.length - 1]);
      const last = rows[rows.length - 1];
      return {
        parts: rows.slice(0, -1).map(cell),
        names: rows.slice(0, -1).map((r) => (r.children[0].textContent ?? '').trim()),
        total: cell(last),
        label: last.textContent ?? '',
      };
    });
  const recon = await reconcile();
  expect(recon.parts.length).toBeGreaterThan(1);
  expect(recon.label).toContain('Construction with fees and contingency');
  // rounded to the pound on both sides — the printed figures are what must agree
  expect(Math.round(recon.parts.reduce((a, b) => a + b, 0))).toBe(Math.round(recon.total));

  // it is a continuation sheet of section 2, so the footers must still run clean
  const seeded = await measure();
  expect(seeded.overflowing).toBe(0);
  expect(seeded.feet).toEqual(Array.from({ length: seeded.count - 1 }, (_, i) => `${i + 2}/${seeded.count}`));

  /**
   * The worst case, on this test's OWN deal: four phases of eight trades each —
   * past the 18-line budget, so a card is part-printed and a whole phase gets no
   * card at all. Both limits bite; the page must SAY what it left out and still
   * fit on one sheet. (Four phases, not five: at five the ACCOMMODATION schedule
   * runs 6px past A4 on its own — a separate capacity limit of that page.)
   */
  const own = await page.evaluate(async () => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const list = await fetch('/trpc/deals.list', { headers: auth });
    const dealId = (await list.json()).result.data.json.deals.find((d: { name: string }) => d.name.startsWith('Morgan')).id;
    const many = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ label: `${tag} trade ${i + 1}`, rate: 12 }));
    const phase = (name: string, start: number, tag: string) => ({
      name,
      start,
      buildMonths: 10,
      salesMonths: 4,
      units: [{ label: 'Apartments', count: 10, area: 800, cap: 420 }],
      trades: many(8, tag),
      contingencyPct: 8,
    });
    const input = {
      units: [],
      phases: [
        phase('Phase 1 — podium', 1, 'P1'),
        phase('Phase 2 — terrace', 12, 'P2'),
        phase('Phase 3 — mews', 23, 'P3'),
        phase('Phase 4 — wharf', 34, 'P4'),
      ],
      efficiency: 85,
      trades: [{ label: 'Build', rate: 150 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [{ label: 'Planning', amount: 120000 }],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 20, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
      jv: { gpCoinvestPct: 10, prefPct: 8, promotePct: 20 },
    };
    const out = await fetch('/trpc/appraisal.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: { dealId, input } }) });
    const body = await out.json();
    return { dealId, ok: !body.error, err: body.error?.json?.message?.slice(0, 140) ?? null };
  });
  expect(own, `worst-case save failed: ${own.err}`).toMatchObject({ ok: true });

  await page.goto(`/deal/${own.dealId}/report`);
  await page.waitForSelector('.a4-page');
  await expect(page.getByText('2 · Phase cost overrides')).toBeVisible();
  // 32 lines over 4 phases. The reconciliation reserves its height first, leaving
  // 9 trade rows: 8 + 1 across two cards, so 23 lines and two whole phases go
  // unprinted — all of it stated, none of it silent.
  await expect(page.getByText('P2 trade 1')).toBeVisible();
  await expect(page.getByText('P2 trade 2')).toHaveCount(0);
  await expect(page.getByText(/23 further trade lines across 2 further phases are not printed/)).toBeVisible();
  // every phase here prices its own trades — the sheet must not promise otherwise
  await expect(page.getByText(/no phase carries the scheme rate/)).toBeVisible();
  await expect(page.getByText(/Every other phase inherits/)).toHaveCount(0);
  // the reconciliation still names every phase, printed card or not, and still ties
  const worstRecon = await reconcile();
  expect(worstRecon.names.slice(0, 4)).toEqual([
    'Phase 1 — podium',
    'Phase 2 — terrace',
    'Phase 3 — mews',
    'Phase 4 — wharf',
  ]);
  expect(Math.round(worstRecon.parts.reduce((a, b) => a + b, 0))).toBe(Math.round(worstRecon.total));
  const worst = await measure();
  expect(worst.overflowing).toBe(0);
  expect(worst.feet).toEqual(Array.from({ length: worst.count - 1 }, (_, i) => `${i + 2}/${worst.count}`));
});

/**
 * Password reset, end to end.
 *
 * OWNS 'reset-drill@apexappraise.co.uk' — a user it creates and resets. It must
 * not touch the seeded demo accounts: four other tests sign in as arthur@, and a
 * changed password there would fail every one of them.
 */
test('a locked-out user can reset their password, once, without being enumerated', async ({ page, request }) => {
  test.setTimeout(90_000);
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:5273';
  const call = async (proc: string, json: unknown, headers: Record<string, string> = {}) => {
    const r = await request.post(`${base}/trpc/${proc}`, { data: { json }, headers: { 'content-type': 'application/json', ...headers } });
    return { status: r.status(), body: await r.json() };
  };

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('apex_token'));
  const auth = { authorization: `Bearer ${token}` };

  /**
   * A NEW address every run. Reset requests are throttled per email — correctly,
   * since an unthrottled endpoint is a way to mail-bomb someone — so a fixed
   * address makes this test pass once and then silently receive no email at all,
   * which surfaces as "that reset link is invalid" and reads like a broken token.
   */
  const email = `reset-drill-${Date.now()}@apexappraise.co.uk`;
  await call('org.invite', { name: 'Reset Drill', email, role: 'ANALYST' }, auth);

  /**
   * An unknown address must be indistinguishable from a known one. "No account
   * with that email" is an enumeration oracle — and for named surveyors at named
   * firms, confirming who holds an account is itself a disclosure.
   */
  const known = await call('auth.requestPasswordReset', { email });
  const unknown = await call('auth.requestPasswordReset', { email: 'nobody-at-all@apexappraise.co.uk' });
  expect(known.status).toBe(unknown.status);
  expect(JSON.stringify(known.body)).toBe(JSON.stringify(unknown.body));

  /**
   * The token is stored hashed, so it cannot be read back from the database — the
   * test has to get it the way the user does: out of the email. On a demo
   * instance that is the in-memory mailbox. No test-only backdoor exists on the
   * API, because an endpoint that hands out reset tokens is a vulnerability
   * whatever it is called.
   */
  const box = await request.get(`${base}/trpc/org.demoMailbox`, { headers: auth });
  const messages = (await box.json()).result.data.json.messages as Array<{ to: string; subject: string; text: string }>;
  /**
   * The FIRST match, because readMailbox returns newest-first. Every earlier token
   * was invalidated by the request that followed it, so the newest is the only
   * one that works.
   *
   * This line was briefly "changed" to take the last match, on a theory about run
   * accumulation that was wrong — the real cause was the demo mailbox evicting the
   * message before the test read it, now fixed by giving it depth.
   */
  const mail = messages.find((m) => m.to === email && m.subject.includes('Reset'));
  expect(mail, 'a reset email should have been sent').toBeTruthy();
  const rawToken = mail!.text.match(/\/reset\?token=([\w-]+)/)?.[1];
  expect(rawToken, 'the email should carry a usable link').toBeTruthy();

  // and the raw token is NOT what the database holds
  const hashedInDb = await call('auth.resetPassword', { token: 'x'.repeat(43), password: 'nope-nope-nope' });
  expect(hashedInDb.body.error, 'a random token of the right shape must not work').toBeTruthy();

  // a wrong token is refused
  const bad = await call('auth.resetPassword', { token: 'not-a-real-token', password: 'brand-new-pw-1' });
  expect(bad.body.error).toBeTruthy();

  // the real one works
  const ok = await call('auth.resetPassword', { token: rawToken, password: 'brand-new-pw-1' });
  expect(ok.body.error, JSON.stringify(ok.body).slice(0, 200)).toBeFalsy();

  // and works exactly once — the token is cleared in the same write that sets the password
  const replay = await call('auth.resetPassword', { token: rawToken, password: 'another-attempt-2' });
  expect(replay.body.error).toBeTruthy();

  // the new password is the one that signs in
  const signedIn = await call('auth.login', { email, password: 'brand-new-pw-1' });
  expect(signedIn.body.result?.data?.json?.token, 'new password should sign in').toBeTruthy();
});
