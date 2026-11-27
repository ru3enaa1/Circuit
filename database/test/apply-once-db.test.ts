import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import {
  ApplyAlreadyClaimed,
  applyDecision,
  CIRCUIT,
  decideRun,
  EventConflict,
  startRun,
  type CrmWriter,
  type DecisionDeps,
} from '../../apps/circuit/src/modules/circuit/index.ts';
import { PgEventStore } from '../../apps/circuit/src/modules/event-store/index.ts';
import { engineDeps, fakeCrm, KNOWN_CONTACT, NORMAL_TEXT, steppingClock } from '../../apps/circuit/test/support/fakes.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, readCircuitPassword } from '../users.ts';
import { sqlErrorOf } from './crm-fixture.ts';
import { SQLSTATE } from './crm-rules.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0012 A4 over PostgreSQL, as circuit_app: station 7 claims the run in circuit.apply_claims
// before its first request, so a decision is applied once, also when two calls race and after a
// restart. Without CIRCUIT_DB_PASSWORD the file fails with the message that names it.
const password = readCircuitPassword(readLocalEnv());
const MENTOR = 'mentor';
/** Long enough for the second call to read and claim while the first one writes. */
const SLOW_WRITE_MS = 300;

let db: DisposableDatabase | undefined;
let asApp: pg.Pool;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await createOrUpdateCircuitApp(db.connection, password);
  asApp = db.poolAs(CIRCUIT_DB_USER, password);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

/** A normal run over PostgreSQL that waits at station 6, with a CRM in memory that counts writes. */
async function waitingRun() {
  const store = new PgEventStore(asApp);
  const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
  const run = await startRun(engineDeps({ store, crmReader: crm }), NORMAL_TEXT);
  const deps = (): DecisionDeps => ({ definition: CIRCUIT, store: new PgEventStore(asApp), claims: new PgEventStore(asApp), clock: steppingClock(), writer: crm });
  return { runId: run.runId, crm, deps };
}

const claimsOf = async (runId: number) => (await asApp.query('SELECT run_id FROM circuit.apply_claims WHERE run_id = $1', [runId])).rowCount;
const eventsOf = async (runId: number) => Number((await asApp.query<{ n: string }>('SELECT count(*) AS n FROM circuit.station_events WHERE run_id = $1', [runId])).rows[0]?.n);

describe('A4 · a decision is applied once', () => {
  it('(control) one decision: one claim, seven events, the proposal written once', async () => {
    const { runId, crm, deps } = await waitingRun();

    await decideRun(deps(), runId, { decision: 'approved' }, MENTOR);

    expect(await claimsOf(runId)).toBe(1);
    expect(await eventsOf(runId)).toBe(7);
    expect(crm.writes).toHaveLength(2);
  });

  it('two applications of the same decision at once write it once; the other is refused by the claim, before any request', async () => {
    const { runId, crm, deps } = await waitingRun();
    // A write that takes its time, so the second call reads no station 7 yet and races on the claim itself.
    const slow: CrmWriter = {
      apply: async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS));
        return crm.apply(...args);
      },
    };
    // Station 6 stored by hand, as decideRun stores it, so both calls race only on station 7.
    await new PgEventStore(asApp).append({
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
      detail: { decision: 'approved', approvedBy: MENTOR, contactId: KNOWN_CONTACT.id, actions: [{ type: 'add_note', body: 'Una vez.' }] },
    });

    const results = await Promise.allSettled([applyDecision({ ...deps(), writer: slow }, runId), applyDecision({ ...deps(), writer: slow }, runId)]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toBeInstanceOf(ApplyAlreadyClaimed);
    expect(crm.writes).toHaveLength(1);
    expect(await eventsOf(runId)).toBe(7);
  });

  it('two decisions at once: the second is an EventConflict, and the proposal is written once', async () => {
    const { runId, crm, deps } = await waitingRun();

    const results = await Promise.allSettled([
      decideRun(deps(), runId, { decision: 'approved' }, MENTOR),
      decideRun(deps(), runId, { decision: 'approved' }, MENTOR),
    ]);

    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.status === 'rejected' && refused[0].reason).toBeInstanceOf(EventConflict);
    expect(crm.writes).toHaveLength(2);
    expect(await claimsOf(runId)).toBe(1);
  });

  it('a claim with no event of station 7 and a restarted engine: no request, no event (M3)', async () => {
    const { runId, crm, deps } = await waitingRun();
    // An apply cut off after its claim: the claim is there, station 6 too, station 7 never came.
    await asApp.query('INSERT INTO circuit.apply_claims (run_id) VALUES ($1)', [runId]);
    await expect(decideRun(deps(), runId, { decision: 'approved' }, MENTOR)).rejects.toThrow(ApplyAlreadyClaimed);
    const stored = await eventsOf(runId);

    // A new engine over the same database, as after a restart.
    await expect(applyDecision(deps(), runId)).rejects.toThrow(ApplyAlreadyClaimed);

    expect(crm.writes).toHaveLength(0);
    expect(await eventsOf(runId)).toBe(stored);
    expect(stored).toBe(6);
  });

  it('circuit_app cannot take a claim back, nor change one', async () => {
    const { runId, deps } = await waitingRun();
    await decideRun(deps(), runId, { decision: 'rejected' }, MENTOR);

    const removed = await sqlErrorOf(() => asApp.query('DELETE FROM circuit.apply_claims WHERE run_id = $1', [runId]));
    const changed = await sqlErrorOf(() => asApp.query('UPDATE circuit.apply_claims SET claimed_at = now() WHERE run_id = $1', [runId]));

    expect([removed.code, changed.code]).toEqual([SQLSTATE.insufficientPrivilege, SQLSTATE.insufficientPrivilege]);
    expect(await claimsOf(runId)).toBe(1);
  });
});
