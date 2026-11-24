import { describe, expect, it } from 'vitest';

// Positive control for the test chain of this app. A runner that discovers nothing, or a
// script that swallows the exit code, stays green while protecting nothing; this test
// proves a failing assertion here reaches `npm test` as exit code 1.
// Run with CIRCUIT_INVERT_CONTROL=1 to see it fail on purpose (CI does the same in F0.5).
const INVERT_FLAG = 'CIRCUIT_INVERT_CONTROL';

describe('positive control', () => {
  it('passes normally and fails when inverted on purpose', () => {
    const inverted = process.env[INVERT_FLAG] === '1';

    expect(inverted, `${INVERT_FLAG}=1 is set: this failure is expected`).toBe(false);
  });
});
