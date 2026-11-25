import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll } from 'vitest';

import { readLocalEnv } from '../../../database/env.ts';
import { seedReadFixture, type ReadFixture } from '../../../database/test/crm-fixture.ts';
import { createDisposableDatabase, runMigrations, type DisposableDatabase } from '../../../database/test/disposable-db.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../../../database/users.ts';
import { CRM_DB_USER } from '../src/config.ts';
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
  });

  afterAll(async () => {
    await state?.app.close();
    await db?.drop();
  });

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
