import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        // Recharts plus its d3 dependencies are over half the bundle and
        // change far less often than app code, so they get their own chunk
        // that stays cached across deploys.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    // In Docker, Express serves both the API and the built frontend from one
    // origin. In local dev they're two processes, so /api/* is proxied here —
    // that way `fetch('/api/...')` behaves identically in both.
    proxy: {
      '/api': {
        target: process.env.SERVER_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Integration tests need a real Postgres and self-skip without
    // DATABASE_URL_TEST, so a bare `npm test` still runs the unit suite.
    setupFiles: ['tests/setup.js'],
    // The integration suites share one test database. Running files in
    // parallel has them truncating each other's fixtures mid-run, which
    // shows up as unrelated, irreproducible failures. The whole suite is
    // ~2s, so serial execution costs nothing worth having.
    fileParallelism: false,
  },
});
