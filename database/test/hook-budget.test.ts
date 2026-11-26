import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';

// ADR-0007 A4 (audit H1): every beforeAll and afterAll of a test with a database runs with
// DATABASE_HOOK_TIMEOUT_MS, never with Vitest's 10 s. Read from the source, because running
// cannot show it: Vitest 5.1.1 does not pass `--hookTimeout` from the command line to the
// projects, so `--hookTimeout=1` passes even with a hook that lacks the budget (CLAUDE.md §8).

const TEST_DIRS = ['apps/crm/test', 'database/test'];
/** A file that imports either of these opens a disposable database. */
const USES_DATABASE = /from '[^']*\/(disposable-db|crm-under-test)\.ts'/;
const HOOK_CALL = /\b(?:beforeAll|afterAll)\(/g;
/** The budget as a hook's last argument, on the hook's closing line or on its own line. */
const BUDGET_ARGUMENT = /,\s*DATABASE_HOOK_TIMEOUT_MS\s*\)/g;
/** Files that must be found, so a wrong path cannot leave the check with nothing to read. */
const KNOWN_DATABASE_FILES = ['apps/crm/test/crm-under-test.ts', 'apps/crm/test/main-process.test.ts', 'database/test/migrations-db.test.ts'];

interface HookCount {
  readonly file: string;
  readonly hooks: number;
  readonly withBudget: number;
}

function databaseTestFiles(): HookCount[] {
  return TEST_DIRS.flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `${dir}/${name}`)
      .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), 'utf8') }))
      .filter(({ text }) => USES_DATABASE.test(text))
      .map(({ file, text }) => ({
        file,
        hooks: text.match(HOOK_CALL)?.length ?? 0,
        withBudget: text.match(BUDGET_ARGUMENT)?.length ?? 0,
      })),
  );
}

describe('the hooks of the tests with a database', () => {
  const files = databaseTestFiles();

  it('are found where they are expected (control)', () => {
    expect(files.map(({ file }) => file)).toEqual(expect.arrayContaining(KNOWN_DATABASE_FILES));
    expect(files.reduce((sum, { hooks }) => sum + hooks, 0)).toBeGreaterThan(0);
  });

  it('each carry DATABASE_HOOK_TIMEOUT_MS as their timeout', () => {
    const short = files.filter(({ hooks, withBudget }) => hooks !== withBudget);
    expect(short, 'cada beforeAll y afterAll lleva DATABASE_HOOK_TIMEOUT_MS como último argumento').toEqual([]);
  });
});

// ADR-0009 A1 (audit H1): every test of a file that seeds or calls docker runs with a named
// budget, never with Vitest's 5 s. A seed test went past them once in five runs, and so did
// schema-dump-db, with docker busy with the backup tests; the run went red, and the database the
// test left behind was dropped under a seed still connected to it.

/** A file that imports either of these seeds the package or orders docker inside its tests. */
const HEAVY = /from '[^']*\/(seed-tools|docker-tools)\.ts'/;
/** A test, opened at the start of a line: it(, it.each( or it.skipIf(. */
const TEST_CALL = /^\s*it(?:\.\w+)?\(/gm;
/** A test budget as the last argument, on the closing line or on its own line. */
const TEST_BUDGET = /,\s*(?:DOCKER|SEED|PROCESS)_TEST_TIMEOUT_MS\s*,?\s*\)/g;
const KNOWN_HEAVY_FILES = [
  'apps/crm/test/seed-agent-key-db.test.ts',
  'database/test/backup-db.test.ts',
  'database/test/schema-dump-db.test.ts',
  'database/test/seed-db.test.ts',
];

interface TestCount {
  readonly file: string;
  readonly tests: number;
  readonly withBudget: number;
}

function heavyTestFiles(): TestCount[] {
  return TEST_DIRS.flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => `${dir}/${name}`)
      .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), 'utf8') }))
      .filter(({ text }) => HEAVY.test(text))
      .map(({ file, text }) => ({ file, tests: text.match(TEST_CALL)?.length ?? 0, withBudget: text.match(TEST_BUDGET)?.length ?? 0 })),
  );
}

describe('the tests that seed or call docker', () => {
  const files = heavyTestFiles();

  it('are found where they are expected (control)', () => {
    expect(files.map(({ file }) => file)).toEqual(expect.arrayContaining(KNOWN_HEAVY_FILES));
    expect(files.every(({ tests }) => tests > 0)).toBe(true);
  });

  it('each carry a named test budget as their timeout', () => {
    const short = files.filter(({ tests, withBudget }) => tests !== withBudget);
    expect(short, 'cada prueba que siembra o llama a docker lleva DOCKER_, SEED_ o PROCESS_TEST_TIMEOUT_MS como último argumento').toEqual([]);
  });
});
