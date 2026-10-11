import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './performance',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: 'performance-results',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273' },
});
