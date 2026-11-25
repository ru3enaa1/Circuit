import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, expect } from 'vitest';

import { readLocalEnv } from '../../../database/env.ts';
import { seedReadFixture, type ReadFixture } from '../../../database/test/crm-fixture.ts';
import {
  createDisposableDatabase,
  DATABASE_HOOK_TIMEOUT_MS,
  runMigrations,
  type DisposableDatabase,
} from '../../../database/test/disposable-db.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../../../database/users.ts';
import { CRM_DB_USER } from '../src/config.ts';
import type { Connector } from '../src/db/scope.ts';
import type { LogLine } from '../src/log.ts';
import { buildServer } from '../src/server/server.ts';

// The CRM as the HTTP tests see it (ADR-0006, Cláusulas): a disposable database, migrated and
// seeded with database/test/crm-fixture.ts; crm_app made the way `npm run db:users` makes it,
// with the password from .env; and the server on a pool of crm_app, driven with inject. No
// port is opened here. Without CRM_DB_PASSWORD the file fails with the message that names it.

export interface CrmUnderTest {
  readonly app: FastifyInstance;
  readonly fixture: ReadFixture;
  /** Every line the server logged, in order. */
  readonly logs: LogLine[];
  /** crm_app's pool, the one the server uses. */
  readonly pool: pg.Pool;
  readonly db: DisposableDatabase;
}

/** Registers the hooks of one test file and returns its CRM, available once beforeAll has run. */
export function useCrmUnderTest(options: { readonly poolSize?: number } = {}): () => CrmUnderTest {
  const password = readCrmPassword(readLocalEnv());
  let state: CrmUnderTest | undefined;
  let db: DisposableDatabase | undefined;

  beforeAll(async () => {
    db = await createDisposableDatabase();
    await runMigrations(db.pool);
    const fixture = await seedReadFixture(db.pool);
    await createOrUpdateCrmApp(db.connection, password);
    const pool = db.poolAs(CRM_DB_USER, password, options.poolSize);
    const logs: LogLine[] = [];
    const app = buildServer({ pool, log: (line) => logs.push(line) });
    await app.ready();
    state = { app, fixture, logs, pool, db };
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await state?.app.close();
    await db?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  return () => {
    if (state === undefined) throw new Error('El CRM de prueba no se levantó: falló el beforeAll.');
    return state;
  };
}

export const bearer = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

/** The parsed JSON body of a response. */
export function bodyOf(response: LightMyRequestResponse): unknown {
  return JSON.parse(response.body) as unknown;
}

export function errorCodeOf(response: LightMyRequestResponse): unknown {
  const body = bodyOf(response) as { error?: { code?: unknown } };
  return body.error?.code;
}

/** 400 entrada_invalida, naming `field`, without `sent` anywhere in the body. */
export function expectInvalid(response: LightMyRequestResponse, field: string, sent: string): void {
  expect(response.statusCode, response.body).toBe(400);
  expect(bodyOf(response)).toEqual({ error: { code: 'entrada_invalida', message: `La entrada no es válida: revisa «${field}».` } });
  if (sent.length > 0) expect(response.body).not.toContain(sent);
}

// ADR-0007: what the write tests share.

/** A valid approval (D7): opaque ids, as station 6 of circuit will send them. */
export const APPROVAL = { approvedBy: 'mentor', approvalRef: 'aprobacion-1' } as const;

/** A JSON request. A string body is sent as it is, so a test can send JSON that does not parse. */
export function sendJson(
  app: FastifyInstance,
  method: 'POST' | 'PATCH',
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<LightMyRequestResponse> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return app.inject({ method, url, headers: { ...headers, 'content-type': 'application/json' }, payload });
}

/** Rows per table, read as the admin past every policy: what a refused write must leave as it was. */
export async function rowCounts(pool: pg.Pool): Promise<Readonly<Record<string, number>>> {
  const result = await pool.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM crm.contacts)::text AS contacts, (SELECT count(*) FROM crm.notes)::text AS notes,
            (SELECT count(*) FROM crm.tasks)::text AS tasks, (SELECT count(*) FROM crm.audit_log)::text AS audit_log`,
  );
  return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([table, count]) => [table, Number(count)]));
}

/** An audit row as the trigger wrote it, read as the admin; bigint columns as text, as pg gives them. */
export interface AuditRow {
  readonly account_id: string;
  readonly table_name: string;
  readonly row_id: string;
  readonly operation: string;
  readonly changed_columns: string[];
  readonly api_key_id: string | null;
  readonly proposed_by: string;
  readonly approved_by: string;
  readonly approval_ref: string | null;
}

/** The newest audit id: the mark before a write, so the rows after it are the write's own. */
export async function lastAuditId(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT coalesce(max(id), 0)::text AS id FROM crm.audit_log');
  return result.rows[0]?.id ?? '0';
}

export async function auditRowsAfter(pool: pg.Pool, mark: string): Promise<AuditRow[]> {
  const result = await pool.query<AuditRow>(
    `SELECT account_id::text, table_name, row_id::text, operation, changed_columns, api_key_id::text,
            proposed_by, approved_by, approval_ref
       FROM crm.audit_log WHERE id > $1 ORDER BY id`,
    [mark],
  );
  return result.rows;
}

/** One statement as a client was asked to run it. drizzle passes a config object, the helpers the text. */
export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * crm_app's pool, with every statement shown to `intercept` before it runs: it returns an error
 * to make that statement fail on purpose (drizzle then wraps it, as it wraps a real one), or
 * undefined to let it run. Everything else of the client is the real one.
 */
export function interceptingConnector(pool: pg.Pool, intercept: (statement: Statement) => Error | undefined): Connector {
  return {
    connect: async () => {
      const client = await pool.connect();
      const run = client.query.bind(client) as (config: unknown, values?: unknown) => Promise<unknown>;
      const query = async (config: string | { readonly text: string }, values?: readonly unknown[]) => {
        const failure = intercept({ text: typeof config === 'string' ? config : config.text, values: values ?? [] });
        if (failure !== undefined) throw failure;
        return run(config, values);
      };
      return new Proxy(client, {
        get: (target, property, receiver) => (property === 'query' ? query : Reflect.get(target, property, receiver)),
      });
    },
  };
}
