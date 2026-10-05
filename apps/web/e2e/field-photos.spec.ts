import { expect, test, type Page } from '@playwright/test';

/**
 * The field app takes photographs.
 *
 * Its shutter used to do `photos + 1`. The viewfinder was a static gradient
 * labelled "CAPTURING · KITCHEN", the thumbnails were decorative gradients from
 * the design tokens, and the inspection reached the workbench reporting "12
 * photos" of a property nobody had photographed — on the record `audit.ts` names a
 * lender's credit committee and an RICS review as the readers of. The upload route
 * it needed already existed, tenant-checked and audited; the field app was the one
 * surface that never called it.
 *
 * Driven through the FILE path rather than `getUserMedia`, and that is not a
 * compromise: it is the real fallback a phone uses when permission is refused,
 * when there is no camera, and in an embedded web view — and it carries a real
 * JPEG through the real multipart route to a real `SitePhoto` row, which is the
 * claim. The `getUserMedia` branch differs only in where the blob comes from.
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

/**
 * A deal of this spec's own making, opened by its EXACT name.
 *
 * Both tests first matched `/Field Photos/` and `/Field Handoff/` with `.first()`,
 * which worked once and then quietly opened a deal left behind by the previous
 * run — the dev database accumulates whatever every past run created, and the
 * screen then showed that deal's photographs while the assertions read the new
 * deal's empty record. Measured: three photographs on screen, zero `SitePhoto`
 * rows on the deal under test. CI seeds fresh and would never have shown it.
 */
async function freshDeal(page: Page, label: string) {
  const name = `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const id = (await page.evaluate(async (dealName) => {
    const res = await fetch('/trpc/deals.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      body: JSON.stringify({
        json: { name: dealName, address: '9 Camera Row, Bournemouth', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
      }),
    });
    return (await res.json())?.result?.data?.json?.id as string;
  }, name)) as string;
  expect(id, 'could not create a deal').toBeTruthy();

  await page.goto('/field');
  await page.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: /Start inspection|Inspection/ }).first().click();
  return { id, name };
}

test('a photograph taken on site reaches the record, and the inspection names it', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  // a deal of this spec's own making: a spec that depends on a seeded deal being
  // empty is a spec that stops the demo being filled in
  const { id: dealId } = await freshDeal(page, 'Field Photos');

  /**
   * No photographs to begin with, and the count says so rather than a tally of
   * shutter presses.
   */
  const filed = page.getByText(/\d+ filed/).first();
  await expect(filed).toHaveText('0 filed');

  // the real upload: a real JPEG through the real multipart route
  await page.locator('input[type=file]').setInputFiles({ name: 'kitchen.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(filed, 'the shutter did not file a photograph').toHaveText('1 filed', { timeout: 20_000 });

  /** A row, with a file behind it — this is the half the gradients never had. */
  const photos = (await page.evaluate(async (id) => {
    const input = encodeURIComponent(JSON.stringify({ json: id }));
    const res = await fetch(`/trpc/photos.list?input=${input}`, {
      headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
    });
    return (await res.json())?.result?.data?.json as Array<{ caption: string; url: string }>;
  }, dealId)) as Array<{ caption: string; url: string }>;
  expect(photos, 'no SitePhoto row was created').toHaveLength(1);
  expect(photos[0]!.caption, 'the photograph does not say which area it is of').toMatch(/site inspection/i);

  // and the image itself is served, which is what "a photograph" means
  const img = await page.request.get(photos[0]!.url);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image');

  // the thumbnail on screen is an image, not a gradient
  await expect(page.locator('img[alt*="photograph"]').first()).toBeVisible();
});

test('the inspection the desk receives names the photograph, not a count of presses', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);

  const { id: dealId } = await freshDeal(page, 'Field Handoff');
  await page.locator('input[type=file]').setInputFiles({ name: 'exterior.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(page.getByText(/\d+ filed/).first()).toHaveText('1 filed', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Save' }).click();

  /**
   * The id reaches the stored inspection. `inspections.save` verifies each one
   * against `SitePhoto` on this deal, so a count could never have survived this
   * assertion — which is the point of reading it from the server rather than from
   * the screen.
   */
  // POLLED, not read once: the save is a round-trip and this is the assertion
  // that matters, so it waits for the server's own copy rather than for a spinner
  const roomsWithPhotos = () =>
    page.evaluate(async (id) => {
      const input = encodeURIComponent(JSON.stringify({ json: id }));
      const res = await fetch(`/trpc/inspections.get?input=${input}`, {
        headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` },
      });
      const rooms = ((await res.json())?.result?.data?.json?.rooms ?? []) as Array<{ photos: string[] }>;
      return rooms.filter((r) => Array.isArray(r.photos) && r.photos.length > 0).flatMap((r) => r.photos);
    }, dealId);

  await expect
    .poll(roomsWithPhotos, { message: 'the saved inspection carries no photograph', timeout: 20_000 })
    .toHaveLength(1);
  expect(typeof (await roomsWithPhotos())[0]).toBe('string');
});
