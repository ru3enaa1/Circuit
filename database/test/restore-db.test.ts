import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CRM_DB_USER } from '../../apps/crm/src/config.ts';
import { DUMP_FILE, HASH_SUFFIX, runBackupCommand } from '../backup.ts';
import { hashFile } from '../command.ts';
import { readLocalEnv } from '../env.ts';
import { runRestoreCommand } from '../restore.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../users.ts';
import { seedReadFixture, sha256, type ReadFixture } from './crm-fixture.ts';
import {
  createDisposableDatabase,
  DATABASE_HOOK_TIMEOUT_MS,
  databaseExists,
  dropTestDatabase,
  newTestDatabaseName,
  runMigrations,
  type DisposableDatabase,
} from './disposable-db.ts';
import { containerTmp, DOCKER_TEST_TIMEOUT_MS, recordingDocker, tempsOf, textDump, unreachableDocker, type RecordingDocker } from './docker-tools.ts';

// ADR-0009 D4–D6: `npm run db:restore` as its function. A disposable database, migrated and
// seeded with the read fixture (rows in all eight tables, archived ones and a revoked key), is
// backed up with db:backup into a temporary folder and restored into new test databases, which
// this file drops at the end.

const env = readLocalEnv();
const crmPassword = readCrmPassword(env);
const quiet = { log: () => undefined, error: () => undefined };

let source: DisposableDatabase | undefined;
let fixture: ReadFixture | undefined;
let root = '';
let dump = '';
/** Every database a restore was asked to create, dropped in afterAll whether it exists or not. */
const targets: string[] = [];
const recordings: RecordingDocker[] = [];

