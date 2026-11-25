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
