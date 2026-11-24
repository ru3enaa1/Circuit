import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, SERVICE_ROLES, SERVICE_SCHEMAS } from '../config.js';
import { inTransaction, sqlErrorOf } from './crm-fixture.js';
import { createDisposableDatabase, MIGRATIONS_PATH, runMigrations, type DisposableDatabase } from './disposable-db.js';
import { readMigrationFolder } from './migration-rules.js';

// Each run creates its own databases, migrates them and drops them (disposable-db.ts).

const expectedCount = readMigrationFolder(MIGRATIONS_PATH).journal.length;

// Set to 1 only by the CI step that runs the race below on a server that has never had the
// roles (ci.yml). Without it, the race passes on any server where the roles already exist,
// without racing (audit H1 a); with it, that case fails instead.
const FRESH_ROLES_EXPECTED = process.env['CIRCUIT_FRESH_ROLES'] === '1';

const SECURITY_MIGRATION = '0002_crm_security.sql';
const ROLE_GUARD_MESSAGE = 'crm: un rol de servicio ya existe con atributos o membresías de más';
const RAISE_EXCEPTION = 'P0001';

/** The guard of 0002 as written: the one statement that raises ROLE_GUARD_MESSAGE. */
function roleGuardStatement(): string {
  const found = readFileSync(join(MIGRATIONS_PATH, SECURITY_MIGRATION), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.includes(ROLE_GUARD_MESSAGE));
  if (found.length !== 1) {
    throw new Error(`Se esperaba una sola guarda de roles en ${SECURITY_MIGRATION}; hay ${found.length}.`);
  }
  return found[0]!;
}

/** The service roles on the server, and whether each has anything it should not. */
async function serviceRolesIn(pool: pg.Pool): Promise<{ rolname: string; risky: boolean }[]> {
  const result = await pool.query<{ rolname: string; risky: boolean }>(
    `SELECT r.rolname,
            r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
              OR EXISTS (SELECT 1 FROM pg_auth_members AS m WHERE m.member = r.oid) AS risky
     FROM pg_roles AS r WHERE r.rolname = ANY($1) ORDER BY r.rolname`,
    [Object.values(SERVICE_ROLES)],
  );
  return result.rows;
}

const CLEAN_ROLES = [
  { rolname: SERVICE_ROLES.circuit, risky: false },
  { rolname: SERVICE_ROLES.crm, risky: false },
];

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
    if (FRESH_ROLES_EXPECTED) {
      expect(await serviceRolesIn(databases[0]!.pool), 'CIRCUIT_FRESH_ROLES=1: con los roles ya creados no hay carrera').toEqual([]);
    }
    await Promise.all(databases.map((db) => runMigrations(db.pool)));
    for (const db of databases) {
      expect(await appliedMigrationCount(db.pool)).toBe(expectedCount);
    }
  });

  it('leaves the service roles without login, admin attributes or memberships', async () => {
    expect(await serviceRolesIn(databases[0]!.pool)).toEqual(CLEAN_ROLES);
  });
});

// ADR-0005 D14, audit H1 b: a service role found with login, an admin attribute or a
// membership stops the migration. Each case changes a real role, because roles belong to
// the server, inside a transaction that is always rolled back: no other connection sees
// the change, and the last case proves nothing was left behind.
describe('the role guard of 0002', () => {
  let db: DisposableDatabase | undefined;

  beforeAll(async () => {
    db = await createDisposableDatabase();
    await runMigrations(db.pool);
  });

  afterAll(async () => {
    await db?.drop();
  });

  const runGuard = (setup?: string): Promise<void> =>
    inTransaction(db!.pool, {}, async (client) => {
      if (setup !== undefined) await client.query(setup);
      await client.query(roleGuardStatement());
    });

  it('lets clean roles through (control)', async () => {
    await expect(runGuard()).resolves.toBeUndefined();
  });

  // The role names are constants from config.ts, never input.
  it.each([
    ['crm_service can log in', `ALTER ROLE ${SERVICE_ROLES.crm} LOGIN`],
    ['crm_service is a member of another role', `GRANT pg_read_all_data TO ${SERVICE_ROLES.crm}`],
    ['circuit_service bypasses row-level security', `ALTER ROLE ${SERVICE_ROLES.circuit} BYPASSRLS`],
  ])('stops the migration when %s', async (_case, setup) => {
    const error = await sqlErrorOf(() => runGuard(setup));
    expect(error.code).toBe(RAISE_EXCEPTION);
    expect(error.message).toBe(ROLE_GUARD_MESSAGE);
  });

  it('leaves both roles as they were', async () => {
    expect(await serviceRolesIn(db!.pool)).toEqual(CLEAN_ROLES);
  });
});
