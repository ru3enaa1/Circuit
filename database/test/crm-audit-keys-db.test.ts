import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDITED_TABLES } from '../../apps/crm/src/db/schema.ts';
import { SERVICE_ROLES } from '../config.ts';
import { inTransaction, seedFixture, sha256, sqlErrorOf, type CrmContext, type Fixture } from './crm-fixture.ts';
import { countOf, errorOf as errorIn, ownContext as ownContextOf, SQLSTATE } from './crm-rules.ts';
import { createDisposableDatabase, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0005, the audit trail and the keys as behaviour, against a migrated disposable database
// with two synthetic accounts. The isolation rules are in crm-rules-db.test.ts; both files
// were one until ADR-0006 D17 split them.

const WITHOUT_AUTHOR = 'crm: escritura sin autor';

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
const ownContext = (): CrmContext => ownContextOf(fixture);

function asCrmService<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool(), { role: crm, context: ownContext() }, work);
}

function errorOf(
  options: Parameters<typeof errorIn>[1],
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.DatabaseError> {
  return errorIn(pool(), options, text, values);
}

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
