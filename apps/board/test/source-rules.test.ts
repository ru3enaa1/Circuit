import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ADR-0011 B1, B2 and B7, read from the source: state and timers live in use-run-events.ts only,
// and nothing in the board names another origin. The same checks as the ADR's git grep, run on
// every `npm test` so they cannot be forgotten.

const BOARD_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FEED_FILE = 'use-run-events.ts';

function sources(): { readonly name: string; readonly text: string }[] {
  return readdirSync(join(BOARD_ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx|css)$/.test(name))
    .map((name) => ({ name: name.split('\\').join('/'), text: readFileSync(join(BOARD_ROOT, 'src', name), 'utf8') }));
}

function filesMatching(pattern: RegExp): string[] {
  return sources()
    .filter((file) => pattern.test(file.text))
    .map((file) => file.name);
}

describe('the board source', () => {
  it('is found (control)', () => {
    const names = sources().map((file) => file.name);

    expect(names).toEqual(expect.arrayContaining([FEED_FILE, 'projection.ts', 'components/Board.tsx', 'components/StationNode.tsx']));
  });

  it('B1 · keeps state only in use-run-events.ts', () => {
    expect(filesMatching(/\b(useState|useReducer)\b/)).toEqual([FEED_FILE]);
  });

  it('B2 · has timers only in use-run-events.ts', () => {
    expect(filesMatching(/\b(setTimeout|setInterval|requestAnimationFrame)\b/)).toEqual([FEED_FILE]);
  });

  it('B1 · the projection reads no clock, no randomness and no network', () => {
    const text = sources().find((file) => file.name === 'projection.ts')?.text ?? '';
    // The code, not its comments, which say what it does not do.
    const projection = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(projection.length).toBeGreaterThan(1000);
    expect(projection).not.toMatch(/\b(Date|Math\.random|fetch|performance|crypto)\b/);
  });

  it('B7 · names no other origin, in the source or in index.html', () => {
    const index = readFileSync(join(BOARD_ROOT, 'index.html'), 'utf8');

    expect(filesMatching(/https?:\/\//)).toEqual([]);
    expect(index).not.toMatch(/https?:\/\//);
  });
});
