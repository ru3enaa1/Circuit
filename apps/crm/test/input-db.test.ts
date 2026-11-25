import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES } from '../src/server/limits.ts';
import { bearer, bodyOf, errorCodeOf, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0006 D14: every input goes through zod after the key and the account. An invalid one is
// 400 entrada_invalida naming the field, and no error body ever carries the value sent.

const crm = useCrmUnderTest();

const asA = () => bearer(crm().fixture.a.apiKey);

function get(url: string, headers = asA()): Promise<LightMyRequestResponse> {
  return crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/${url}`, headers });
}

function post(payload: string, headers: Record<string, string> = { ...asA(), 'content-type': 'application/json' }) {
  return crm().app.inject({ method: 'POST', url: '/accounts/cuenta-a/contacts/search', headers, payload });
}

/** 400 entrada_invalida, naming `field`, without `sent` anywhere in the body. */
function expectInvalid(response: LightMyRequestResponse, field: string, sent: string): void {
  expect(response.statusCode, response.body).toBe(400);
  expect(bodyOf(response)).toEqual({ error: { code: 'entrada_invalida', message: `La entrada no es válida: revisa «${field}».` } });
  if (sent.length > 0) expect(response.body).not.toContain(sent);
}

describe('D14 · route and query', () => {
  it.each([
    ['letters', 'abc'],
    ['zero', '0'],
    ['a leading zero', '01'],
    ['seventeen digits', '12345678901234567'],
    ['an id past 2^53', '9007199254740993'],
  ])('contactId with %s is 400 «contactId»', async (_case, value) => {
    expectInvalid(await get(`contacts/${value}`), 'contactId', value);
    expectInvalid(await get(`contacts/${value}/notes`), 'contactId', value);
  });

  it('companyId with letters is 400 «companyId»', async () => {
    expectInvalid(await get('companies/zz9'), 'companyId', 'zz9');
  });

  it.each([
    ['0', 'limit=0'],
    ['101', 'limit=101'],
    ['letters', 'limit=diez'],
    ['given twice', 'limit=1&limit=2'],
  ])('limit %s is 400 «limit»', async (_case, query) => {
    expectInvalid(await get(`contacts/${crm().fixture.a.contactId}/notes?${query}`), 'limit', '');
  });

  it('before that is not an id is 400 «before»', async () => {
    expectInvalid(await get(`contacts/${crm().fixture.a.contactId}/tasks?before=ayer`), 'before', 'ayer');
  });

  it('an unknown query parameter is 400 «consulta», without its name', async () => {
    expectInvalid(await get('stages?orden_secreto=1'), 'consulta', 'orden_secreto');
  });

  it('limit 100 and the default both pass (control)', async () => {
    expect((await get(`contacts/${crm().fixture.a.contactId}/notes?limit=100`)).statusCode).toBe(200);
    expect((await get(`contacts/${crm().fixture.a.contactId}/notes`)).statusCode).toBe(200);
  });

  // The account is compared before validation (D9 before D14), and a slug outside the pattern
  // can never be the key's: it answers like any other account, and never echoes the slug.
  it('a slug outside the pattern is 403 cuenta_ajena, like any other account', async () => {
    const response = await crm().app.inject({ method: 'GET', url: '/accounts/CUENTA-A/stages', headers: asA() });
    expect(response.statusCode).toBe(403);
    expect(errorCodeOf(response)).toBe('cuenta_ajena');
    expect(response.body).not.toContain('CUENTA-A');
  });
});

describe('D14 · the search body', () => {
  const tooLong = `${'a'.repeat(250)}@b.test`;

  it.each([
    ['without email', '{}', ''],
    ['with email as a number', '{"email":12345}', '12345'],
    ['with an address without @', '{"email":"sin-arroba.test"}', 'sin-arroba.test'],
    ['with an address of 255 characters', JSON.stringify({ email: tooLong }), tooLong],
  ])('%s is 400 «email»', async (_case, payload, sent) => {
    expectInvalid(await post(payload), 'email', sent);
  });

  it.each([
    ['an unknown field', '{"email":"contacto@cuenta-a.test","campo_desconocido":1}', 'campo_desconocido'],
    ['an array', '["contacto@cuenta-a.test"]', 'contacto@cuenta-a.test'],
    ['JSON that does not parse', '{"email": "contacto@cuenta-a.test"', 'contacto@cuenta-a.test'],
    ['an empty body', '', ''],
  ])('%s is 400 «cuerpo», without echoing it', async (_case, payload, sent) => {
    expectInvalid(await post(payload), 'cuerpo', sent);
  });

  it.each([
    ['without a content type', {}],
    ['as text/plain', { 'content-type': 'text/plain' }],
  ])('a body %s is 400 «cuerpo»', async (_case, type) => {
    expectInvalid(await post('{"email":"contacto@cuenta-a.test"}', { ...asA(), ...type }), 'cuerpo', 'contacto@cuenta-a.test');
  });

  it('a body over 16 KiB is 413 demasiado_grande', async () => {
    const response = await post(JSON.stringify({ email: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(response.statusCode).toBe(413);
    expect(errorCodeOf(response)).toBe('demasiado_grande');
  });

  it('application/json with its UTF-8 charset passes (control)', async () => {
    const response = await post(JSON.stringify({ email: crm().fixture.a.email }), {
      ...asA(),
      'content-type': 'application/json; charset=utf-8',
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('D14 · the key comes before the input', () => {
  it('without a key, an invalid input is 401, not 400 or 413', async () => {
    const responses = await Promise.all([
      get('contacts/abc', {}),
      post('{"email": rota', { 'content-type': 'application/json' }),
      post('x'.repeat(MAX_BODY_BYTES * 2), { 'content-type': 'application/json' }),
    ]);
    expect(responses.map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
      [401, 'sin_llave'],
      [401, 'sin_llave'],
      [401, 'sin_llave'],
    ]);
  });

  it('with an unknown key, an invalid input is 401 llave_invalida', async () => {
    const unknown = bearer('test-key-unknown');
    const responses = await Promise.all([get('contacts/abc', unknown), post('{"email": rota', { ...unknown, 'content-type': 'application/json' })]);
    expect(responses.map((response) => errorCodeOf(response))).toEqual(['llave_invalida', 'llave_invalida']);
  });
});
