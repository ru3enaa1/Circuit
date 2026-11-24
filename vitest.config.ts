import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One project per app: `npm test` at the root runs every app, and the report names the
    // app each failure belongs to.
    projects: ['apps/*'],
  },
});
