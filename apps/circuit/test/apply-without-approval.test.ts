import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyDecision,
  CIRCUIT,
  decideRun,
  startRun,
  type ApplyClaims,
  type DecisionDeps,
  type EventStore,
  type StationEvent,
} from '../src/modules/circuit/index.ts';
import { HttpCrmClient } from '../src/modules/crm-client/index.ts';
import { FAKE_ACCOUNT, FAKE_KEY, startFakeCrmHttp, type FakeCrmHttp } from './support/fake-crm-http.ts';
import { MemoryStore, NORMAL_REPLIES, NORMAL_TEXT, engineDeps, scriptedModel, steppingClock } from './support/fakes.ts';

// ADR-0012 A2 and A5, with a CRM over real HTTP on 127.0.0.1 that counts every request: applying
// without an approval sends no write, and an approval sends exactly its actions, in order, once.

const MENTOR = 'mentor';
const LUCIA_ID = 7;

let crm: FakeCrmHttp;
let client: HttpCrmClient;

beforeEach(async () => {
  crm = await startFakeCrmHttp();
  client = new HttpCrmClient({ baseUrl: crm.url, key: FAKE_KEY }, FAKE_ACCOUNT);
});

afterEach(async () => {
  await crm.close();
});

/** A run of the normal request that waits at station 6, read and proposed over HTTP. */
async function waitingRun(store: MemoryStore, replies = NORMAL_REPLIES): Promise<number> {
  const run = await startRun(engineDeps({ store, crmReader: client, model: scriptedModel(replies) }), NORMAL_TEXT);
  expect(run.at).toBe('person');
  return run.runId;
}

const decisionDeps = (store: EventStore & ApplyClaims): DecisionDeps => ({ definition: CIRCUIT, store, claims: store, clock: steppingClock(), writer: client });

const closeOf = (events: readonly StationEvent[]) => events.find((event) => event.station === 'close');

describe('A2 · applying without an approval sends no write to the CRM', () => {
  it('(control) station 5 read the CRM over HTTP, with the key', async () => {
    await waitingRun(new MemoryStore());

    expect(crm.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `POST /accounts/${FAKE_ACCOUNT}/contacts/search`,
      `GET /accounts/${FAKE_ACCOUNT}/stages`,
    ]);
    expect(crm.requests.every((request) => request.authorization === `Bearer ${FAKE_KEY}`)).toBe(true);
  });

  it('(a) a run with no event of station 6: 0 writes, and station 7 fails with sin_aprobacion', async () => {
    const store = new MemoryStore();
    const runId = await waitingRun(store);

    const done = await applyDecision(decisionDeps(store), runId);

    expect(crm.writes()).toHaveLength(0);
    expect(closeOf(done.events)).toMatchObject({ seq: 6, status: 'failed', outcome: 'error', detail: { reason: 'sin_aprobacion' } });
    // Nothing was claimed: there was nothing to apply.
    expect(store.claimed.size).toBe(0);
  });

  it('(b) the approval of run A does not apply run B: 0 writes', async () => {
    const store = new MemoryStore();
    const runA = await waitingRun(store);
    const runB = await waitingRun(store);
    await decideRun(decisionDeps(store), runA, { decision: 'approved' }, MENTOR);
    const writesOfA = crm.writes().length;
    const approvalOfA = store.stored.find((event) => event.runId === runA && event.station === 'person');
    // A store that hands run B the event that approved run A, as a bug or a planted row would.
    const planted: EventStore & ApplyClaims = {
      createRun: (run) => store.createRun(run),
      append: async (event) => {
        store.stored.push(event);
      },
      events: async (id) => (id === runB && approvalOfA !== undefined ? [...(await store.events(runB)), approvalOfA] : store.events(id)),
      claim: (id) => store.claim(id),
    };

    const done = await applyDecision(decisionDeps(planted), runB);

    expect(writesOfA).toBe(2);
    expect(crm.writes()).toHaveLength(writesOfA);
    expect(closeOf(done.events.filter((event) => event.runId === runB))).toMatchObject({ status: 'failed', detail: { reason: 'sin_aprobacion' } });
  });

  it('(c) rejected: 0 writes, and station 7 completes', async () => {
    const store = new MemoryStore();
    const runId = await waitingRun(store);

    const done = await decideRun(decisionDeps(store), runId, { decision: 'rejected' }, MENTOR);

    expect(crm.writes()).toHaveLength(0);
    expect(closeOf(done.events)).toMatchObject({ status: 'completed', outcome: 'done', detail: { results: [] } });
  });

  it('(d) approved: exactly the approved actions, in order, each signed by the mentor and the run', async () => {
    const store = new MemoryStore();
    const runId = await waitingRun(store);

    await decideRun(decisionDeps(store), runId, { decision: 'approved' }, MENTOR);

    const approval = { approvedBy: MENTOR, approvalRef: `run-${runId}` };
    expect(crm.writes()).toEqual([
      expect.objectContaining({ method: 'POST', path: `/accounts/${FAKE_ACCOUNT}/contacts/${LUCIA_ID}/notes`, body: { body: 'Pide ayuda para ordenar sus procesos.', approval } }),
      expect.objectContaining({ method: 'PATCH', path: `/accounts/${FAKE_ACCOUNT}/contacts/${LUCIA_ID}`, body: { stageId: 13, approval } }),
    ]);
  });

  it('(d) corrected: the mentor\'s list as stored in station 6, not station 5\'s proposal (M1)', async () => {
    const store = new MemoryStore();
    const runId = await waitingRun(store);
    const actions = [{ type: 'create_task', title: 'Llamar el lunes', dueOn: '2026-12-01' }];

    await decideRun(decisionDeps(store), runId, { decision: 'corrected', actions }, MENTOR);

    expect(crm.writes().map((request) => request.body)).toEqual([
      { title: 'Llamar el lunes', dueOn: '2026-12-01', approval: { approvedBy: MENTOR, approvalRef: `run-${runId}` } },
    ]);
  });
});

describe('A5 · in order, one request each, no retries, stopping at the first failure', () => {
  const THREE = [
    { type: 'add_note', body: 'Primera.' },
    { type: 'create_task', title: 'Segunda', dueOn: null },
    { type: 'move_stage', stage: 'programa-propuesto' },
  ];

  it('a 500 on the second of three: the first stays, the third is never asked, and the event says all three', async () => {
    const store = new MemoryStore();
    const runId = await waitingRun(store);
    crm.failWrite(2, 500);

    const done = await decideRun(decisionDeps(store), runId, { decision: 'corrected', actions: THREE }, MENTOR);

    // One request for the 500, never a second one (M6).
    expect(crm.writes().map((request) => `${request.method} ${request.path.replace(/^.*\/contacts/, '/contacts')}`)).toEqual([
      `POST /contacts/${LUCIA_ID}/notes`,
      `POST /contacts/${LUCIA_ID}/tasks`,
    ]);
    const close = closeOf(done.events);
    expect(close).toMatchObject({ status: 'failed', outcome: 'error' });
    expect(close?.detail).toEqual({
      approvalRef: `run-${runId}`,
      results: [
        { type: 'add_note', result: 'applied', id: 501, status: 201 },
        { type: 'create_task', result: 'failed', status: 500 },
        { type: 'move_stage', result: 'not_sent' },
      ],
    });
    // Nothing of the CRM's answer body reaches the event.
    expect(JSON.stringify(done.events)).not.toContain('cuerpo que no debe guardarse');
  });
});
