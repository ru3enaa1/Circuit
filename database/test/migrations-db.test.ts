import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MIGRATIONS_DIR,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  REPO_ROOT,
  SERVICE_SCHEMAS,
} from '../config.js';
import { readAdminConnection, type AdminConnection } from '../connection.js';
import { readLocalEnv } from '../env.js';
import { readMigrationFolder } from './migration-rules.js';

// Each run creates its own database, migrates it and drops it. The development database
// named in .env is never opened (CLAUDE.md §7: tests use disposable databases).

const TEST_DB_PREFIX = 'circuit_test_';
const TEST_DB_SUFFIX_BYTES = 6;
const TEST_DB_NAME = /^circuit_test_[0-9a-f]{12}$/;
// Present in every PostgreSQL cluster; CREATE and DROP DATABASE are issued from it.
const MAINTENANCE_DB = 'postgres';

const MIGRATIONS_PATH = join(REPO_ROOT, MIGRATIONS_DIR);

/** The only identifier this file puts into SQL text; anything but a test database is refused. */
function testDatabase(name: string): string {
  if (!TEST_DB_NAME.test(name)) {
    throw new Error(`Solo se crean o borran bases de prueba desechables; se rechazó «${name}».`);
  }
  return `"${name}"`;
}

async function connectOrExplain(client: pg.Client, connection: AdminConnection): Promise<void> {
  try {
    await client.connect();
  } catch (cause) {
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${connection.host}:${connection.port}. ` +
        '¿Está levantado? docker compose up -d --wait db',
      { cause },
    );
  }
}

async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: MIGRATIONS_PATH,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}

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
  const connection = readAdminConnection(readLocalEnv());
  const databaseName = `${TEST_DB_PREFIX}${randomBytes(TEST_DB_SUFFIX_BYTES).toString('hex')}`;
  const expectedCount = readMigrationFolder(MIGRATIONS_PATH).journal.length;
  const admin = new pg.Client({ ...connection, database: MAINTENANCE_DB });
  // A pool does not connect until its first query, so building it here is safe.
  const pool = new pg.Pool({ ...connection, database: databaseName, max: 1 });
  let created = false;

  beforeAll(async () => {
    await connectOrExplain(admin, connection);
    await admin.query(`CREATE DATABASE ${testDatabase(databaseName)}`);
    created = true;
  });

  afterAll(async () => {
    await pool.end();
    if (created) {
      // WITH (FORCE) closes any connection a failed test left open.
      await admin.query(`DROP DATABASE IF EXISTS ${testDatabase(databaseName)} WITH (FORCE)`);
      const left = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      expect(left.rowCount, 'the disposable database must be gone').toBe(0);
    }
    await admin.end();
  });

  it('applies every migration to an empty database, and a second run applies nothing', async () => {
    // A new database is copied from template1; this proves the schemas come from the migrations.
    expect(await serviceSchemasIn(pool)).toEqual([]);

    await runMigrations(pool);
    expect(await serviceSchemasIn(pool)).toEqual([...SERVICE_SCHEMAS].sort());
    expect(await appliedMigrationCount(pool)).toBe(expectedCount);

    await runMigrations(pool);
    expect(await appliedMigrationCount(pool)).toBe(expectedCount);
  });
});
