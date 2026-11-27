import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVENT_FIELDS, LATEST_RUNS, RUN_FIELDS, TOOL_FIELDS } from '../src/server/api.ts';
import { GOLDEN_CASES, runCase } from './golden/harness.ts';
import { MemoryStore } from './support/fakes.ts';
import { GOOD_HOST, testServer } from './support/server.ts';

// ADR-0011 B5, B8 and B13 over the store in memory: the four GET routes, their fixed fields and
// their parameters. The same answers over PostgreSQL are in database/test/server-read-db.test.ts.

const store = new MemoryStore();
const tools = [{ name: 'herramienta-falsa', label: 'Herramienta falsa', access: 'write' as const }];
const { app, reader, lines } = testServer({ store, tools });

beforeAll(async () => {
  for (const name of GOLDEN_CASES) await runCase(name, store);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: GOOD_HOST } });

describe('B5 · the four routes answer fixed fields', () => {
  it('GET /api/circuit: the table, the threshold and the titles, without any document text', async () => {
    const body = (await get('/api/circuit')).json();

    expect(Object.keys(body).sort()).toEqual(['documents', 'lowConfidenceBelow', 'mentor', 'model', 'samples', 'scenario', 'stations', 'transitions']);
    // ADR-0012 A12: a sample's id and label, never its text.
    expect(body.samples).toEqual([{ id: 'normal', label: 'Pide un programa' }]);
    expect(body.mentor).toBe('mentor');
    expect(body.stations.map((station: { id: string }) => station.id)).toEqual(['intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close']);
    expect(Object.keys(body.stations[0]).sort()).toEqual(['decidedBy', 'id', 'number']);
    expect(Object.keys(body.transitions[0]).sort()).toEqual(['from', 'outcome', 'to']);
    expect(body.documents).toEqual([{ id: 'radiografia', title: 'Radiografía de la operación' }]);
    expect(body.lowConfidenceBelow).toBe(0.7);
    expect(JSON.stringify(body)).not.toContain('proceso por proceso');
  });

  it('GET /api/runs: newest first, each run with the fields of the list', async () => {
    const { runs } = (await get('/api/runs')).json();

    expect(runs.map((run: { id: number }) => run.id)).toEqual([4, 3, 2, 1]);
    for (const run of runs) expect(Object.keys(run).sort()).toEqual([...RUN_FIELDS].sort());
    expect(runs[3]).toMatchObject({ id: 1, events: 7, lastStation: 'close', lastOutcome: 'done', lastStatus: 'completed' });
    expect(runs[1]).toMatchObject({ id: 3, events: 2, lastStation: 'filter', lastOutcome: 'injection', lastStatus: 'stopped' });
  });

  it(`GET /api/runs shows at most ${LATEST_RUNS}`, async () => {
    const many = new MemoryStore();
    for (let index = 0; index < LATEST_RUNS + 2; index += 1) await runCase('injection', many);
    const server = testServer({ store: many });
    const response = await server.app.inject({ method: 'GET', url: '/api/runs', headers: { host: GOOD_HOST } });

    expect(response.json().runs).toHaveLength(LATEST_RUNS);
    expect(response.json().runs[0].id).toBe(LATEST_RUNS + 2);
    await server.app.close();
  });

  it('GET /api/runs/:id/events: each event with the fields of the list, and only those after `after`', async () => {
    const all = (await get('/api/runs/1/events')).json();
    const later = (await get('/api/runs/1/events?after=5')).json();

    expect(Object.keys(all).sort()).toEqual(['events', 'runId']);
    expect(all.events.map((event: { seq: number }) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const event of all.events) expect(Object.keys(event).sort()).toEqual([...EVENT_FIELDS].sort());
    expect(later.events.map((event: { seq: number }) => event.seq)).toEqual([6, 7]);
    expect((await get('/api/runs/1/events?after=7')).json().events).toEqual([]);
  });

  it('a run that does not exist gives 404', async () => {
    const response = await get('/api/runs/99/events');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'no_encontrado' });
  });

  it.each([
    ['/api/runs/1/events?after=-1', 'after'],
    ['/api/runs/1/events?after=abc', 'after'],
    ['/api/runs/1/events?after=1.5', 'after'],
    ['/api/runs/1/events?after=01', 'after'],
    ['/api/runs/1/events?after=2147483648', 'after'],
    ['/api/runs/1/events?after=1&after=2', 'after'],
    ['/api/runs/1/events?later=1', 'later'],
    [`/api/runs/${2 ** 53}/events`, 'id'],
    ['/api/runs/0/events', 'id'],
    ['/api/runs/-1/events', 'id'],
    ['/api/runs/abc/events', 'id'],
    ['/api/runs?limit=50', 'limit'],
    ['/api/circuit?x=1', 'x'],
    ['/api/tools?verbose=1', 'verbose'],
  ])('%s gives 400 naming %s, never its value', async (url, field) => {
    const response = await get(url);
    const value = new URL(url, 'http://x').search.split('=')[1] ?? url.split('/')[3];

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'entrada_invalida', field });
    if (value !== undefined && value.length > 1) expect(response.body).not.toContain(value);
  });

  it('the log line names the route pattern, never the URL with its values', async () => {
    await get('/api/runs/1/events?after=3');

    expect(lines.at(-1)).toEqual({ event: 'request', method: 'GET', route: '/api/runs/:id/events', status: 200, ms: expect.any(Number) });
  });

  it('a reader that fails gives 500 with no detail, and a log line with its codes only', async () => {
    const failing = testServer();
    failing.reader.latestRuns = async () => {
      throw Object.assign(new Error('SELECT … lucia@hiloverde.test'), { code: 'ECONNREFUSED' });
    };
    const response = await failing.app.inject({ method: 'GET', url: '/api/runs', headers: { host: GOOD_HOST } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'error_interno' });
    expect(failing.lines).toContainEqual({ event: 'internal_error', sqlstate: null, code: 'ECONNREFUSED' });
    expect(JSON.stringify(failing.lines)).not.toContain('lucia');
    await failing.app.close();
  });
});

describe('B8 · the CRM tools are data', () => {
  it('GET /api/tools gives back the injected list as it is, with the fields of the list', async () => {
    const body = (await get('/api/tools')).json();

    expect(body).toEqual({ tools });
    expect(Object.keys(body.tools[0]).sort()).toEqual([...TOOL_FIELDS].sort());
  });
});

// ADR-0012 amends B13: POST /api/runs and POST /api/runs/:id/decision are the only writes (server-decision.test.ts).
describe('B13 · every other route only reads', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s on every read route gives 404 and reads nothing', async (method) => {
    const before = reader.calls.length;
    const stored = store.stored.length;
    const urls = ['/', '/api/circuit', '/api/runs', '/api/runs/1/events', '/api/tools'].filter((url) => !(method === 'POST' && url === '/api/runs'));
    for (const url of urls) {
      const response = await app.inject({ method, url, headers: { host: GOOD_HOST, 'content-type': 'application/json' }, payload: '{}' });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(reader.calls.length).toBe(before);
    expect(store.stored.length).toBe(stored);
  });
});
