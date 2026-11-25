import { createHash } from 'node:crypto';

import pg from 'pg';

import { SERVICE_ROLES } from '../config.ts';

// Helpers for the crm database tests (ADR-0005). Everything here is synthetic: two invented
// accounts, with addresses under .test, a domain reserved for tests (RFC 6761).

/** The settings 0002_crm_security.sql reads; F1.2 will set them the same way, per transaction. */
const CONTEXT_SETTINGS = {
  accountId: 'crm.account_id',
  apiKeyId: 'crm.api_key_id',
  proposedBy: 'crm.proposed_by',
  approvedBy: 'crm.approved_by',
  approvalRef: 'crm.approval_ref',
} as const;

export type CrmContext = Partial<Record<keyof typeof CONTEXT_SETTINGS, string>>;
export type ServiceRole = (typeof SERVICE_ROLES)[keyof typeof SERVICE_ROLES];

/** Who signs the fixture's own writes: the trigger refuses a write without both (D8). */
export const FIXTURE_AUTHORS = { proposedBy: 'fixture', approvedBy: 'fixture' } as const;

const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(SERVICE_ROLES));

async function applyContext(client: pg.PoolClient, role: ServiceRole | undefined, context: CrmContext): Promise<void> {
  if (role !== undefined) {
    // The only identifier put into SQL text, and only one of the two known roles.
    if (!KNOWN_ROLES.has(role)) throw new Error(`Rol desconocido: ${role}`);
    await client.query(`SET LOCAL ROLE ${role}`);
  }
  for (const [key, value] of Object.entries(context)) {
    const setting = CONTEXT_SETTINGS[key as keyof typeof CONTEXT_SETTINGS];
    await client.query('SELECT set_config($1, $2, true)', [setting, value]);
  }
}

/**
 * Runs `work` in one transaction, as `role` (the admin when undefined) and with `context`
 * set for that transaction only. Rolled back unless `commit` is set, so tests do not see
 * each other's writes.
 */
export async function inTransaction<T>(
  pool: pg.Pool,
  options: { readonly role?: ServiceRole; readonly context?: CrmContext; readonly commit?: boolean },
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await applyContext(client, options.role, options.context ?? {});
    const result = await work(client);
    await client.query(options.commit === true ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** The database error `action` raises, to check its SQLSTATE. Fails when it raises none, or another kind. */
export async function sqlErrorOf(action: () => Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  }
  throw new Error('Se esperaba un error de PostgreSQL y la sentencia pasó.');
}

export function sha256(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

export interface FixtureAccount {
  readonly id: string;
  readonly slug: string;
  readonly apiKeyId: string;
  readonly apiKey: string;
  readonly stageId: string;
  readonly companyId: string;
  readonly contactId: string;
  readonly email: string;
}

export interface Fixture {
  readonly a: FixtureAccount;
  readonly b: FixtureAccount;
  /** A revoked key of account a: resolve_api_key must not return it. */
  readonly revokedApiKey: string;
}

async function insertId(client: pg.PoolClient, text: string, values: readonly unknown[]): Promise<string> {
  const result = await client.query<{ id: string }>(text, [...values]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('La inserción de la semilla de prueba no devolvió un id.');
  return id;
}

async function seedAccount(client: pg.PoolClient, slug: string): Promise<FixtureAccount> {
  const apiKey = `test-key-${slug}`;
  const email = `contacto@${slug}.test`;
  const id = await insertId(client, 'INSERT INTO crm.accounts (slug, name) VALUES ($1, $2) RETURNING id', [
    slug,
    `Cuenta ${slug}`,
  ]);
  const apiKeyId = await insertId(
    client,
    "INSERT INTO crm.api_keys (account_id, label, key_hash, permissions) VALUES ($1, 'agente', $2, '{read,write}') RETURNING id",
    [id, sha256(apiKey)],
  );
  const stageId = await insertId(
    client,
    "INSERT INTO crm.pipeline_stages (account_id, key, label, position) VALUES ($1, 'nueva', 'Nueva solicitud', 0) RETURNING id",
    [id],
  );
  const companyId = await insertId(client, 'INSERT INTO crm.companies (account_id, name) VALUES ($1, $2) RETURNING id', [
    id,
    `Empresa de ${slug}`,
  ]);
  const contactId = await insertId(
    client,
    'INSERT INTO crm.contacts (account_id, company_id, stage_id, full_name, email) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [id, companyId, stageId, `Contacto de ${slug}`, email],
  );
  await client.query("INSERT INTO crm.notes (account_id, contact_id, body) VALUES ($1, $2, 'Primera nota')", [id, contactId]);
  await client.query("INSERT INTO crm.tasks (account_id, contact_id, title) VALUES ($1, $2, 'Primera tarea')", [id, contactId]);
  return { id, slug, apiKeyId, apiKey, stageId, companyId, contactId, email };
}

/** Two accounts with one row in every table, committed, written as the admin. */
export async function seedFixture(pool: pg.Pool): Promise<Fixture> {
  return inTransaction(pool, { context: FIXTURE_AUTHORS, commit: true }, async (client) => {
    const a = await seedAccount(client, 'cuenta-a');
    const b = await seedAccount(client, 'cuenta-b');
    const revokedApiKey = 'test-key-revoked';
    await client.query(
      "INSERT INTO crm.api_keys (account_id, label, key_hash, permissions, revoked_at) VALUES ($1, 'revocada', $2, '{read}', now())",
      [a.id, sha256(revokedApiKey)],
    );
    return { a, b, revokedApiKey };
  });
}
