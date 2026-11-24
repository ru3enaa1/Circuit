import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, REPO_ROOT } from '../config.js';
import { readAdminConnection, type AdminConnection } from '../connection.js';
import { readLocalEnv } from '../env.js';

// Every database test creates its own database, migrates it and drops it. The development
// database named in .env is never opened (CLAUDE.md §7: tests use disposable databases).

const TEST_DB_PREFIX = 'circuit_test_';
const TEST_DB_SUFFIX_BYTES = 6;
const TEST_DB_NAME = /^circuit_test_[0-9a-f]{12}$/;
// Present in every PostgreSQL cluster; CREATE and DROP DATABASE are issued from it.
const MAINTENANCE_DB = 'postgres';

export const MIGRATIONS_PATH = join(REPO_ROOT, MIGRATIONS_DIR);

/** The only identifier this module puts into SQL text; anything but a test database is refused. */
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

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: MIGRATIONS_PATH,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}

export interface DisposableDatabase {
  readonly name: string;
  /** Connects as the admin from .env, which owns every object the migrations create. */
  readonly pool: pg.Pool;
  readonly connection: AdminConnection;
  /** Drops the database, closing any connection a failed test left open, and checks it is gone. */
  drop(): Promise<void>;
}

/** An empty database (copied from template1, so nothing in it comes from the migrations). */
export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const connection = readAdminConnection(readLocalEnv());
  const name = `${TEST_DB_PREFIX}${randomBytes(TEST_DB_SUFFIX_BYTES).toString('hex')}`;
  const admin = new pg.Client({ ...connection, database: MAINTENANCE_DB });
  await connectOrExplain(admin, connection);
  try {
    await admin.query(`CREATE DATABASE ${testDatabase(name)}`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  // A pool does not connect until its first query, so building it here is safe.
  const pool = new pg.Pool({ ...connection, database: name, max: 2 });

  async function drop(): Promise<void> {
    await pool.end();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${testDatabase(name)} WITH (FORCE)`);
      const left = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (left.rowCount !== 0) throw new Error(`La base desechable ${name} sigue ahí.`);
    } finally {
      await admin.end();
    }
  }

  return { name, pool, connection, drop };
}
