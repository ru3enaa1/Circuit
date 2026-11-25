import { DrizzleQueryError, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { readCrmConfig } from '../src/config.ts';
import { createCrmPool } from '../src/db/pool.ts';
import type { Connector } from '../src/db/scope.ts';
import { errorCodes, stdoutLog, type LogLine } from '../src/log.ts';
import { buildServer } from '../src/server/server.ts';
import { APPROVAL, bearer, bodyOf, interceptingConnector, sendJson, useCrmUnderTest } from './crm-under-test.ts';

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

/** PostgreSQL refuses U+0000 in text with this SQLSTATE, so a statement that sends one always fails. */
const NUL_IN_TEXT = '22021';

/**
 * The error drizzle itself throws when a statement fails: a DrizzleQueryError whose message
 * carries the SQL and its parameters (here, an address), with the driver's error as its
 * cause (baseline of ADR-0007, F-2). Made by a real statement, so a change in drizzle's
 * wrapping shows up here.
 */
async function realDrizzleError(): Promise<unknown> {
  const statement = drizzle({ client: crm().pool }).execute(sql`SELECT ${`${PLANTED_EMAIL}\u0000`}::text`);
  return statement.then(
    () => {
      throw new Error('Se esperaba que la sentencia con un NUL fallara.');
    },
    (error: unknown) => error,
  );
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

  // ADR-0006 A7: every query drizzle runs comes back wrapped, so this is the shape a real
  // database error has. The SQLSTATE used to come out null.
  it('a database error wrapped by drizzle leaves the SQLSTATE of its cause, and never the statement or its values', async () => {
    const wrapped = await realDrizzleError();
    // Only meaningful if the wrapper is what arrives, and it does carry the address.
    expect(wrapped).toBeInstanceOf(DrizzleQueryError);
    expect(wrapped).not.toBeInstanceOf(pg.DatabaseError);
    expect((wrapped as DrizzleQueryError).cause).toBeInstanceOf(pg.DatabaseError);
    expect((wrapped as DrizzleQueryError).message).toContain(PLANTED_EMAIL);
    const logs: LogLine[] = [];
    const app = failingServer(wrapped, logs);
    const response = await app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer('test-key-cualquiera') });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(bodyOf(response)).toEqual({ error: { code: 'error_interno', message: 'Error interno.' } });
    expect(logs[0]).toEqual({ event: 'internal_error', sqlstate: NUL_IN_TEXT, code: null });
    expect(JSON.stringify(logs)).not.toContain(PLANTED_EMAIL);
  });

  it('a connection drizzle wraps leaves its system code, and never the wrapper or the cause message', () => {
    const dropped = Object.assign(new Error(`read ECONNRESET ${PLANTED_EMAIL}`), { code: 'ECONNRESET' });
    const wrapped = new DrizzleQueryError('SELECT 1 WHERE $1 = $1', [PLANTED_EMAIL], dropped);
    const codes = errorCodes(wrapped);
    expect(codes).toEqual({ sqlstate: null, code: 'ECONNRESET' });
    expect(JSON.stringify(codes)).not.toContain(PLANTED_EMAIL);
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

// ADR-0007 D12: the same line for a write, and never its body. A database error raised by a
// write leaves the SQLSTATE of its cause, read through drizzle's wrapper.
describe('D12 · a write is logged like a read, and its errors by their code only', () => {
  it('creating a contact leaves one request line, and neither the name nor the address', async () => {
    const { a } = crm().fixture;
    const body = { fullName: 'Nombre Plantado', email: PLANTED_EMAIL, stageId: Number(a.stageId), approval: APPROVAL };
    const lines = await linesOf(() => sendJson(crm().app, 'POST', '/accounts/cuenta-a/contacts', bearer(a.apiKey), body));
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]!).sort()).toEqual(REQUEST_LINE_KEYS);
    expect(lines[0]).toMatchObject({ event: 'request', method: 'POST', route: '/accounts/:slug/contacts', status: 201 });
    const text = JSON.stringify(lines);
    for (const secret of [a.apiKey, PLANTED_EMAIL, 'Nombre Plantado', APPROVAL.approvalRef]) expect(text).not.toContain(secret);
  });

  // The error is planted where the driver raises it, under drizzle, so drizzle wraps it as it
  // wraps a real one: a DrizzleQueryError whose message carries the statement's parameters
  // (here, the address) and whose cause carries the address in its message and its detail.
  it.each([
    ['any error', 'XX000', undefined],
    ['a unique violation on another index', '23505', 'contacts_pkey'],
  ])('%s in a write is 500 with its SQLSTATE, never the statement, its values or the cause message', async (_case, sqlstate, constraint) => {
    const { a } = crm().fixture;
    let planted = 0;
    const pool = interceptingConnector(crm().pool, (statement) => {
      if (!statement.text.startsWith('insert into "crm"."contacts"')) return undefined;
      planted += 1;
      const error = plantedDatabaseError();
      error.code = sqlstate;
      if (constraint !== undefined) error.constraint = constraint;
      return error;
    });
    const logs: LogLine[] = [];
    const app = buildServer({ pool, log: (line) => logs.push(line) });
    const body = { fullName: 'Nombre Plantado', email: PLANTED_EMAIL, stageId: Number(a.stageId), approval: APPROVAL };
    const response = await sendJson(app, 'POST', '/accounts/cuenta-a/contacts', bearer(a.apiKey), body);
    await app.close();
    // Only meaningful if the write itself got as far as the planted error.
    expect(planted).toBe(1);
    expect(response.statusCode).toBe(500);
    expect(bodyOf(response)).toEqual({ error: { code: 'error_interno', message: 'Error interno.' } });
    expect(logs.filter((line) => line['event'] === 'internal_error')).toEqual([{ event: 'internal_error', sqlstate, code: null }]);
    for (const text of [JSON.stringify(logs), response.body]) {
      expect(text).not.toContain(PLANTED_EMAIL);
      expect(text).not.toContain('Nombre Plantado');
    }
  });
});
