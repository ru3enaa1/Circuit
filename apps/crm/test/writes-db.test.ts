import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  APPROVAL,
  auditRowsAfter,
  bearer,
  bodyOf,
  expectInvalid,
  lastAuditId,
  rowCounts,
  sendJson,
  useCrmUnderTest,
  type AuditRow,
} from './crm-under-test.ts';

// ADR-0007 D5, D6 and D13: each write that answers 2xx leaves exactly one audit row, in its
// own transaction, signed by the key that made it and by the approval it carried; and answers
// with the fields of its list and nothing else. Every audit row is compared whole.

const crm = useCrmUnderTest();

const KEYS = {
  contact: ['companyId', 'createdAt', 'email', 'fullName', 'id', 'stageId'],
  note: ['body', 'createdAt', 'id'],
  task: ['completedAt', 'createdAt', 'dueOn', 'id', 'title'],
} as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const keysOf = (value: object): string[] => Object.keys(value).sort();

/** Each test sends its own approval reference, so a row can only match the write that made it. */
const approvalFor = (ref: string) => ({ approvedBy: 'mentor', approvalRef: ref });

/** The response and the audit rows the request left, read as the admin. */
async function written(send: () => Promise<LightMyRequestResponse>): Promise<{ response: LightMyRequestResponse; audit: AuditRow[] }> {
  const mark = await lastAuditId(crm().db.pool);
  const response = await send();
  return { response, audit: await auditRowsAfter(crm().db.pool, mark) };
}

function post(path: string, body: unknown, key = crm().fixture.a.apiKey) {
  return sendJson(crm().app, 'POST', `/accounts/cuenta-a/${path}`, bearer(key), body);
}

function patch(contactId: number | string, body: unknown) {
  return sendJson(crm().app, 'PATCH', `/accounts/cuenta-a/contacts/${contactId}`, bearer(crm().fixture.a.apiKey), body);
}

/** What every audit row of a write by `apiKeyId` on account a holds besides its table, row and columns. */
function signedBy(apiKeyId: string, approvalRef: string): Pick<AuditRow, 'account_id' | 'api_key_id' | 'proposed_by' | 'approved_by' | 'approval_ref'> {
  return {
    account_id: crm().fixture.a.id,
    api_key_id: apiKeyId,
    proposed_by: `key-${apiKeyId}`,
    approved_by: 'mentor',
    approval_ref: approvalRef,
  };
}

function created<T extends object>(response: LightMyRequestResponse, status: number, name: string): T {
  expect(response.statusCode, response.body).toBe(status);
  const body = bodyOf(response) as Record<string, T>;
  expect(Object.keys(body)).toEqual([name]);
  return body[name]!;
}

async function newContact(email: string): Promise<number> {
  const response = await post('contacts', { fullName: 'Persona nueva', email, stageId: Number(crm().fixture.a.stageId), approval: APPROVAL });
  return created<{ id: number }>(response, 201, 'contact').id;
}

