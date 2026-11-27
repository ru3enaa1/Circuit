import { defineConfig } from 'vitest/config';

// Confirmed by the owner on 2026-11-24: 80 on every measure is the floor coderachnid's
// tests-that-bite sets for a whole codebase. It only rises; the core
// aims for ~90 once it has code (F2). Coverage proves a line ran, not that a wrong line would
// be noticed, so it never replaces a positive control.
const COVERAGE_FLOOR_PERCENT = 80;

export default defineConfig({
  test: {
    // One project per app, plus the database tooling: `npm test` at the root runs them all,
    // and the report names the project each failure belongs to.
    projects: ['apps/*', 'database'],
    coverage: {
      provider: 'v8',
      // Production code only, listed explicitly so a source file no test imports shows up
      // at 0% instead of silently staying out of the report. Tests live under test/.
      // The board's .tsx count too (ADR-0004 H6, ADR-0011 B11), with the same floor.
      include: ['apps/*/src/**/*.{ts,tsx}', 'database/*.ts'],
      // Declarations only: nothing in them runs.
      exclude: ['**/*.d.ts'],
      // Text only: the CI log is the report, and nothing is written to the repository.
      reporter: ['text'],
      thresholds: {
        lines: COVERAGE_FLOOR_PERCENT,
        functions: COVERAGE_FLOOR_PERCENT,
        branches: COVERAGE_FLOOR_PERCENT,
        statements: COVERAGE_FLOOR_PERCENT,
      },
    },
  },
});
