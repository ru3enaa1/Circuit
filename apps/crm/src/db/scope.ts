import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { hashApiKey, KEY_AUTHOR_PREFIX, type Credentials } from '../keys.ts';
import { ApiError, type Permission } from '../server/errors.ts';

// The transaction every request runs in, one per request on its own connection. It resolves
// the key by its SHA-256, compares the account of the route with the key's, requires the
// route's permission, sets the context for this transaction only, works and ends. Row-level
// security (ADR-0005 D4) stands behind the comparison as a second barrier.
//
// Reads (ADR-0006 D9, D10) run READ ONLY and set no author: a write slipped into a read fails
// with 25006 before any privilege is checked. Writes (ADR-0007 D3, D4) run READ WRITE, and
// parse their input only once the key, the account and the permission have passed, because the
// approval the trigger records comes from that input.

/** The settings 0002_crm_security.sql reads through crm.context_account_id() and the trigger. */
const ACCOUNT_SETTING = 'crm.account_id';
const API_KEY_SETTING = 'crm.api_key_id';
const PROPOSED_BY_SETTING = 'crm.proposed_by';
const APPROVED_BY_SETTING = 'crm.approved_by';
const APPROVAL_REF_SETTING = 'crm.approval_ref';

// `true` in every set_config: for this transaction only, so the next request on this
// connection starts without an account and without authors.
const READ_CONTEXT = 'SELECT set_config($1, $2, true), set_config($3, $4, true)';
const WRITE_CONTEXT =
  'SELECT set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true), set_config($7, $8, true), set_config($9, $10, true)';

/** What the pool has to offer: a connection. A test passes one that fails on purpose. */
export interface Connector {
  connect(): Promise<pg.PoolClient>;
}

export interface Scope {
  /** The key's account: queries filter by it too, and RLS filters by it again. */
  readonly accountId: number;
  readonly db: NodePgDatabase;
  readonly client: pg.PoolClient;
}

/**
 * What a READ ONLY transaction may require (ADR-0008 D11): the reads take `read`, the export
 * `export`. A write never runs on these, nor a read on `write` or `delete`.
 */
export type ReadPermission = Extract<Permission, 'read' | 'export'>;
export type WritePermission = Extract<Permission, 'write' | 'delete'>;

/** ADR-0007 D7: who approved a write and the approval it came from, already validated by input.ts. */
export interface Approval {
  readonly approvedBy: string;
  readonly approvalRef: string;
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
  const hash = hashApiKey(token);
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

/** ADR-0006 D8 and D9, then the route's permission (ADR-0007 D2), in this order. */
function authorize(key: ResolvedKey | undefined, slug: string, permission: Permission): ResolvedKey {
  // An unknown key and a revoked one get the same answer.
  if (key === undefined) throw new ApiError('llave_invalida');
  // Before anything is read, and the same for another account and for a slug that does not exist.
  if (key.accountSlug !== slug) throw new ApiError('cuenta_ajena');
  if (!key.permissions.includes(permission)) throw new ApiError('sin_permiso', permission);
  return key;
}

const BEGIN = {
  read: 'BEGIN TRANSACTION READ ONLY',
  write: 'BEGIN TRANSACTION READ WRITE',
} as const;

/** One transaction on its own connection, with the key authorized before `run` is called. */
async function inTransaction<T>(
  pool: Connector,
  access: keyof typeof BEGIN,
  credentials: Credentials,
  permission: Permission,
  run: (client: pg.PoolClient, key: ResolvedKey) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query(BEGIN[access]);
    const key = authorize(await resolveKey(client, credentials.token), credentials.slug, permission);
    const result = await run(client, key);
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

const scopeOf = (client: pg.PoolClient, key: ResolvedKey): Scope => ({ accountId: key.accountId, db: drizzle({ client }), client });

/**
 * ADR-0006 D10: READ ONLY, with the account and the key set, and no author. `permission` is
 * the route's: `read` unless the route says otherwise, and only the export says `export`.
 */
export function withReadScope<T>(
  pool: Connector,
  credentials: Credentials,
  work: (scope: Scope) => Promise<T>,
  permission: ReadPermission = 'read',
): Promise<T> {
  return inTransaction(pool, 'read', credentials, permission, async (client, key) => {
    await client.query(READ_CONTEXT, [ACCOUNT_SETTING, String(key.accountId), API_KEY_SETTING, String(key.apiKeyId)]);
    return work(scopeOf(client, key));
  });
}

/**
 * ADR-0007 D3 and D4: READ WRITE. `parse` reads the request only after the key, the account and
 * the permission have passed (D3), and the context is set from the key and from the approval it
 * returns, and from nothing else: the proposer is the key (D5), never a field of the request.
 */
export function withWriteScope<I extends { readonly approval: Approval }, T>(
  pool: Connector,
  credentials: Credentials,
  permission: WritePermission,
  parse: () => I,
  work: (scope: Scope, input: I) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, 'write', credentials, permission, async (client, key) => {
    const input = parse();
    await client.query(WRITE_CONTEXT, [
      ACCOUNT_SETTING,
      String(key.accountId),
      API_KEY_SETTING,
      String(key.apiKeyId),
      PROPOSED_BY_SETTING,
      `${KEY_AUTHOR_PREFIX}${key.apiKeyId}`,
      APPROVED_BY_SETTING,
      input.approval.approvedBy,
      APPROVAL_REF_SETTING,
      input.approval.approvalRef,
    ]);
    return work(scopeOf(client, key), input);
  });
}
