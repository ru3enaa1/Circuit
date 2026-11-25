import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import { bearer, bodyOf, errorCodeOf, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0006 D8, D9 and D16, through the real server on a disposable database as crm_app.
// Every negative case checks the error code, and every 403 has a 200 next to it as control,
// so a refusal for another reason (a missing row, a broken route) does not pass for this one.

const crm = useCrmUnderTest();

const seen: LightMyRequestResponse[] = [];

async function get(url: string, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  const response = await crm().app.inject({ method: 'GET', url, headers });
  seen.push(response);
  return response;
}

describe('D8 · the key', () => {
  it.each([
    ['without the header', {}],
    ['with another scheme', { authorization: 'Basic dXN1YXJpbzpjbGF2ZQ==' }],
    ['with Bearer and nothing after it', { authorization: 'Bearer ' }],
  ])('%s: 401 sin_llave with WWW-Authenticate: Bearer', async (_case, headers) => {
    const response = await get('/accounts/cuenta-a/stages', headers);
    expect(response.statusCode).toBe(401);
    expect(errorCodeOf(response)).toBe('sin_llave');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('an unknown key and a revoked one get the same 401 llave_invalida, byte for byte', async () => {
    const unknown = await get('/accounts/cuenta-a/stages', bearer('test-key-unknown'));
    const revoked = await get('/accounts/cuenta-a/stages', bearer(crm().fixture.revokedApiKey));
    expect(unknown.statusCode).toBe(401);
    expect(errorCodeOf(unknown)).toBe('llave_invalida');
    expect(unknown.headers['www-authenticate']).toBe('Bearer');
    expect(revoked.statusCode).toBe(unknown.statusCode);
    expect(revoked.headers['www-authenticate']).toBe(unknown.headers['www-authenticate']);
    expect(revoked.body).toBe(unknown.body);
  });

  it.each([
    ['a token with a space inside', 'Bearer dos partes'],
    ['a token longer than 512 characters', `Bearer ${'a'.repeat(513)}`],
  ])('%s: 401 llave_invalida', async (_case, authorization) => {
    const response = await get('/accounts/cuenta-a/stages', { authorization });
    expect(response.statusCode).toBe(401);
    expect(errorCodeOf(response)).toBe('llave_invalida');
  });

  it('the scheme is case-insensitive (RFC 7235), and the right key reads (control)', async () => {
    const response = await get('/accounts/cuenta-a/stages', { authorization: `bearer ${crm().fixture.a.apiKey}` });
    expect(response.statusCode).toBe(200);
  });
});

describe('D9 · the account of the route is the account of the key', () => {
  it("account b's key reads account b's stages (control)", async () => {
    const { b } = crm().fixture;
    const response = await get('/accounts/cuenta-b/stages', bearer(b.apiKey));
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ stages: [{ id: Number(b.stageId) }] });
  });

  it("account a's key on account b: 403 cuenta_ajena, and nothing is read", async () => {
    const response = await get('/accounts/cuenta-b/stages', bearer(crm().fixture.a.apiKey));
    expect(response.statusCode).toBe(403);
    expect(errorCodeOf(response)).toBe('cuenta_ajena');
    expect(response.body).not.toContain('stages');
  });

  it('a slug that does not exist answers exactly like another account', async () => {
    const key = bearer(crm().fixture.a.apiKey);
    const other = await get('/accounts/cuenta-b/stages', key);
    const missing = await get('/accounts/no-existe/stages', key);
    expect(missing.statusCode).toBe(other.statusCode);
    expect(missing.body).toBe(other.body);
  });

  it('a key without read: 403 sin_permiso, on every route', async () => {
    const key = bearer(crm().fixture.extras.writeOnlyKey);
    const { contactId, companyId } = crm().fixture.a;
    const urls = ['stages', `contacts/${contactId}`, `contacts/${contactId}/notes`, `contacts/${contactId}/tasks`, `companies/${companyId}`];
    const responses = await Promise.all(urls.map((url) => get(`/accounts/cuenta-a/${url}`, key)));
    const search = await crm().app.inject({
      method: 'POST',
      url: '/accounts/cuenta-a/contacts/search',
      headers: { ...key, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: crm().fixture.a.email }),
    });
    seen.push(search);
    expect([...responses, search].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual(
      Array.from({ length: urls.length + 1 }, () => [403, 'sin_permiso']),
    );
  });
});

describe('D16 · no CORS, no cookies', () => {
  it('a preflight is not answered with CORS headers', async () => {
    const preflight = await crm().app.inject({
      method: 'OPTIONS',
      url: '/accounts/cuenta-a/stages',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    seen.push(preflight);
    expect(preflight.statusCode).toBe(404);
  });

  // Last in the file, so it sees every response above: refusals and successes alike.
  it('no response of this file carries access-control-allow-origin or set-cookie', () => {
    expect(seen.length).toBeGreaterThan(10);
    const offending = seen.filter(
      (response) => response.headers['access-control-allow-origin'] !== undefined || response.headers['set-cookie'] !== undefined,
    );
    expect(offending).toEqual([]);
  });
});
