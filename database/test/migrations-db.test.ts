import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, SERVICE_ROLES, SERVICE_SCHEMAS } from '../config.js';
import { createDisposableDatabase, MIGRATIONS_PATH, runMigrations, type DisposableDatabase } from './disposable-db.js';
import { readMigrationFolder } from './migration-rules.js';

// Each run creates its own databases, migrates them and drops them (disposable-db.ts).

const expectedCount = readMigrationFolder(MIGRATIONS_PATH).journal.length;

async function serviceSchemasIn(pool: pg.Pool): Promise<readonly string[]> {
  const result = await pool.query<{ schema_name: string }>(
    'SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1) ORDER BY schema_name',
    [[...SERVICE_SCHEMAS]],
  );
  return result.rows.map((row) => row.schema_name);
}

async function appliedMigrationCount(pool: pg.Pool): Promise<number> {
  // Both identifiers are constants from config.ts, never input.
  const result = await pool.query<{ applied: string }>(
    `SELECT count(*) AS applied FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return Number(result.rows[0]?.applied);
}

describe('migrations on a disposable database', () => {
  let db: DisposableDatabase | undefined;

  beforeAll(async () => {
    db = await createDisposableDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('applies every migration to an empty database, and a second run applies nothing', async () => {
    const pool = db!.pool;
    // A new database is copied from template1; this proves the schemas come from the migrations.
    expect(await serviceSchemasIn(pool)).toEqual([]);

    await runMigrations(pool);
    expect(await serviceSchemasIn(pool)).toEqual([...SERVICE_SCHEMAS].sort());
    expect(await appliedMigrationCount(pool)).toBe(expectedCount);

    await runMigrations(pool);
    expect(await appliedMigrationCount(pool)).toBe(expectedCount);
  });
});

// ADR-0005 D14: roles belong to the whole server, so two databases migrating at the same
// moment both try to create them. Both must finish, and the roles must stay NOLOGIN.
describe('two disposable databases migrating at once', () => {
  const databases: DisposableDatabase[] = [];

  beforeAll(async () => {
    // allSettled, so a database already created is still dropped when the other one fails.
    const created = await Promise.allSettled([createDisposableDatabase(), createDisposableDatabase()]);
    for (const outcome of created) {
      if (outcome.status === 'fulfilled') databases.push(outcome.value);
    }
    const failure = created.find((outcome) => outcome.status === 'rejected');
    if (failure) throw failure.reason;
  });

  afterAll(async () => {
    await Promise.all(databases.map((db) => db.drop()));
  });

  it('both apply every migration', async () => {
    expect(databases).toHaveLength(2);
    await Promise.all(databases.map((db) => runMigrations(db.pool)));
    for (const db of databases) {
      expect(await appliedMigrationCount(db.pool)).toBe(expectedCount);
    }
  });

  it('leaves the service roles without login or admin attributes', async () => {
    const result = await databases[0]!.pool.query<{ rolname: string; risky: boolean }>(
      `SELECT rolname,
              rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS risky
       FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [Object.values(SERVICE_ROLES)],
    );
    expect(result.rows).toEqual([
      { rolname: SERVICE_ROLES.circuit, risky: false },
      { rolname: SERVICE_ROLES.crm, risky: false },
    ]);
  });
});
