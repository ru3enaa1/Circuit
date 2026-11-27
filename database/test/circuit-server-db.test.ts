import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { projectRun } from '../../apps/board/src/projection.ts';
import type { CircuitInfo, RunEvent } from '../../apps/board/src/api.ts';
import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import { CIRCUIT, LOW_CONFIDENCE_BELOW } from '../../apps/circuit/src/modules/circuit/index.ts';
import { CRM_TOOLS } from '../../apps/circuit/src/modules/crm-client/index.ts';
import { PgEventStore, PgRunReader } from '../../apps/circuit/src/modules/event-store/index.ts';
import { SIMULATOR_NAME } from '../../apps/circuit/src/modules/model/index.ts';
import { startCircuit, startupMessage, type RunningCircuit } from '../../apps/circuit/src/main.ts';
import { circuitPayload, EVENT_FIELDS, RUN_FIELDS } from '../../apps/circuit/src/server/api.ts';
import type { LogLine } from '../../apps/circuit/src/server/log.ts';
import { buildServer } from '../../apps/circuit/src/server/server.ts';
import { GOLDEN_CASES, readInput, runCase } from '../../apps/circuit/test/golden/harness.ts';
import { DOCUMENTS, MemoryStore } from '../../apps/circuit/test/support/fakes.ts';
import { GOOD_HOST, TEST_MENTOR, TEST_PORT, TEST_SAMPLES, fakeBoardDir, memoryCommands } from '../../apps/circuit/test/support/server.ts';
import { FAKE_KEY } from '../../apps/circuit/test/support/fake-crm-http.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, readCircuitPassword } from '../users.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0011 B4, B5 and B13 over PostgreSQL, as circuit_app: the four golden cases stored by the
// engine, read back by the circuit server, and projected as the board does. Also the circuit
// process's start-up (main.ts), on a free port of 127.0.0.1.

const env = readLocalEnv();
const password = readCircuitPassword(env);
const board = fakeBoardDir();
// Since F2.4 circuit reads the agent's key at start-up (ADR-0012 A9); a key of its shape, in the board's temporary folder.
const keyFile = join(board.dir, 'agent-key');
writeFileSync(keyFile, `${FAKE_KEY}\n`);

let db: DisposableDatabase | undefined;
let reader: PgRunReader;
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await createOrUpdateCircuitApp(db.connection, password);
  const pool = db.poolAs(CIRCUIT_DB_USER, password);
  const store = new PgEventStore(pool);
  // A new database: the cases get ids 1 to 4, in the order of GOLDEN_CASES.
  for (const name of GOLDEN_CASES) await runCase(name, store);
  reader = new PgRunReader(pool);
  const circuit = circuitPayload({ definition: CIRCUIT, scenario: 'escuela', model: SIMULATOR_NAME, lowConfidenceBelow: LOW_CONFIDENCE_BELOW, documents: DOCUMENTS, samples: TEST_SAMPLES, mentor: TEST_MENTOR });
  app = buildServer({ reader, circuit, tools: CRM_TOOLS, board: new Map(), port: () => TEST_PORT, log: () => undefined, commands: memoryCommands(new MemoryStore()) });
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  await db?.drop();
  board.remove();
}, DATABASE_HOOK_TIMEOUT_MS);

const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: GOOD_HOST } });

async function rowCounts(): Promise<readonly number[]> {
  const result = await db?.pool.query<{ runs: string; events: string }>(
    'SELECT (SELECT count(*) FROM circuit.runs) AS runs, (SELECT count(*) FROM circuit.station_events) AS events',
  );
  const row = result?.rows[0];
  return [Number(row?.runs), Number(row?.events)];
}

describe('B5 · the read API over PostgreSQL', () => {
  it('GET /api/runs: the four runs, newest first, each with its last event and the fields of the list', async () => {
    const { runs } = (await get('/api/runs')).json();

    expect(runs.map((run: { id: number; events: number; lastStation: string }) => [run.id, run.events, run.lastStation])).toEqual([
      [4, 5, 'close'],
      [3, 2, 'filter'],
      [2, 5, 'close'],
      [1, 7, 'close'],
    ]);
    for (const run of runs) expect(Object.keys(run).sort()).toEqual([...RUN_FIELDS].sort());
    expect(runs[1]).toMatchObject({ lastOutcome: 'injection', lastStatus: 'stopped', startedAt: '2026-11-26T09:00:00.000Z' });
  });

  it.each(GOLDEN_CASES.map((name, index) => [name, index + 1] as const))('the events of %s carry the fields of the list and nothing the filter crossed out', async (name, id) => {
    const response = await get(`/api/runs/${id}/events`);
    const { personal } = readInput(name);

    expect(response.statusCode).toBe(200);
    for (const event of response.json().events) expect(Object.keys(event).sort()).toEqual([...EVENT_FIELDS].sort());
    expect(personal.length).toBeGreaterThan(0);
    for (const value of personal) expect(response.body, value).not.toContain(value);
  });

  it('after=<seq> gives only the later events; a run that does not exist gives 404', async () => {
    const later = (await get('/api/runs/1/events?after=4')).json();

    expect(later.events.map((event: { seq: number }) => event.seq)).toEqual([5, 6, 7]);
    expect((await get('/api/runs/99/events')).statusCode).toBe(404);
  });

  it('a run with no event yet is listed with nulls', async () => {
    const empty = await new PgEventStore((db as DisposableDatabase).poolAs(CIRCUIT_DB_USER, password)).createRun({
      scenario: 'escuela',
      inputSha256: 'a'.repeat(64),
      startedAt: '2026-11-26T10:00:00.000Z',
    });
    const [newest] = await reader.latestRuns(1);

    expect(newest).toEqual({ id: empty, startedAt: '2026-11-26T10:00:00.000Z', events: 0, lastStation: null, lastOutcome: null, lastStatus: null });
    expect(await reader.eventsAfter(empty, 0)).toEqual([]);
  });
});

