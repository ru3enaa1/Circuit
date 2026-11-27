import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { approvalFrom, CIRCUIT, CrmWriteFailed, type StationEvent } from '../src/modules/circuit/index.ts';
import { CrmClientConfigError, HttpCrmClient, readAgentKey, readCrmEndpoint, readCrmUrl } from '../src/modules/crm-client/index.ts';
import { FAKE_ACCOUNT, FAKE_KEY, startFakeCrmHttp, type FakeCrmHttp } from './support/fake-crm-http.ts';
import { MemoryStore } from './support/fakes.ts';
import { GOOD_HOST, testServer } from './support/server.ts';

// ADR-0012 A9: crm-client talks to loopback only, refuses a redirect, and the agent's key appears
// in no event, no log line and no error message.

describe('CRM_URL', () => {
  it('(control) is the CRM on 127.0.0.1:4010 when unset, and takes localhost', () => {
    expect(readCrmUrl(undefined).href).toBe('http://127.0.0.1:4010/');
    expect(readCrmUrl('').href).toBe('http://127.0.0.1:4010/');
    expect(readCrmUrl('http://localhost:4011').href).toBe('http://localhost:4011/');
  });

  it.each([
    'http://ejemplo.test',
    'http://ejemplo.test:4010',
    'https://127.0.0.1:4010',
    'http://127.0.0.2:4010',
    'http://127.0.0.1:4010/otra',
    'http://agente:clave@127.0.0.1:4010',
    'http://127.0.0.1:4010/?x=1',
    'no es una URL',
  ])('refuses %s at start-up, naming the variable and not the value', (value) => {
    expect(() => readCrmUrl(value)).toThrow(CrmClientConfigError);
    expect(() => readCrmUrl(value)).toThrow(/CRM_URL/);
    expect(() => readCrmUrl(value)).not.toThrow('ejemplo');
  });
});

describe('ADR-0020 D2 · CRM_URL inside Compose', () => {
  it('(control) http://crm:<port> is refused on the host', () => {
    expect(() => readCrmUrl('http://crm:4010')).toThrow(CrmClientConfigError);
    expect(() => readCrmUrl('http://crm:4010', false)).toThrow(/CRM_URL/);
  });

  it('inside a container it takes http://crm:<port>, and still refuses any other host', () => {
    expect(readCrmUrl('http://crm:4010', true).href).toBe('http://crm:4010/');
    expect(readCrmUrl(undefined, true).href).toBe('http://127.0.0.1:4010/');
    expect(() => readCrmUrl('http://ejemplo.test:4010', true)).toThrow(CrmClientConfigError);
    expect(() => readCrmUrl('https://crm:4010', true)).toThrow(CrmClientConfigError);
  });
});

describe('CRM_AGENT_KEY_FILE', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'circuit-key-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(control) reads the key the seed wrote, with its newline, relative to the root or absolute', () => {
    writeFileSync(join(dir, 'key'), `${FAKE_KEY}\n`);

    expect(readAgentKey('key', dir)).toBe(FAKE_KEY);
    expect(readAgentKey(join(dir, 'key'), '/en/otra/parte')).toBe(FAKE_KEY);
    expect(readCrmEndpoint({ CRM_AGENT_KEY_FILE: 'key' }, dir)).toEqual({ baseUrl: new URL('http://127.0.0.1:4010'), key: FAKE_KEY });
  });

  it.each([
    ['unset', undefined, null],
    ['a file that does not exist', 'no-existe', null],
    ['a file that is not a key', 'mala', 'contenido-secreto-que-no-se-muestra'],
  ])('stops the start-up when %s, naming the variable and never the content', (_case, file, content) => {
    if (content !== null && file !== undefined) writeFileSync(join(dir, file), content);

    expect(() => readAgentKey(file, dir)).toThrow(CrmClientConfigError);
    expect(() => readAgentKey(file, dir)).toThrow(/CRM_AGENT_KEY_FILE/);
    expect(() => readAgentKey(file, dir)).not.toThrow(/contenido-secreto|no-existe/);
  });
});

