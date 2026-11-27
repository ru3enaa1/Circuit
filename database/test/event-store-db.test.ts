import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import { CIRCUIT, decideRun, startRun, type ApplyClaims, type EventStore } from '../../apps/circuit/src/modules/circuit/index.ts';
import { PgEventStore } from '../../apps/circuit/src/modules/event-store/index.ts';
import { KNOWN_CONTACT, MemoryStore, NORMAL_TEXT, engineDeps, fakeCrm, steppingClock } from '../../apps/circuit/test/support/fakes.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, readCircuitPassword } from '../users.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0010 D10 and D16: the store over PostgreSQL gives back exactly what the engine stored, so
// a run through it is the run through the store in memory, event for event. As circuit_app.
const password = readCircuitPassword(readLocalEnv());

let db: DisposableDatabase | undefined;
let store: PgEventStore;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await createOrUpdateCircuitApp(db.connection, password);
  store = new PgEventStore(db.poolAs(CIRCUIT_DB_USER, password));
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

/** One normal run from intake to close, on the given store, with fresh fakes and clocks. */
async function fullRun(on: EventStore & ApplyClaims) {
  const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
  const started = await startRun(engineDeps({ store: on, crmReader: crm }), NORMAL_TEXT);
  return decideRun({ definition: CIRCUIT, store: on, clock: steppingClock(), claims: on, writer: crm }, started.runId, { decision: 'approved' }, 'mentor');
}

describe('D16 · the PostgreSQL store, as circuit_app', () => {
  it('gives back the same events as the store in memory, for a run from 1 to 7', async () => {
    const inMemory = await fullRun(new MemoryStore());
    const inDatabase = await fullRun(store);

    const withoutRun = <T extends { runId: number }>(events: readonly T[]) => events.map(({ runId: _runId, ...rest }) => rest);
    expect(withoutRun(await store.events(inDatabase.runId))).toEqual(withoutRun(inMemory.events));
    expect(inDatabase.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps each run apart, and an unknown run has no events', async () => {
    const first = await fullRun(store);
    const second = await fullRun(store);

    expect(second.runId).toBeGreaterThan(first.runId);
    expect((await store.events(first.runId)).every((event) => event.runId === first.runId)).toBe(true);
    expect(await store.events(999_999)).toEqual([]);
  });

  it('refuses a second event of a station already stored, as the table says', async () => {
    const run = await fullRun(store);
    const [intake] = await store.events(run.runId);

    await expect(store.append({ ...intake!, seq: 8 })).rejects.toThrow();
    expect(await store.events(run.runId)).toHaveLength(7);
  });
});
