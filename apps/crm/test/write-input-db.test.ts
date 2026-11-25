import { describe, expect, it } from 'vitest';

import { NOTE_BODY_MAX_LENGTH, SHORT_TEXT_MAX_LENGTH } from '../src/db/schema.ts';
import { APPROVAL, bearer, bodyOf, expectInvalid, rowCounts, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0007 D7 and D9, and H9 of the audit of ADR-0006: every body of a write goes through zod
// in strict mode, approval included, after the key. Whatever is wrong is 400 entrada_invalida
// naming the field, never 500 and never the value, and nothing is written.

const crm = useCrmUnderTest();

const NUL = '\u0000';
/** Half of a UTF-16 pair with no other half: PostgreSQL would store it as U+FFFD without a word. */
const LONE_SURROGATE = '\ud800';
/** A mark around each planted character, so an echo of the value shows in the error body. */
const MARK = 'marcado';

let sequence = 0;
const nextEmail = () => {
  sequence += 1;
  return `entrada-${sequence}@cuenta-a.test`;
};

type Method = 'POST' | 'PATCH';

function send(method: Method, path: string, body: unknown, key = crm().fixture.a.apiKey) {
  return sendJson(crm().app, method, `/accounts/cuenta-a/${path}`, bearer(key), body);
}

const contactPath = () => `contacts/${crm().fixture.a.contactId}`;
const newContact = (fields: Record<string, unknown>) => ({
  fullName: 'Persona de prueba',
  email: nextEmail(),
  stageId: Number(crm().fixture.a.stageId),
  approval: APPROVAL,
  ...fields,
});

/** Each write route with a valid body built around `fields`. */
const WRITES: readonly (readonly [string, Method, () => string, (fields: Record<string, unknown>) => Record<string, unknown>])[] = [
  ['create', 'POST', () => 'contacts', newContact],
  ['update', 'PATCH', contactPath, (fields) => ({ fullName: 'Otro nombre', approval: APPROVAL, ...fields })],
  ['note', 'POST', () => `${contactPath()}/notes`, (fields) => ({ body: 'Una nota', approval: APPROVAL, ...fields })],
  ['task', 'POST', () => `${contactPath()}/tasks`, (fields) => ({ title: 'Una tarea', approval: APPROVAL, ...fields })],
  ['archive', 'POST', () => `${contactPath()}/archive`, (fields) => ({ approval: APPROVAL, ...fields })],
];

const notePath = () => `${contactPath()}/notes`;

describe('D7 · every write carries a well-formed approval', () => {
  it.each(WRITES)('%s without approval is 400 «approval», and nothing is written', async (_route, method, path, body) => {
    const before = await rowCounts(crm().db.pool);
    const { approval: _left, ...without } = body({});
    expectInvalid(await send(method, path(), without, crm().fixture.extras.deleteKey), 'approval', '');
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it.each([
    ['without approvedBy', { approvalRef: 'aprobacion-1' }, ''],
    ['without approvalRef', { approvedBy: 'mentor' }, ''],
    ['with a space in approvedBy', { approvedBy: 'mentor tutor', approvalRef: 'aprobacion-1' }, 'mentor tutor'],
    ['with an address in approvedBy', { approvedBy: 'mentor@escuela.test', approvalRef: 'aprobacion-1' }, 'escuela.test'],
    ['with 41 characters in approvedBy', { approvedBy: 'm'.repeat(41), approvalRef: 'aprobacion-1' }, 'm'.repeat(41)],
    ['with a key as approvedBy', { approvedBy: 'key-7', approvalRef: 'aprobacion-1' }, 'key-7'],
    ['with capitals in approvalRef', { approvedBy: 'mentor', approvalRef: 'Aprobacion-1' }, 'Aprobacion-1'],
    ['with a field more', { ...APPROVAL, nota: 'campo-de-mas' }, 'campo-de-mas'],
    ['as text', 'mentor-en-texto', 'mentor-en-texto'],
    ['as null', null, ''],
  ])('an approval %s is 400 «approval», without echoing it', async (_case, approval, sent) => {
    const before = await rowCounts(crm().db.pool);
    expectInvalid(await send('POST', notePath(), { body: 'Nota', approval }), 'approval', sent);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it('approvedBy of 40 characters, and a word that only starts like a key, are approvals (control)', async () => {
    for (const approvedBy of ['m'.repeat(40), 'key-agente']) {
      const response = await send('POST', notePath(), { body: 'Nota', approval: { approvedBy, approvalRef: 'aprobacion-1' } });
      expect(response.statusCode, response.body).toBe(201);
    }
  });
});

describe('D9 · each text: trimmed, within its limits, without NUL and without a lone surrogate', () => {
  type TextRequest = (value: string) => { readonly path: string; readonly body: object };
  const TEXTS: readonly (readonly [string, number, TextRequest])[] = [
    ['fullName', SHORT_TEXT_MAX_LENGTH, (value) => ({ path: 'contacts', body: newContact({ fullName: value }) })],
    ['title', SHORT_TEXT_MAX_LENGTH, (value) => ({ path: `${contactPath()}/tasks`, body: { title: value, approval: APPROVAL } })],
    ['body', NOTE_BODY_MAX_LENGTH, (value) => ({ path: notePath(), body: { body: value, approval: APPROVAL } })],
  ];

  it.each(TEXTS)('%s: empty, blank, one past its limit, with a NUL or a lone surrogate is 400 naming it, never 500', async (field, max, request) => {
    const before = await rowCounts(crm().db.pool);
    const wrong = ['', '   ', 'x'.repeat(max + 1), `${MARK}${NUL}${MARK}`, `${MARK}${NUL}`, `${MARK}${LONE_SURROGATE}${MARK}`];
    for (const value of wrong) {
      const { path, body } = request(value);
      expectInvalid(await send('POST', path, body), field, value.includes(MARK) ? MARK : '');
    }
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it.each(TEXTS)('%s: exactly at its limit, and padded with spaces, is written (control)', async (_field, max, request) => {
    for (const value of ['x'.repeat(max), `  ${'x'.repeat(max)}  `]) {
      const { path, body } = request(value);
      expect((await send('POST', path, body)).statusCode).toBe(201);
    }
  });

  it.each([
    ['a NUL', `${MARK}${NUL}@cuenta-a.test`],
    ['a lone surrogate', `${MARK}${LONE_SURROGATE}@cuenta-a.test`],
    ['no @', `${MARK}.cuenta-a.test`],
    ['255 characters', `${MARK}${'a'.repeat(248 - MARK.length)}@b.test`],
  ])('an address with %s is 400 «email», creating and changing', async (_case, email) => {
    expectInvalid(await send('POST', 'contacts', newContact({ email })), 'email', MARK);
    expectInvalid(await send('PATCH', contactPath(), { email, approval: APPROVAL }), 'email', MARK);
  });
});

describe('D9 · ids, dates and an empty change', () => {
  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['a fraction', '1.5'],
    ['text', '"12"'],
    ['past 2^53', '9007199254740993'],
  ])('stageId and companyId as %s are 400 naming each', async (_case, literal) => {
    for (const field of ['stageId', 'companyId']) {
      const valid = JSON.stringify(newContact({ [field]: 0 }));
      const payload = valid.replace(`"${field}":0`, `"${field}":${literal}`);
      expect(payload).toContain(literal);
      expectInvalid(await send('POST', 'contacts', payload), field, '');
    }
  });

  it('companyId null creates a contact without a company (control)', async () => {
    const response = await send('POST', 'contacts', newContact({ companyId: null }));
    expect(response.statusCode, response.body).toBe(201);
    expect(bodyOf(response)).toMatchObject({ contact: { companyId: null } });
  });

  it.each([
    ['a day February does not have', '2026-02-30'],
    ['February 29 of a common year', '2027-02-29'],
    ['without its zeros', '2026-2-3'],
    ['year zero, which PostgreSQL refuses', '0000-01-01'],
    ['with a time', '2026-12-01T10:00:00Z'],
    ['as a number', 20261201],
  ])('dueOn as %s is 400 «dueOn», never 500', async (_case, dueOn) => {
    expectInvalid(await send('POST', `${contactPath()}/tasks`, { title: 'Tarea', dueOn, approval: APPROVAL }), 'dueOn', '');
  });

  it('dueOn on February 29 of a leap year is written (control)', async () => {
    const response = await send('POST', `${contactPath()}/tasks`, { title: 'Tarea bisiesta', dueOn: '2028-02-29', approval: APPROVAL });
    expect(response.statusCode, response.body).toBe(201);
    expect(bodyOf(response)).toMatchObject({ task: { dueOn: '2028-02-29' } });
  });

  it('a change with nothing but its approval is 400 «cuerpo»', async () => {
    expectInvalid(await send('PATCH', contactPath(), { approval: APPROVAL }), 'cuerpo', '');
  });
});

describe('H9 · __proto__ in a body is refused, and the prototype stays clean', () => {
  const PROTO = '"__proto__":{"polluted":true}';

  it.each(WRITES)('%s: __proto__ at the top of the body is 400 «cuerpo»', async (_route, method, path, body) => {
    const payload = `{${PROTO},${JSON.stringify(body({})).slice(1)}`;
    expectInvalid(await send(method, path(), payload, crm().fixture.extras.deleteKey), 'cuerpo', '');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each(WRITES)('%s: __proto__ inside approval is 400 «approval»', async (_route, method, path, body) => {
    const payload = JSON.stringify(body({})).replace('"approval":{', `"approval":{${PROTO},`);
    expect(payload).toContain(PROTO);
    expectInvalid(await send(method, path(), payload, crm().fixture.extras.deleteKey), 'approval', '');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
