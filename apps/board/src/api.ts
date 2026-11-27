/**
 * What the circuit server sends the board (ADR-0011 B5), as the board reads it. The board does not
 * import circuit's code: it is a separate app that only knows these shapes. Station ids are kept
 * as strings, because the table is data the board receives, not a list it owns.
 */

export type EventStatus = 'completed' | 'stopped' | 'failed';
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface RunEvent {
  readonly runId: number;
  readonly seq: number;
  readonly station: string;
  readonly outcome: string;
  readonly status: EventStatus;
  /** ISO 8601 in UTC. */
  readonly startedAt: string;
  readonly durationMs: number;
  /** Null when the source has no number to give, as the simulator. */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costMicroUsd: number | null;
  readonly model: string;
  readonly detail: { readonly [key: string]: JsonValue };
}

export interface CircuitStation {
  readonly id: string;
  readonly number: number;
  readonly decidedBy: string;
}

export interface CircuitTransition {
  readonly from: string;
  readonly outcome: string;
  readonly to: string;
}

/** The part of GET /api/circuit the projection needs. */
export interface CircuitTable {
  readonly stations: readonly CircuitStation[];
  readonly transitions: readonly CircuitTransition[];
}

export interface CircuitInfo extends CircuitTable {
  readonly scenario: string;
  readonly model: string;
  readonly lowConfidenceBelow: number;
  readonly documents: readonly { readonly id: string; readonly title: string }[];
  /** «Probar una solicitud» (ADR-0012 A12): each sample's id and label, never its text. */
  readonly samples: readonly { readonly id: string; readonly label: string }[];
  /** Who signs the decisions (A7). */
  readonly mentor: string;
}

export interface RunSummary {
  readonly id: number;
  readonly startedAt: string;
  readonly events: number;
  readonly lastStation: string | null;
  readonly lastOutcome: string | null;
  readonly lastStatus: EventStatus | null;
}

export interface CrmTool {
  readonly name: string;
  readonly label: string;
  readonly access: 'read' | 'write';
}

export const API = {
  circuit: '/api/circuit',
  runs: '/api/runs',
  tools: '/api/tools',
  events: (runId: number, after: number) => `/api/runs/${runId}/events?after=${after}`,
  /** POST: starts a run with one of the scenario's samples (ADR-0012 A12). */
  tryout: '/api/runs',
  /** POST: the mentor's decision for a run that waits at the person station (A6). */
  decision: (runId: number) => `/api/runs/${runId}/decision`,
} as const;

/** A payload of another shape: the board shows it failed instead of painting half of it. */
export class UnexpectedPayload extends Error {
  override readonly name = 'UnexpectedPayload';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function arrayField(value: unknown, field: string): unknown[] {
  const inner = isObject(value) ? value[field] : undefined;
  if (!Array.isArray(inner)) throw new UnexpectedPayload(field);
  return inner;
}

export function readCircuit(value: unknown): CircuitInfo {
  arrayField(value, 'stations');
  arrayField(value, 'transitions');
  arrayField(value, 'documents');
  arrayField(value, 'samples');
  if (!isObject(value) || typeof value['lowConfidenceBelow'] !== 'number') throw new UnexpectedPayload('lowConfidenceBelow');
  if (typeof value['mentor'] !== 'string') throw new UnexpectedPayload('mentor');
  return value as unknown as CircuitInfo;
}

export const readRuns = (value: unknown): readonly RunSummary[] => arrayField(value, 'runs') as RunSummary[];
export const readTools = (value: unknown): readonly CrmTool[] => arrayField(value, 'tools') as CrmTool[];
export const readEvents = (value: unknown): readonly RunEvent[] => arrayField(value, 'events') as RunEvent[];

/** What a command answered: its status and the error's name, when the server sent one. */
export interface CommandAnswer {
  readonly status: number;
  readonly error: string | null;
  readonly field: string | null;
  readonly runId: number | null;
}

/** The server's answer to a POST, read only for the fields the board uses. */
export function readCommandAnswer(status: number, value: unknown): CommandAnswer {
  const body = isObject(value) ? value : {};
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : null);
  const runId = typeof body['runId'] === 'number' && Number.isSafeInteger(body['runId']) ? (body['runId'] as number) : null;
  return { status, error: text('error'), field: text('field'), runId };
}
