import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GIF_FILE, GIF_HEIGHT, GIF_MAX_BYTES, GIF_WIDTH } from './shots/board-gif.ts';

// ADR-0017: the README's first screen is a GIF of the circuit, written by `npm run board:gif`.
// GitHub stops showing a heavy GIF (the plan's F6 pitfalls), so its weight is held here, with its
// size and format, on every `npm test`.

describe('ADR-0017 · the GIF of the README', () => {
  const bytes = readFileSync(GIF_FILE);

  it('is a GIF89a of the recorded size', () => {
    expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    // The logical screen: width and height, little endian, right after the signature.
    expect([bytes.readUInt16LE(6), bytes.readUInt16LE(8)]).toEqual([GIF_WIDTH, GIF_HEIGHT]);
  });

  it('weighs no more than the limit', () => {
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(bytes.length).toBeLessThanOrEqual(GIF_MAX_BYTES);
  });
});
