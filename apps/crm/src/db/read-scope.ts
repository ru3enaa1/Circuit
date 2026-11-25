import { createHash } from 'node:crypto';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { ApiError } from '../server/errors.ts';

// ADR-0006 D9 and D10: every request is one READ ONLY transaction on its own connection. It
// resolves the key by its SHA-256, compares the account of the route with the key's, requires
// `read`, sets the context for this transaction only, reads and ends. Row-level security
// (ADR-0005 D4) stands behind the comparison as a second barrier, and READ ONLY behind the
// grants: a write slipped into a read fails with 25006 before any privilege is checked.

/** The settings 0002_crm_security.sql reads through crm.context_account_id() and the trigger. */
const ACCOUNT_SETTING = 'crm.account_id';
const API_KEY_SETTING = 'crm.api_key_id';
const READ_PERMISSION = 'read';

/** What the pool has to offer: a connection. A test passes one that fails on purpose. */
export interface Connector {
  connect(): Promise<pg.PoolClient>;
}

export interface ReadScope {
  /** The key's account: queries filter by it too, and RLS filters by it again. */
  readonly accountId: number;
  readonly db: NodePgDatabase;
  readonly client: pg.PoolClient;
}

export interface Credentials {
  readonly token: string;
  /** The account slug as the route spells it, still unvalidated: it is only compared. */
  readonly slug: string;
}

interface ResolvedKey {
  readonly apiKeyId: number;
  readonly accountId: number;
  readonly accountSlug: string;
  readonly permissions: readonly string[];
}

/** bigint arrives from pg as text; schema.ts declares ids `mode: 'number'`, so they must fit. */
function toId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new Error('Un id de la base no cabe en un número de JavaScript.');
  return id;
}

async function resolveKey(client: pg.PoolClient, token: string): Promise<ResolvedKey | undefined> {
  const hash = createHash('sha256').update(token).digest();
  const result = await client.query<{ api_key_id: string; account_id: string; account_slug: string; permissions: string[] }>(
    'SELECT api_key_id, account_id, account_slug, permissions FROM crm.resolve_api_key($1)',
    [hash],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    apiKeyId: toId(row.api_key_id),
    accountId: toId(row.account_id),
    accountSlug: row.account_slug,
    permissions: row.permissions,
  };
}

/** D8 and D9, in this order; an unknown key and a revoked one get the same answer. */
function authorize(key: ResolvedKey | undefined, slug: string): ResolvedKey {
  if (key === undefined) throw new ApiError('llave_invalida');
  // Before anything is read, and the same for another account and for a slug that does not exist.
  if (key.accountSlug !== slug) throw new ApiError('cuenta_ajena');
  if (!key.permissions.includes(READ_PERMISSION)) throw new ApiError('sin_permiso');
  return key;
}

export async function withReadScope<T>(
  pool: Connector,
  credentials: Credentials,
  work: (scope: ReadScope) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const key = authorize(await resolveKey(client, credentials.token), credentials.slug);
    // `true`: for this transaction only, so the next request on this connection starts without it.
    await client.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      ACCOUNT_SETTING,
      String(key.accountId),
      API_KEY_SETTING,
      String(key.apiKeyId),
    ]);
    const result = await work({ accountId: key.accountId, db: drizzle({ client }), client });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // The error that ended the request is the one that propagates. If ROLLBACK fails too, the
    // connection is not trusted again: release(true) destroys it instead of returning it.
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
