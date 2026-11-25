import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DUMP_FILE, HASH_SUFFIX } from '../backup.ts';
import { REPO_ROOT } from '../config.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0009 D25: the real command, as `npm run db:backup` runs it. Node loads the file without a
// build (ADR-0006 D1), so this catches what the function tests cannot: an import that fails
// only at load, or a main guard that never runs.

/** A new Node plus five orders to docker, with every file running at once (CLAUDE.md §8). */
const PROCESS_TEST_TIMEOUT_MS = 60_000;

let db: DisposableDatabase | undefined;
let root = '';

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  root = mkdtempSync(join(tmpdir(), 'circuit-backup-process-'));
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

function backupProcess(args: readonly string[]) {
  return spawnSync(process.execPath, ['database/backup.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: PROCESS_TEST_TIMEOUT_MS });
}

describe('D25 · node database/backup.ts', () => {
  it(
    'with a label that is not a slug exits with 1 and its reason, and writes nothing',
    () => {
      const run = backupProcess(['--label', 'Antes semilla', '--backups-dir', root]);
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain('La etiqueta (--label)');
      expect(readdirSync(root)).toEqual([]);
    },
    PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    'on a disposable database exits with 0 and leaves the dump and its SHA-256',
    () => {
      const run = backupProcess(['--label', 'proceso', '--database', db!.name, '--backups-dir', root]);
      expect(run.status, run.stderr).toBe(0);
      const [folder, ...rest] = readdirSync(root);
      expect(rest).toEqual([]);
      expect(folder).toMatch(/^\d{8}-\d{6}Z-proceso$/);
      expect(readdirSync(join(root, folder ?? '')).sort()).toEqual([DUMP_FILE, `${DUMP_FILE}${HASH_SUFFIX}`]);
    },
    PROCESS_TEST_TIMEOUT_MS,
  );
});
