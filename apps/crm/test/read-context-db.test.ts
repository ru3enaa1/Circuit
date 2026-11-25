import { describe, expect, it } from 'vitest';

import { sqlErrorOf } from '../../../database/test/crm-fixture.ts';
import { withReadScope } from '../src/db/read-scope.ts';
import { bearer, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0006 D10: every request is one READ ONLY transaction, and its context lasts that
// transaction only. One connection in the pool, so the request and the checks after it share
// it: a context left in the session would show there.

const READ_ONLY_TRANSACTION = '25006';

const crm = useCrmUnderTest({ poolSize: 1 });

const credentialsOfA = () => ({ token: crm().fixture.a.apiKey, slug: crm().fixture.a.slug });

describe('D10 · one READ ONLY transaction per request', () => {
  it('a write planted inside the helper fails with 25006', async () => {
    const { a } = crm().fixture;
    const error = await sqlErrorOf(() =>
      withReadScope(crm().pool, credentialsOfA(), (scope) =>
        scope.client.query("INSERT INTO crm.notes (account_id, contact_id, body) VALUES ($1, $2, 'escrita en una lectura')", [
          a.id,
          a.contactId,
        ]),
      ),
    );
    expect(error.code).toBe(READ_ONLY_TRANSACTION);
  });

  it('inside the helper, the context is the account of the key (control)', async () => {
    const inside = await withReadScope(crm().pool, credentialsOfA(), async (scope) => {
      const result = await scope.client.query<{ id: string | null }>('SELECT crm.context_account_id()::text AS id');
      return { setting: result.rows[0]?.id, scope: scope.accountId };
    });
    expect(inside).toEqual({ setting: crm().fixture.a.id, scope: Number(crm().fixture.a.id) });
  });

  it('after a request, the same connection has no account and sees no contact', async () => {
    const response = await crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer(crm().fixture.a.apiKey) });
    expect(response.statusCode).toBe(200);
    // The request used the only connection there is, so the queries below run on it.
    expect(crm().pool.totalCount).toBe(1);
    const after = await crm().pool.query<{ account: string | null; contacts: string }>(
      'SELECT crm.context_account_id()::text AS account, (SELECT count(*) FROM crm.contacts)::text AS contacts',
    );
    expect(after.rows).toEqual([{ account: null, contacts: '0' }]);
  });

  it('a refused request rolls back and gives its connection back', async () => {
    const headers = bearer('test-key-unknown');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers })).statusCode);
    }
    const ok = await crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer(crm().fixture.a.apiKey) });
    expect([...statuses, ok.statusCode]).toEqual([401, 401, 401, 200]);
    expect(crm().pool.idleCount).toBe(1);
  });
});
