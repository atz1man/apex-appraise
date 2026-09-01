import { expect, test, type Page } from '@playwright/test';

/**
 * The desktop widths a firm actually works at.
 *
 * The phone guard (mobile.spec.ts) holds four screens to zero horizontal
 * scroll at 390px. Nothing asked the same of a laptop, and two things had
 * gone wrong there. The appraisal screen scrolled sideways at EVERY desktop
 * width — measured at 1440px, the document was 1,455 wide — because the task
 * assignee row in its side panel could not wrap and its last avatar stood 15px
 * past the edge. And below 1400px the top bar's global nav left the deal
 * screens' own controls — Save, Export, Versions — scrolled out of sight
 * behind a hidden scrollbar: at 1180px the Save button of the appraisal was
 * off the right of the header with nothing to say so.
 *
 * The assignee row was also the demo firm's initials — AO, DW, MV, PA —
 * offered to every workspace. It is the firm's real members now, which is
 * asserted by inviting one with initials the seed does not have.
 */

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
};

const call = (page: Page, path: string, json: unknown) =>
  page.evaluate(
    async ([p, body]) => {
      const r = await fetch(`/trpc/${p}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ json: body }),
      });
      const j = await r.json();
      return { ok: !j.error, data: j.result?.data?.json ?? null, err: j.error?.json?.message ?? null };
    },
    [path, json] as const,
  );

const dealId = (page: Page, prefix: string) =>
  page.evaluate(async (pre) => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    return j.result.data.json.deals.find((d: { name: string }) => d.name.startsWith(pre)).id as string;
  }, prefix);

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** what the header's right-hand slot cannot show: its content past its own edge */
const hiddenInHeader = (page: Page) =>
  page.evaluate(() => {
    const slot = document.querySelector('header .ml-auto') as HTMLElement | null;
    return slot ? slot.scrollWidth - slot.clientWidth : -1;
  });

test('no screen scrolls sideways at laptop widths, and the header hides nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const id = await dealId(page, 'Northgate');
  for (const width of [1024, 1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/board', `/deal/${id}`, `/deal/${id}/appraisal`, `/deal/${id}/costs`, `/deal/${id}/dataroom`]) {
      await page.goto(path);
      await page.waitForTimeout(600);
      await expect.poll(() => overflow(page), { timeout: 10_000, message: `${path} scrolls sideways at ${width}px` }).toBeLessThanOrEqual(0);
      await expect.poll(() => hiddenInHeader(page), { timeout: 10_000, message: `the header hides controls on ${path} at ${width}px` }).toBeLessThanOrEqual(0);
    }
  }
});

test('a task can be given to any member of the firm, and only to a member', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const id = await dealId(page, 'Northgate');
  const invited = await call(page, 'org.invite', { name: 'Zed Quill', email: `zq-${Date.now()}@apexappraise.co.uk`, role: 'ANALYST' });
  expect(invited.ok, invited.err ?? '').toBe(true);
  // the invite answers with the one-time password, not the row — the member list names the id
  const members = await page.evaluate(async () => {
    const r = await fetch('/trpc/org.members', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    return (await r.json()).result.data.json as Array<{ id: string; name: string }>;
  });
  const userId = members.find((m) => m.name === 'Zed Quill')!.id;
  try {
    await page.goto(`/deal/${id}/appraisal`);
    await expect(page.getByText('Unit schedule')).toBeVisible({ timeout: 20_000 });
    // the picker offers the new colleague, because it is the team and not a list
    await expect(page.getByRole('button', { name: 'Assign new task to ZQ' })).toBeVisible();
    // and the API will not take initials the firm does not have
    const nobody = await call(page, 'tasks.create', { dealId: id, title: 'Nobody’s', aspect: 'Costs', assignee: 'QQ' });
    expect(nobody.ok).toBe(false);
    expect(nobody.err).toMatch(/not a member/i);
  } finally {
    await call(page, 'org.removeMember', { userId });
  }
});
