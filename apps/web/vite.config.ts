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
  },
});
