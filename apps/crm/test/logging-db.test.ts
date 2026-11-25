import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { readCrmConfig } from '../src/config.ts';
import { createCrmPool } from '../src/db/pool.ts';
import type { Connector } from '../src/db/read-scope.ts';
import { stdoutLog, type LogLine } from '../src/log.ts';
import { buildServer } from '../src/server/server.ts';
import { bearer, bodyOf, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0006 D15: one line per request with method, route pattern, status and duration, and
// nothing that came with the request. A database error leaves its SQLSTATE and nothing else.

const crm = useCrmUnderTest();

const REQUEST_LINE_KEYS = ['event', 'method', 'ms', 'route', 'status'];
const PLANTED_EMAIL = 'persona-real@empresa.test';

/** The lines `action` adds to the server's log. */
async function linesOf(action: () => Promise<unknown>): Promise<LogLine[]> {
  const before = crm().logs.length;
  await action();
  return crm().logs.slice(before);
}

/** A database error that carries an address in its message and its detail, as a real one can. */
function plantedDatabaseError(): pg.DatabaseError {
  const error = new pg.DatabaseError(`falló con ${PLANTED_EMAIL}`, 0, 'error');
  error.code = 'XX000';
  error.detail = `Key (email)=(${PLANTED_EMAIL}) already exists.`;
  return error;
}

/** A server whose every query fails with `error`, logging into `logs`. */
function failingServer(error: unknown, logs: LogLine[]) {
  const client = {
    query: () => Promise.reject(error),
    release: () => undefined,
  } as unknown as pg.PoolClient;
  const pool: Connector = { connect: async () => client };
  return buildServer({ pool, log: (line) => logs.push(line) });
}

describe('D15 · one line per request, without the request', () => {
  it('a search leaves method, route pattern, status and duration, and not the key, the email or the name', async () => {
    const { a } = crm().fixture;
    const lines = await linesOf(() =>
      crm().app.inject({
        method: 'POST',
        url: '/accounts/cuenta-a/contacts/search',
        headers: { ...bearer(a.apiKey), 'content-type': 'application/json' },
        payload: JSON.stringify({ email: a.email }),
      }),
    );
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]!).sort()).toEqual(REQUEST_LINE_KEYS);
    expect(lines[0]).toMatchObject({ event: 'request', method: 'POST', route: '/accounts/:slug/contacts/search', status: 200 });
    const text = JSON.stringify(lines);
    for (const secret of [a.apiKey, a.email, 'Contacto de cuenta-a']) expect(text).not.toContain(secret);
  });

  it('a read by id logs the pattern, not the URL with the slug and the id', async () => {
    const { a } = crm().fixture;
    const lines = await linesOf(() =>
      crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/contacts/${a.contactId}`, headers: bearer(a.apiKey) }),
    );
    expect(lines.map((line) => [line['route'], line['status']])).toEqual([['/accounts/:slug/contacts/:contactId', 200]]);
    expect(JSON.stringify(lines)).not.toContain('cuenta-a');
  });

  it('a refused key and an unknown route log their status, the second without a route', async () => {
    const refused = await linesOf(() => crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer('test-key-unknown') }));
    const unknown = await linesOf(() => crm().app.inject({ method: 'GET', url: '/rutas/que-no-existen' }));
    expect([...refused, ...unknown].map((line) => [line['route'], line['status']])).toEqual([
      ['/accounts/:slug/stages', 401],
      [null, 404],
    ]);
    expect(JSON.stringify(refused)).not.toContain('test-key-unknown');
  });

  // Fastify answers these from frameworkErrors, where no hook runs (audit of ADR-0006, H2).
  it('a URL the router cannot read leaves its line too, without a route and without the URL', async () => {
    const { a } = crm().fixture;
    const lines = await linesOf(async () => {
      await crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/contacts/%zz' });
      await crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/contacts/${'7'.repeat(101)}`, headers: bearer(a.apiKey) });
    });
    expect(lines.map((line) => Object.keys(line).sort())).toEqual([REQUEST_LINE_KEYS, REQUEST_LINE_KEYS]);
    expect(lines.map((line) => [line['event'], line['method'], line['route'], line['status']])).toEqual([
      ['request', 'GET', null, 401],
      ['request', 'GET', null, 400],
    ]);
    expect(lines.every((line) => typeof line['ms'] === 'number' && line['ms'] >= 0)).toBe(true);
    const text = JSON.stringify(lines);
    for (const sent of ['cuenta-a', '%zz', '7777777', a.apiKey]) expect(text).not.toContain(sent);
  });
});

describe('D15 · an error is logged by its code only', () => {
  it('a database error leaves its SQLSTATE, and the 500 says nothing else', async () => {
    const logs: LogLine[] = [];
    const app = failingServer(plantedDatabaseError(), logs);
    const response = await app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer('test-key-cualquiera') });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(bodyOf(response)).toEqual({ error: { code: 'error_interno', message: 'Error interno.' } });
    expect(logs[0]).toEqual({ event: 'internal_error', sqlstate: 'XX000', code: null });
    expect(JSON.stringify(logs)).not.toContain(PLANTED_EMAIL);
    expect(response.body).not.toContain(PLANTED_EMAIL);
  });

  it('a connection that fails leaves its system code, never its message', async () => {
    const logs: LogLine[] = [];
    const refused = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:5432 ${PLANTED_EMAIL}`), { code: 'ECONNREFUSED' });
    const app = failingServer(refused, logs);
    const response = await app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer('test-key-cualquiera') });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(logs[0]).toEqual({ event: 'internal_error', sqlstate: null, code: 'ECONNREFUSED' });
    expect(JSON.stringify(logs)).not.toContain(PLANTED_EMAIL);
  });

  it('the process writes each line to stdout as one JSON object', () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      stdoutLog({ event: 'request', status: 200 });
    } finally {
      spy.mockRestore();
    }
    expect(written).toEqual(['{"event":"request","status":200}\n']);
  });

  it('an idle connection that drops is logged by its SQLSTATE, and does not end the process', async () => {
    const logs: LogLine[] = [];
    const config = readCrmConfig({ CRM_DB_PASSWORD: 'clave-de-prueba-0123456789', POSTGRES_DB: 'nada', DB_PORT: '5432', CRM_PORT: '0' });
    const pool = createCrmPool(config.db, (line) => logs.push(line));
    const dropped = plantedDatabaseError();
    dropped.code = '57P01';
    pool.emit('error', dropped);
    await pool.end();
    expect(logs).toEqual([{ event: 'pool_error', sqlstate: '57P01', code: null }]);
  });
});
