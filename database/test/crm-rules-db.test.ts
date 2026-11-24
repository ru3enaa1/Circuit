import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDITED_TABLES } from '../../apps/crm/src/db/schema.js';
import { SERVICE_ROLES } from '../config.js';
import {
  FIXTURE_AUTHORS,
  inTransaction,
  seedFixture,
  sha256,
  sqlErrorOf,
  type CrmContext,
  type Fixture,
  type ServiceRole,
} from './crm-fixture.js';
import { createDisposableDatabase, runMigrations, type DisposableDatabase } from './disposable-db.js';

// ADR-0005, the rules as behaviour: real statements against a migrated disposable database
// with two synthetic accounts. Every negative case checks the SQLSTATE, so a statement that
// fails for another reason (a typo, a missing row) does not pass for the right one.

const SQLSTATE = {
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  uniqueViolation: '23505',
  insufficientPrivilege: '42501',
  invalidText: '22P02',
  raiseException: 'P0001',
} as const;

const WITHOUT_AUTHOR = 'crm: escritura sin autor';
// 42501 alone would also pass for a missing privilege; this part of the message only comes
// from a policy check (audit H2).
const RLS_REJECTION = /row-level security policy/;

/** Tables crm_service can read; api_keys is not one of them (D10). */
const READABLE_TABLES = ['accounts', 'pipeline_stages', 'companies', 'contacts', 'notes', 'tasks', 'audit_log'];

const crm = SERVICE_ROLES.crm;

let db: DisposableDatabase | undefined;
let fixture: Fixture;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  fixture = await seedFixture(db.pool);
});

afterAll(async () => {
  await db?.drop();
});

const pool = (): pg.Pool => db!.pool;

/** What F1.2 will set for a write the agent proposed and the mentor approved, in account a. */
function ownContext(): CrmContext {
  return {
    accountId: fixture.a.id,
    apiKeyId: fixture.a.apiKeyId,
    proposedBy: 'agente',
    approvedBy: 'mentor',
    approvalRef: 'aprobacion-1',
  };
}

function asCrmService<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool(), { role: crm, context: ownContext() }, work);
}

