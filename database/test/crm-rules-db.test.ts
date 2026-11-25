import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE_ROLES } from '../config.ts';
import { FIXTURE_AUTHORS, inTransaction, seedFixture, sqlErrorOf, type CrmContext, type Fixture } from './crm-fixture.ts';
import {
  accountIdsIn,
  errorOf as errorIn,
  expectRlsRejection,
  ownContext as ownContextOf,
  READABLE_TABLES,
  SQLSTATE,
} from './crm-rules.ts';
import { createDisposableDatabase, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0005, the isolation rules as behaviour: real statements against a migrated disposable
// database with two synthetic accounts. The audit trail and the keys are in
// crm-audit-keys-db.test.ts; both files were one until ADR-0006 D17 split them.

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
