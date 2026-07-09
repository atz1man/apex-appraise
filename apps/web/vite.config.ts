import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5273),
    proxy: {
      '/trpc': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: { maxParallelFileOps: 20 },
  },
});