beforeAll(async () => {
  source = await createDisposableDatabase();
  await runMigrations(source.pool);
  fixture = await seedReadFixture(source.pool);
  await createOrUpdateCrmApp(source.connection, crmPassword);
  root = mkdtempSync(join(tmpdir(), 'circuit-restore-test-'));
  const code = await runBackupCommand(['--label', 'origen', '--database', source.name, '--backups-dir', root], env, { out: quiet });
  const folder = readdirSync(root)[0];
  if (code !== 0 || folder === undefined) throw new Error('db:backup no dejó el respaldo de origen.');
  dump = join(root, folder, DUMP_FILE);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  for (const name of targets) await dropTestDatabase(name);
  rmSync(root, { recursive: true, force: true });
  await source?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

interface Run {
  readonly code: number;
  readonly err: string;
  readonly recording: RecordingDocker;
}

async function restore(file: string, into: string, inner = recordingDocker()): Promise<Run> {
  recordings.push(inner);
  const err: string[] = [];
  const code = await runRestoreCommand(['--file', file, '--into', into], env, {
    docker: inner.docker,
    out: { log: () => undefined, error: (line: string) => err.push(line) },
  });
  return { code, err: err.join('\n'), recording: inner };
}

function newTarget(): string {
  const name = newTestDatabaseName();
  targets.push(name);
  return name;
}

/** A copy of the source backup in its own folder, changed by `change`, with a .sha256 of `hashOf`. */
function alteredCopy(change: (bytes: Buffer) => Buffer, hashOf: 'original' | 'altered'): string {
  const folder = mkdtempSync(join(root, 'copia-'));
  const file = join(folder, DUMP_FILE);
  copyFileSync(dump, file);
  const original = hashFile(file);
  writeFileSync(file, change(readFileSync(file)));
  writeFileSync(`${file}${HASH_SUFFIX}`, `${hashOf === 'original' ? original : hashFile(file)}  ${DUMP_FILE}\n`);
  return file;
}

const adminUser = (): string => source!.connection.user;

describe('D4 · only into a new database', () => {
  it(
    'into a database that exists exits with 1 and leaves it exactly as it was',
    async () => {
      const before = textDump(source!.name, adminUser());
      const run = await restore(dump, source!.name);
      expect(run.code).toBe(1);
      expect(run.err).toContain('ya existe');
      expect(textDump(source!.name, adminUser())).toBe(before);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    'a backup with one byte changed exits with 1 before creating anything',
    async () => {
      const file = alteredCopy((bytes) => {
        bytes[100] = (bytes[100] ?? 0) ^ 0xff;
        return bytes;
      }, 'original');
      const target = newTarget();
      const recording = recordingDocker(unreachableDocker);
      const run = await restore(file, target, recording);
      expect(run.code).toBe(1);
      expect(run.err).toContain('SHA-256');
      expect(recording.runs).toEqual([]);
      expect(await databaseExists(target)).toBe(false);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it.each([['Mayusculas'], ['1empieza'], ['con-guion'], ['x'.repeat(64)]])(
    'the name %j exits with 1 before anything',
    async (into) => {
      const recording = recordingDocker(unreachableDocker);
      const run = await restore(dump, into, recording);
      expect(run.code).toBe(1);
      expect(run.err).toContain('--into');
      expect(recording.runs).toEqual([]);
    },
  );

  it('a file that does not exist exits with 1', async () => {
    const run = await restore(join(root, 'no-existe.dump'), newTarget(), recordingDocker(unreachableDocker));
    expect(run.code).toBe(1);
    expect(run.err).toContain('No existe el respaldo');
  });
});

describe('D5 · all or nothing', () => {
  it(
    'a truncated backup, with a .sha256 that matches it, exits with 1 and leaves no database',
    async () => {
      const file = alteredCopy((bytes) => bytes.subarray(0, Math.floor(bytes.length / 2)), 'altered');
      const target = newTarget();
      const run = await restore(file, target);
      expect(run.code).toBe(1);
      expect(run.err).toContain('pg_restore falló');
      expect(await databaseExists(target)).toBe(false);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );
});

/** What crm_app sees in the restored copy: the rules of ADR-0005 must have come with it. */
async function asAppIn(database: string, accountId: string) {
  const client = new pg.Client({ ...source!.connection, user: CRM_DB_USER, password: crmPassword, database });
  await client.connect();
  try {
    await client.query('BEGIN');
    const withoutAccount = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM crm.contacts');
    await client.query("SELECT set_config('crm.account_id', $1, true)", [accountId]);
    const accounts = await client.query<{ id: string }>('SELECT DISTINCT account_id::text AS id FROM crm.contacts');
    const contacts = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM crm.contacts');
    const agent = await client.query<{ id: string }>('SELECT api_key_id::text AS id FROM crm.resolve_api_key($1)', [sha256(fixture!.a.apiKey)]);
    const revoked = await client.query('SELECT 1 FROM crm.resolve_api_key($1)', [sha256(fixture!.revokedApiKey)]);
    await client.query('ROLLBACK');
    return {
      withoutAccount: withoutAccount.rows[0]?.n,
      accounts: accounts.rows.map((row) => row.id),
      contacts: contacts.rows[0]?.n,
      agent: agent.rows.map((row) => row.id),
      revoked: revoked.rowCount,
    };
  } finally {
    await client.end();
  }
}

describe('D6 · the restore is tested', () => {
  let target = '';

  beforeAll(async () => {
    target = newTarget();
    const run = await restore(dump, target);
    if (run.code !== 0) throw new Error(`db:restore no restauró la copia: ${run.err}`);
  }, DATABASE_HOOK_TIMEOUT_MS);

  it(
    'the copy dumps byte for byte like the original, with owners and privileges',
    () => {
      const original = textDump(source!.name, adminUser());
      // Control: the comparison carries what M8 and M9 would lose, and the data.
      for (const part of ['OWNER TO crm_owner', 'GRANT SELECT', 'CREATE POLICY', 'COPY crm.contacts']) expect(original).toContain(part);
      expect(textDump(target, adminUser())).toBe(original);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    "as crm_app, the copy shows no row without an account, only account a's with it, and a's live key only",
    async () => {
      const ownCount = await source!.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM crm.contacts WHERE account_id = $1', [fixture!.a.id]);
      expect(await asAppIn(target, fixture!.a.id)).toEqual({
        withoutAccount: 0,
        accounts: [fixture!.a.id],
        contacts: ownCount.rows[0]?.n,
        agent: [fixture!.a.apiKeyId],
        revoked: 0,
      });
    },
    DOCKER_TEST_TIMEOUT_MS,
  );

  it(
    "none of this file's temporaries is left in the container",
    () => {
      const temps = recordings.flatMap(({ runs }) => tempsOf(runs));
      expect(temps.length).toBeGreaterThanOrEqual(2);
      const left = new Set(containerTmp().map((name) => `/tmp/${name}`));
      expect(temps.filter((path) => left.has(path))).toEqual([]);
    },
    DOCKER_TEST_TIMEOUT_MS,
  );
});
