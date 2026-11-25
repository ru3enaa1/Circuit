import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import { bearer, bodyOf, errorCodeOf, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0006 D12 and D13: what each read returns, against the fixture of
// database/test/crm-fixture.ts (seedReadFixture). The keys of every object are compared with
// a fixed list, so a column added to a query, account_id above all, turns this red.

const KEYS = {
  stage: ['id', 'key', 'label', 'position'],
  contact: ['companyId', 'createdAt', 'email', 'fullName', 'id', 'stageId'],
  company: ['createdAt', 'id', 'industry', 'name', 'revenueRange', 'sizeRange'],
  note: ['body', 'createdAt', 'id'],
  task: ['completedAt', 'createdAt', 'dueOn', 'id', 'title'],
} as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const crm = useCrmUnderTest();

const asA = () => bearer(crm().fixture.a.apiKey);

function get(url: string, headers = asA()): Promise<LightMyRequestResponse> {
  return crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/${url}`, headers });
}

function search(email: unknown, headers = asA()): Promise<LightMyRequestResponse> {
  return crm().app.inject({
    method: 'POST',
    url: '/accounts/cuenta-a/contacts/search',
    headers: { ...headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ email }),
  });
}

/** The body of a 200, failing on any other status so a refusal never reads as an empty list. */
function okBody<T>(response: LightMyRequestResponse): T {
  expect(response.statusCode, response.body).toBe(200);
  return bodyOf(response) as T;
}

const keysOf = (value: object): string[] => Object.keys(value).sort();

describe('D12 · each response carries the fields of its list and nothing else', () => {
  it('stages, in pipeline order', async () => {
    const { stages } = okBody<{ stages: Record<string, unknown>[] }>(await get('stages'));
    expect(stages.map(keysOf)).toEqual([KEYS.stage, KEYS.stage]);
    expect(stages).toEqual([
      { id: Number(crm().fixture.a.stageId), key: 'nueva', label: 'Nueva solicitud', position: 0 },
      { id: Number(crm().fixture.extras.secondStageId), key: 'contactada', label: 'Contactada', position: 1 },
    ]);
  });

  it('a contact found by email, with ids as numbers and dates in UTC', async () => {
    const { a } = crm().fixture;
    const { contacts } = okBody<{ contacts: Record<string, unknown>[] }>(await search(a.email));
    expect(contacts).toHaveLength(1);
    expect(keysOf(contacts[0]!)).toEqual(KEYS.contact);
    expect(contacts[0]).toMatchObject({
      id: Number(a.contactId),
      fullName: 'Contacto de cuenta-a',
      email: a.email,
      companyId: Number(a.companyId),
      stageId: Number(a.stageId),
    });
    expect(contacts[0]?.['createdAt']).toMatch(ISO_UTC);
  });

  it('the search trims and lowercases the address before comparing', async () => {
    const { contacts } = okBody<{ contacts: unknown[] }>(await search(`  ${crm().fixture.a.email.toUpperCase()} `));
    expect(contacts).toHaveLength(1);
  });

  it('a contact and a company by id', async () => {
    const { a } = crm().fixture;
    const { contact } = okBody<{ contact: object }>(await get(`contacts/${a.contactId}`));
    const { company } = okBody<{ company: object }>(await get(`companies/${a.companyId}`));
    expect(keysOf(contact)).toEqual(KEYS.contact);
    expect(keysOf(company)).toEqual(KEYS.company);
    expect(company).toMatchObject({ id: Number(a.companyId), name: 'Empresa de cuenta-a', industry: null });
  });

  it('notes and tasks, newest first, without the archived ones', async () => {
    const { a, extras } = crm().fixture;
    const { notes } = okBody<{ notes: Record<string, unknown>[] }>(await get(`contacts/${a.contactId}/notes`));
    const { tasks } = okBody<{ tasks: Record<string, unknown>[] }>(await get(`contacts/${a.contactId}/tasks`));
    expect(notes.map(keysOf)).toEqual([KEYS.note, KEYS.note]);
    expect(notes.map((note) => note['body'])).toEqual(['Segunda nota', 'Primera nota']);
    expect(tasks.map(keysOf)).toEqual([KEYS.task, KEYS.task]);
    expect(tasks.map((task) => task['id'])).not.toContain(Number(extras.archivedTaskId));
    expect(tasks[0]).toMatchObject({ id: Number(extras.doneTaskId), dueOn: '2026-11-30', completedAt: '2026-11-24T10:00:00.000Z' });
  });

  it('limit and before page through a list', async () => {
    const { a, extras } = crm().fixture;
    const first = okBody<{ notes: { id: number }[] }>(await get(`contacts/${a.contactId}/notes?limit=1`));
    expect(first.notes.map((note) => note.id)).toEqual([Number(extras.secondNoteId)]);
    const next = okBody<{ notes: { body: string }[] }>(await get(`contacts/${a.contactId}/notes?limit=1&before=${extras.secondNoteId}`));
    expect(next.notes.map((note) => note.body)).toEqual(['Primera nota']);
  });

  it('an archived contact or company is 404, and an archived address finds nothing', async () => {
    const { extras } = crm().fixture;
    const responses = await Promise.all([
      get(`contacts/${extras.archivedContactId}`),
      get(`contacts/${extras.archivedContactId}/notes`),
      get(`companies/${extras.archivedCompanyId}`),
    ]);
    expect(responses.map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
      [404, 'no_encontrado'],
      [404, 'no_encontrado'],
      [404, 'no_encontrado'],
    ]);
    expect(okBody<{ contacts: unknown[] }>(await search(extras.archivedContactEmail)).contacts).toEqual([]);
  });

  it('no response names the account or an archive date', async () => {
    const { a } = crm().fixture;
    const urls = ['stages', `contacts/${a.contactId}`, `contacts/${a.contactId}/notes`, `contacts/${a.contactId}/tasks`, `companies/${a.companyId}`];
    const responses = await Promise.all(urls.map((url) => get(url)));
    const bodies = [...responses, await search(a.email)].map((response) => okBody<object>(response));
    expect(JSON.stringify(bodies)).not.toMatch(/accountId|account_id|archivedAt|archived_at/);
  });
});

describe('D13 · a record of another account reads as one that does not exist', () => {
  it("account b's contact, notes and company, asked through account a, are 404 like a missing id", async () => {
    const { b } = crm().fixture;
    const missing = await get('contacts/999999');
    const pairs = await Promise.all([
      get(`contacts/${b.contactId}`),
      get(`contacts/${b.contactId}/notes`),
      get(`contacts/${b.contactId}/tasks`),
      get(`companies/${b.companyId}`),
    ]);
    expect(missing.statusCode).toBe(404);
    for (const response of pairs) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(missing.body);
    }
    expect(okBody<{ contacts: unknown[] }>(await search(b.email)).contacts).toEqual([]);
  });

  it("account b's key reads the same contact with 200 (control)", async () => {
    const { b } = crm().fixture;
    const response = await crm().app.inject({ method: 'GET', url: `/accounts/cuenta-b/contacts/${b.contactId}`, headers: bearer(b.apiKey) });
    expect(okBody<{ contact: { email: string } }>(response).contact.email).toBe(b.email);
  });
});