function approvingEvent(runId: number): StationEvent {
  return {
    runId,
    seq: 6,
    station: 'person',
    outcome: 'approved',
    status: 'completed',
    startedAt: '2026-11-27T09:00:00.000Z',
    durationMs: 1,
    tokensIn: 0,
    tokensOut: 0,
    costMicroUsd: 0,
    model: 'person',
    detail: { decision: 'approved', approvedBy: 'mentor', contactId: 7, actions: [{ type: 'add_note', body: 'Nota.' }] },
  };
}

describe('every request', () => {
  let crm: FakeCrmHttp;
  let elsewhere: FakeCrmHttp;

  beforeEach(async () => {
    crm = await startFakeCrmHttp();
    elsewhere = await startFakeCrmHttp();
  });

  afterEach(async () => {
    await crm.close();
    await elsewhere.close();
  });

  it('refuses a redirect: the other port receives nothing, and the write fails without a status (M5)', async () => {
    crm.redirectTo(new URL(`/accounts/${FAKE_ACCOUNT}/contacts/7/notes`, elsewhere.url));
    const client = new HttpCrmClient({ baseUrl: crm.url, key: FAKE_KEY }, FAKE_ACCOUNT);
    const approval = approvalFrom(CIRCUIT, 1, approvingEvent(1));

    const attempt = client.apply(approval, approval.actions[0]!, 7);

    await expect(attempt).rejects.toThrow(CrmWriteFailed);
    await expect(attempt).rejects.toMatchObject({ status: null });
    expect(crm.requests).toHaveLength(1);
    expect(elsewhere.requests).toHaveLength(0);
  });

  it('refuses to send an action the Approval does not list', async () => {
    const client = new HttpCrmClient({ baseUrl: crm.url, key: FAKE_KEY }, FAKE_ACCOUNT);
    const approval = approvalFrom(CIRCUIT, 1, approvingEvent(1));

    await expect(client.apply(approval, { type: 'add_note', body: 'Otra.' }, 7)).rejects.toThrow(CrmWriteFailed);
    expect(crm.requests).toHaveLength(0);
  });

  it('a failed write says its status, and its message holds neither the key nor the body', async () => {
    crm.failWrite(1, 500);
    const client = new HttpCrmClient({ baseUrl: crm.url, key: FAKE_KEY }, FAKE_ACCOUNT);
    const approval = approvalFrom(CIRCUIT, 1, approvingEvent(1));

    const error: unknown = await client.apply(approval, approval.actions[0]!, 7).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrmWriteFailed);
    expect(error).toMatchObject({ status: 500 });
    expect(String((error as Error).message)).not.toContain(FAKE_KEY);
    expect(String((error as Error).message)).not.toContain('cuerpo que no debe guardarse');
  });

  it('the key reaches the CRM in the header, and no event and no log line of a whole run', async () => {
    const store = new MemoryStore();
    const client = new HttpCrmClient({ baseUrl: crm.url, key: FAKE_KEY }, FAKE_ACCOUNT);
    const { app, lines } = testServer({ store, crm: client });
    const post = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, headers: { host: GOOD_HOST, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });

    const started = await post('/api/runs', { sample: 'normal' });
    const runId = (started.json() as { runId: number }).runId;
    const decided = await post(`/api/runs/${runId}/decision`, { decision: 'approved' });

    expect([started.statusCode, decided.statusCode]).toEqual([201, 200]);
    expect(crm.writes()).toHaveLength(2);
    expect(crm.requests.every((request) => request.authorization === `Bearer ${FAKE_KEY}`)).toBe(true);
    expect(JSON.stringify(store.stored)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(lines)).not.toContain('crmk_');
    await app.close();
  });
});
