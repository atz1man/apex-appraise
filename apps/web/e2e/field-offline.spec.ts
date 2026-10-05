import { expect, test, type Page } from '@playwright/test';

/**
 * A photograph taken out of signal survives the tab closing.
 *
 * The camera that `field-photos.spec.ts` proves works held its blob in an object
 * URL in React state, and the commit that built it said so rather than papering
 * over it: "NOT durable across a reload — an unuploaded shot is lost if the tab
 * closes; IndexedDB and a drain queue is the real answer to a day out of signal."
 * This is that answer, and this spec is the half that counts what actually
 * happens — the unit tests prove the decisions (`lib/photo-queue.ts`,
 * `lib/photo-drain.ts`), not that a browser store holds a JPEG across a page
 * load, which is the entire claim.
 *
 * The three assertions, in the order a surveyor meets them:
 *
 *   with the upload route refused, the shutter still files a RECORD and the
 *   screen says the photograph is on the device and the page may be closed;
 *
 *   after a real `page.reload()`, which empties every object URL and every piece
 *   of React state, the photograph is STILL waiting;
 *
 *   when the route answers again, it drains on its own to a `SitePhoto` row with
 *   a servable file — no button pressed, because there is no button.
 *
 * Three mutants are caught, each named by the assertion that catches it: the
 * memory store in place of IndexedDB ("the photograph did not survive the
 * reload"), a record removed on upload rather than on attribution ("an uploaded
 * photograph was forgotten before anything named it"), and the attribution
 * effect disabled ("the queue did not drain once the connection returned" —
 * "filed" is the room's own list, which is what that count means).
 *
 * TWO SURVIVE, and both are this spec's limits rather than the fix's.
 *
 *   Dropping `bringForward` from the reconnection handler. The backoff then
 *   outlives the connection returning and the 20-second timer eventually drains
 *   the queue anyway — inside any deadline generous enough not to be flaky.
 *   Measured: the mutant passes, taking 24.3s against 6.6s. A deadline below the
 *   interval would discriminate it only probabilistically, since how deep the
 *   backoff is by then depends on how many attempts the refused route happened
 *   to collect. Proven instead where it can be, in `lib/photo-drain.test.ts`: a
 *   record three failures deep is planted, `drainOnce` is shown skipping it,
 *   `bringForward` runs, and the same `drainOnce` sends it.
 *
 *   Attributing by the record's stored INDEX rather than its room NAME. No
 *   browser test can see that one: it needs a room list that has CHANGED since
 *   the photograph was taken, and this spec's has not — the names a reload
 *   rebuilds are the names it was taken under, so index and name agree. That
 *   boundary is `lib/photo-queue.test.ts`'s (a renamed room, and a vanished one).
 */

const JPEG = Buffer.from(
  // the smallest valid JPEG: SOI, a grey 1×1 baseline frame, EOI
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/ooooA//9k=',
  'base64',
);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

