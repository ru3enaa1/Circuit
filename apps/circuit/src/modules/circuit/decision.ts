import { emailOf, parseStoredActions, validateActions, type CrmAction } from './actions.ts';
import { approvalFrom, contactIdOf, isApprover, NotAnApproval, type Approval } from './approval.ts';
import { END, nextStation, stationOf, type CircuitDefinition, type Destination, type StationId } from './definition.ts';
import { eventOf, settle, Unrecorded, workerOf, type RunOutcome } from './engine.ts';
import { CrmWriteFailed, type ApplyClaims, type Clock, type CrmWriter, type Detail, type EventStore, type StationEvent } from './ports.ts';
import { NO_USAGE, type StationResult } from './stations.ts';
import { InvalidInput, requireOneOf, requireRecord } from './validate.ts';

/**
 * Stations 6 and 7 (ADR-0012). The person's decision becomes the only event of station 6
 * (ADR-0010, question 6). Station 7 reads that stored event back, never memory (A2), turns it
 * into an Approval (A1), claims the run so it applies once (A4) and writes in order, stopping at
 * the first failure (A5).
 */

export const DECISIONS = ['approved', 'corrected', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Stations 6 and 7 are never the model's, so no model name is ever stored for them. */
const NOT_A_MODEL = '';

export interface DecisionDeps {
  readonly definition: CircuitDefinition;
  readonly store: EventStore;
  readonly claims: ApplyClaims;
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

/**
 * The run was claimed before (A4): another call applies it, or one was cut off before storing
 * station 7. Nothing is sent and nothing is stored; the claim keeps it in sight.
 */
export class ApplyAlreadyClaimed extends Unrecorded {
  override readonly name = 'ApplyAlreadyClaimed';

  constructor(runId: number) {
    super(`La corrida ${runId} ya se reclamó para aplicar.`);
  }
}

/** The station a run waits at, or null when it ended or never started. */
export function waitingAt(definition: CircuitDefinition, events: readonly StationEvent[]): StationId | null {
  const last = events.at(-1);
  if (last === undefined || last.status !== 'completed') return null;
  const next = nextStation(definition, last.station, last.outcome);
  return next !== END && stationOf(definition, next).decidedBy === 'person' ? next : null;
}

const decidedByPerson = (definition: CircuitDefinition, event: StationEvent): boolean => stationOf(definition, event.station).decidedBy === 'person';

/**
 * Stores the decision as the person station's event and runs what follows it. `approvedBy` is
 * the configured mentor, never something the request body names (ADR-0012 A6, A7).
 */
export async function decideRun(deps: DecisionDeps, runId: number, input: unknown, approvedBy: string): Promise<RunOutcome> {
  if (!isApprover(approvedBy)) throw new InvalidInput('approvedBy');
  const before = await deps.store.events(runId);
  const station = waitingAt(deps.definition, before);
  if (station === null) throw new RunNotWaiting(runId);
  const startedAt = deps.clock.now();
  const { decision, actions, contactId } = readDecision(input, before);
  const detail: Detail = { decision, approvedBy, contactId, actions };
  const result: StationResult = { outcome: decision, status: 'completed', detail, usage: NO_USAGE };
  const event = eventOf(runId, before.length + 1, station, result, startedAt, deps.clock.now(), workerOf(deps.definition, station, NOT_A_MODEL));
  // Two decisions at once: the store refuses the second (EventConflict), and it applies nothing.
  await deps.store.append(event);
  return applyDecision(deps, runId);
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
  // A8: the mentor's list passes the same validation as station 5's, against the same contact.
  const actions = validateActions(body['actions'], { contactKnown: contactId !== null, email: emailOf(proposed) });
  return { decision, actions, contactId };
}

/** Where every way out of the person station leads; the table has one, station 7. */
function afterPerson(definition: CircuitDefinition): Destination {
  const ways = new Set(definition.transitions.filter((entry) => stationOf(definition, entry.from).decidedBy === 'person').map((entry) => entry.to));
  const [only] = ways;
  if (ways.size !== 1 || only === undefined) throw new Error('El circuito debe tener una sola salida después de la persona.');
  return only;
}

/**
 * Runs what follows the person station for a run that waits there or that already decided. With
 * no stored decision, station 7 fails with `sin_aprobacion` and writes nothing (A2). A run that
 * ended, or whose station 7 is stored, gives RunNotWaiting.
 */
export async function applyDecision(deps: DecisionDeps, runId: number): Promise<RunOutcome> {
  const events = await deps.store.events(runId);
  const last = events.at(-1);
  const decided = last !== undefined && last.status === 'completed' && decidedByPerson(deps.definition, last);
  if (!decided && waitingAt(deps.definition, events) === null) throw new RunNotWaiting(runId);
  let station = afterPerson(deps.definition);
  while (station !== END) {
    const handler = AFTER_DECISION[station];
    if (handler === undefined) throw new Error(`La estación «${station}» no corre después de la decisión.`);
    // Read back from the store, so what is applied is what was stored (ADR-0012 A2).
    const stored = await deps.store.events(runId);
    const startedAt = deps.clock.now();
    const result = await settle(() => handler(deps, runId, stored));
    const event = eventOf(runId, stored.length + 1, station, result, startedAt, deps.clock.now(), workerOf(deps.definition, station, NOT_A_MODEL));
    await deps.store.append(event);
    if (result.status !== 'completed') break;
    station = nextStation(deps.definition, station, result.outcome);
  }
  return { runId, at: END, events: await deps.store.events(runId) };
}

type ActionResult =
  | { readonly type: string; readonly result: 'applied'; readonly id: number; readonly status: number }
  | { readonly type: string; readonly result: 'failed'; readonly status: number | null }
  | { readonly type: string; readonly result: 'not_sent' };

const WITHOUT_APPROVAL: StationResult = { outcome: 'error', status: 'failed', detail: { reason: 'sin_aprobacion' }, usage: NO_USAGE };

/**
 * Station 7: claims the run, then applies the Approval's actions in order, one write each, and
 * stops at the first failure (ADR-0012 A4, A5). Without a stored decision it writes nothing.
 */
async function close(deps: DecisionDeps, runId: number, events: readonly StationEvent[]): Promise<StationResult> {
  const decided = events.find((event) => decidedByPerson(deps.definition, event));
  if (decided === undefined) return WITHOUT_APPROVAL;
  // Before the first request, and before reading the decision: a second call stops here (A4).
  if (!(await deps.claims.claim(runId))) throw new ApplyAlreadyClaimed(runId);
  if (decided.outcome === 'rejected' && decided.runId === runId) return done({ results: [] });
  let approval: Approval;
  try {
    approval = approvalFrom(deps.definition, runId, decided);
  } catch (error) {
    if (error instanceof NotAnApproval || error instanceof InvalidInput) return WITHOUT_APPROVAL;
    throw error;
  }
  const results = await applyAll(deps.writer, approval);
  const detail = { approvalRef: approval.approvalRef, results };
  return results.every((entry) => entry.result === 'applied') ? done(detail) : { outcome: 'error', status: 'failed', detail, usage: NO_USAGE };
}

const done = (detail: Detail): StationResult => ({ outcome: 'done', status: 'completed', detail, usage: NO_USAGE });

async function applyAll(writer: CrmWriter, approval: Approval): Promise<ActionResult[]> {
  let contactId = approval.contactId;
  const results: ActionResult[] = [];
  for (const action of approval.actions) {
    if (results.some((entry) => entry.result !== 'applied')) {
      results.push({ type: action.type, result: 'not_sent' });
      continue;
    }
    const applied = await applyOne(writer, approval, action, contactId);
    results.push(applied);
    // The actions after a create_contact work on the contact it made.
    if (applied.result === 'applied' && action.type === 'create_contact') contactId = applied.id;
  }
  return results;
}

async function applyOne(writer: CrmWriter, approval: Approval, action: CrmAction, contactId: number | null): Promise<ActionResult> {
  try {
    const { id, status } = await writer.apply(approval, action, contactId);
    if (!Number.isSafeInteger(id) || id < 1) return { type: action.type, result: 'failed', status };
    return { type: action.type, result: 'applied', id, status };
  } catch (error) {
    // Only the status: the writer's message can quote the CRM's answer (ADR-0012 A5).
    return { type: action.type, result: 'failed', status: error instanceof CrmWriteFailed ? error.status : null };
  }
}

type AfterDecision = (deps: DecisionDeps, runId: number, events: readonly StationEvent[]) => Promise<StationResult>;

/** What runs after the person decides, by station id. Station 7 is the only one, and the only one with the writer. */
const AFTER_DECISION: Readonly<Partial<Record<StationId, AfterDecision>>> = Object.freeze({ close });
