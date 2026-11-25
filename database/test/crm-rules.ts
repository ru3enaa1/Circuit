import type pg from 'pg';
import { expect } from 'vitest';

import { inTransaction, sqlErrorOf, type CrmContext, type Fixture, type ServiceRole } from './crm-fixture.ts';

// Shared by the tests that check ADR-0005's rules as behaviour (crm-rules-db, crm-audit-keys-db)
// and by the ones that repeat them as crm_app (crm-login-db, ADR-0006 D5). Every negative case
// checks the SQLSTATE, so a statement that fails for another reason (a typo, a missing row)
// does not pass for the right one.

export const SQLSTATE = {
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  uniqueViolation: '23505',
  insufficientPrivilege: '42501',
  invalidText: '22P02',
  raiseException: 'P0001',
  readOnlyTransaction: '25006',
  invalidPassword: '28P01',
} as const;

// 42501 alone would also pass for a missing privilege; this part of the message only comes
// from a policy check (ADR-0005 audit H2).
const RLS_REJECTION = /row-level security policy/;

/** Tables crm_service can read; api_keys is not one of them (ADR-0005 D10). */
export const READABLE_TABLES = ['accounts', 'pipeline_stages', 'companies', 'contacts', 'notes', 'tasks', 'audit_log'];

/** What F1.3 will set for a write the agent proposed and the mentor approved, in account a. */
export function ownContext(fixture: Fixture): CrmContext {
  return {
    accountId: fixture.a.id,
    apiKeyId: fixture.a.apiKeyId,
    proposedBy: 'agente',
    approvedBy: 'mentor',
    approvalRef: 'aprobacion-1',
  };
}

/** The error one statement raises in its own transaction, which is always rolled back. */
export function errorOf(
  pool: pg.Pool,
  options: { readonly role?: ServiceRole; readonly context?: CrmContext },
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.DatabaseError> {
  return sqlErrorOf(() => inTransaction(pool, options, (client) => client.query(text, [...values])));
}

export async function accountIdsIn(client: pg.PoolClient, table: string): Promise<string[]> {
  // `table` comes from READABLE_TABLES, a constant, never from input.
  const id = table === 'accounts' ? 'id' : 'account_id';
  const result = await client.query<{ account: string }>(`SELECT DISTINCT ${id} AS account FROM crm.${table}`);
  return result.rows.map((row) => row.account);
}

/** The accounts seen in every readable table, one query at a time: a client runs them in sequence. */
export async function accountIdsInEveryTable(client: pg.PoolClient): Promise<string[]> {
  const found: string[] = [];
  for (const table of READABLE_TABLES) found.push(...(await accountIdsIn(client, table)));
  return found;
}

export function expectRlsRejection(error: pg.DatabaseError): void {
  expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
  expect(error.message).toMatch(RLS_REJECTION);
}

export async function countOf(client: pg.PoolClient, table: 'contacts' | 'audit_log'): Promise<number> {
  const result = await client.query<{ n: string }>(`SELECT count(*) AS n FROM crm.${table}`);
  return Number(result.rows[0]?.n);
}
