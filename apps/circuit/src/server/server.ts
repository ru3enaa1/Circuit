import { fastify, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { InvalidParameter, registerApi, type ApiDeps } from './api.ts';
import { INDEX_PATH, type BoardFiles } from './board-files.ts';
import { FORBIDDEN_HOST_BODY, SECURITY_HEADERS, isAllowedHost } from './guard.ts';
import { errorCodes, requestLine, type LogSink } from './log.ts';

// The circuit server (ADR-0011): the board and its read API, on 127.0.0.1 only. Built without
// listening, so the tests drive it with fastify.inject; main.ts is the only place that opens a
// port. It only reads (B13): there is no route but GET until ADR-0012.

export interface ServerDeps extends ApiDeps {
  readonly board: BoardFiles;
  /** The port the Host header must name. A function, because with port 0 it is known after listen. */
  readonly port: () => number;
  readonly log: LogSink;
}

/** What `/` answers while apps/board/dist is missing: the command that builds it. */
export const BOARD_MISSING = 'El tablero no está compilado: corre npm run board:build.';

function withSecurityHeaders(reply: FastifyReply): FastifyReply {
  return reply.headers(SECURITY_HEADERS);
}

function refuseHost(reply: FastifyReply): FastifyReply {
  return withSecurityHeaders(reply).code(403).send(FORBIDDEN_HOST_BODY);
}

/** Our parameter errors as 400 with the field; Fastify's client errors as 400; anything else as 500, logged by its codes. */
function handleError(error: unknown, reply: FastifyReply, log: LogSink): FastifyReply {
  if (error instanceof InvalidParameter) return reply.code(400).send({ error: 'entrada_invalida', field: error.field });
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  if (typeof status === 'number' && status >= 400 && status < 500) return reply.code(400).send({ error: 'entrada_invalida' });
  log({ event: 'internal_error', ...errorCodes(error) });
  return reply.code(500).send({ error: 'error_interno' });
}

/**
 * A URL the router cannot read is answered before any hook (CLAUDE.md §8, frameworkErrors), so
 * the Host check, the headers and the log line are repeated here.
 */
function answerUnroutable(request: FastifyRequest, reply: FastifyReply, deps: ServerDeps): void {
  const started = performance.now();
  if (!isAllowedHost(request.headers.host, deps.port())) void refuseHost(reply);
  else void withSecurityHeaders(reply).code(400).send({ error: 'entrada_invalida', field: 'ruta' });
  deps.log(requestLine(request.method, null, reply.statusCode, performance.now() - started));
}

/** One GET route per file of the fixed list (B7); `/` is index.html. Nothing else is served. */
function registerBoard(app: FastifyInstance, board: BoardFiles): void {
  if (board.size === 0) {
    app.get('/', async (_request, reply) => reply.code(503).type('text/plain; charset=utf-8').send(BOARD_MISSING));
    return;
  }
  for (const [path, file] of board) {
    app.get(path, async (_request, reply) => reply.type(file.contentType).send(file.body));
  }
  const index = board.get(INDEX_PATH);
  if (index !== undefined) app.get('/', async (_request, reply) => reply.type(index.contentType).send(index.body));
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = fastify({
    // No framework logger: its lines carry the URL. onResponse writes the only request line.
    logger: false,
    // GET only (B13); Fastify would add a HEAD for every GET.
    exposeHeadRoutes: false,
    frameworkErrors: (_error, request, reply) => {
      answerUnroutable(request, reply, deps);
    },
  });

  // B6: the first thing every request meets, before routing decides anything.
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHost(request.headers.host, deps.port())) return refuseHost(reply);
    return undefined;
  });
  // B7: on every answer, the board's files, the API, a 404 and an error alike.
  app.addHook('onSend', async (_request, reply, payload) => {
    withSecurityHeaders(reply);
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    deps.log(requestLine(request.method, request.routeOptions.url ?? null, reply.statusCode, reply.elapsedTime));
  });

  app.setErrorHandler((error, _request, reply) => handleError(error, reply, deps.log));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'no_encontrado' }));

  registerApi(app, deps);
  registerBoard(app, deps.board);
  return app;
}
