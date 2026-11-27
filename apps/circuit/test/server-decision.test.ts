import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fakeCrm, KNOWN_CONTACT, MemoryStore } from './support/fakes.ts';
import { GOOD_HOST, TEST_PORT, testServer } from './support/server.ts';

// ADR-0012 A6 and A8, and the tryout route (A12): the decision arrives as JSON from the board's
// own origin, with no approver in the body, and every refusal leaves the events as they were.

type Server = ReturnType<typeof testServer>;

let server: Server;
let crm: ReturnType<typeof fakeCrm>;

beforeEach(() => {
  crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
  server = testServer({ store: new MemoryStore(), crm });
});

afterEach(async () => {
  await server.app.close();
});

const JSON_HEADERS = { host: GOOD_HOST, 'content-type': 'application/json' };

function post(url: string, payload: string, headers: Record<string, string> = JSON_HEADERS) {
  return server.app.inject({ method: 'POST', url, headers, payload });
}

/** A run of the normal sample, waiting at station 6. */
async function waiting(): Promise<number> {
  const started = await post('/api/runs', JSON.stringify({ sample: 'normal' }));
  expect(started.statusCode).toBe(201);
  return (started.json() as { runId: number }).runId;
}

const decide = (runId: number, body: unknown, headers?: Record<string, string>) => post(`/api/runs/${runId}/decision`, JSON.stringify(body), headers);

describe('A12 · POST /api/runs tries one of the scenario\'s samples', () => {
  it('(control) starts a run that stops at the person station, and answers its id', async () => {
    const runId = await waiting();

    expect(runId).toBe(1);
    expect(server.store.stored.map((event) => event.station)).toEqual(['intake', 'filter', 'classification', 'knowledge', 'crm']);
  });

  it.each([
    ['a sample that does not exist', JSON.stringify({ sample: 'otra' }), 'sample'],
    ['a sample that is not a slug', JSON.stringify({ sample: '../x' }), 'sample'],
    ['free text in place of a sample', JSON.stringify({ text: 'Hola' }), 'sample'],
    ['a field of more', JSON.stringify({ sample: 'normal', text: 'Hola' }), 'cuerpo'],
  ])('refuses %s with 400 and starts nothing', async (_case, payload, field) => {
    const answer = await post('/api/runs', payload);

    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toEqual({ error: 'entrada_invalida', field });
    expect(server.store.runs).toHaveLength(0);
  });
});

