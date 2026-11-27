import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { CircuitDefinition, SourceDocument, StationEvent } from '../modules/circuit/index.ts';
import type { CrmTool } from '../modules/crm-client/index.ts';
import type { RunReader, RunSummary } from '../modules/event-store/index.ts';

/**
 * The board's read API (ADR-0011 B5): four GET routes. Each answer is built from a fixed list of
 * fields, so a column added to a table never reaches the browser by itself. The parameters pass
 * through zod in strict mode, and a 400 names the field, never its value. The text station 2
 * crossed out is never stored (ADR-0010 D6), so no answer can carry it.
 */

/** How many runs the list on the top left shows (docs/diseno.md §8). */
export const LATEST_RUNS = 10;
/** The largest seq the table holds: an integer column. */
const MAX_SEQ = 2_147_483_647;

export const EVENT_FIELDS = [
  'runId',
  'seq',
  'station',
  'outcome',
  'status',
  'startedAt',
  'durationMs',
  'tokensIn',
  'tokensOut',
  'costMicroUsd',
  'model',
  'detail',
] as const satisfies readonly (keyof StationEvent)[];

export const RUN_FIELDS = ['id', 'startedAt', 'events', 'lastStation', 'lastOutcome', 'lastStatus'] as const satisfies readonly (keyof RunSummary)[];
export const TOOL_FIELDS = ['name', 'label', 'access'] as const satisfies readonly (keyof CrmTool)[];

/** What GET /api/circuit answers: the table, the threshold and the documents' titles (B5, amendment of the brief). */
export interface CircuitPayload {
  readonly scenario: string;
  readonly model: string;
  readonly lowConfidenceBelow: number;
  readonly stations: readonly { readonly id: string; readonly number: number; readonly decidedBy: string }[];
  readonly transitions: readonly { readonly from: string; readonly outcome: string; readonly to: string }[];
  readonly documents: readonly { readonly id: string; readonly title: string }[];
}

export interface CircuitSource {
  readonly definition: CircuitDefinition;
  readonly scenario: string;
  readonly model: string;
  readonly lowConfidenceBelow: number;
  readonly documents: readonly SourceDocument[];
}

/** Built once at start-up. The documents' text stays out: the board shows titles only. */
export function circuitPayload(source: CircuitSource): CircuitPayload {
  return {
    scenario: source.scenario,
    model: source.model,
    lowConfidenceBelow: source.lowConfidenceBelow,
    stations: source.definition.stations.map(({ id, number, decidedBy }) => ({ id, number, decidedBy })),
    transitions: source.definition.transitions.map(({ from, outcome, to }) => ({ from, outcome, to })),
    documents: source.documents.map(({ id, title }) => ({ id, title })),
  };
}

function pick<T extends object, K extends keyof T>(value: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as Pick<T, K>;
}

const runId = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));

const seq = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,9})$/)
  .transform(Number)
  .pipe(z.number().int().max(MAX_SEQ));

const NO_QUERY = z.strictObject({});
const EVENTS_PARAMS = z.strictObject({ id: runId });
const EVENTS_QUERY = z.strictObject({ after: seq.optional() });

/** A refused parameter. The message is the field's name, never what it held. */
export class InvalidParameter extends Error {
  override readonly name = 'InvalidParameter';
  readonly field: string;

  constructor(field: string) {
    super(field);
    this.field = field;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, fallbackField: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  // An unknown key reports it in `keys`; any other issue, in its path.
  const key = issue?.code === 'unrecognized_keys' ? issue.keys[0] : issue?.path[0];
  throw new InvalidParameter(typeof key === 'string' ? key : fallbackField);
}

export interface ApiDeps {
  readonly reader: RunReader;
  readonly circuit: CircuitPayload;
  readonly tools: readonly CrmTool[];
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'no_encontrado' });
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/circuit', async (request) => {
    parse(NO_QUERY, request.query, 'query');
    return deps.circuit;
  });

  app.get('/api/tools', async (request) => {
    parse(NO_QUERY, request.query, 'query');
    return { tools: deps.tools.map((tool) => pick(tool, TOOL_FIELDS)) };
  });

  app.get('/api/runs', async (request) => {
    parse(NO_QUERY, request.query, 'query');
    const runs = await deps.reader.latestRuns(LATEST_RUNS);
    return { runs: runs.map((run) => pick(run, RUN_FIELDS)) };
  });

  app.get('/api/runs/:id/events', async (request, reply) => {
    const { id } = parse(EVENTS_PARAMS, request.params, 'id');
    const { after = 0 } = parse(EVENTS_QUERY, request.query, 'after');
    const events = await deps.reader.eventsAfter(id, after);
    if (events === null) return notFound(reply);
    return { runId: id, events: events.map((event) => pick(event, EVENT_FIELDS)) };
  });
}
