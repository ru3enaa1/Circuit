import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, REPO_ROOT } from '../config.ts';
import { readAdminConnection, type AdminConnection } from '../connection.ts';
import { readLocalEnv } from '../env.ts';

// Every database test creates its own database, migrates it and drops it. The development
// database named in .env is never opened (CLAUDE.md §7: tests use disposable databases).

const TEST_DB_PREFIX = 'circuit_test_';
const TEST_DB_SUFFIX_BYTES = 6;
const TEST_DB_NAME = /^circuit_test_[0-9a-f]{12}$/;
// Present in every PostgreSQL cluster; CREATE and DROP DATABASE are issued from it.
const MAINTENANCE_DB = 'postgres';

export const MIGRATIONS_PATH = join(REPO_ROOT, MIGRATIONS_DIR);

/**
 * The time every beforeAll and afterAll of a test with a database gets, passed as the
 * hook's second argument. Vitest's default, 10 s, ran out once (audit of ADR-0007, H1): on
 * the first `npm run check` of a session, seven hooks that create a database, migrate it,
 * seed it and create crm_app went past it, with every file running at once and coverage on.
 * Warm runs fit in the default. By how much the cold one went over was not measured, so the
 * budget is generous; a hook that really hangs still fails in this run, a minute later.
 * hook-budget.test.ts proves every such hook carries it: `--hookTimeout` cannot, because
 * Vitest 5.1.1 does not pass it to the projects (CLAUDE.md §8).
 */
export const DATABASE_HOOK_TIMEOUT_MS = 60_000;

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

/**
 * Returns a function that resolves once every client the pool opened has closed its socket.
 * pool.end() resolves as soon as it has asked each idle client to close, not once they have
 * closed (pg-pool 3.14, `_remove`). A DROP ... WITH (FORCE) sent then could terminate a
 * backend that is still closing, and its client would raise an unhandled 57P01 that turns
 * a green run red: 2 runs in 10 on 2026-11-24. 'remove' fires after the socket has closed.
 */
function closedClients(pool: pg.Pool): () => Promise<void> {
  let open = 0;
  const waiting: (() => void)[] = [];
  pool.on('connect', () => {
    open += 1;
  });
  pool.on('remove', () => {
    open -= 1;
    if (open === 0) for (const resolve of waiting.splice(0)) resolve();
  });
  return () => (open === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve)));
}

export interface DisposableDatabase {
  readonly name: string;
  /** Connects as the admin from .env, a superuser that sees past every policy. */
  readonly pool: pg.Pool;
  readonly connection: AdminConnection;
  /**
   * A pool on this database as another user, such as crm_app (ADR-0006). drop() ends it and
   * waits for its sockets first, for the same reason as the admin pool's.
   */
  poolAs(user: string, password: string, max?: number): pg.Pool;
  /** Drops the database, closing any connection a failed test left open, and checks it is gone. */
  drop(): Promise<void>;
}

const DEFAULT_POOL_SIZE = 2;

/**
 * ADR-0009: a name for a database that a command under test creates itself, such as the
 * target of db:restore, in the only form dropTestDatabase accepts.
 */
export function newTestDatabaseName(): string {
  return `${TEST_DB_PREFIX}${randomBytes(TEST_DB_SUFFIX_BYTES).toString('hex')}`;
}

/**
 * Drops a test database that a test named but did not create with createDisposableDatabase,
 * if it exists, and checks it is gone. Close every connection to it first: FORCE would end a
 * backend that is still closing (see closedClients).
 */
export async function dropTestDatabase(name: string): Promise<void> {
  const connection = readAdminConnection(readLocalEnv());
  const admin = new pg.Client({ ...connection, database: MAINTENANCE_DB });
  await connectOrExplain(admin, connection);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${testDatabase(name)} WITH (FORCE)`);
    const left = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (left.rowCount !== 0) throw new Error(`La base de prueba ${name} sigue ahí.`);
  } finally {
    await admin.end();
  }
}

/** Whether a database of that name exists on the server: what a refused restore must not leave. */
export async function databaseExists(name: string): Promise<boolean> {
  const connection = readAdminConnection(readLocalEnv());
  const admin = new pg.Client({ ...connection, database: MAINTENANCE_DB });
  await connectOrExplain(admin, connection);
  try {
    return (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 1;
  } finally {
    await admin.end();
  }
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
  const pool = new pg.Pool({ ...connection, database: name, max: DEFAULT_POOL_SIZE });
  const pools: { readonly pool: pg.Pool; readonly allClosed: () => Promise<void> }[] = [
    { pool, allClosed: closedClients(pool) },
  ];

  function poolAs(user: string, password: string, max: number = DEFAULT_POOL_SIZE): pg.Pool {
    const other = new pg.Pool({ ...connection, user, password, database: name, max });
    pools.push({ pool: other, allClosed: closedClients(other) });
    return other;
  }

  async function drop(): Promise<void> {
    // A test may have ended its own pool already; ending one twice rejects.
    await Promise.all(pools.map(async (entry) => (entry.pool.ended ? undefined : entry.pool.end())));
    await Promise.all(pools.map((entry) => entry.allClosed()));
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${testDatabase(name)} WITH (FORCE)`);
      const left = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (left.rowCount !== 0) throw new Error(`La base desechable ${name} sigue ahí.`);
    } finally {
      await admin.end();
    }
  }

  return { name, pool, connection, poolAs, drop };
}
