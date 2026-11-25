import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseScenario } from '../../apps/crm/src/scenario.ts';
import { REPO_ROOT } from '../config.ts';
import { AGENT_KEY_LABEL } from '../seed.ts';
import { sha256 } from './crm-fixture.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import { CRM_TABLES, interceptingConnector, newKeyFile, REAL_SCENARIO, seed, seedEnv, slowCommitConnector, tableCounts, type SeedRun } from './seed-tools.ts';

/** Long enough for the second seed to connect and reach its check; short enough for the test. */
const SLOW_COMMIT_MS = 1_500;

// ADR-0009 D11–D16: `npm run db:seed` as its function, with the real package, on disposable
// databases. Each describe makes its own, so one case cannot lean on another's rows.

const scenario = parseScenario(JSON.parse(readFileSync(join(REPO_ROOT, 'scenarios', REAL_SCENARIO, 'crm.json'), 'utf8')));
const contactsOf = (slug: string) => scenario.accounts.find((account) => account.slug === slug)?.contacts ?? [];
const SEEDED = (() => {
  const contacts = scenario.accounts.flatMap((account) => account.contacts);
  return {
    companies: scenario.accounts.reduce((sum, account) => sum + account.companies.length, 0),
    contacts: contacts.length,
    notes: contacts.reduce((sum, row) => sum + row.notes.length, 0),
    tasks: contacts.reduce((sum, row) => sum + row.tasks.length, 0),
  };
})();

/** A migrated disposable database, made in beforeAll and dropped in afterAll of the calling describe. */
function useMigratedDatabase(migrate = true): () => DisposableDatabase {
  let db: DisposableDatabase | undefined;
  beforeAll(async () => {
    db = await createDisposableDatabase();
    if (migrate) await runMigrations(db.pool);
  }, DATABASE_HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await db?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);
  return () => {
    if (db === undefined) throw new Error('La base desechable no se creó: falló el beforeAll.');
    return db;
  };
}

/** Every row of every crm table, as JSON and ordered by id, without the columns that are not the package's (D15). */
async function allRows(pool: pg.Pool): Promise<Record<string, unknown[]>> {
  const dropped: Partial<Record<string, string>> = { audit_log: " - 'occurred_at'", api_keys: " - 'key_hash' - 'created_at'" };
  const rows: Record<string, unknown[]> = {};
  for (const table of CRM_TABLES) {
    const result = await pool.query<{ row: unknown }>(`SELECT to_jsonb(t)${dropped[table] ?? ''} AS row FROM crm.${table} AS t ORDER BY t.id`);
    rows[table] = result.rows.map(({ row }) => row);
  }
  return rows;
}

describe('D11 · on a database that was never migrated', () => {
  const db = useMigratedDatabase(false);

  it('exits with 1, says to run db:migrate first, and leaves no key file', async () => {
    const keyFile = newKeyFile();
    const run = await seed(seedEnv(db().name, keyFile));
    expect(run.code).toBe(1);
    expect(run.err).toContain('corre npm run db:migrate antes');
    expect(readdirSync(dirname(keyFile))).toEqual([]);
  });
});

