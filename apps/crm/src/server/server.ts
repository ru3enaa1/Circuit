import { fastify, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import type { Connector } from '../db/scope.ts';
import { errorCodes, type LogLine, type LogSink } from '../log.ts';
import { ACCOUNTS_PATH, crmRoutes } from '../routes/reads.ts';
import { presentedKey } from './auth.ts';
import { ApiError, ERROR_STATUS, errorBody } from './errors.ts';
import { MAX_BODY_BYTES } from './limits.ts';

// The CRM's HTTP server (ADR-0006). Built without listening, so the tests drive it with
// fastify.inject; main.ts is the only place that opens a port, on 127.0.0.1 (D7).

export interface ServerDeps {
  readonly pool: Connector;
  readonly log: LogSink;
}

const BODY_TOO_LARGE = 'FST_ERR_CTP_BODY_TOO_LARGE';

function sendError(reply: FastifyReply, error: ApiError): FastifyReply {
  const status = ERROR_STATUS[error.code];
  // RFC 6750 §3: every 401 says which scheme the API expects, and the same for both causes.
  if (status === 401) void reply.header('www-authenticate', 'Bearer');
  return reply.code(status).send(errorBody(error));
}

function statusOf(error: unknown): number | undefined {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  return typeof status === 'number' ? status : undefined;
}

/** Our own errors as they are; Fastify's client errors as 400 or 413; anything else as 500. */
function handleError(error: unknown, reply: FastifyReply, log: LogSink): FastifyReply {
  if (error instanceof ApiError) return sendError(reply, error);
  const fastifyCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (fastifyCode === BODY_TOO_LARGE) return sendError(reply, new ApiError('demasiado_grande'));
  const status = statusOf(error);
  if (status !== undefined && status >= 400 && status < 500) return sendError(reply, new ApiError('entrada_invalida'));
  // D15: the codes only. The error's message and detail can carry the values of the statement.
  log({ event: 'internal_error', ...errorCodes(error) });
  return sendError(reply, new ApiError('error_interno'));
}

/** D15: the only request line, from fixed fields. `route` is the pattern, never the URL. */
function requestLine(method: string, route: string | null, status: number, ms: number): LogLine {
  return { event: 'request', method, route, status, ms: Math.round(ms) };
}

/**
 * What Fastify answers before any route: a URL it cannot decode, or a parameter longer than
 * maxParamLength. No route and no hook runs on this path (audit of ADR-0006, H1 and H2), so
 * the key still comes before the input here (D14), and this writes the line onResponse would
 * (D15). Fastify starts no clock on this path (reply.elapsedTime is 0), so the duration is
 * this function's own.
 */
function answerUnroutable(request: FastifyRequest, reply: FastifyReply, log: LogSink): void {
  const started = performance.now();
  const needsKey = request.url.startsWith(`${ACCOUNTS_PATH}/`);
  const keyless = needsKey && presentedKey(request.headers.authorization) === 'missing';
  void sendError(reply, keyless ? new ApiError('sin_llave') : new ApiError('entrada_invalida', 'ruta'));
  log(requestLine(request.method, null, reply.statusCode, performance.now() - started));
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = fastify({
    // D15: no framework logger at all, so none of its request lines (which carry the URL) or
    // error lines (which carry the message) can be written. onResponse below writes the only
    // request line, from fixed fields.
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
    // ADR-0007 D1: exactly the thirteen routes; Fastify would add a HEAD for every GET.
    exposeHeadRoutes: false,
    frameworkErrors: (_error, request, reply) => {
      answerUnroutable(request, reply, deps.log);
    },
  });

  // Every body is kept as text and parsed by the route, after the key and the account
  // (input.ts, jsonBody): no content type can make the server answer before that check.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((error, _request, reply) => handleError(error, reply, deps.log));
  app.setNotFoundHandler((_request, reply) => sendError(reply, new ApiError('no_encontrado')));

  app.addHook('onResponse', async (request, reply) => {
    // The pattern (/accounts/:slug/contacts/:contactId), never the URL with its values.
    deps.log(requestLine(request.method, request.routeOptions.url ?? null, reply.statusCode, reply.elapsedTime));
  });

  void app.register(crmRoutes, { pool: deps.pool });
  return app;
}
