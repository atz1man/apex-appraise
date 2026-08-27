import { expect, test, type Page } from '@playwright/test';

/**
 * The document that leaves the building.
 *
 * "One shared calculation engine for every surface (screen, export, report,
 * portal)" names four. `oneEngine.test.ts` covers two of them — it holds the
 * screen and the xlsx export to the same figures. The other two have each
 * already shipped a defect of exactly this kind: the investor portal reported
 * an LP's returns as literals (`70d253b`) and the buyer portal was £2,000 out
 * on the deposit it said was held (`4c4624e`). Both are covered now, by the
 * specs those fixes brought with them.
 *
 * The appraisal report was not. It is the surface that matters most of the four,
 * because it is the one a client and a lender receive — and its figures are
 * computed inside the page rather than read from the API, so nothing outside
 * that component had ever agreed with them.
 *
 * Asserted as agreement with the engine, never against numbers typed here: a
 * test carrying its own copy of the arithmetic is the defect this guards
 * against, wearing a different hat. That mistake was made once already on this
 * branch, in a test that reimplemented GDV to check a deal card and got it
 * wrong.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const call = (page: Page, path: string, input: string) =>
  page.evaluate(
    ([p, i]) =>
      fetch(`/trpc/${p}?input=${encodeURIComponent(JSON.stringify({ json: i }))}`, {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      })
        .then((r) => r.json())
        .then((j) => {
          if (!j.result?.data?.json) throw new Error(`${p} failed: ${j.error?.json?.message ?? 'no result'}`);
          return j.result.data.json;
        }),
    [path, input] as const,
  );

const dealNamed = (page: Page, prefix: string) =>
  page.evaluate(async (name) => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith(name)).id as string;
  }, prefix);

/**
 * Every figure printed beside a label, wherever it appears.
 *
 * The report shows the same number more than once and at more than one
 * precision: a KPI tile reads "£2.58m" while the breakdown row reads
 * "£2,580,480". Both are correct, and both are worth holding to the engine —
 * so this collects all of them rather than picking one, and the assertion below
 * requires every occurrence to agree at the precision it was written to.
 */
const printedEverywhere = async (page: Page, label: string): Promise<number[]> => {
  const hits = page.getByText(label, { exact: true });
  const n = await hits.count();
  if (n === 0) throw new Error(`"${label}" is not on the report at all`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const text = await hits.nth(i).locator('xpath=..').innerText();
    for (const m of text.matchAll(/£\s?([\d,]+(?:\.\d+)?)\s?(m|k|bn)?(\/ft|\s?pa\b)?/gi)) {
      /**
       * A rate is not a total. The note column beside "Construction cost" reads
       * "£187/ft²" and beside the investment line "£… pa" — different quantities
       * that happen to sit on the same row, and sweeping them in reported the
       * build rate as though the report disagreed with its own build cost.
       */
      if (m[3]) continue;
      const mult = { k: 1_000, m: 1_000_000, bn: 1_000_000_000 }[m[2]?.toLowerCase() ?? ''] ?? 1;
      out.push(Number(m[1]!.replace(/,/g, '')) * mult);
    }
  }
  if (!out.length) throw new Error(`no money found beside "${label}"`);
  return out;
};

/**
 * Does a printed figure agree with the engine, at the precision it was written?
 *
 * "£2.58m" is three significant figures and cannot be held to the pound; the
 * breakdown's "£2,580,480" can, and is. Same reasoning as `narrative-guard.ts`
 * applies to the prose: saying a figure shortly is not saying a different one.
 */
const agrees = (printed: number, engine: number): boolean => {
  if (Math.abs(printed - Math.round(engine)) <= 1) return true;
  const digits = Math.max(1, String(Math.round(printed)).replace(/0+$/, '').length);
  const factor = 10 ** (Math.floor(Math.log10(Math.abs(engine))) - digits + 1);
  return Math.round(engine / factor) * factor === printed;
};

test('the printed appraisal report quotes the engine, to the pound', async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  const id = await dealNamed(page, 'Harbour');

  /**
   * The engine's own answer for this deal, through the API the rest of the
   * product reads. Whatever the page prints has to match THIS.
   */
  const current = (await call(page, 'appraisal.getCurrent', id)) as {
    result: { gdv: number; build: number; fees: number; cont: number; finance: number; profit: number; residualNet: number };
  };
  const R = current.result;
  expect(R?.gdv, 'no current appraisal on this deal — the fixture has moved').toBeGreaterThan(0);

  await page.goto(`/deal/${id}/report`);
  await page.waitForSelector('.a4-page');

  for (const [label, engine] of [
    ['Gross development value', R.gdv],
    ['Construction cost', R.build],
    ['Professional fees', R.fees],
    ['Contingency', R.cont],
    ['Finance (interest + fees)', R.finance],
    ['Developer profit', R.profit],
    ['Residual land value', R.residualNet],
  ] as const) {
    const occurrences = await printedEverywhere(page, label);
    const wrong = occurrences.filter((v) => !agrees(v, engine));
    expect(
      wrong,
      `"${label}" is printed as ${wrong.map((v) => v.toLocaleString('en-GB')).join(', ')} `
        + `where the engine says ${Math.round(engine).toLocaleString('en-GB')}`,
    ).toEqual([]);
    // and at least one place prints it in full, so an abbreviation cannot be
    // the only thing holding this figure up
    expect(
      occurrences.some((v) => Math.abs(v - Math.round(engine)) <= 1),
      `"${label}" appears only as an abbreviation — nothing on the report states it to the pound`,
    ).toBe(true);
  }
});
