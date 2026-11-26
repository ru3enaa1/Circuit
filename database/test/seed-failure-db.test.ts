import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { SEED_LOCK_NAME } from '../seed.ts';
import { DATABASE_HOOK_TIMEOUT_MS } from './disposable-db.ts';
import {
  CRM_TABLES,
  hookedConnector,
  KEY_IN_TEXT,
  newKeyFile,
  removeKeyFiles,
  seed,
  seedEnv,
  SEED_TEST_TIMEOUT_MS,
  tableCounts,
  useMigratedDatabase,
} from './seed-tools.ts';

// Audit of ADR-0009, H1 and H9: the rare failures of db:seed, each told in our own words and
// none leaving a half-written state. A session the server ends, a key file that cannot be written
// after the COMMIT, and a key revoked by someone else while the seed rotates it.

afterAll(removeKeyFiles, DATABASE_HOOK_TIMEOUT_MS);

/** How often, and for how long, the test looks for the seed waiting on its lock. */
const POLL_MS = 50;
const WAIT_LIMIT_MS = 10_000;

/** The backend of a seed that waits on a lock in `database`: `advisory` for its own lock, `transactionid` for a row. */
async function seedWaitingOn(waitEvent: string, pool: pg.Pool, database: string): Promise<number> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
        WHERE datname = $1 AND wait_event_type = 'Lock' AND wait_event = $2 AND pid <> pg_backend_pid()`,
      [database, waitEvent],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`La semilla nunca llegó a esperar (${waitEvent}).`);
}

describe('A1 · a seed whose session the server ends', () => {
  const db = useMigratedDatabase();

  it.each([
    ['waiting on its own lock, before its transaction', 'advisory'],
    ['inside its transaction, with a ROLLBACK still to send', 'transactionid'],
  ])('%s: exits with 1 by its SQLSTATE, writes nothing, and leaves no unhandled error', async (_case, waitEvent) => {
    // Another session holds what the seed will wait for: its advisory lock, or, uncommitted, the
    // row of the first account, so the seed waits inside its transaction on its own INSERT. Then
    // the server ends the seed's session. In the second case pg still has the ROLLBACK to run when
    // the connection drops, and emits 'error' on the client: what the audit saw as unhandled.
    const holder = await db().pool.connect();
    try {
      if (waitEvent === 'advisory') await holder.query('SELECT pg_advisory_lock(hashtext($1))', [SEED_LOCK_NAME]);
      else await holder.query("BEGIN; INSERT INTO crm.accounts (slug, name) VALUES ('escuela-andamio', 'Sin confirmar')");
      const keyFile = newKeyFile();
      const running = seed(seedEnv(db().name, keyFile));
      await db().pool.query('SELECT pg_terminate_backend($1)', [await seedWaitingOn(waitEvent, db().pool, db().name)]);
      const run = await running;
      expect(run.code).toBe(1);
      expect(run.err).toBe('db:seed falló (SQLSTATE 57P01).');
      await holder.query('ROLLBACK');
      expect(Object.values(await tableCounts(db().pool))).toEqual(CRM_TABLES.map(() => 0));
      expect(readdirSync(dirname(keyFile))).toEqual([]);
    } finally {
      // Destroyed, not returned to the pool: ending the session releases the lock and the row.
      holder.release(true);
    }
  }, SEED_TEST_TIMEOUT_MS);
});

describe('H9 · a key file that cannot be written after the COMMIT', () => {
  const db = useMigratedDatabase();
  const folder = mkdtempSync(join(tmpdir(), 'circuit-seed-bloqueo-'));
  afterAll(() => rmSync(folder, { recursive: true, force: true }), DATABASE_HOOK_TIMEOUT_MS);

  it('says the database was seeded and how to get a key, and the next run issues one', async () => {
    // A file where the key's folder would go: the folder cannot be made.
    const blocker = join(folder, 'no-es-carpeta');
    writeFileSync(blocker, 'un archivo donde iría la carpeta');
    const run = await seed(seedEnv(db().name, join(blocker, 'crm-agent-key')));
    expect(run.code).toBe(1);
    expect(run.err).toContain('La base quedó sembrada, pero no se pudo escribir la llave en');
    expect(run.err).toContain('Corre npm run db:seed otra vez y emitirá otra.');
    expect(`${run.out}\n${run.err}`).not.toMatch(KEY_IN_TEXT);
    expect((await tableCounts(db().pool))['accounts']).toBe(2);
    const again = await seed(seedEnv(db().name, newKeyFile()));
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain('Llave del agente nueva');
    const live = await db().pool.query("SELECT 1 FROM crm.api_keys WHERE label = 'agente' AND revoked_at IS NULL");
    expect(live.rowCount).toBe(1);
  }, SEED_TEST_TIMEOUT_MS);
});

describe("H9 · an agent key revoked by someone else while the seed rotates it", () => {
  const db = useMigratedDatabase();

  it("is told by the issuer's own message, and the seed changes nothing", async () => {
    const keyFile = newKeyFile();
    const env = seedEnv(db().name, keyFile);
    expect((await seed(env)).code).toBe(0);
    // Without the file the next run rotates the key, revoking the live one by its id.
    rmSync(keyFile);
    const before = await tableCounts(db().pool);
    const racing = hookedConnector(env, async (text, values) => {
      // Someone else revokes the same key, and commits, just before the seed's own revocation.
      if (text.startsWith('UPDATE crm.api_keys SET revoked_at')) await db().pool.query(text, [...values]);
    });
    const run = await seed(env, { connect: racing });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/^db:seed: No hay una llave viva con el id \d+\.$/);
    expect(await tableCounts(db().pool)).toEqual(before);
    expect(readdirSync(dirname(keyFile))).toEqual([]);
  }, SEED_TEST_TIMEOUT_MS);
});
