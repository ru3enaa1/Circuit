import { describe, expect, it } from 'vitest';

import {
  ApplyAlreadyClaimed,
  applyDecision,
  approvalFrom,
  CIRCUIT,
  decideRun,
  NotAnApproval,
  startRun,
  type Approval,
  type DecisionDeps,
  type StationEvent,
} from '../src/modules/circuit/index.ts';
import { MemoryStore, NORMAL_TEXT, engineDeps, fakeCrm, KNOWN_CONTACT, steppingClock } from './support/fakes.ts';

// ADR-0012 A1 and A4 in memory: only approvalFrom makes an Approval, from a stored event of the
// person station that approved, for its own run; and station 7 claims the run before it writes.

const MENTOR = 'mentor';

function personEvent(change: Partial<StationEvent> = {}, detail: Record<string, unknown> = {}): StationEvent {
  return {
    runId: 3,
    seq: 6,
    station: 'person',
    outcome: 'approved',
    status: 'completed',
    startedAt: '2026-11-27T09:00:00.000Z',
    durationMs: 10,
    tokensIn: 0,
    tokensOut: 0,
    costMicroUsd: 0,
    model: 'person',
    detail: { decision: 'approved', approvedBy: MENTOR, contactId: 7, actions: [{ type: 'add_note', body: 'Nota.' }], ...detail } as StationEvent['detail'],
    ...change,
  };
}

describe('A1 · an Approval comes only from approvalFrom and a stored approving event', () => {
  it('(control) a stored approval of run 3 approves run 3, with its ref and its actions', () => {
    const approval = approvalFrom(CIRCUIT, 3, personEvent());

    expect(approval).toMatchObject({ runId: 3, approvedBy: MENTOR, approvalRef: 'run-3', contactId: 7, actions: [{ type: 'add_note', body: 'Nota.' }] });
    expect(Object.isFrozen(approval)).toBe(true);
    expect(Object.isFrozen(approval.actions[0])).toBe(true);
  });

  it.each([
    ['another run (M2)', 4, personEvent(), 'runId'],
    ['another station', 3, personEvent({ station: 'crm' }), 'station'],
    ['a rejection', 3, personEvent({ outcome: 'rejected' }, { decision: 'rejected' }), 'decision'],
    ['an outcome the detail does not repeat', 3, personEvent({ outcome: 'corrected' }), 'decision'],
    ['a failed event', 3, personEvent({ status: 'failed' }), 'decision'],
    ['a key as the approver', 3, personEvent({}, { approvedBy: 'key-7' }), 'approvedBy'],
    ['no approver', 3, personEvent({}, { approvedBy: null }), 'approvedBy'],
  ])('refuses %s', (_case, runId, event, field) => {
    expect(() => approvalFrom(CIRCUIT, runId, event)).toThrow(NotAnApproval);
    expect(() => approvalFrom(CIRCUIT, runId, event)).toThrow(expect.objectContaining({ field }));
  });

  it('refuses a stored list that is not one of the closed list', () => {
    const event = personEvent({}, { actions: [{ type: 'delete_contact' }] });

    expect(() => approvalFrom(CIRCUIT, 3, event)).toThrow();
  });

  it('cannot be written as an object literal, nor handed to the writer as one', async () => {
    const writer = fakeCrm();
    const action = { type: 'add_note', body: 'Nota.' } as const;
    // @ts-expect-error: the mark is a symbol only approval.ts can name.
    const forged: Approval = { runId: 3, approvedBy: MENTOR, approvalRef: 'run-3', contactId: 7, actions: [action] };
    // @ts-expect-error: the writer takes an Approval, and a literal is not one.
    await writer.apply({ runId: 3, approvedBy: MENTOR, approvalRef: 'run-3', contactId: 7, actions: [action] }, action, 7);

    expect(forged.runId).toBe(3);
  });
});

async function waitingRun() {
  const store = new MemoryStore();
  const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
  const run = await startRun(engineDeps({ store, crmReader: crm }), NORMAL_TEXT);
  const deps: DecisionDeps = { definition: CIRCUIT, store, claims: store, clock: steppingClock(), writer: crm };
  return { run, store, crm, deps };
}

describe('A4 · station 7 claims the run before its first write', () => {
  it('claims the run when it applies, and the claim is kept', async () => {
    const { run, store, deps } = await waitingRun();

    await decideRun(deps, run.runId, { decision: 'approved' }, MENTOR);

    expect([...store.claimed]).toEqual([run.runId]);
  });

  it('a claim with no event of station 7 (a cut-off apply) sends nothing and stores nothing, also on a new start (M3)', async () => {
    const { run, store, crm, deps } = await waitingRun();
    await expect(decideRun({ ...deps, claims: { claim: async () => false } }, run.runId, { decision: 'approved' }, MENTOR)).rejects.toThrow(
      ApplyAlreadyClaimed,
    );
    const stored = store.stored.length;
    store.claimed.add(run.runId);

    // A restarted engine: new deps over the same store, which still holds the claim.
    await expect(applyDecision({ ...deps, clock: steppingClock() }, run.runId)).rejects.toThrow(ApplyAlreadyClaimed);

    expect(crm.writes).toHaveLength(0);
    expect(store.stored).toHaveLength(stored);
    expect(store.stored.at(-1)?.station).toBe('person');
  });

  it('a rejection claims too, so a second close of it is refused the same way', async () => {
    const { run, store, deps } = await waitingRun();

    await decideRun(deps, run.runId, { decision: 'rejected' }, MENTOR);

    expect(store.claimed.has(run.runId)).toBe(true);
  });
});
