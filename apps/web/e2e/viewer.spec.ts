import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * A view-only member sees what they cannot do BEFORE they try it.
 *
 * `src/lib/write-controls.test.ts` proves every control that fires a mutation
 * is marked. That is a static claim about the source; whether a marked control
 * is actually greyed out for a viewer, with the reason on it, is a browser
 * fact — and no spec in this suite had ever signed in as one. The member is
 * invited through the product's own `org.invite`, signs in with the temporary
 * password it returns, and is removed again afterwards, so the demo workspace
 * the other workers read is left as it was found.
 *
 * The dialog handler is the sharp assertion. Measured before the fix, a viewer
 * pressing "Delete task" was asked to confirm the deletion, agreed, and was
 * then refused: the confirm was the product's word that the action was
 * theirs to take. A disabled button fires no click and so no dialog, and the
 * handler turns any dialog into a failure rather than a dismissed prompt.
 */

const READ_ONLY = 'Your account has view-only access to this workspace';
const base = () => process.env.E2E_BASE_URL ?? 'http://localhost:5273';

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post(`${base()}/trpc/auth.login`, {
    data: { json: { email: 'arthur@apexappraise.co.uk', password: 'demo' } },
  });
  return { authorization: `Bearer ${(await login.json()).result.data.json.token as string}` };
}

let email = '';

test.beforeEach(async ({ request }, info) => {
  email = `viewer-${info.parallelIndex}-${Date.now()}@apexappraise.co.uk`;
});

test.afterEach(async ({ request }) => {
  const headers = await adminHeaders(request);
  const members = await request.get(`${base()}/trpc/org.members`, { headers });
  const me = ((await members.json()).result.data.json as Array<{ id: string; email: string }>).find((m) => m.email === email);
  if (me) await request.post(`${base()}/trpc/org.removeMember`, { headers, data: { json: { userId: me.id } } });
});

async function signInAsViewer(page: Page, request: APIRequestContext) {
  const headers = await adminHeaders(request);
  const invited = await request.post(`${base()}/trpc/org.invite`, {
    headers,
    data: { json: { name: 'Vera Viewer', email, role: 'VIEWER' } },
  });
  const body = await invited.json();
  expect(body.error, `invite failed: ${JSON.stringify(body.error?.json?.message)}`).toBeUndefined();
  const tempPassword = body.result.data.json.tempPassword as string;
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(tempPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
}

test('a viewer is told, and every write control is greyed out with the reason', async ({ page, request }) => {
  page.on('dialog', (d) => {
    throw new Error(`a view-only member was asked "${d.message()}" — the control that opened it was live`);
  });
  await signInAsViewer(page, request);

  // said once, on every screen, before anything is pressed
  await expect(page.getByText('View only', { exact: true })).toBeVisible();

  // the pipeline: "Advance stage →" on every card was live before the fix
  await page.goto('/board');
  const advance = page.getByRole('button', { name: 'Advance stage →' });
  await expect(advance.first()).toBeVisible();
  const count = await advance.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    await expect(advance.nth(i)).toBeDisabled();
    await expect(advance.nth(i)).toHaveAttribute('title', new RegExp(READ_ONLY));
  }

  // the calendar: every "Delete task" asked to confirm and then refused
  await page.goto('/calendar');
  const del = page.getByRole('button', { name: /^Delete task/ });
  await expect(del.first()).toBeAttached();
  for (let i = 0; i < (await del.count()); i++) {
    await expect(del.nth(i)).toBeDisabled();
    await expect(del.nth(i)).toHaveAttribute('title', new RegExp(READ_ONLY));
  }
  await expect(page.getByRole('button', { name: /^(Complete|Reopen) task$/ }).first()).toBeDisabled();
  // a disabled control fires nothing: no dialog reached the handler above
  await del.first().click({ force: true, trial: false }).catch(() => {});

  // the appraisal: figures can still be explored — the engine runs in the browser —
  // but the save that would make them the firm's position says why it will not
  await page.goto('/board');
  const deal = (await page.getByRole('link', { name: /Northgate/ }).first().getAttribute('href'))!.split('/').slice(0, 3).join('/');
  await page.goto(`${deal}/appraisal`);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const field = page.getByRole('spinbutton').first();
  await field.fill('999');
  await field.blur();
  const save = page.getByRole('button', { name: 'Save appraisal' });
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('title', new RegExp(READ_ONLY));
});

test('the same controls are live for a member who may write', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();
  await expect(page.getByText('View only', { exact: true })).toHaveCount(0);
  await page.goto('/board');
  const advance = page.getByRole('button', { name: 'Advance stage →' });
  await expect(advance.first()).toBeVisible();
  await expect(advance.first()).toBeEnabled();
  await expect(advance.first()).not.toHaveAttribute('title', new RegExp(READ_ONLY));
});
