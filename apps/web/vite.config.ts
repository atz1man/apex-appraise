import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5273),
    proxy: {
      '/trpc': { target: 'http://localhost:4100', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4100', changeOrigin: true },
      '/reports': { target: 'http://localhost:4100', changeOrigin: true },
      // public read-only report links, same as nginx does in production
      '/shared': { target: 'http://localhost:4100', changeOrigin: true },
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
      // map tiles are proxied by the API, so no browser talks to a tile server
      '/tiles': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: { maxParallelFileOps: 20 },
  },
  /**
   * Unit tests live under src/. Without this, `vitest run` also collects the
   * Playwright specs in e2e/ — which throw "test() was called here" and make the
   * package's own `npm test` fail every single time, so nobody runs it and the
   * unit tests guard nothing. Browser tests are run by `npm run test:e2e`.
   */
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /**
     * The suite runs in a timezone that is not the firm's, deliberately.
     *
     * Everything this product prints is for a UK firm, but the people who READ
     * it — buyers, investors, a client following a signing link — are often not
     * in the UK. A date entered as a day is stored at UTC midnight, so anywhere
     * west of Greenwich renders it as the day before: a valuation date typed as
     * 30 June reached a client in New York as 29 June.
     *
     * Run in UTC or London, a test asserting "30 June" passes whether or not
     * the code pins a zone, so the guard is decoration. Here it is not.
     */
    env: { TZ: 'America/New_York' },
  },
});
