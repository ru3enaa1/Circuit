import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import { APPROVAL, auditRowsAfter, bearer, bodyOf, expectInvalid, lastAuditId, rowCounts, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0007 D10 and D11: what a write refers to belongs to the key's account. A stage or a
// company it cannot see is a wrong field (400), a contact it cannot see does not exist (404),
// and an address already active in the account is a conflict (409). None of them writes.

const crm = useCrmUnderTest();

/** No id of the fixture comes near this one. */
const MISSING_ID = '999999';

function send(method: 'POST' | 'PATCH', path: string, body: unknown, key = crm().fixture.a.apiKey, slug = 'cuenta-a') {
  return sendJson(crm().app, method, `/accounts/${slug}/${path}`, bearer(key), body);
}

function contactBody(email: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { fullName: 'Persona de prueba', email, stageId: Number(crm().fixture.a.stageId), approval: APPROVAL, ...fields };
}

async function newContact(email: string): Promise<number> {
  const response = await send('POST', 'contacts', contactBody(email));
  expect(response.statusCode, response.body).toBe(201);
  return (bodyOf(response) as { contact: { id: number } }).contact.id;
}

/** `responses` are all `status`, each with the body of the first. */
function expectSameAnswer(responses: readonly LightMyRequestResponse[], status: number): void {
  for (const response of responses) {
    expect(response.statusCode, response.body).toBe(status);
    expect(response.body).toBe(responses[0]!.body);
  }
}

describe('D10 · a stage or a company of another account is a wrong field', () => {
  it("b's stage creating in a is 400 «stageId», with the same body as a stage that does not exist", async () => {
    const before = await rowCounts(crm().db.pool);
    const other = await send('POST', 'contacts', contactBody('etapa-b@cuenta-a.test', { stageId: Number(crm().fixture.b.stageId) }));
    const missing = await send('POST', 'contacts', contactBody('etapa-b@cuenta-a.test', { stageId: Number(MISSING_ID) }));
    expectInvalid(other, 'stageId', '');
    expectSameAnswer([other, missing], 400);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it("b's stage moving a's contact is 400 «stageId», and the contact does not move", async () => {
    const { a, b } = crm().fixture;
    const before = await rowCounts(crm().db.pool);
    expectInvalid(await send('PATCH', `contacts/${a.contactId}`, { stageId: Number(b.stageId), approval: APPROVAL }), 'stageId', '');
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it("b's company, an archived one and one that does not exist are 400 «companyId», with the same body", async () => {
    const { b, extras } = crm().fixture;
    const before = await rowCounts(crm().db.pool);
    const responses = [];
    for (const companyId of [b.companyId, extras.archivedCompanyId, MISSING_ID]) {
      responses.push(await send('POST', 'contacts', contactBody('empresa@cuenta-a.test', { companyId: Number(companyId) })));
    }
    expectInvalid(responses[0]!, 'companyId', '');
    expectSameAnswer(responses, 400);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it("b's key with b's stage and company creates in b (control)", async () => {
    const { b } = crm().fixture;
    const body = contactBody('control@cuenta-b.test', { stageId: Number(b.stageId), companyId: Number(b.companyId) });
    expect((await send('POST', 'contacts', body, b.apiKey, 'cuenta-b')).statusCode).toBe(201);
  });
});

describe('D10 · a contact of another account, archived or missing is 404, the same in each case', () => {
  const routes = [
    ['update', 'PATCH', (id: string) => `contacts/${id}`, { fullName: 'Otro nombre', approval: APPROVAL }],
    ['note', 'POST', (id: string) => `contacts/${id}/notes`, { body: 'Una nota', approval: APPROVAL }],
    ['task', 'POST', (id: string) => `contacts/${id}/tasks`, { title: 'Una tarea', approval: APPROVAL }],
    ['archive', 'POST', (id: string) => `contacts/${id}/archive`, { approval: APPROVAL }],
  ] as const;

  it.each(routes)('%s: b\'s contact, an archived one and a missing one get one 404 body, and nothing is written', async (_route, method, path, body) => {
    const { b, extras } = crm().fixture;
    const before = await rowCounts(crm().db.pool);
    const responses = [];
    for (const id of [MISSING_ID, b.contactId, extras.archivedContactId]) responses.push(await send(method, path(id), body, extras.deleteKey));
    expect(bodyOf(responses[0]!)).toEqual({ error: { code: 'no_encontrado', message: 'No se encontró.' } });
    expectSameAnswer(responses, 404);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it('archiving twice: 204, then 404, and one audit row', async () => {
    const contactId = await newContact('dos-veces@cuenta-a.test');
    const mark = await lastAuditId(crm().db.pool);
    const first = await send('POST', `contacts/${contactId}/archive`, { approval: APPROVAL }, crm().fixture.extras.deleteKey);
    const second = await send('POST', `contacts/${contactId}/archive`, { approval: APPROVAL }, crm().fixture.extras.deleteKey);
    expect([first.statusCode, second.statusCode]).toEqual([204, 404]);
    expect((await auditRowsAfter(crm().db.pool, mark)).map((row) => [row.row_id, row.changed_columns])).toEqual([[String(contactId), ['archived_at']]]);
  });
});

describe('D11 · an address already active in the account is 409 ya_existe', () => {
  const CONFLICT = { error: { code: 'ya_existe', message: 'Ya hay un contacto activo con ese correo.' } };

  it("creating with the fixture's address, as sent or spelled otherwise, is 409, writes nothing and does not echo it", async () => {
    const { a } = crm().fixture;
    const before = await rowCounts(crm().db.pool);
    for (const email of [a.email, `  ${a.email.toUpperCase()} `]) {
      const response = await send('POST', 'contacts', contactBody(email));
      expect(response.statusCode, response.body).toBe(409);
      expect(bodyOf(response)).toEqual(CONFLICT);
      expect(response.body).not.toContain('cuenta-a.test');
    }
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it("changing another contact's address to the fixture's is 409, and writes nothing", async () => {
    const contactId = await newContact('cambiara@cuenta-a.test');
    const before = await rowCounts(crm().db.pool);
    const response = await send('PATCH', `contacts/${contactId}`, { email: crm().fixture.a.email, approval: APPROVAL });
    expect([response.statusCode, bodyOf(response)]).toEqual([409, CONFLICT]);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
    const saved = await crm().db.pool.query('SELECT email FROM crm.contacts WHERE id = $1', [contactId]);
    expect(saved.rows).toEqual([{ email: 'cambiara@cuenta-a.test' }]);
  });

  it("an archived contact's address can be used again (control)", async () => {
    expect((await send('POST', 'contacts', contactBody(crm().fixture.extras.archivedContactEmail))).statusCode).toBe(201);
  });

  it("a's address in account b is not a conflict: the index is per account (control)", async () => {
    const { a, b } = crm().fixture;
    const response = await send('POST', 'contacts', contactBody(a.email, { stageId: Number(b.stageId) }), b.apiKey, 'cuenta-b');
    expect(response.statusCode, response.body).toBe(201);
  });
});
