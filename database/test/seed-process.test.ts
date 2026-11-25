import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import { KEY_IN_TEXT, newKeyFile, REAL_SCENARIO } from './seed-tools.ts';

// ADR-0009 D25: the real command, as `npm run db:seed` runs it, so an import that fails only at
// load, or a main guard that never runs, shows here.

/** A new Node that loads pg, zod and the CRM schema, with every file running at once (CLAUDE.md §8). */
const PROCESS_TEST_TIMEOUT_MS = 60_000;

let db: DisposableDatabase | undefined;
const keyFile = newKeyFile();

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  rmSync(dirname(keyFile), { recursive: true, force: true });
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

/** The variables go through the environment, which wins over .env (database/env.ts); an empty one counts as missing. */
function seedProcess(env: Record<string, string>) {
  return spawnSync(process.execPath, ['database/seed.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: PROCESS_TEST_TIMEOUT_MS,
    env: { ...process.env, CRM_AGENT_KEY_FILE: keyFile, ...env },
  });
}

describe('D25 · node database/seed.ts', () => {
  it(
    'without CIRCUIT_SCENARIO exits with 1 and names it, without connecting',
    () => {
      // A database that does not exist: had it connected, the error would carry SQLSTATE 3D000.
      const run = seedProcess({ CIRCUIT_SCENARIO: '', POSTGRES_DB: 'no_existe_esta_base' });
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain('Falta CIRCUIT_SCENARIO');
      expect(run.stderr).not.toContain('SQLSTATE');
    },
    PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    'on a disposable database exits with 0, seeds both accounts and leaves the key in its file, not in the output',
    () => {
      const run = seedProcess({ CIRCUIT_SCENARIO: REAL_SCENARIO, POSTGRES_DB: db!.name });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('escuela-andamio: sembrada');
      expect(run.stdout).toContain('cuenta-vecina: sembrada');
      expect(readFileSync(keyFile, 'utf8')).toMatch(KEY_IN_TEXT);
      expect(`${run.stdout}${run.stderr}`).not.toMatch(KEY_IN_TEXT);
    },
    PROCESS_TEST_TIMEOUT_MS,
  );
});
