import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import { PgEventStore } from '../../apps/circuit/src/modules/event-store/index.ts';
import { eventsPath, runCase, serialize } from '../../apps/circuit/test/golden/harness.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, readCircuitPassword } from '../users.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0010 D16: the golden case `normal`, run against a disposable database as circuit_app.
// What circuit.station_events holds afterwards is its events.json, byte for byte. The database
// is new, so the run is its first and gets id 1, as in the store in memory.
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

describe('D16 · the golden case normal, stored in PostgreSQL', () => {
  it('reads back from circuit.station_events exactly its events.json', async () => {
    const ran = await runCase('normal', store);

    expect(ran[0]?.runId).toBe(1);
    expect(serialize(await store.events(1))).toBe(readFileSync(eventsPath('normal'), 'utf8'));
  });
});
