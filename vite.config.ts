/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the static build runs from any static host, at the root or in a subfolder.
  base: './',
  // The lazily loaded 3D code is ~960 kB minified (three core, shared with the exporter, ~390 kB;
  // fiber + drei + the view ~570 kB); that is expected.
  build: { chunkSizeWarningLimit: 1100 },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
