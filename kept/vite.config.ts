/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
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
