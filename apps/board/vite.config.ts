import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// The board's build (ADR-0011 B12): Vite 8.3.8, the one Vitest brings, with no plugin. Its Oxc
// transform compiles the JSX on its own (question 3). The same file is the Vitest project of
// apps/board, so the tests see the same JSX setting as the build.

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: ROOT,
  base: '/',
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // CSP `default-src 'self'` (B7) refuses data: URLs, so no font or image is inlined.
    assetsInlineLimit: 0,
    // No polyfill script: everything the page runs is a file circuit serves from its list.
    modulePreload: { polyfill: false },
  },
});
