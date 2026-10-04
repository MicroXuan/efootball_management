import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { adminManualChunk } from './src/build/manual-chunks';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: { '/v1': 'http://127.0.0.1:3000' }
  },
  build: {
    rollupOptions: {
      output: { manualChunks: adminManualChunk }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    restoreMocks: true,
    clearMocks: true
  }
});
