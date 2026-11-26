import { emailOf, parseStoredActions, validateActions, type CrmAction } from './actions.ts';
import { END, nextStation, stationOf, type CircuitDefinition, type Destination, type StationId } from './definition.ts';
import { eventOf, settle, workerOf, type RunOutcome } from './engine.ts';
import type { Clock, CrmWriter, Detail, EventStore, JsonValue, StationEvent } from './ports.ts';
import { NO_USAGE, type StationResult } from './stations.ts';
import { InvalidInput, requireOneOf, requireRecord } from './validate.ts';

/**
 * Stations 6 and 7. The person's decision becomes the only event of station 6 (ADR-0010,
 * question 6), and station 7 applies what that stored event says, read back from the store
 * and never from memory (ADR-0012 A2). ADR-0012 adds the marked Approval type, the claim that
 * applies once, and the HTTP client; this file gives them a stored event to start from.
 */

export const DECISIONS = ['approved', 'corrected', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** The CRM's audit author shape; a key's own name (`key-<n>`) never approves (ADR-0007 D7). */
const APPROVER_PATTERN = /^[a-z0-9-]{1,40}$/;
const KEY_AUTHOR = /^key-[0-9]+$/;

/** Stations 6 and 7 are never the model's, so no model name is ever stored for them. */
const NOT_A_MODEL = '';

export interface DecisionDeps {
  readonly definition: CircuitDefinition;
  readonly store: EventStore;
  readonly clock: Clock;
  readonly writer: CrmWriter;
}

/** The run does not exist, or it is not waiting for a person: nothing is stored (ADR-0012 A6, 409). */
export class RunNotWaiting extends Error {
  constructor(runId: number) {
    super(`La corrida ${runId} no espera una decisión.`);
    this.name = 'RunNotWaiting';
  }
}

/** The station a run waits at, or null when it ended or never started. */
export function waitingAt(definition: CircuitDefinition, events: readonly StationEvent[]): StationId | null {
  const last = events.at(-1);
  if (last === undefined || last.status !== 'completed') return null;
  const next = nextStation(definition, last.station, last.outcome);
  return next !== END && stationOf(definition, next).decidedBy === 'person' ? next : null;
}

/**
 * Stores the decision as the person station's event and runs what follows it. `approvedBy` is
 * the configured mentor, never something the request body names (ADR-0012 A6, A7).
 */
export async function decideRun(deps: DecisionDeps, runId: number, input: unknown, approvedBy: string): Promise<RunOutcome> {
  if (!APPROVER_PATTERN.test(approvedBy) || KEY_AUTHOR.test(approvedBy)) throw new InvalidInput('approvedBy');
  const before = await deps.store.events(runId);
  const station = waitingAt(deps.definition, before);
  if (station === null) throw new RunNotWaiting(runId);
  const startedAt = deps.clock.now();
  const { decision, actions, contactId } = readDecision(input, before);
  const detail: Detail = { decision, approvedBy, contactId, actions };
  const result: StationResult = { outcome: decision, status: 'completed', detail, usage: NO_USAGE };
  const event = eventOf(runId, before.length + 1, station, result, startedAt, deps.clock.now(), workerOf(deps.definition, station, NOT_A_MODEL));
  await deps.store.append(event);
  return runAfterDecision(deps, runId, nextStation(deps.definition, station, decision));
}

interface ReadDecision {
  readonly decision: Decision;
  readonly actions: readonly CrmAction[];
  readonly contactId: number | null;
}

/** approved takes station 5's proposal as stored; corrected, the mentor's list; rejected, nothing. */
function readDecision(input: unknown, before: readonly StationEvent[]): ReadDecision {
  const body = requireRecord(input, 'decision');
  const decision = requireOneOf(body['decision'], 'decision', DECISIONS);
  const proposal = before.find((event) => event.station === 'crm' && event.status === 'completed');
  const proposed = proposal === undefined ? [] : parseStoredActions(proposal.detail['actions']);
  const contactId = proposal === undefined ? null : contactIdOf(proposal.detail['contactId']);
  if (decision !== 'corrected') {
    // Only a correction carries a list; anywhere else a list is a mistake, not something to ignore.
    if (body['actions'] !== undefined) throw new InvalidInput('actions');
    return { decision, actions: decision === 'approved' ? proposed : [], contactId };
  }
  const actions = validateActions(body['actions'], { contactKnown: contactId !== null, email: emailOf(proposed) });
  return { decision, actions, contactId };
}

function contactIdOf(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new InvalidInput('contactId');
  return value;
}

async function runAfterDecision(deps: DecisionDeps, runId: number, first: Destination): Promise<RunOutcome> {
  let station = first;
  while (station !== END) {
    const handler = AFTER_DECISION[station];
    if (handler === undefined) throw new Error(`La estación «${station}» no corre después de la decisión.`);
    // Read back from the store, so what is applied is what was stored (ADR-0012 A2).
    const events = await deps.store.events(runId);
    const startedAt = deps.clock.now();
    const result = await settle(() => handler(deps, events));
    const event = eventOf(runId, events.length + 1, station, result, startedAt, deps.clock.now(), workerOf(deps.definition, station, NOT_A_MODEL));
    await deps.store.append(event);
    if (result.status !== 'completed') break;
    station = nextStation(deps.definition, station, result.outcome);
  }
  return { runId, at: END, events: await deps.store.events(runId) };
}

type ActionResult = { readonly type: string; readonly result: 'applied'; readonly id: number } | { readonly type: string; readonly result: 'failed' | 'not_sent' };

/**
 * Station 7: applies the stored decision's actions in order, one write each, and stops at the
 * first failure (ADR-0012 A5). Without a stored decision it writes nothing.
 */
async function close(deps: DecisionDeps, events: readonly StationEvent[]): Promise<StationResult> {
  const decided = events.find((event) => stationOf(deps.definition, event.station).decidedBy === 'person');
  if (decided === undefined) {
    return { outcome: 'error', status: 'failed', detail: { reason: 'sin_aprobacion' }, usage: NO_USAGE };
  }
  const actions = decided.outcome === 'rejected' ? [] : parseStoredActions(decided.detail['actions']);
  let contactId = contactIdOf(decided.detail['contactId']);
  const results: ActionResult[] = [];
  for (const action of actions) {
    if (results.some((entry) => entry.result !== 'applied')) {
      results.push({ type: action.type, result: 'not_sent' });
      continue;
    }
    const applied = await applyOne(deps.writer, action, contactId);
    results.push(applied);
    if (applied.result === 'applied' && action.type === 'create_contact') contactId = applied.id;
  }
  const allApplied = results.every((entry) => entry.result === 'applied');
  return allApplied
    ? { outcome: 'done', status: 'completed', detail: { results }, usage: NO_USAGE }
    : { outcome: 'error', status: 'failed', detail: { results }, usage: NO_USAGE };
}

async function applyOne(writer: CrmWriter, action: CrmAction, contactId: number | null): Promise<ActionResult> {
  try {
    const { id } = await writer.apply(action, contactId);
    if (!Number.isSafeInteger(id) || id < 1) return { type: action.type, result: 'failed' };
    return { type: action.type, result: 'applied', id };
  } catch {
    // The writer's error is not stored: it can quote the CRM's answer (ADR-0012 A5).
    return { type: action.type, result: 'failed' };
  }
}

/** What runs after the person decides, by station id. Station 7 is the only one, and the only one with the writer. */
const AFTER_DECISION: Readonly<Partial<Record<StationId, (deps: DecisionDeps, events: readonly StationEvent[]) => Promise<StationResult>>>> =
  Object.freeze({ close });
