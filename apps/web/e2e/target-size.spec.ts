import { expect, test, type Page } from '@playwright/test';

/**
 * Every screen fits a phone, and every control on it can be hit with a thumb.
 *
 * Two rules, measured rather than read, over every route signed in at 390px:
 *
 *   1. No horizontal overflow — the page body never scrolls sideways. The
 *      repo's rule already; `mobile.spec.ts` proves it on three screens.
 *      Walked over ALL of them on 6 September: seven overflowed. Calendar and
 *      Benchmarking by the automatic-minimum gotcha one level up from where it
 *      is usually seen — a page grid that named its columns only from `lg:`,
 *      so below it the one implicit column was `auto` and each two-column item
 *      took its min-content width. Settings by a subtler one: the members table
 *      scrolled inside its wrapper as intended, but the sr-only "Remove" label
 *      inside it is absolutely positioned, and a scroll container that is not
 *      itself positioned does not contain those — one 1px span at x=594 widened
 *      the page by 204px while the table it belonged to scrolled correctly. And
 *      the four printed documents, whose A4 sheet widened the page instead of
 *      scrolling inside its frame.
 *
 *   2. WCAG 2.5.8 target size (AA in 2.2): a control is at least 24×24 CSS px,
 *      OR a 24px circle centred on it touches no other control (the spacing
 *      exception), OR it is a link inside running text (the inline exception).
 *      Measured with those exceptions applied: 42 failed, in three places —
 *      every task chip on the calendar at 21px tall, the "Advance stage"
 *      control on every pipeline card at 15px, and the data room's share
 *      checkboxes, 16px boxes with a picker hard against them. Without the
 *      exceptions the count was 134, which is the number a naive rule reports
 *      and the reason this one applies them: a rule that flags spaced
 *      checkboxes and footer links is a rule people learn to ignore.
 *
 * Leaflet's attribution links are exempt as inline text (they are a credit
 * line, not controls this product draws), and so are elements hidden from
 * assistive technology.
 */

test.use({ viewport: { width: 390, height: 844 } });

const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem]';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

/** the routes the headings walk uses, plus the field app */
async function routes(page: Page): Promise<string[]> {
  await page.goto('/board');
  await page.waitForLoadState('networkidle');
  const deals = await page.locator('a[href^="/deal/"]').evaluateAll((as) => as.map((a) => [a.getAttribute('href') ?? '', (a.textContent ?? '').trim()] as const));
  const deal = (deals.find(([, n]) => /Northgate/i.test(n)) ?? deals[0])![0].split('/').slice(0, 3).join('/');
  await page.goto(deal);
  await page.waitForLoadState('networkidle');
  const tabs = [...new Set(await page.locator(`a[href^="${deal}/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')))];
  return ['/', '/board', deal, ...tabs, `${deal}/engagement/document`, '/portfolio/pack', '/calendar', '/benchmarking', '/integrations', '/settings', '/investors', '/whats-new', '/docs/api', '/field'];
}

/** overflow in px, and every control failing 2.5.8 after its exceptions */
function measure(sel: string) {
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const visible = (el: Element) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0 && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]') && !el.classList.contains('sr-only');
  };
  const targets = [...document.querySelectorAll(sel)].filter(visible);
  const rects = targets.map((el) => el.getBoundingClientRect());
  const R = 12;
  const circleClear = (i: number) => {
    const r = rects[i]!;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return rects.every((o, j) => j === i || cx + R <= o.left || cx - R >= o.right || cy + R <= o.top || cy - R >= o.bottom);
  };
  const small: string[] = [];
  targets.forEach((el, i) => {
    const r = rects[i]!;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li, td, span, dd, figcaption, blockquote')) return; // inline text link
    if (el.closest('.leaflet-control-attribution')) return; // Leaflet's credit line
    if ((r.width < 24 || r.height < 24) && !circleClear(i)) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      small.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  });
  return { overflow, small: [...new Set(small)] };
}

test('no screen scrolls sideways at phone width, and every control meets the 24px target size', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const failures: string[] = [];
  for (const route of await routes(page)) {
    await test.step(route.replace(/\/deal\/[^/]+/, '/deal/…'), async () => {
      await page.goto(route);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(250);
      const m = await page.evaluate(measure, SEL);
      if (m.overflow > 0) failures.push(`${route}: scrolls sideways by ${m.overflow}px`);
      for (const s of m.small) failures.push(`${route}: ${s} is under 24px with another control inside 12px of its centre`);
    });
  }
  expect(failures, `at 390px:\n  ${failures.join('\n  ')}`).toEqual([]);
});

/** A sweep over an empty list passes in silence. This says the predicate sees what it is meant to. */
test('the rule finds an undersized crowded control and a sideways-scrolling page', async ({ page }) => {
  await page.setContent(`
    <p>An <a href="#x">inline link</a> in running text is exempt.</p>
    <button style="width:20px;height:20px;position:absolute;left:10px;top:60px">a</button>
    <button style="width:20px;height:20px;position:absolute;left:31px;top:60px">b</button>
    <button style="width:20px;height:20px;position:absolute;left:200px;top:60px">spaced</button>
    <div style="width:900px;height:10px"></div>
  `);
  const m = await page.evaluate(measure, SEL);
  expect(m.overflow).toBeGreaterThan(0);
  expect(m.small).toEqual(['button "a" 20×20', 'button "b" 20×20']);
});
