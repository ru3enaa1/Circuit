import type { LightMyRequestResponse } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { readLocalEnv } from '../../../database/env.ts';
import { runKeysCommand } from '../../../database/keys.ts';
import { DATABASE_HOOK_TIMEOUT_MS } from '../../../database/test/disposable-db.ts';
import { APPROVAL, bearer, bodyOf, rowCounts, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0008 D13: the criterion of F1 in one test. A {read,write} key of account a, issued by the
// real issuer, as the seed of F1.5 will issue the agent's, is refused the three things the agent
// must never do: archive (403 «borrado»), export (403 «exportación») and reach another account
// (403 cuenta_ajena). None of the three changes a row. The controls: the same key reads its
// contact (200) and writes a note (201), so each refusal is for the permission or the account,
// and not for a key that does not work.

const crm = useCrmUnderTest();

/** A key anywhere in a text, written here and not taken from API_KEY_SHAPE. */
const KEY_IN_TEXT = /crmk_[A-Za-z0-9_-]{43}/;
const AGENT_PERMISSIONS = 'read,write';

let agent: { readonly id: string; readonly key: string } | undefined;

beforeAll(async () => {
  const out: string[] = [];
  const errors: string[] = [];
  const args = ['issue', '--account', 'cuenta-a', '--label', 'agente-real', '--permissions', AGENT_PERMISSIONS];
  const env = { ...readLocalEnv(), POSTGRES_DB: crm().db.name };
  const code = await runKeysCommand(args, env, { out: { log: (line: string) => out.push(line), error: (line: string) => errors.push(line) } });
  const text = out.join('\n');
  const key = KEY_IN_TEXT.exec(text)?.[0];
  const id = /Llave (\d+) emitida/.exec(text)?.[1];
  if (code !== 0 || key === undefined || id === undefined) throw new Error(`El emisor no dio la llave del agente: ${errors.join(' ')}`);
  agent = { id, key };
}, DATABASE_HOOK_TIMEOUT_MS);

function agentKey(): Record<string, string> {
  if (agent === undefined) throw new Error('El emisor no corrió: falló el beforeAll.');
  return bearer(agent.key);
}

/** The response of `request`, and the row counts before and after it. */
async function counted(request: () => Promise<LightMyRequestResponse>) {
  const before = await rowCounts(crm().db.pool);
  const response = await request();
  return { response, before, after: await rowCounts(crm().db.pool) };
}

function expectRefused(response: LightMyRequestResponse, code: string, message: string): void {
  expect(response.statusCode, response.body).toBe(403);
  expect(bodyOf(response)).toEqual({ error: { code, message } });
}

describe("D13 · the agent's key, issued by db:keys, and the three «no» of F1", () => {
  it('is a live {read,write} key of account a', async () => {
    const result = await crm().db.pool.query<{ slug: string; permissions: string[]; revoked: unknown }>(
      `SELECT a.slug, k.permissions, k.revoked_at AS revoked
         FROM crm.api_keys AS k JOIN crm.accounts AS a ON a.id = k.account_id WHERE k.id = $1`,
      [agent?.id],
    );
    expect(result.rows).toEqual([{ slug: 'cuenta-a', permissions: AGENT_PERMISSIONS.split(','), revoked: null }]);
  });

  it('archiving is 403 «borrado», and no row changes', async () => {
    const { contactId } = crm().fixture.a;
    const { response, before, after } = await counted(() =>
      sendJson(crm().app, 'POST', `/accounts/cuenta-a/contacts/${contactId}/archive`, agentKey(), { approval: APPROVAL }),
    );
    expectRefused(response, 'sin_permiso', 'La llave no tiene permiso de borrado.');
    expect(after).toEqual(before);
  });

  it('exporting is 403 «exportación», and no row changes', async () => {
    const { response, before, after } = await counted(() =>
      crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/export', headers: agentKey() }),
    );
    expectRefused(response, 'sin_permiso', 'La llave no tiene permiso de exportación.');
    expect(after).toEqual(before);
  });

  it('a read and a write of cuenta-b are 403 cuenta_ajena, and no row changes', async () => {
    const { contactId } = crm().fixture.b;
    const read = await counted(() => crm().app.inject({ method: 'GET', url: `/accounts/cuenta-b/contacts/${contactId}`, headers: agentKey() }));
    const write = await counted(() =>
      sendJson(crm().app, 'POST', `/accounts/cuenta-b/contacts/${contactId}/notes`, agentKey(), { body: 'Nota ajena', approval: APPROVAL }),
    );
    for (const { response, before, after } of [read, write]) {
      expectRefused(response, 'cuenta_ajena', 'La llave no es de esta cuenta.');
      expect(after).toEqual(before);
    }
  });

  it('controls: the same key reads its contact (200) and writes a note (201)', async () => {
    const { contactId } = crm().fixture.a;
    const read = await crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/contacts/${contactId}`, headers: agentKey() });
    expect(read.statusCode, read.body).toBe(200);
    const { response, before, after } = await counted(() =>
      sendJson(crm().app, 'POST', `/accounts/cuenta-a/contacts/${contactId}/notes`, agentKey(), { body: 'Nota del agente', approval: APPROVAL }),
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(after).toEqual({ ...before, notes: (before['notes'] ?? 0) + 1, audit_log: (before['audit_log'] ?? 0) + 1 });
  });
});