describe('A6 · the decision route', () => {
  it('(control) approves from the board\'s origin, by either of its names', async () => {
    const first = await waiting();
    const second = await waiting();

    const byIp = await decide(first, { decision: 'approved' }, { ...JSON_HEADERS, origin: `http://127.0.0.1:${TEST_PORT}` });
    const byName = await decide(second, { decision: 'rejected' }, { ...JSON_HEADERS, origin: `http://localhost:${TEST_PORT}` });

    expect([byIp.statusCode, byName.statusCode]).toEqual([200, 200]);
    expect(byIp.json()).toEqual({ runId: first });
    expect(server.store.stored.filter((event) => event.station === 'person').map((event) => event.detail['approvedBy'])).toEqual(['mentor', 'mentor']);
  });

  const refusals: readonly [string, (runId: number) => Promise<{ statusCode: number; json(): unknown }>, number, unknown][] = [
    ['text/plain', (runId) => decide(runId, { decision: 'approved' }, { host: GOOD_HOST, 'content-type': 'text/plain' }), 415, { error: 'tipo_no_admitido' }],
    ['a form', (runId) => post(`/api/runs/${runId}/decision`, 'decision=approved', { host: GOOD_HOST, 'content-type': 'application/x-www-form-urlencoded' }), 415, { error: 'tipo_no_admitido' }],
    ['no content type', (runId) => post(`/api/runs/${runId}/decision`, '', { host: GOOD_HOST }), 415, { error: 'tipo_no_admitido' }],
    ['another origin (M4)', (runId) => decide(runId, { decision: 'approved' }, { ...JSON_HEADERS, origin: 'http://ejemplo.test' }), 403, { error: 'origen_no_permitido' }],
    ['the board\'s host on another port', (runId) => decide(runId, { decision: 'approved' }, { ...JSON_HEADERS, origin: 'http://127.0.0.1:9999' }), 403, { error: 'origen_no_permitido' }],
    ['a body with approvedBy', (runId) => decide(runId, { decision: 'approved', approvedBy: 'otra-persona' }), 400, { error: 'entrada_invalida', field: 'cuerpo' }],
    ['a decision that is not one of the three', (runId) => decide(runId, { decision: 'maybe' }), 400, { error: 'entrada_invalida', field: 'decision' }],
    ['a __proto__ key', (runId) => post(`/api/runs/${runId}/decision`, '{"decision":"approved","__proto__":{"polluted":true}}'), 400, { error: 'entrada_invalida' }],
    ['a body past 16 KiB', (runId) => decide(runId, { decision: 'corrected', actions: [{ type: 'add_note', body: 'x'.repeat(17_000) }] }), 413, { error: 'cuerpo_demasiado_grande' }],
    ['another Host', (runId) => decide(runId, { decision: 'approved' }, { ...JSON_HEADERS, host: 'ejemplo.test' }), 403, { error: 'anfitrion_no_permitido' }],
  ];

  it.each(refusals)('refuses %s, and no event is added', async (_case, send, status, body) => {
    const runId = await waiting();
    const before = server.store.stored.length;

    const answer = await send(runId);

    expect(answer.statusCode).toBe(status);
    expect(answer.json()).toEqual(body);
    expect(server.store.stored).toHaveLength(before);
    expect(crm.writes).toHaveLength(0);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('a second decision is a 409, and the first is the one that stays', async () => {
    const runId = await waiting();
    await decide(runId, { decision: 'rejected' });
    const before = server.store.stored.length;

    const second = await decide(runId, { decision: 'approved' });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'no_espera_decision' });
    expect(server.store.stored).toHaveLength(before);
    expect(crm.writes).toHaveLength(0);
  });

  it('a run that does not exist is a 409 too', async () => {
    const answer = await decide(42, { decision: 'approved' });

    expect(answer.statusCode).toBe(409);
    expect(server.store.stored).toHaveLength(0);
  });

  it('answers no preflight: another origin gets no CORS header to send JSON with', async () => {
    const runId = await waiting();

    const answer = await server.app.inject({
      method: 'OPTIONS',
      url: `/api/runs/${runId}/decision`,
      headers: { host: GOOD_HOST, origin: 'http://ejemplo.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });

    expect(answer.statusCode).toBe(404);
    expect(answer.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('A8 · a correction passes the same checks as station 5\'s proposal', () => {
  it('(control) a corrected list is stored and applied as the mentor wrote it', async () => {
    const runId = await waiting();

    const answer = await decide(runId, { decision: 'corrected', actions: [{ type: 'add_note', body: 'Corregida.' }] });

    expect(answer.statusCode).toBe(200);
    expect(crm.writes.map((write) => write.action)).toEqual([{ type: 'add_note', body: 'Corregida.' }]);
  });

  it.each([
    ['delete_contact', [{ type: 'delete_contact' }], 'actions'],
    ['a note of 4001 characters', [{ type: 'add_note', body: 'x'.repeat(4001) }], 'actions[0].body'],
    ['a field of more', [{ type: 'add_note', body: 'Nota.', contactId: 99 }], 'actions'],
    ['a create_contact for a contact the CRM already has', [{ type: 'create_contact', fullName: 'Otra' }], 'actions[0].type'],
    ['six actions', Array.from({ length: 6 }, () => ({ type: 'add_note', body: 'Nota.' })), 'actions'],
    ['an approval with a list', undefined, 'actions'],
  ])('refuses %s with 400, and stores no event', async (_case, actions, field) => {
    const runId = await waiting();
    const before = server.store.stored.length;
    const body = actions === undefined ? { decision: 'approved', actions: [] } : { decision: 'corrected', actions };

    const answer = await decide(runId, body);

    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toEqual({ error: 'entrada_invalida', field });
    expect(server.store.stored).toHaveLength(before);
    expect(crm.writes).toHaveLength(0);
  });
});
