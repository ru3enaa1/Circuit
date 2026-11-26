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
const TEST_BUDGET = /,\s*(?:DOCKER|SEED|PROCESS|MIGRATION)_TEST_TIMEOUT_MS\s*,?\s*\)/g;
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


// ADR-0010 D20: a test that applies the migrations in its own body carries a named budget too.
// «two disposable databases migrating at once» ran out of the 5 s in 1 of 2 runs of the
// baseline, and every migration makes it slower. Read test by test: from each it( to the next
// test, hook or describe, which is where a test's body ends in these files.

const MIGRATES = /\brunMigrations\(/;
const NEXT_BLOCK = /^\s*(?:it(?:\.\w+)?|describe|beforeAll|afterAll|beforeEach|afterEach)\(/gm;
const IS_TEST = /^\s*it/;
const KNOWN_MIGRATING_TESTS = ['database/test/migrations-db.test.ts'];

/** The text of each test of a file, from its it( to the start of the next block. */
function testBodies(text: string): string[] {
  const starts = [...text.matchAll(NEXT_BLOCK)].map((match) => ({ at: match.index, isTest: IS_TEST.test(match[0]) }));
  return starts.flatMap((start, index) => (start.isTest ? [text.slice(start.at, starts[index + 1]?.at ?? text.length)] : []));
}

const hasBudget = (body: string): boolean => (body.match(TEST_BUDGET)?.length ?? 0) > 0;

function migratingTests(): { readonly file: string; readonly test: string }[] {
  return TEST_DIRS.flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => name.endsWith('.test.ts') && name !== 'hook-budget.test.ts')
      .map((name) => `${dir}/${name}`)
      .flatMap((file) =>
        testBodies(readFileSync(join(REPO_ROOT, file), 'utf8'))
          .filter((body) => MIGRATES.test(body))
          .map((test) => ({ file, test })),
      ),
  );
}

describe('the tests that apply the migrations in their own body (ADR-0010 D20)', () => {
  const found = migratingTests();

  it('are found where they are expected (control)', () => {
    expect(found.map(({ file }) => file)).toEqual(expect.arrayContaining(KNOWN_MIGRATING_TESTS));
  });

  it('each carry a named test budget as their timeout', () => {
    const short = found.filter(({ test }) => !hasBudget(test)).map(({ file, test }) => `${file}: ${test.split('\n')[0]?.trim()}`);
    expect(short, 'cada prueba que llama a runMigrations lleva MIGRATION_TEST_TIMEOUT_MS (u otro presupuesto con nombre) como último argumento').toEqual([]);
  });

  it('reads a file test by test (control)', () => {
    const text = [
      "it('a', async () => {",
      '  await runMigrations(pool);',
      '}, MIGRATION_TEST_TIMEOUT_MS);',
      '',
      "it('b', async () => {",
      '  await runMigrations(pool);',
      '});',
      '',
      "it('c', () => {});",
    ].join('\n');
    const bodies = testBodies(text);
    expect(bodies.map((body) => [MIGRATES.test(body), hasBudget(body)])).toEqual([
      [true, true],
      [true, false],
      [false, false],
    ]);
  });
});
