import { expect, test } from '@playwright/test';

test('HTTPS proxy headers preserve SPA routes, static assets and HSTS', async ({ request }) => {
  // Run against the built nginx stack, as CI does. Vite cannot test this.
  for (const path of ['/login', '/register', '/deal/release-smoke/appraisal', '/icon.svg']) {
    const response = await request.get(path, { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(response.status(), path).toBe(200);
    expect(response.headers()['strict-transport-security'], path).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    if (path !== '/icon.svg') expect(await response.text()).toContain('<div id="root"></div>');
  }
  const plain = await request.get('/login', { headers: { 'X-Forwarded-Proto': 'http' } });
  expect(plain.status()).toBe(200);
  expect(plain.headers()['strict-transport-security']).toBeUndefined();
  const missing = await request.get('/assets/not-a-real-release-file.js', { headers: { 'X-Forwarded-Proto': 'https' } });
  expect(missing.status()).toBe(404);
  expect(missing.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
});