// ADR-0012 amends B13: POST /api/runs and POST /api/runs/:id/decision are the only writes.
describe('B13 · every other route only reads', () => {
  it('POST, PUT, PATCH and DELETE on every read route give 404, and the tables do not change', async () => {
    const before = await rowCounts();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const urls = ['/', '/api/circuit', '/api/runs', '/api/runs/1/events', '/api/tools'].filter((url) => !(method === 'POST' && url === '/api/runs'));
      for (const url of urls) {
        const response = await app.inject({ method, url, headers: { host: GOOD_HOST, 'content-type': 'application/json' }, payload: '{"decision":"approved"}' });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    expect(await rowCounts()).toEqual(before);
  });
});

describe('B4 · end to end: the golden case normal, stored, read and projected', () => {
  it('gives the final view: seven stations completed and the main route lit', async () => {
    const info = (await get('/api/circuit')).json() as CircuitInfo;
    const { events } = (await get('/api/runs/1/events')).json() as { events: RunEvent[] };
    const view = projectRun(info, events);

    expect(view.stations.map((station) => station.status)).toEqual(Array(7).fill('completed'));
    expect(view.edges.filter((edge) => edge.taken).map((edge) => `${edge.from}>${edge.to}`)).toEqual([
      'intake>filter',
      'filter>classification',
      'classification>knowledge',
      'knowledge>crm',
      'crm>person',
      'person>close',
      'close>end',
    ]);
    expect(view.finished).toBe(true);
  });
});

describe('main.ts · the circuit process', () => {
  const baseEnv = () => ({ ...env, POSTGRES_DB: db?.name ?? '', CIRCUIT_PORT: '0', CIRCUIT_SCENARIO: 'escuela', CRM_AGENT_KEY_FILE: keyFile });

  it('listens on 127.0.0.1, serves the API and the board, and closes', async () => {
    const lines: LogLine[] = [];
    let running: RunningCircuit | undefined;
    try {
      running = await startCircuit(baseEnv(), { log: (line) => lines.push(line), boardDir: board.dist });
      expect(running.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const circuit = await fetch(`${running.address}/api/circuit`);
      const page = await fetch(`${running.address}/`);
      expect(circuit.status).toBe(200);
      expect(((await circuit.json()) as CircuitInfo).documents.length).toBeGreaterThan(0);
      expect(await page.text()).toContain('<div id="root">');
      expect(page.headers.get('content-security-policy')).toBe("default-src 'self'; frame-ancestors 'none'");
      expect(lines).toContainEqual({ event: 'listening', address: running.address });
    } finally {
      await running?.close();
    }
  });

  it('without a built board it says which command builds it', async () => {
    const lines: LogLine[] = [];
    const running = await startCircuit(baseEnv(), { log: (line) => lines.push(line), boardDir: `${board.dir}/no-dist` });
    await running.close();

    expect(lines).toContainEqual({ event: 'board_missing', fix: 'npm run board:build' });
  });

  it.each([
    [{ CIRCUIT_DB_PASSWORD: 'otra-clave-que-no-es-la-buena' }, 'npm run db:users'],
    [{ POSTGRES_DB: 'circuit_no_existe' }, 'npm run db:migrate'],
    [{ CIRCUIT_SCENARIO: 'no-existe' }, 'CIRCUIT_SCENARIO'],
    [{ DB_PORT: '1' }, 'docker compose up'],
    [{ CRM_AGENT_KEY_FILE: join(board.dir, 'no-existe') }, 'npm run db:seed'],
    [{ CRM_URL: 'http://ejemplo.test:4010' }, 'CRM_URL'],
  ])('refuses to start with %j, naming the fix and never a value', async (change, fix) => {
    const attempt = startCircuit({ ...baseEnv(), ...change }, { log: () => undefined, boardDir: board.dist });

    await expect(attempt).rejects.toBeInstanceOf(Error);
    const message = startupMessage(await attempt.catch((error: unknown) => error));
    expect(message).toContain(fix);
    expect(message).not.toContain(password);
    expect(message).not.toContain('otra-clave');
    expect(message).not.toContain(FAKE_KEY);
    expect(message).not.toContain('ejemplo.test');
    expect(message).toMatch(/^Circuit no arrancó: /);
  });

  it('a port already taken is named by its variable', async () => {
    const first = await startCircuit(baseEnv(), { log: () => undefined, boardDir: board.dist });
    try {
      const port = new URL(first.address).port;
      const second = startCircuit({ ...baseEnv(), CIRCUIT_PORT: port }, { log: () => undefined, boardDir: board.dist });
      await expect(second).rejects.toThrow('El puerto de CIRCUIT_PORT ya está en uso');
    } finally {
      await first.close();
    }
  });

  it('startupMessage keeps an unknown error to its name', () => {
    expect(startupMessage(new TypeError('lucia@hiloverde.test'))).toBe('Circuit no arrancó (TypeError).');
  });
});