describe('D12, D13, D15 · seeding the real package', () => {
  const db = useMigratedDatabase();
  const other = useMigratedDatabase();
  const keyFile = newKeyFile();
  let first: SeedRun | undefined;

  beforeAll(async () => {
    first = await seed(seedEnv(db().name, keyFile));
    if (first.code !== 0) throw new Error(`La semilla falló: ${first.err}`);
  }, DATABASE_HOOK_TIMEOUT_MS);

  it('says «sembrada» for each account, with its counts, and where the key went', () => {
    expect(first?.out).toContain('escuela-andamio: sembrada (6 etapas, 5 empresas');
    expect(first?.out).toContain('cuenta-vecina: sembrada (1 etapas, 0 empresas, 1 contactos');
    expect(first?.out).toContain(`Llave del agente nueva, en ${keyFile}`);
  });

  it('D12: one audit row per company, contact, note and task, each an insert signed seed, without a key or an approval', async () => {
    const audit = await db().pool.query<{ table_name: string; n: number }>(
      `SELECT table_name, count(*)::int AS n FROM crm.audit_log
        WHERE operation = 'insert' AND proposed_by = 'seed' AND approved_by = 'seed' AND api_key_id IS NULL AND approval_ref IS NULL
        GROUP BY table_name ORDER BY table_name`,
    );
    expect(Object.fromEntries(audit.rows.map((row) => [row.table_name, row.n]))).toEqual(SEEDED);
    expect((await tableCounts(db().pool))['audit_log']).toBe(SEEDED.companies + SEEDED.contacts + SEEDED.notes + SEEDED.tasks);
  });

  it('D13: a second run changes no count of the eight tables, says «ya estaba» for each account and keeps the key', async () => {
    const before = await tableCounts(db().pool);
    const second = await seed(seedEnv(db().name, keyFile));
    expect(second.code, second.err).toBe(0);
    expect(second.out).toContain('escuela-andamio: ya estaba; no se tocó');
    expect(second.out).toContain('cuenta-vecina: ya estaba; no se tocó');
    expect(second.out).toContain('Llave del agente sin cambios');
    expect(await tableCounts(db().pool)).toEqual(before);
  });

  it('D15: a second database seeded with the same package has the same rows, ids included, but for three columns', async () => {
    const run = await seed(seedEnv(other().name, newKeyFile()));
    expect(run.code, run.err).toBe(0);
    // The first database was seeded twice; the second run wrote nothing, so the rows still compare.
    expect(await allRows(other().pool)).toEqual(await allRows(db().pool));
  });

  it("D15: the first company of the package has the lowest id, and each date is the package's", async () => {
    const companies = await db().pool.query<{ id: string; name: string }>('SELECT id::text AS id, name FROM crm.companies ORDER BY id');
    expect(companies.rows[0]?.name).toBe(scenario.accounts[0]?.companies[0]?.name);
    const dated = await db().pool.query<{ email: string; created: string }>(
      `SELECT email, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created FROM crm.contacts ORDER BY id`,
    );
    const expected = [...contactsOf('escuela-andamio'), ...contactsOf('cuenta-vecina')].map((row) => ({
      email: row.email,
      created: row.createdAt ?? scenario.createdAt,
    }));
    expect(dated.rows).toEqual(expected);
  });
});

describe('D14 · all or nothing', () => {
  const db = useMigratedDatabase();

  it.each([
    ['the first statement of the second account fails', (_text: string, values: readonly unknown[]) => values[0] === 'cuenta-vecina'],
    ['the COMMIT fails', (text: string) => text === 'COMMIT'],
  ])('%s: 0 rows in the eight tables, no key and no key file or temporary', async (_case, fails) => {
    const keyFile = newKeyFile();
    const env = seedEnv(db().name, keyFile);
    const run = await seed(env, { connect: interceptingConnector(env, fails) });
    expect(run.code).toBe(1);
    expect(Object.values(await tableCounts(db().pool))).toEqual(CRM_TABLES.map(() => 0));
    expect(readdirSync(dirname(keyFile))).toEqual([]);
  });
});

describe('D16 · two seeds at once', () => {
  const db = useMigratedDatabase();

  it('both exit with 0 and leave one set of rows, one live agent key, and that key in the file', async () => {
    const keyFile = newKeyFile();
    const env = seedEnv(db().name, keyFile);
    // The first one holds its COMMIT back, so the second starts while the first's rows are still
    // uncommitted: without the lock it would find no account and collide with 23505.
    const runs = await Promise.all([seed(env, { connect: slowCommitConnector(env, SLOW_COMMIT_MS) }), seed(env)]);
    expect(runs.map((run) => run.code), runs.map((run) => run.err).join('\n')).toEqual([0, 0]);
    const counts = await tableCounts(db().pool);
    expect({ companies: counts['companies'], contacts: counts['contacts'], notes: counts['notes'], tasks: counts['tasks'] }).toEqual(SEEDED);
    const live = await db().pool.query<{ hash: Buffer }>('SELECT key_hash AS hash FROM crm.api_keys WHERE label = $1 AND revoked_at IS NULL', [AGENT_KEY_LABEL]);
    expect(live.rowCount).toBe(1);
    expect(existsSync(keyFile)).toBe(true);
    expect(sha256(readFileSync(keyFile, 'utf8').trimEnd()).equals(live.rows[0]?.hash ?? Buffer.alloc(0))).toBe(true);
  });
});
