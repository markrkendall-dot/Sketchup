import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The standalone viewer (viewer.html, src/viewer/): one JS bundle and one stylesheet, which
// scripts/build-viewer.mjs then inlines into a single HTML file with a plan baked in. Vite 8 is
// Rolldown-based: `codeSplitting: false` is its single-bundle switch (the old
// `inlineDynamicImports`), and it needs the one input, so this is a separate config and output
// folder; `npm run build` and dist/ are untouched.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-viewer',
    rolldownOptions: {
      input: 'viewer.html',
      output: { codeSplitting: false },
    },
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 1024,
    modulePreload: false,
    sourcemap: false,
    // One bundle of about 1.9 MB is the point.
    chunkSizeWarningLimit: 2500,
  },
});
