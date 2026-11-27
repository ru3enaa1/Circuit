import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DECISIONS, MAX_ACTIONS } from '../modules/circuit/index.ts';
import { InvalidParameter, parse, runIdParam } from './api.ts';

/**
 * The only two routes that write (ADR-0012 A6 and its amendment A12): the mentor's decision, and
 * a sample request to try. Both take JSON only: another page cannot send JSON to this port without
 * a preflight the server never answers, and a form or text/plain body is refused with 415. A
 * browser names the page that sends a POST in `Origin`, which must be the board's own. The Host
 * check of ADR-0011 B6 runs before all of it.
 */

export interface RunCommands {
  /** Starts a run with the scenario's sample of that id; null when there is no such sample. */
  tryout(sampleId: string): Promise<{ readonly runId: number } | null>;
  /** Stores the mentor's decision and runs station 7 (the core's decideRun, through the desk). */
  decide(runId: number, input: unknown): Promise<void>;
}

/** application/json, with or without the UTF-8 charset: the CRM's own rule (ADR-0007). */
const JSON_TYPE = /^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i;

/** The two names the board is served under, with its port (ADR-0011 B6), as a browser writes an origin. */
export function isBoardOrigin(origin: string, port: number): boolean {
  const value = origin.toLowerCase();
  return value === `http://127.0.0.1:${port}` || value === `http://localhost:${port}`;
}

/**
 * The shape of the mentor's corrected list, each action strict: a field the core does not know is
 * a 400, not something to drop (A8). Its limits and the contact's rules are the core's to check.
 */
const ACTION = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create_contact'), fullName: z.string() }),
  z.strictObject({ type: z.literal('update_contact'), fullName: z.string() }),
  z.strictObject({ type: z.literal('add_note'), body: z.string() }),
  z.strictObject({ type: z.literal('create_task'), title: z.string(), dueOn: z.string().nullable().optional() }),
  z.strictObject({ type: z.literal('move_stage'), stage: z.string() }),
]);

/** No `approvedBy`: the mentor comes from CIRCUIT_MENTOR, never from the body (A6, A7). */
const DECISION_BODY = z.strictObject({ decision: z.enum(DECISIONS), actions: z.array(ACTION).max(MAX_ACTIONS).optional() });
const TRYOUT_BODY = z.strictObject({ sample: z.string().regex(/^[a-z0-9-]{1,40}$/) });
const DECISION_PARAMS = z.strictObject({ id: runIdParam });
const NO_QUERY = z.strictObject({});

/** A request the route refuses before it reaches the core: its status and the error's name. */
export class CommandRefused extends Error {
  override readonly name = 'CommandRefused';
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string) {
    super(error);
    this.status = status;
    this.error = error;
  }
}

/**
 * The body as the schema reads it, or a 400 naming one of the schema's own fields, or the section:
 * a field the request made up is never written back (the CRM's rule, ADR-0006 D14).
 */
function parseBody<S extends z.ZodObject>(schema: S, value: unknown, section: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0]?.path[0];
  throw new InvalidParameter(typeof first === 'string' && Object.keys(schema.shape).includes(first) ? first : section);
}

/** Before the body is read: the page that sends it, then the type of what it sends. */
function checkSender(request: FastifyRequest, port: number): void {
  const origin = request.headers.origin;
  if (origin !== undefined && !isBoardOrigin(origin, port)) throw new CommandRefused(403, 'origen_no_permitido');
  if (!JSON_TYPE.test(request.headers['content-type'] ?? '')) throw new CommandRefused(415, 'tipo_no_admitido');
}

export function registerCommands(app: FastifyInstance, commands: RunCommands, port: () => number): void {
  const onRequest = async (request: FastifyRequest) => checkSender(request, port());

  app.post('/api/runs', { onRequest }, async (request, reply: FastifyReply) => {
    parse(NO_QUERY, request.query, 'query');
    const { sample } = parseBody(TRYOUT_BODY, request.body, 'cuerpo');
    const started = await commands.tryout(sample);
    if (started === null) throw new InvalidParameter('sample');
    return reply.code(201).send({ runId: started.runId });
  });

  app.post('/api/runs/:id/decision', { onRequest }, async (request) => {
    const { id } = parse(DECISION_PARAMS, request.params, 'id');
    parse(NO_QUERY, request.query, 'query');
    const body = parseBody(DECISION_BODY, request.body, 'cuerpo');
    await commands.decide(id, body);
    return { runId: id };
  });
}
