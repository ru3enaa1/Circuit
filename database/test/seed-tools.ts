import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';

import type { Scenario } from '../../apps/crm/src/scenario.ts';
import { readAdminConnection } from '../connection.ts';
import { readLocalEnv, type Env } from '../env.ts';
import type { AdminClient, ConnectAdmin } from '../keys.ts';
import { runSeed, runSeedCommand, type SeedDeps } from '../seed.ts';

// What the tests of db:seed (ADR-0009 D11–D22) share. Every key file goes to a temporary folder
// of the system, never to .secrets/, and every database is a disposable one.

/** The real package; the tests may name it, the code may not (D7). */
export const REAL_SCENARIO = 'escuela';
export const CRM_TABLES = ['accounts', 'api_keys', 'pipeline_stages', 'companies', 'contacts', 'notes', 'tasks', 'audit_log'] as const;
/** A key anywhere in a text, written here and not taken from API_KEY_SHAPE. */
export const KEY_IN_TEXT = /crmk_[A-Za-z0-9_-]{43}/;

/** A key file in a folder of its own, so a test can check that nothing else is left beside it. */
export function newKeyFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'circuit-seed-')), 'crm-agent-key');
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
