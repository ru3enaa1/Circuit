import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { withReadScope, withWriteScope, type Approval, type Connector, type Scope } from '../db/read-scope.ts';
import { listAuditLog } from '../db/reads.ts';
import { addNote, addTask, archiveContact, createContact, updateContact } from '../db/writes.ts';
import { credentialsOf } from '../server/auth.ts';
import type { Permission } from '../server/errors.ts';
import {
  accountParams,
  archiveBody,
  contactChangesBody,
  contactParams,
  jsonBody,
  newContactBody,
  noQuery,
  noteBody,
  pageOf,
  pageQuery,
  parseInput,
  taskBody,
} from './input.ts';

// ADR-0007 D1: the five routes that write and the one that reads the audit trail. Registered
// inside the /accounts/:slug plugin of reads.ts, so its onRequest hook refuses a request
// without a key before the body is read (D3). Each write goes through withWriteScope: the key,
// the account and the permission (D2), then the input, then the write and its audit row.

const CREATED = 201;
const UPDATED = 200;
const NO_CONTENT = 204;

/** A route's parameters, its query (none) and its body, parsed together once the key has passed. */
function contactInput<S extends z.ZodObject>(request: FastifyRequest, body: S): z.output<S> & { readonly contactId: number } {
  const { contactId } = parseInput(contactParams, request.params, 'ruta');
  parseInput(noQuery, request.query, 'consulta');
  return { ...parseInput(body, jsonBody(request.headers['content-type'], request.body), 'cuerpo'), contactId };
}

function write<I extends { readonly approval: Approval }, T>(
  pool: Connector,
  request: FastifyRequest,
  permission: Exclude<Permission, 'read'>,
  parse: () => I,
  work: (scope: Scope, input: I) => Promise<T>,
): Promise<T> {
  return withWriteScope(pool, credentialsOf(request), permission, parse, work);
}

export function writeRoutes(app: FastifyInstance, pool: Connector): void {
  app.post('/contacts', async (request, reply) => {
    const parse = () => {
      parseInput(accountParams, request.params, 'ruta');
      parseInput(noQuery, request.query, 'consulta');
      return parseInput(newContactBody, jsonBody(request.headers['content-type'], request.body), 'cuerpo');
    };
    const contact = await write(pool, request, 'write', parse, (scope, input) => createContact(scope, input));
    return reply.code(CREATED).send({ contact });
  });

  // Changes the contact's fields, and moves it through the pipeline with stageId.
  app.patch('/contacts/:contactId', async (request, reply) => {
    const parse = () => contactInput(request, contactChangesBody);
    const contact = await write(pool, request, 'write', parse, (scope, input) => updateContact(scope, input.contactId, input));
    return reply.code(UPDATED).send({ contact });
  });

  app.post('/contacts/:contactId/notes', async (request, reply) => {
    const parse = () => contactInput(request, noteBody);
    const note = await write(pool, request, 'write', parse, (scope, input) => addNote(scope, input.contactId, input.body));
    return reply.code(CREATED).send({ note });
  });

  app.post('/contacts/:contactId/tasks', async (request, reply) => {
    const parse = () => contactInput(request, taskBody);
    const task = await write(pool, request, 'write', parse, (scope, input) => addTask(scope, input.contactId, input));
    return reply.code(CREATED).send({ task });
  });

  // Archiving is deleting (ADR-0005 D6), so it takes `delete`: the agent's key gets 403 here.
  // A POST and not a DELETE: nothing is removed, and DELETE has no route at all (D1).
  app.post('/contacts/:contactId/archive', async (request, reply) => {
    const parse = () => contactInput(request, archiveBody);
    await write(pool, request, 'delete', parse, (scope, input) => archiveContact(scope, input.contactId));
    return reply.code(NO_CONTENT).send();
  });

  app.get('/audit-log', (request) =>
    withReadScope(pool, credentialsOf(request), async (scope) => {
      parseInput(accountParams, request.params, 'ruta');
      const page = pageOf(parseInput(pageQuery, request.query, 'consulta'));
      return { entries: await listAuditLog(scope, page) };
    }),
  );
}
