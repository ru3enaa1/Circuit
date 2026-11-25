import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/server/server.ts';

// ADR-0006 D11, amended by ADR-0007 D1 and then by ADR-0008 D10: the routes the server
// registers, compared with a fixed list of method and pattern. Adding a route means changing
// this list, and that change shows in the diff. None issues, lists or revokes keys (ADR-0008 D9).

const EXPECTED_ROUTES = [
  'GET /accounts/:slug/audit-log',
  'GET /accounts/:slug/companies/:companyId',
  'GET /accounts/:slug/contacts/:contactId',
  'GET /accounts/:slug/contacts/:contactId/notes',
  'GET /accounts/:slug/contacts/:contactId/tasks',
  'GET /accounts/:slug/export',
  'GET /accounts/:slug/stages',
  'GET /health',
  'PATCH /accounts/:slug/contacts/:contactId',
  'POST /accounts/:slug/contacts',
  'POST /accounts/:slug/contacts/:contactId/archive',
  'POST /accounts/:slug/contacts/:contactId/notes',
  'POST /accounts/:slug/contacts/:contactId/tasks',
  'POST /accounts/:slug/contacts/search',
];

/** These tests never reach the database: a pool that is used fails the test. */
const unusedPool = {
  connect: (): Promise<pg.PoolClient> => Promise.reject(new Error('La prueba no debía conectarse a la base.')),
};

describe('D11 · the routes', () => {
  it('are exactly the fourteen of the list, and none is a DELETE', async () => {
    const app = buildServer({ pool: unusedPool, log: () => undefined });
    const seen: string[] = [];
    // Added before ready(): the routes are registered inside plugins, which load then.
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) seen.push(`${method} ${route.url}`);
    });
    await app.ready();
    await app.close();
    expect(seen.sort()).toEqual(EXPECTED_ROUTES);
  });

  it('/health answers without a key, without the database and without data', async () => {
    const app = buildServer({ pool: unusedPool, log: () => undefined });
    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('a route outside the list is 404 no_encontrado, and HEAD is not added for GET', async () => {
    const app = buildServer({ pool: unusedPool, log: () => undefined });
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/accounts' }),
      app.inject({ method: 'DELETE', url: '/accounts/cuenta-a/contacts/1' }),
      app.inject({ method: 'HEAD', url: '/health' }),
    ]);
    await app.close();
    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404]);
    expect(JSON.parse(responses[0]!.body)).toEqual({ error: { code: 'no_encontrado', message: 'No se encontró.' } });
  });
});
