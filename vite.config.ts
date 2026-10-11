/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The lazily loaded 3D chunk (three + fiber + drei) is ~950 kB minified; that is expected.
  build: { chunkSizeWarningLimit: 1100 },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
