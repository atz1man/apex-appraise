import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    headless: true,
    // a failure's last frame, so a CI red carries the page it saw and not only the line it stopped on
    screenshot: 'only-on-failure',
  },
});
