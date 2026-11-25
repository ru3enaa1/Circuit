import type { LightMyRequestResponse } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HOOK_TIMEOUT_MS } from '../../../database/test/disposable-db.ts';
import { APPROVAL, bearer, bodyOf, expectInvalid, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0007 D13: the audit trail as the API reads it, by account, newest first and paged like
// the notes. The fixture already left rows in both accounts (its own writes, signed `fixture`),
// and each account writes one note through the API before the tests, so both kinds are there.

const crm = useCrmUnderTest();

const ENTRY_KEYS = ['apiKeyId', 'approvalRef', 'approvedBy', 'changedColumns', 'id', 'occurredAt', 'operation', 'proposedBy', 'rowId', 'tableName'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Entry {
  readonly id: number;
  readonly rowId: number;
  readonly tableName: string;
  readonly [field: string]: unknown;
}

function auditLog(query = '', slug = 'cuenta-a', key = crm().fixture.a.apiKey): Promise<LightMyRequestResponse> {
  return crm().app.inject({ method: 'GET', url: `/accounts/${slug}/audit-log${query}`, headers: bearer(key) });
}

async function entriesOf(response: Promise<LightMyRequestResponse>): Promise<Entry[]> {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(200);
  return (bodyOf(answered) as { entries: Entry[] }).entries;
}

/** The ids of an account's audit rows, newest first, read as the admin past every policy. */
async function idsInDatabase(accountId: string): Promise<number[]> {
  // Ordered by the table's column: `ORDER BY id` would take the output column, which is text.
  const result = await crm().db.pool.query<{ id: string }>(
    'SELECT audit_log.id::text AS id FROM crm.audit_log WHERE account_id = $1 ORDER BY audit_log.id DESC',
    [accountId],
  );
  return result.rows.map((row) => Number(row.id));
}

const noteIds: Record<'a' | 'b', number> = { a: 0, b: 0 };

beforeAll(async () => {
  for (const account of ['a', 'b'] as const) {
    const { slug, contactId, apiKey } = crm().fixture[account];
    const response = await sendJson(crm().app, 'POST', `/accounts/${slug}/contacts/${contactId}/notes`, bearer(apiKey), {
      body: 'Nota para la bitácora',
      approval: APPROVAL,
    });
    expect(response.statusCode, response.body).toBe(201);
    noteIds[account] = (bodyOf(response) as { note: { id: number } }).note.id;
  }
}, DATABASE_HOOK_TIMEOUT_MS);

describe('D13 · the audit trail through the API', () => {
  it('each entry carries the fields of its list, never the account, newest first', async () => {
    const { a } = crm().fixture;
    const entries = await entriesOf(auditLog());
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.map((entry) => Object.keys(entry).sort())).toEqual(entries.map(() => ENTRY_KEYS));
    expect(entries.map((entry) => entry.id)).toEqual([...entries.map((entry) => entry.id)].sort((x, y) => y - x));
    expect(entries[0]).toEqual({
      id: expect.any(Number),
      occurredAt: expect.stringMatching(ISO_UTC),
      tableName: 'notes',
      rowId: noteIds.a,
      operation: 'insert',
      changedColumns: ['account_id', 'body', 'contact_id', 'created_at', 'id'],
      apiKeyId: Number(a.apiKeyId),
      proposedBy: `key-${a.apiKeyId}`,
      approvedBy: APPROVAL.approvedBy,
      approvalRef: APPROVAL.approvalRef,
    });
    // As a key. account_id does appear as a value: changedColumns lists the columns an insert filled.
    expect(JSON.stringify(entries)).not.toMatch(/"accountId":|"account_id":/);
  });

  it("a's key sees every entry of a and none of b; b's key sees b's (control)", async () => {
    const { a, b } = crm().fixture;
    const ofA = await entriesOf(auditLog('?limit=100'));
    const ofB = await entriesOf(auditLog('?limit=100', 'cuenta-b', b.apiKey));
    const inA = await idsInDatabase(a.id);
    const inB = await idsInDatabase(b.id);
    expect(inA.length).toBeLessThan(100);
    expect(ofA.map((entry) => entry.id)).toEqual(inA);
    expect(ofB.map((entry) => entry.id)).toEqual(inB);
    expect(ofA.map((entry) => entry.id).filter((id) => inB.includes(id))).toEqual([]);
    expect(ofB.some((entry) => entry.rowId === noteIds.b && entry.tableName === 'notes')).toBe(true);
  });

  it('limit and before page through without repeating or skipping an entry', async () => {
    const all = (await entriesOf(auditLog('?limit=100'))).map((entry) => entry.id);
    const paged: number[] = [];
    let query = '?limit=2';
    for (let page = 0; page <= all.length; page += 1) {
      const entries = await entriesOf(auditLog(query));
      if (entries.length === 0) break;
      expect(entries.length).toBeLessThanOrEqual(2);
      paged.push(...entries.map((entry) => entry.id));
      query = `?limit=2&before=${entries.at(-1)!.id}`;
    }
    expect(paged).toEqual(all);
  });

  it('a limit past 100 or an unknown parameter is 400 naming it', async () => {
    expectInvalid(await auditLog('?limit=101'), 'limit', '');
    expectInvalid(await auditLog('?tabla=contacts'), 'consulta', 'tabla');
  });
});