function errorOf(
  options: { readonly role?: ServiceRole; readonly context?: CrmContext },
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.DatabaseError> {
  return sqlErrorOf(() => inTransaction(pool(), options, (client) => client.query(text, [...values])));
}

async function accountIdsIn(client: pg.PoolClient, table: string): Promise<string[]> {
  // `table` comes from READABLE_TABLES, a constant, never from input.
  const id = table === 'accounts' ? 'id' : 'account_id';
  const result = await client.query<{ account: string }>(`SELECT DISTINCT ${id} AS account FROM crm.${table}`);
  return result.rows.map((row) => row.account);
}

function expectRlsRejection(error: pg.DatabaseError): void {
  expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
  expect(error.message).toMatch(RLS_REJECTION);
}

async function countOf(client: pg.PoolClient, table: 'contacts' | 'audit_log'): Promise<number> {
  const result = await client.query<{ n: string }>(`SELECT count(*) AS n FROM crm.${table}`);
  return Number(result.rows[0]?.n);
}

describe('D3 · foreign keys carry the account', () => {
  it("rejects a note of account a that points at account b's contact", async () => {
    const error = await errorOf(
      { context: FIXTURE_AUTHORS },
      "INSERT INTO crm.notes (account_id, contact_id, body) VALUES ($1, $2, 'cruzada')",
      [fixture.a.id, fixture.b.contactId],
    );
    expect(error.code).toBe(SQLSTATE.foreignKeyViolation);
    expect(error.constraint).toBe('notes_contact_fk');
  });
});

describe('D4 · crm_service reads only its own account', () => {
  it.each(READABLE_TABLES)('%s: only the rows of the account in crm.account_id', async (table) => {
    expect(await asCrmService((client) => accountIdsIn(client, table))).toEqual([fixture.a.id]);
  });

  it.each([
    ['unset', {}],
    ['empty', { accountId: '' }],
  ])('%s account: 0 rows in every table', async (_case, context: CrmContext) => {
    const seen = await inTransaction(pool(), { role: crm, context }, async (client) => {
      // One query at a time: a client runs its queries in sequence.
      const found: string[] = [];
      for (const table of READABLE_TABLES) found.push(...(await accountIdsIn(client, table)));
      return found;
    });
    expect(seen).toEqual([]);
  });

  it('a value that is not an id fails instead of matching anything', async () => {
    const error = await errorOf({ role: crm, context: { accountId: '1 OR true' } }, 'SELECT id FROM crm.contacts');
    expect(error.code).toBe(SQLSTATE.invalidText);
  });
});

describe('D4 · crm_service writes only its own account', () => {
  it('rejects inserting a row in account b while account a is set', async () => {
    const error = await errorOf({ role: crm, context: ownContext() }, 'INSERT INTO crm.companies (account_id, name) VALUES ($1, $2)', [
      fixture.b.id,
      'Intrusa',
    ]);
    expectRlsRejection(error);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ] as const)('rejects any insert while the account is %s', async (_case, accountId) => {
    // Signed and with a key, so only the missing account can stop it.
    const signed: CrmContext = { apiKeyId: fixture.a.apiKeyId, proposedBy: 'agente', approvedBy: 'mentor' };
    const context = accountId === undefined ? signed : { ...signed, accountId };
    const error = await errorOf({ role: crm, context }, 'INSERT INTO crm.companies (account_id, name) VALUES ($1, $2)', [
      fixture.a.id,
      'Sin cuenta',
    ]);
    expectRlsRejection(error);
  });

  it('rejects moving a row of account a into account b', async () => {
    const error = await errorOf({ role: crm, context: ownContext() }, 'UPDATE crm.companies SET account_id = $1 WHERE id = $2', [
      fixture.b.id,
      fixture.a.companyId,
    ]);
    expectRlsRejection(error);
  });

  // With a WHERE, PostgreSQL also checks the new row against the read policy, which would hide
  // a WITH CHECK that lets anything through. Without one, only WITH CHECK stands (audit H2).
  it('rejects an update without WHERE that would move the visible rows into account b', async () => {
    const error = await errorOf({ role: crm, context: ownContext() }, 'UPDATE crm.companies SET account_id = $1', [fixture.b.id]);
    expectRlsRejection(error);
  });

  it("an update aimed at account b's row changes nothing", async () => {
    const updated = await asCrmService(
      async (client) =>
        (await client.query("UPDATE crm.contacts SET full_name = 'Cambiado' WHERE id = $1", [fixture.b.contactId])).rowCount,
    );
    expect(updated).toBe(0);
  });
});

describe('D5 · crm_service removes nothing', () => {
  it.each([
    ['DELETE', 'DELETE FROM crm.notes'],
    ['TRUNCATE', 'TRUNCATE crm.notes'],
  ])('%s on notes fails with 42501', async (_case, statement) => {
    expect((await errorOf({ role: crm, context: ownContext() }, statement)).code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('D7 · an update leaves an audit row with names and no values', () => {
  it('changing the email logs {email} and neither address', async () => {
    const newEmail = 'nuevo@cuenta-a.test';
    const logged = await asCrmService(async (client) => {
      await client.query('UPDATE crm.contacts SET email = $1 WHERE id = $2', [newEmail, fixture.a.contactId]);
      const result = await client.query<Record<string, unknown> & { as_text: string }>(
        `SELECT table_name, row_id, operation, changed_columns, api_key_id, proposed_by, approved_by,
                approval_ref, l::text AS as_text
         FROM crm.audit_log l WHERE table_name = 'contacts' AND row_id = $1 AND operation = 'update'`,
        [fixture.a.contactId],
      );
      return result.rows;
    });
    expect(logged).toHaveLength(1);
    const [row] = logged;
    // First, so a trigger that copies a value fails here and not on a field it also changed.
    expect(row?.as_text).not.toContain(newEmail);
    expect(row?.as_text).not.toContain(fixture.a.email);
    expect(row).toMatchObject({
      table_name: 'contacts',
      row_id: fixture.a.contactId,
      operation: 'update',
      changed_columns: ['email'],
      api_key_id: fixture.a.apiKeyId,
      proposed_by: 'agente',
      approved_by: 'mentor',
      approval_ref: 'aprobacion-1',
    });
  });
});

describe('D7 · an insert into any audited table is logged in the same transaction', () => {
  const inserts: Record<(typeof AUDITED_TABLES)[number], (f: Fixture) => [string, unknown[]]> = {
    companies: (f) => ['INSERT INTO crm.companies (account_id, name) VALUES ($1, $2) RETURNING id', [f.a.id, 'Nueva']],
    contacts: (f) => [
      'INSERT INTO crm.contacts (account_id, stage_id, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
      [f.a.id, f.a.stageId, 'Otra persona', 'otra@cuenta-a.test'],
    ],
    notes: (f) => ['INSERT INTO crm.notes (account_id, contact_id, body) VALUES ($1, $2, $3) RETURNING id', [f.a.id, f.a.contactId, 'Nota']],
    tasks: (f) => ['INSERT INTO crm.tasks (account_id, contact_id, title) VALUES ($1, $2, $3) RETURNING id', [f.a.id, f.a.contactId, 'Tarea']],
  };

  it.each(AUDITED_TABLES)('%s', async (table) => {
    const [statement, values] = inserts[table](fixture);
    const logged = await asCrmService(async (client) => {
      const inserted = await client.query<{ id: string }>(statement, values);
      const result = await client.query<{ operation: string; changed_columns: string[] }>(
        'SELECT operation, changed_columns FROM crm.audit_log WHERE table_name = $1 AND row_id = $2',
        [table, inserted.rows[0]?.id],
      );
      return result.rows;
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.operation).toBe('insert');
    expect(logged[0]?.changed_columns).toContain('account_id');
  });
});

describe('D8 · a write without an author fails and leaves nothing', () => {
  // null leaves the setting out; '' is what a setting from an earlier transaction reads as.
  it.each([
    ['without proposed_by', 'proposedBy', null],
    ['without approved_by', 'approvedBy', null],
    ['with an empty approved_by', 'approvedBy', ''],
    ['with an empty proposed_by', 'proposedBy', ''],
  ] as const)('%s', async (_case, key, value) => {
    const context = Object.fromEntries(
      Object.entries({ ...ownContext(), [key]: value }).filter(([, setting]) => setting !== null),
    ) as CrmContext;
    const outcome = await inTransaction(pool(), { role: crm, context }, async (client) => {
      const before = [await countOf(client, 'contacts'), await countOf(client, 'audit_log')];
      await client.query('SAVEPOINT attempt');
      const error = await sqlErrorOf(() =>
        client.query("UPDATE crm.contacts SET full_name = 'Sin autor' WHERE id = $1", [fixture.a.contactId]),
      );
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      const name = await client.query<{ full_name: string }>('SELECT full_name FROM crm.contacts WHERE id = $1', [
        fixture.a.contactId,
      ]);
      const after = [await countOf(client, 'contacts'), await countOf(client, 'audit_log')];
      return { error, before, after, name: name.rows[0]?.full_name };
    });
    expect(outcome.error.code).toBe(SQLSTATE.raiseException);
    expect(outcome.error.message).toBe(WITHOUT_AUTHOR);
    expect(outcome.after).toEqual(outcome.before);
    expect(outcome.name).toBe(`Contacto de ${fixture.a.slug}`);
  });
});

describe('D7 · authors are opaque ids, never a name or an address (audit H4)', () => {
  it.each([
    ['proposed_by with a name', 'proposedBy', 'Nombre Apellido', 'audit_log_proposed_by_format'],
    ['approved_by with an address', 'approvedBy', 'revisora@cuenta-a.test', 'audit_log_approved_by_format'],
    ['approval_ref with a sentence', 'approvalRef', 'aprobada por la revisora', 'audit_log_approval_ref_format'],
    ['approval_ref over 40 characters', 'approvalRef', 'a'.repeat(41), 'audit_log_approval_ref_format'],
  ] as const)('%s fails with 23514', async (_case, key, value, constraint) => {
    const error = await errorOf(
      { role: crm, context: { ...ownContext(), [key]: value } },
      "UPDATE crm.contacts SET full_name = 'Con autor' WHERE id = $1",
      [fixture.a.contactId],
    );
    expect(error.code).toBe(SQLSTATE.checkViolation);
    expect(error.constraint).toBe(constraint);
  });
});

describe('D9 · audit_log only grows, and only through the trigger', () => {
  it.each([
    ['UPDATE', "UPDATE crm.audit_log SET proposed_by = 'otro'"],
    ['DELETE', 'DELETE FROM crm.audit_log'],
    [
      'INSERT',
      `INSERT INTO crm.audit_log (account_id, table_name, row_id, operation, changed_columns, proposed_by, approved_by)
       VALUES (crm.context_account_id(), 'notes', 1, 'insert', '{}', 'yo', 'yo')`,
    ],
  ])('%s fails with 42501', async (_case, statement) => {
    expect((await errorOf({ role: crm, context: ownContext() }, statement)).code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('D10 · keys are kept as SHA-256 and read only through resolve_api_key', () => {
  it('rejects a hash that is not 32 bytes', async () => {
    const error = await errorOf(
      {},
      "INSERT INTO crm.api_keys (account_id, label, key_hash, permissions) VALUES ($1, 'corta', $2, '{read}')",
      [fixture.a.id, sha256('x').subarray(0, 31)],
    );
    expect(error.code).toBe(SQLSTATE.checkViolation);
    expect(error.constraint).toBe('api_keys_key_hash_length');
  });

  it('crm_service cannot read api_keys', async () => {
    const error = await errorOf({ role: crm, context: ownContext() }, 'SELECT * FROM crm.api_keys');
    expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('resolves a live key, with its account, and nothing for a revoked or unknown one', async () => {
    const resolved = await inTransaction(pool(), { role: crm }, async (client) => {
      const lookup = async (key: string): Promise<unknown[]> =>
        (await client.query('SELECT * FROM crm.resolve_api_key($1)', [sha256(key)])).rows;
      return {
        live: await lookup(fixture.b.apiKey),
        revoked: await lookup(fixture.revokedApiKey),
        unknown: await lookup('test-key-unknown'),
      };
    });
    expect(resolved).toEqual({
      live: [{ api_key_id: fixture.b.apiKeyId, account_id: fixture.b.id, account_slug: fixture.b.slug, permissions: ['read', 'write'] }],
      revoked: [],
      unknown: [],
    });
  });
});

describe('D11 · permissions are a closed, non-empty set', () => {
  it.each(['{admin}', '{}', '{read,NULL}', '{{read}}'])('rejects %s', async (permissions) => {
    const error = await errorOf(
      {},
      "INSERT INTO crm.api_keys (account_id, label, key_hash, permissions) VALUES ($1, 'mala', $2, $3)",
      [fixture.a.id, sha256(`permissions ${permissions}`), permissions],
    );
    expect(error.code).toBe(SQLSTATE.checkViolation);
    expect(error.constraint).toBe('api_keys_permissions_valid');
  });
});

describe('D13 · circuit_service does not see the CRM', () => {
  it('reading crm.contacts fails with 42501', async () => {
    const error = await errorOf({ role: SERVICE_ROLES.circuit, context: ownContext() }, 'SELECT * FROM crm.contacts');
    expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
  });
});

describe('contact email (ADR-0005, Restricciones)', () => {
  const insertContact = (client: pg.PoolClient, email: string) =>
    client.query('INSERT INTO crm.contacts (account_id, stage_id, full_name, email) VALUES ($1, $2, $3, $4)', [
      fixture.a.id,
      fixture.a.stageId,
      'Persona',
      email,
    ]);

  it.each([
    ['uppercase', 'Mayus@cuenta-a.test', 'contacts_email_lowercase'],
    ['without @', 'sin-arroba.test', 'contacts_email_shape'],
  ])('rejects an address %s', async (_case, email, constraint) => {
    const error = await sqlErrorOf(() => asCrmService((client) => insertContact(client, email)));
    expect(error.code).toBe(SQLSTATE.checkViolation);
    expect(error.constraint).toBe(constraint);
  });

  it('is unique per account among active contacts, and archiving frees it', async () => {
    const outcome = await asCrmService(async (client) => {
      await client.query('SAVEPOINT attempt');
      const duplicate = await sqlErrorOf(() => insertContact(client, fixture.a.email));
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      await client.query('UPDATE crm.contacts SET archived_at = now() WHERE id = $1', [fixture.a.contactId]);
      return { duplicate, reused: (await insertContact(client, fixture.a.email)).rowCount };
    });
    expect(outcome.duplicate.code).toBe(SQLSTATE.uniqueViolation);
    expect(outcome.duplicate.constraint).toBe('contacts_account_email_active_key');
    expect(outcome.reused).toBe(1);
  });
});