/** A deal of this spec's own making, opened by its EXACT name — see `field-photos.spec.ts`. */
async function freshDeal(page: Page, label: string) {
  const name = `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const id = (await page.evaluate(async (dealName) => {
    const res = await fetch('/trpc/deals.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({
        json: { name: dealName, address: '9 Basement Lane, Bournemouth', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
      }),
    });
    return (await res.json())?.result?.data?.json?.id as string;
  }, name)) as string;
  expect(id, 'could not create a deal').toBeTruthy();
  return { id, name };
}

/** Open the inspection on a deal named exactly this, from wherever the app is. */
async function openInspection(page: Page, name: string) {
  await page.goto('/field');
  await page.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: /Start inspection|Inspection/ }).first().click();
}

async function photoRows(page: Page, dealId: string) {
  return (await page.evaluate(async (id) => {
    const input = encodeURIComponent(JSON.stringify({ json: id }));
    const res = await fetch(`/trpc/photos.list?input=${input}`, {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    });
    return (await res.json())?.result?.data?.json as Array<{ id: string; url: string }>;
  }, dealId)) as Array<{ id: string; url: string }>;
}

test('a photograph taken with no connection survives a reload and goes on its own', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const { id: dealId, name } = await freshDeal(page, 'Field Offline');

  /**
   * The basement: the route is refused before a single shot is taken.
   *
   * `abort` rather than a 500 on purpose — a refused connection is what a phone
   * with no signal gets, and it is the path that reaches the `catch` in the
   * uploader rather than its status check. The 500 path is what
   * `upload-failure`'s rule covers.
   */
  await page.route('**/uploads/photo', (r) => r.abort());

  await openInspection(page, name);
  const filed = page.getByText(/\d+ filed/).first();
  await expect(filed).toHaveText('0 filed');

  await page.locator('input[type=file]').setInputFiles({ name: 'basement.jpg', mimeType: 'image/jpeg', buffer: JPEG });

  // the shutter filed a RECORD, and the screen does not pretend otherwise
  await expect(filed, 'the shutter did not queue anything').toHaveText('0 filed · 1 waiting', { timeout: 20_000 });
  await expect(page.getByText('WAITING').first()).toBeVisible();
  await expect(
    page.getByText(/saved on this device/),
    'nothing told the surveyor the photograph was safe',
  ).toBeVisible();

  // nothing reached the server, which is the premise
  expect(await photoRows(page, dealId), 'the refused route let something through').toHaveLength(0);

  /**
   * THE CLAIM. A real reload: every object URL revoked, every piece of React
   * state gone, the component remounted from nothing. Before the queue existed
   * the photograph was gone with it, silently.
   */
  await page.reload();
  await openInspection(page, name);
  await expect(
    page.getByText(/\d+ filed/).first(),
    'the photograph did not survive the reload',
  ).toHaveText('0 filed · 1 waiting', { timeout: 20_000 });
  await expect(page.getByText('WAITING').first()).toBeVisible();

  /**
   * Out of the basement. The route answers again and the connection event says
   * so — which is what a phone fires when signal returns, and what spends the
   * backoff (`bringForward`). No control is pressed because there is none: a
   * Retry button whose only effect is to ask sooner is furniture.
   */
  await page.unroute('**/uploads/photo');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(
    page.getByText(/\d+ filed/).first(),
    'the queue did not drain once the connection returned',
  ).toHaveText('1 filed', { timeout: 30_000 });
  await expect(page.getByText('WAITING')).toHaveCount(0);
  await expect(page.getByText(/saved on this device|waiting for a connection/)).toHaveCount(0);

  /** A row, with a file behind it — the same bar `field-photos.spec.ts` sets. */
  const rows = await photoRows(page, dealId);
  expect(rows, 'the drained photograph created no SitePhoto row').toHaveLength(1);
  const img = await page.request.get(rows[0]!.url);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image');

  /**
   * And the inspection names it. The photograph was taken before the reload and
   * uploaded after it, so the id was attributed to its room by NAME out of the
   * restored queue record — the index it was taken at is not trusted, because
   * the room list is rebuilt from the inspection on every open.
   */
  await page.getByRole('button', { name: 'Save' }).click();
  const named = () =>
    page.evaluate(async (id) => {
      const input = encodeURIComponent(JSON.stringify({ json: id }));
      const res = await fetch(`/trpc/inspections.get?input=${input}`, {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      });
      const rooms = ((await res.json())?.result?.data?.json?.rooms ?? []) as Array<{ photos: string[] }>;
      return rooms.flatMap((r) => (Array.isArray(r.photos) ? r.photos : []));
    }, dealId);
  await expect
    .poll(named, { message: 'the saved inspection does not name the drained photograph', timeout: 20_000 })
    .toEqual([rows[0]!.id]);
});

/**
 * The other direction, and the reason the queue is not simply a retry: a record
 * that has reached the server is NOT forgotten until an inspection names it.
 *
 * Deleting on upload would lose the attribution — the photograph would stand in
 * the deal's site log with nothing saying which room it is of, and no surveyor
 * would know to go and say.
 */
test('a photograph uploaded but not yet named is still attributed after a reload', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const { id: dealId, name } = await freshDeal(page, 'Field Attribution');

  await openInspection(page, name);
  await page.locator('input[type=file]').setInputFiles({ name: 'hall.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(page.getByText(/\d+ filed/).first()).toHaveText('1 filed', { timeout: 20_000 });

  // uploaded, and deliberately NOT saved: the inspection does not name it yet
  const rows = await photoRows(page, dealId);
  expect(rows).toHaveLength(1);

  await page.reload();
  await openInspection(page, name);

  // the record was still in the store, so the remounted screen re-attributes it
  await expect(
    page.getByText(/\d+ filed/).first(),
    'an uploaded photograph was forgotten before anything named it',
  ).toHaveText('1 filed', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const input = encodeURIComponent(JSON.stringify({ json: id }));
          const res = await fetch(`/trpc/inspections.get?input=${input}`, {
            headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
          });
          const roomsOut = ((await res.json())?.result?.data?.json?.rooms ?? []) as Array<{ photos: string[] }>;
          return roomsOut.flatMap((r) => (Array.isArray(r.photos) ? r.photos : []));
        }, dealId),
      { message: 'the inspection never named the uploaded photograph', timeout: 20_000 },
    )
    .toEqual([rows[0]!.id]);
});
