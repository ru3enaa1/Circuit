import { describe, expect, it } from 'vitest';

import { sqlErrorOf } from '../../../database/test/crm-fixture.ts';
import { withReadScope, withWriteScope } from '../src/db/scope.ts';
import { APPROVAL, bearer, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0007 D4: every write is one READ WRITE transaction, and its context (the account, the
// key and the three authors) lasts that transaction only. One connection in the pool, so the
// request and the checks after it share it: a context left in the session would show there.

const INSUFFICIENT_PRIVILEGE = '42501';

const crm = useCrmUnderTest({ poolSize: 1 });

const credentialsOfA = () => ({ token: crm().fixture.a.apiKey, slug: crm().fixture.a.slug });

/** Every setting the write helper fixes, empty ones as null. */
const CONTEXT_QUERY = `SELECT crm.context_account_id()::text AS account,
  nullif(current_setting('crm.api_key_id', true), '') AS key,
  nullif(current_setting('crm.proposed_by', true), '') AS proposed_by,
  nullif(current_setting('crm.approved_by', true), '') AS approved_by,
  nullif(current_setting('crm.approval_ref', true), '') AS approval_ref`;

const EMPTY_CONTEXT = { account: null, key: null, proposed_by: null, approved_by: null, approval_ref: null };

function addNote(headers: Record<string, string>, body: unknown = { body: 'Nota de contexto', approval: APPROVAL }) {
  return sendJson(crm().app, 'POST', `/accounts/cuenta-a/contacts/${crm().fixture.a.contactId}/notes`, headers, body);
}

describe('D4 · one READ WRITE transaction per write, and its context dies with it', () => {
  it('inside the write helper, the context is the key, its account and the approval (control)', async () => {
    const { a } = crm().fixture;
    const inside = await withWriteScope(crm().pool, credentialsOfA(), 'write', () => ({ approval: APPROVAL }), async (scope) => {
      const result = await scope.client.query(CONTEXT_QUERY);
      const access = await scope.client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
      return { ...result.rows[0], readOnly: access.rows[0]?.transaction_read_only };
    });
    expect(inside).toEqual({
      account: a.id,
      key: a.apiKeyId,
      proposed_by: `key-${a.apiKeyId}`,
      approved_by: APPROVAL.approvedBy,
      approval_ref: APPROVAL.approvalRef,
      readOnly: 'off',
    });
  });

  it('after a write, the same connection has no account, no key and no author, and a write planted there fails on RLS', async () => {
    const { a } = crm().fixture;
    const response = await addNote(bearer(a.apiKey));
    expect(response.statusCode, response.body).toBe(201);
    // The request used the only connection there is, so the queries below run on it.
    expect(crm().pool.totalCount).toBe(1);
    const after = await crm().pool.query(CONTEXT_QUERY);
    expect(after.rows).toEqual([EMPTY_CONTEXT]);
    const planted = await sqlErrorOf(() =>
      crm().pool.query("INSERT INTO crm.notes (account_id, contact_id, body) VALUES ($1, $2, 'plantada después')", [a.id, a.contactId]),
    );
    expect(planted.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(planted.message).toContain('row-level security');
  });

  it('after a write, the read helper on that connection sets no author', async () => {
    expect((await addNote(bearer(crm().fixture.a.apiKey))).statusCode).toBe(201);
    const inside = await withReadScope(crm().pool, credentialsOfA(), async (scope) => (await scope.client.query(CONTEXT_QUERY)).rows[0]);
    expect(inside).toEqual({ ...EMPTY_CONTEXT, account: crm().fixture.a.id, key: crm().fixture.a.apiKeyId });
  });

  it('a refused write rolls back and gives its connection back', async () => {
    const { a, extras } = crm().fixture;
    const statuses = [
      (await addNote(bearer(extras.readOnlyKey))).statusCode,
      (await addNote(bearer(a.apiKey), { body: '', approval: APPROVAL })).statusCode,
      (await addNote(bearer(a.apiKey), { body: 'sin aprobación' })).statusCode,
      (await addNote(bearer(a.apiKey))).statusCode,
    ];
    expect(statuses).toEqual([403, 400, 400, 201]);
    expect(crm().pool.idleCount).toBe(1);
    expect((await crm().pool.query(CONTEXT_QUERY)).rows).toEqual([EMPTY_CONTEXT]);
  });
});
