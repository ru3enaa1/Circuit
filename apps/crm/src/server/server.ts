import { fastify, type FastifyInstance, type FastifyReply } from 'fastify';

import type { Connector } from '../db/read-scope.ts';
import { errorCodes, type LogSink } from '../log.ts';
import { crmRoutes } from '../routes/reads.ts';
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

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = fastify({
    // D15: no framework logger at all, so none of its request lines (which carry the URL) or
    // error lines (which carry the message) can be written. onResponse below writes the only
    // request line, from fixed fields.
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
    // D11: exactly the seven routes; Fastify would add a HEAD for every GET.
    exposeHeadRoutes: false,
    // A malformed URL (bad percent-encoding) never reaches a route.
    frameworkErrors: (_error, _request, reply) => {
      void sendError(reply, new ApiError('entrada_invalida', 'ruta'));
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
    deps.log({
      event: 'request',
      method: request.method,
      // The pattern (/accounts/:slug/contacts/:contactId), never the URL with its values.
      route: request.routeOptions.url ?? null,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    });
  });

  void app.register(crmRoutes, { pool: deps.pool });
  return app;
}
