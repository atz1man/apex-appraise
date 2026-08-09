import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // one database, one file at a time: these tests share a throwaway SQLite
    // database, and parallel writers to SQLite is a flake generator
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
