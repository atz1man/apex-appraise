import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    headless: true,
    // a failure's last frame, so a CI red carries the page it saw and not only the line it stopped on
    screenshot: 'only-on-failure',
    /**
     * Bound each ACTION, not just the test.
     *
     * With neither of these set, a `goto` or a `waitForSelector` is bounded
     * only by the test's own budget, so whichever action happens to be in
     * flight when the budget expires is the one the failure names — whether or
     * not it is the one that hung. That is not a hypothetical: the covenants
     * spec has timed out three times, each time reporting the funding pack's
     * `waitForSelector` because the pack is the last thing it does, and twice
     * the answer was to raise the budget. Measured afterwards, the pack renders
     * in 151ms.
     *
     * 20s is far above anything this suite does on a healthy stack (the whole
     * eight-load covenants test takes under four seconds) and below every test
     * budget here, including the 30s default. So a genuine hang now fails at
     * its own line with its own call log, and the tests that need longer keep
     * asking for it per call.
     */
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
  },
});
