/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Give each build's service worker its own cache name.
 *
 * sw.js is served verbatim from public/, so nothing else in the pipeline can
 * tell it what changed. The id is derived from the emitted asset filenames
 * rather than the clock: rebuilding identical code leaves the name alone, so
 * users are not made to re-download a byte-identical app.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'kept-stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/sw.js');
      let sw: string;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch {
        return; // No service worker emitted (a partial build); nothing to stamp.
      }
      if (!sw.includes('__BUILD_ID__')) {
        // Fail loudly rather than shipping a worker that can never evict: a
        // renamed placeholder would otherwise be a silent regression.
        this.error('sw.js has no __BUILD_ID__ placeholder to stamp');
      }
      const manifest = readFileSync(resolve(__dirname, 'dist/app/index.html'), 'utf8');
      const id = createHash('sha256').update(manifest).digest('hex').slice(0, 12);
      writeFileSync(swPath, sw.replaceAll('__BUILD_ID__', id));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: { port: 5183 },
  build: {
    rollupOptions: {
      // Two entries, not one SPA: the landing page is a marketing document that
      // must paint without booting the app, and the app is a PWA whose service
      // worker scope is /app/. Sharing one bundle would put the whole receipt
      // app on the critical path of a page that only needs to sell it.
      input: {
        landing: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app/index.html'),
      },
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
