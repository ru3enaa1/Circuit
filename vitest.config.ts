import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One project per app, plus the database tooling: `npm test` at the root runs them all,
    // and the report names the project each failure belongs to.
    projects: ['apps/*', 'database'],
  },
});
