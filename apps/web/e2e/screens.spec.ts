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
    await page.getByText('Harbour Reach').first().click();
    const url = page.url();
    const dealId = url.match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/costs`);
    await expect(page.getByText('Cost report — packages & contractors')).toBeVisible();
    await expect(page.getByText('Variance alerts')).toBeVisible();
  });

  test('sales CRM tracks units and opens the drawer', async ({ page }) => {
    await page.goto('/board');
    await page.getByText('Harbour Reach').first().click();
    const dealId = page.url().match(/deal\/([^/]+)/)![1];
    await page.goto(`/deal/${dealId}/sales`);
    await expect(page.getByText('Unit sales tracker')).toBeVisible();
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

  // the ladder ends at the capitalised value that enters GDV
  await expect(page.getByText('Investment value in GDV', { exact: true })).toBeVisible();
  await expect(page.getByText('£2,374,783').first()).toBeVisible();
  // the let-up void pushes the net initial yield above the 7.25% capitalisation yield
  await expect(page.getByText('7.52%')).toBeVisible();

  // and the right-rail residual breakdown states the GDV composition
  await expect(page.getByText('— capitalised investment value')).toBeVisible();
  await expect(page.getByText('— units sold')).toBeVisible();

  // live engine: a sharper yield capitalises the same rent into a bigger number
  await page.getByLabel('All-risks yield (%)').fill('6');
  await expect(page.getByText('£2,888,139').first()).toBeVisible();
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
  await expect(page.getByText(/Page 6 of 6 · © Apex Appraise/)).toBeVisible();

  // and the valuer can see the same record in-product before issuing
  await page.goto(`/deal/${id}`);
  await expect(page.getByText('AI use on this deal')).toBeVisible();
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
  await expect(page.getByRole('button', { name: /Issue to client|Record acceptance|Withdraw & revise/ })).toBeVisible();
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

  // phase A overrides the rate and the contingency; phase B inherits both
  await expect(page.getByLabel('Phase A — quayside block build rate')).toHaveValue('206');
  await expect(page.getByLabel('Phase A — quayside block contingency')).toHaveValue('7');
  const inherited = page.getByLabel('Phase B — courtyard block build rate');
  await expect(inherited).toHaveValue('');
  await expect(inherited).toHaveAttribute('placeholder', /scheme/);

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
  await expect(accommodation.getByText('£206')).toBeVisible();
  await expect(accommodation.getByText('£170')).toBeVisible();
  await expect(accommodation.getByText(/delivered in 2 phases over 32 months/)).toBeVisible();

  // page numbering still matches what prints
  const pages = await page.locator('.a4-page').count();
  await expect(page.getByText(`Page ${pages} of ${pages}`)).toBeVisible();
});
