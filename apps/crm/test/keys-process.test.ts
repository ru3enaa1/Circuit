import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../database/config.ts';
import { useCrmUnderTest } from './crm-under-test.ts';

// ADR-0008 D19: the real command, as `npm run db:keys` runs it. Node loads the file without a
// build (ADR-0006 D1), so this catches what the function tests cannot: an import that fails
// only at load, or a main guard that never runs.

const crm = useCrmUnderTest();

/** A new Node that loads pg and the CRM schema is slow with every file running (CLAUDE.md §8). */
const PROCESS_TEST_TIMEOUT_MS = 30_000;
const KEY_IN_TEXT = /crmk_[A-Za-z0-9_-]{43}/g;

function keysProcess(args: readonly string[], database: string) {
  return spawnSync(process.execPath, ['database/keys.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: PROCESS_TEST_TIMEOUT_MS,
    env: { ...process.env, POSTGRES_DB: database },
  });
}

describe('D19 · node database/keys.ts', () => {
  it(
    'without arguments exits with 1 and the usage, without connecting',
    () => {
      // A database that does not exist: had it connected, the error would carry SQLSTATE 3D000.
      const run = keysProcess([], 'no_existe_esta_base');
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain('Uso: npm run db:keys');
      expect(run.stderr).not.toContain('SQLSTATE');
    },
    PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    'issue on a disposable database exits with 0 and prints one key',
    () => {
      const run = keysProcess(['issue', '--account', 'cuenta-a', '--label', 'proceso', '--permissions', 'read'], crm().db.name);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.match(KEY_IN_TEXT)).toHaveLength(1);
    },
    PROCESS_TEST_TIMEOUT_MS,
  );
});
