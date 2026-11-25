import type { FastifyInstance, FastifyRequest } from 'fastify';

import { withReadScope, type Connector, type Scope } from '../db/scope.ts';
import { findCompany, findContact, findContactsByEmail, listNotes, listStages, listTasks } from '../db/reads.ts';
import { credentialsOf, presentedKey } from '../server/auth.ts';
import { ApiError } from '../server/errors.ts';
import {
  accountParams,
  companyParams,
  contactParams,
  jsonBody,
  noQuery,
  pageOf,
  pageQuery,
  parseInput,
  searchBody,
} from './input.ts';
import { exportRoutes } from './export.ts';
import { writeRoutes } from './writes.ts';

// ADR-0008 D10, which amends ADR-0007 D1: exactly fourteen routes. /health takes no key and
// returns no data; the other thirteen live under /accounts/:slug/ and take a key. The six of
// this file read through withReadScope; the six of writes.ts are the writes and the audit
// trail; export.ts is the export.

export interface RouteOptions {
  readonly pool: Connector;
}

/** Every route that reads or writes data lives under it and takes a key. */
export const ACCOUNTS_PATH = '/accounts';

function read<T>(pool: Connector, request: FastifyRequest, work: (scope: Scope) => Promise<T>): Promise<T> {
  return withReadScope(pool, credentialsOf(request), work);
}

function found<T>(row: T | undefined): T {
  if (row === undefined) throw new ApiError('no_encontrado');
  return row;
}

/** Another account's contact reads as one that does not exist (D13): RLS hides it from findContact. */
async function activeContact(scope: Scope, request: FastifyRequest): Promise<number> {
  const { contactId } = parseInput(contactParams, request.params, 'ruta');
  return found(await findContact(scope, contactId)).id;
}

async function accountRoutes(app: FastifyInstance, options: RouteOptions): Promise<void> {
  const { pool } = options;
  // Before the body is read, so a request without a key never gets as far as a 400 or a 413.
  app.addHook('onRequest', async (request) => {
    if (presentedKey(request.headers.authorization) === 'missing') throw new ApiError('sin_llave');
  });

  app.get('/stages', (request) =>
    read(pool, request, async (scope) => {
      parseInput(accountParams, request.params, 'ruta');
      parseInput(noQuery, request.query, 'consulta');
      return { stages: await listStages(scope) };
    }),
  );

  app.post('/contacts/search', (request) =>
    read(pool, request, async (scope) => {
      parseInput(accountParams, request.params, 'ruta');
      parseInput(noQuery, request.query, 'consulta');
      const { email } = parseInput(searchBody, jsonBody(request.headers['content-type'], request.body), 'cuerpo');
      return { contacts: await findContactsByEmail(scope, email) };
    }),
  );

  app.get('/companies/:companyId', (request) =>
    read(pool, request, async (scope) => {
      const { companyId } = parseInput(companyParams, request.params, 'ruta');
      parseInput(noQuery, request.query, 'consulta');
      return { company: found(await findCompany(scope, companyId)) };
    }),
  );

  contactRoutes(app, pool);
  // In this plugin, so the hook above runs before any of their bodies is read.
  writeRoutes(app, pool);
  exportRoutes(app, pool);
}

/** One contact by id, and its notes and tasks: 404 when the contact is archived or not visible. */
function contactRoutes(app: FastifyInstance, pool: Connector): void {
  app.get('/contacts/:contactId', (request) =>
    read(pool, request, async (scope) => {
      const { contactId } = parseInput(contactParams, request.params, 'ruta');
      parseInput(noQuery, request.query, 'consulta');
      return { contact: found(await findContact(scope, contactId)) };
    }),
  );

  app.get('/contacts/:contactId/notes', (request) =>
    read(pool, request, async (scope) => {
      const page = pageOf(parseInput(pageQuery, request.query, 'consulta'));
      return { notes: await listNotes(scope, await activeContact(scope, request), page) };
    }),
  );

  app.get('/contacts/:contactId/tasks', (request) =>
    read(pool, request, async (scope) => {
      const page = pageOf(parseInput(pageQuery, request.query, 'consulta'));
      return { tasks: await listTasks(scope, await activeContact(scope, request), page) };
    }),
  );
}

export async function crmRoutes(app: FastifyInstance, options: RouteOptions): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(accountRoutes, { ...options, prefix: `${ACCOUNTS_PATH}/:slug` });
}