describe('D5, D6 and D13 · each write: its answer and its one audit row', () => {
  it('creating a contact: 201 { contact }, saved trimmed and lowercased, and one insert row', async () => {
    const { a } = crm().fixture;
    const body = { fullName: '  Ana Prueba  ', email: ' Ana@Cuenta-A.test ', stageId: Number(a.stageId), companyId: Number(a.companyId), approval: approvalFor('crear-1') };
    const { response, audit } = await written(() => post('contacts', body));
    const contact = created<Record<string, unknown>>(response, 201, 'contact');
    expect(keysOf(contact)).toEqual(KEYS.contact);
    expect(contact).toMatchObject({ fullName: 'Ana Prueba', email: 'ana@cuenta-a.test', stageId: Number(a.stageId), companyId: Number(a.companyId) });
    expect(contact['createdAt']).toMatch(ISO_UTC);
    expect(audit).toEqual([
      {
        ...signedBy(a.apiKeyId, 'crear-1'),
        table_name: 'contacts',
        row_id: String(contact['id']),
        operation: 'insert',
        changed_columns: ['account_id', 'company_id', 'created_at', 'email', 'full_name', 'id', 'stage_id'],
      },
    ]);
    const saved = await crm().db.pool.query('SELECT full_name, email, account_id::text FROM crm.contacts WHERE id = $1', [contact['id']]);
    expect(saved.rows).toEqual([{ full_name: 'Ana Prueba', email: 'ana@cuenta-a.test', account_id: a.id }]);
  });

  it('updating moves the contact to another stage: 200 { contact }, and one update row with stage_id only', async () => {
    const { a, extras } = crm().fixture;
    const contactId = await newContact('mover@cuenta-a.test');
    const { response, audit } = await written(() => patch(contactId, { stageId: Number(extras.secondStageId), approval: approvalFor('mover-1') }));
    const contact = created<Record<string, unknown>>(response, 200, 'contact');
    expect(keysOf(contact)).toEqual(KEYS.contact);
    expect(contact).toMatchObject({ id: contactId, stageId: Number(extras.secondStageId) });
    expect(audit).toEqual([
      { ...signedBy(a.apiKeyId, 'mover-1'), table_name: 'contacts', row_id: String(contactId), operation: 'update', changed_columns: ['stage_id'] },
    ]);
  });

  it('an update that changes no value still writes, with an empty changed_columns (pregunta 5)', async () => {
    const { a } = crm().fixture;
    const contactId = await newContact('igual@cuenta-a.test');
    const { response, audit } = await written(() => patch(contactId, { stageId: Number(a.stageId), approval: approvalFor('igual-1') }));
    expect(response.statusCode, response.body).toBe(200);
    expect(audit).toEqual([
      { ...signedBy(a.apiKeyId, 'igual-1'), table_name: 'contacts', row_id: String(contactId), operation: 'update', changed_columns: [] },
    ]);
  });

  it('null takes the company away, and leaving a field out keeps it', async () => {
    const { a } = crm().fixture;
    const contactId = await newContact('sin-empresa@cuenta-a.test');
    await patch(contactId, { companyId: Number(a.companyId), approval: APPROVAL });
    const { response, audit } = await written(() => patch(contactId, { companyId: null, approval: approvalFor('quitar-1') }));
    expect(created<Record<string, unknown>>(response, 200, 'contact')).toMatchObject({ companyId: null, fullName: 'Persona nueva' });
    expect(audit.map((row) => row.changed_columns)).toEqual([['company_id']]);
  });

  it('a note: 201 { note }, and one insert row', async () => {
    const { a } = crm().fixture;
    const { response, audit } = await written(() => post(`contacts/${a.contactId}/notes`, { body: '  Llamó otra vez.  ', approval: approvalFor('nota-1') }));
    const note = created<Record<string, unknown>>(response, 201, 'note');
    expect(keysOf(note)).toEqual(KEYS.note);
    expect(note['body']).toBe('Llamó otra vez.');
    expect(audit).toEqual([
      {
        ...signedBy(a.apiKeyId, 'nota-1'),
        table_name: 'notes',
        row_id: String(note['id']),
        operation: 'insert',
        changed_columns: ['account_id', 'body', 'contact_id', 'created_at', 'id'],
      },
    ]);
  });

  it('a task with its due date: 201 { task }, and one insert row', async () => {
    const { a } = crm().fixture;
    const { response, audit } = await written(() =>
      post(`contacts/${a.contactId}/tasks`, { title: 'Enviar el temario', dueOn: '2026-12-01', approval: approvalFor('tarea-1') }),
    );
    const task = created<Record<string, unknown>>(response, 201, 'task');
    expect(keysOf(task)).toEqual(KEYS.task);
    expect(task).toMatchObject({ title: 'Enviar el temario', dueOn: '2026-12-01', completedAt: null });
    expect(audit).toEqual([
      {
        ...signedBy(a.apiKeyId, 'tarea-1'),
        table_name: 'tasks',
        row_id: String(task['id']),
        operation: 'insert',
        changed_columns: ['account_id', 'contact_id', 'created_at', 'due_on', 'id', 'title'],
      },
    ]);
  });

  it('archiving with the read-write-delete key: 204 without a body, one update row signed by that key, and the contact is gone', async () => {
    const { extras } = crm().fixture;
    const contactId = await newContact('archivar@cuenta-a.test');
    const { response, audit } = await written(() => post(`contacts/${contactId}/archive`, { approval: approvalFor('archivar-1') }, extras.deleteKey));
    expect(response.statusCode, response.body).toBe(204);
    expect(response.body).toBe('');
    expect(audit).toEqual([
      { ...signedBy(extras.deleteKeyId, 'archivar-1'), table_name: 'contacts', row_id: String(contactId), operation: 'update', changed_columns: ['archived_at'] },
    ]);
    const read = await crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/contacts/${contactId}`, headers: bearer(extras.deleteKey) });
    expect(read.statusCode).toBe(404);
  });
});

describe('D5 · the proposer is the key, never the request', () => {
  it.each([
    ['at the top of the body', { body: 'Nota', proposedBy: 'mentor', approval: APPROVAL }, 'cuerpo'],
    ['inside approval', { body: 'Nota', approval: { ...APPROVAL, proposedBy: 'mentor' } }, 'approval'],
  ])('a proposedBy %s is 400 and writes nothing', async (_case, body, field) => {
    const before = await rowCounts(crm().db.pool);
    expectInvalid(await post(`contacts/${crm().fixture.a.contactId}/notes`, body), field, '');
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });
});
