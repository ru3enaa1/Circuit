import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';

import type { Scenario } from '../../apps/crm/src/scenario.ts';
import { readAdminConnection } from '../connection.ts';
import { readLocalEnv, type Env } from '../env.ts';
import type { AdminClient, ConnectAdmin } from '../keys.ts';
import { runSeed, runSeedCommand, type SeedDeps } from '../seed.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// What the tests of db:seed (ADR-0009 D11–D22) share. Every key file goes to a temporary folder
// of the system, never to .secrets/, and every database is a disposable one.

/** The real package; the tests may name it, the code may not (D7). */
export const REAL_SCENARIO = 'escuela';
export const CRM_TABLES = ['accounts', 'api_keys', 'pipeline_stages', 'companies', 'contacts', 'notes', 'tasks', 'audit_log'] as const;
/**
 * The time every test that seeds gets, as its last argument (audit of ADR-0009, H1). Vitest's
 * 5 s ran out: with every file running at once, coverage on and docker busy with the backup
 * tests, a seed of the real package and the reading of its rows took 5 124 ms once in five runs.
 * A seed takes well under a second when warm, so the budget is generous, as the hooks' is; a
 * test that really hangs still fails, a minute later. hook-budget.test.ts proves each such test
 * carries it.
 */
export const SEED_TEST_TIMEOUT_MS = 60_000;
/** A key anywhere in a text, written here and not taken from API_KEY_SHAPE. */
export const KEY_IN_TEXT = /crmk_[A-Za-z0-9_-]{43}/;

/** Every folder newKeyFile made in this test file, so removeKeyFiles leaves none behind (audit of ADR-0009, H8). */
const keyFolders: string[] = [];

/** A key file in a folder of its own, so a test can check that nothing else is left beside it. */
export function newKeyFile(): string {
  const folder = mkdtempSync(join(tmpdir(), 'circuit-seed-'));
  keyFolders.push(folder);
  return join(folder, 'crm-agent-key');
}

/** For each file's afterAll: the keys in them open databases that are gone, but they are still keys. */
export function removeKeyFiles(): void {
  for (const folder of keyFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
}

export function seedEnv(database: string, keyFile: string): Env {
  return { ...readLocalEnv(), POSTGRES_DB: database, CIRCUIT_SCENARIO: REAL_SCENARIO, CRM_AGENT_KEY_FILE: keyFile };
}

export interface SeedRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function capture(): { readonly lines: { out: string[]; err: string[] }; readonly out: Pick<Console, 'log' | 'error'> } {
  const lines = { out: [] as string[], err: [] as string[] };
  return { lines, out: { log: (line: string) => lines.out.push(line), error: (line: string) => lines.err.push(line) } };
}

/** `npm run db:seed` as its function. */
export async function seed(env: Env, deps: Omit<SeedDeps, 'out'> = {}): Promise<SeedRun> {
  const { lines, out } = capture();
  const code = await runSeedCommand([], env, { ...deps, out });
  return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
}

/** The seed of a package already parsed, past the format: how a test reaches the database's own refusals. */
export async function seedParsed(scenario: Scenario, keyFile: string, env: Env, deps: Omit<SeedDeps, 'out'> = {}): Promise<SeedRun> {
  const { lines, out } = capture();
  const code = await runSeed(scenario, keyFile, env, { ...deps, out });
  return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
}

/** Rows per crm table, read as the admin past every policy. */
export async function tableCounts(pool: pg.Pool): Promise<Record<string, number>> {
  const columns = CRM_TABLES.map((table) => `(SELECT count(*) FROM crm.${table})::int AS ${table}`).join(', ');
  return (await pool.query<Record<string, number>>(`SELECT ${columns}`)).rows[0] ?? {};
}

/**
 * The admin of `env`, whose COMMIT waits `ms` first: a seed beside it is sure to reach its own
 * check of the accounts while this one still holds its rows uncommitted (D16).
 */
export function slowCommitConnector(env: Env, ms: number): ConnectAdmin {
  return async () => {
    const client = new pg.Client(readAdminConnection(env));
    await client.connect();
    const query = async (text: string, values?: unknown[]) => {
      if (text === 'COMMIT') await new Promise((resolve) => setTimeout(resolve, ms));
      return client.query(text, values);
    };
    return { query, end: () => client.end() } as AdminClient;
  };
}

/** The admin of `env`, with `before` awaited ahead of each statement: how a test makes another session act at a chosen moment. */
export function hookedConnector(env: Env, before: (text: string, values: readonly unknown[]) => Promise<void>): ConnectAdmin {
  return async () => {
    const client = new pg.Client(readAdminConnection(env));
    await client.connect();
    const query = async (text: string, values?: unknown[]) => {
      await before(text, values ?? []);
      return client.query(text, values);
    };
    return { query, end: () => client.end() } as AdminClient;
  };
}

/**
 * The admin of `env`, with every statement shown to `fails` first: when it says so, that statement
 * fails on purpose and never reaches the database. Each error the database itself raises is kept
 * in `errors`, so a test can show what it carried.
 */
export function interceptingConnector(env: Env, fails: (text: string, values: readonly unknown[]) => boolean, errors: unknown[] = []): ConnectAdmin {
  return async () => {
    const client = new pg.Client(readAdminConnection(env));
    await client.connect();
    const query = async (text: string, values?: unknown[]) => {
      if (fails(text, values ?? [])) throw new Error('falla plantada por la prueba');
      return client.query(text, values).catch((error: unknown) => {
        errors.push(error);
        throw error;
      });
    };
    return { query, end: () => client.end() } as AdminClient;
  };
}

/** A migrated disposable database, made in beforeAll and dropped in afterAll of the calling describe. */
export function useMigratedDatabase(migrate = true): () => DisposableDatabase {
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
