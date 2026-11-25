import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeDocker, DUMP_FILE, folderStamp, hashFile, HASH_SUFFIX, runBackupCommand, type Docker } from '../backup.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../users.ts';
import { seedReadFixture } from './crm-fixture.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import { containerTmp, DOCKER_TEST_TIMEOUT_MS, recordingDocker, sqlOfBackup, tempsOf, unreachableDocker, type RecordingDocker } from './docker-tools.ts';

// ADR-0009 D1–D3: `npm run db:backup` as its function, on a disposable database seeded with the
// fixture and with every backup written to a temporary folder of the system, never to
// database/backups/. docker is the real one, wrapped so each order is recorded.

const env = readLocalEnv();
const crmPassword = readCrmPassword(env);
const adminPassword = env['POSTGRES_PASSWORD'] ?? '';
/** A fixed clock, so a test knows the folder a run will want. */
const NOW = new Date('2026-11-25T18:04:05.678Z');
const FOLDER = `${folderStamp(NOW)}-prueba`;

let db: DisposableDatabase | undefined;
let root = '';
/** Every recording of this file, so the last test checks the temporaries of all of them. */
const recordings: RecordingDocker[] = [];

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await seedReadFixture(db.pool);
  // crm_app on the server, with its verifier: a backup must not carry it (D3).
  await createOrUpdateCrmApp(db.connection, crmPassword);
  root = mkdtempSync(join(tmpdir(), 'circuit-backup-test-'));
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly recording: RecordingDocker;
}

async function backup(args: readonly string[], options: { readonly inner?: Docker; readonly backupsDir?: string } = {}): Promise<Run> {
  const recording = recordingDocker(options.inner);
  recordings.push(recording);
  const out: string[] = [];
  const err: string[] = [];
  const all = [...args, '--database', db!.name, '--backups-dir', options.backupsDir ?? root];
  const code = await runBackupCommand(all, env, {
    docker: recording.docker,
    now: () => NOW,
    out: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  });
  return { code, out: out.join('\n'), err: err.join('\n'), recording };
}

/** A fresh root per case, so the fixed clock never meets the folder of another case. */
function freshRoot(): string {
  return mkdtempSync(join(root, 'caso-'));
}

describe('D1–D3 · db:backup', () => {
  it(
    'D1, D2: a good run leaves circuit.dump and its .sha256, the SHA-256 sha256sum gave inside the container',
    async () => {
      const dir = freshRoot();
      const run = await backup(['--label', 'prueba'], { backupsDir: dir });
      expect(run.code, run.err).toBe(0);
      expect(readdirSync(join(dir, FOLDER)).sort()).toEqual([DUMP_FILE, `${DUMP_FILE}${HASH_SUFFIX}`]);
      const hostHash = hashFile(join(dir, FOLDER, DUMP_FILE));
      const insideHash = run.recording.runs.find(({ args }) => args.includes('sha256sum'))?.result.stdout.slice(0, 64);
      expect(insideHash).toBe(hostHash);
      expect(readFileSync(join(dir, FOLDER, `${DUMP_FILE}${HASH_SUFFIX}`), 'utf8')).toBe(`${hostHash}  ${DUMP_FILE}\n`);
      expect(run.out).toContain(hostHash);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'D1: the folder is named by the time in UTC, with its Z, and the label',
    () => {
      expect(folderStamp(NOW)).toBe('20261125-180405Z');
    },
  );

  it(
    'D1: with the folder already there, exits with 1, calls no docker and leaves its content as it was',
    async () => {
      const dir = freshRoot();
      mkdirSync(join(dir, FOLDER));
      writeFileSync(join(dir, FOLDER, 'marca.txt'), 'estaba antes');
      const run = await backup(['--label', 'prueba'], { backupsDir: dir, inner: unreachableDocker });
      expect(run.code).toBe(1);
      expect(run.err).toContain('Ya existe');
      expect(run.recording.runs).toEqual([]);
      expect(readdirSync(join(dir, FOLDER))).toEqual(['marca.txt']);
      expect(readFileSync(join(dir, FOLDER, 'marca.txt'), 'utf8')).toBe('estaba antes');
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it.each([['Antes semilla'], ['../fuera'], ['']])(
    'D1: the label %j exits with 1 before docker is called',
    async (label) => {
      const dir = freshRoot();
      const run = await backup(['--label', label], { backupsDir: dir, inner: unreachableDocker });
      expect(run.code).toBe(1);
      expect(run.err).toContain('La etiqueta (--label)');
      expect(run.recording.runs).toEqual([]);
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it(
    'D2: a copy that comes out with one byte changed exits with 1 and leaves no folder',
    async () => {
      const dir = freshRoot();
      const flipping: Docker = async (args) => {
        const result = await composeDocker(args);
        const target = args[0] === 'cp' ? args[2] : undefined;
        if (result.code === 0 && target !== undefined) {
          const bytes = readFileSync(target);
          bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
          writeFileSync(target, bytes);
        }
        return result;
      };
      const run = await backup(['--label', 'prueba'], { backupsDir: dir, inner: flipping });
      expect(run.code).toBe(1);
      expect(run.err).toContain('SHA-256');
      expect(existsSync(join(dir, FOLDER))).toBe(false);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'D2: a pg_dump that fails exits with 1 and leaves no folder',
    async () => {
      const dir = freshRoot();
      const failingDump: Docker = async (args) => (args.includes('pg_dump') ? { code: 1, stdout: '', stderr: '' } : composeDocker(args));
      const run = await backup(['--label', 'prueba'], { backupsDir: dir, inner: failingDump });
      expect(run.code).toBe(1);
      expect(run.err).toContain('pg_dump falló (salida 1)');
      expect(existsSync(join(dir, FOLDER))).toBe(false);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'D1: a temporary that cannot be removed is reported, and the backup stands',
    async () => {
      const dir = freshRoot();
      const keepingTemp: Docker = async (args) => (args.includes('rm') ? { code: 1, stdout: '', stderr: '' } : composeDocker(args));
      const run = await backup(['--label', 'prueba'], { backupsDir: dir, inner: keepingTemp });
      expect(run.code, run.err).toBe(0);
      expect(run.err).toContain('Aviso: no se pudo borrar /tmp/circuit-backup-');
      expect(existsSync(join(dir, FOLDER, DUMP_FILE))).toBe(true);
      // This case left its temporary on purpose; it goes now, so the last test still checks the rest.
      for (const temp of tempsOf(run.recording.runs)) await composeDocker(['exec', '-T', 'db', 'rm', '-f', temp]);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'D3: no order carries a password, and none is pg_dumpall',
    async () => {
      expect(adminPassword.length, 'POSTGRES_PASSWORD de .env o del entorno').toBeGreaterThan(0);
      const run = await backup(['--label', 'prueba'], { backupsDir: freshRoot() });
      expect(run.code, run.err).toBe(0);
      const orders = run.recording.runs.map(({ args }) => args.join(' '));
      expect(orders.length).toBeGreaterThanOrEqual(5);
      for (const order of orders) {
        expect(order).not.toContain(adminPassword);
        expect(order).not.toContain(crmPassword);
        expect(order).not.toMatch(/PGPASSWORD|pg_dumpall/);
      }
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'D3: the backup, read back as SQL, holds the data but no verifier and no password',
    async () => {
      const dir = freshRoot();
      const run = await backup(['--label', 'prueba'], { backupsDir: dir });
      expect(run.code, run.err).toBe(0);
      const sql = sqlOfBackup(join(dir, FOLDER, DUMP_FILE));
      // Control: the text is the dump, with the fixture's rows in it.
      expect(sql).toContain('COPY crm.contacts');
      expect(sql).toContain('contacto@cuenta-a.test');
      expect(sql).not.toContain('SCRAM-SHA-256$');
      expect(sql).not.toContain(adminPassword);
      expect(sql).not.toContain(crmPassword);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    "D1: after the good runs and the failed ones, none of this file's temporaries is left in the container",
    () => {
      const temps = recordings.flatMap(({ runs }) => tempsOf(runs));
      // Control: the runs above did make temporaries, so the check has something to look for.
      expect(temps.length).toBeGreaterThanOrEqual(4);
      const left = new Set(containerTmp().map((name) => `/tmp/${name}`));
      expect(temps.filter((path) => left.has(path))).toEqual([]);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );
});
