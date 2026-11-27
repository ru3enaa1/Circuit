import { END, FIRST_STATION, nextStation, stationOf, type CircuitDefinition, type Destination, type StationId } from './definition.ts';
import type { Clock, CrmReader, Detail, Digest, EventStore, ModelPort, SourceDocument, StationEvent, Usage } from './ports.ts';
import { AUTOMATIC_STATIONS, NO_USAGE, type RunState, type StationResult } from './stations.ts';
import { InvalidInput } from './validate.ts';

/**
 * The engine: a generic loop over the definition (ADR-0010 D1). It runs one station, stores
 * its event, and only then looks up the next station in the table (D8). It stops when the run
 * ends, when a station does not complete, or before a station a person decides, which waits
 * without an event until the decision arrives (question 6).
 */

export interface EngineDeps {
  readonly definition: CircuitDefinition;
  readonly store: EventStore;
  readonly clock: Clock;
  readonly digest: Digest;
  readonly model: ModelPort;
  readonly crmReader: CrmReader;
  readonly documents: readonly SourceDocument[];
  /** The scenario's id, stored with each run. */
  readonly scenario: string;
}

export interface RunOutcome {
  readonly runId: number;
  /** Where the run stopped: `end`, or the station it waits at. */
  readonly at: Destination;
  readonly events: readonly StationEvent[];
}

/** Starts a run with a request's raw text. The text is never stored: only its SHA-256 (question 7). */
export async function startRun(deps: EngineDeps, text: string): Promise<RunOutcome> {
  const runId = await deps.store.createRun({
    scenario: deps.scenario,
    inputSha256: deps.digest.sha256(text),
    startedAt: isoOf(deps.clock.now()),
  });
  return runAutomatic(deps, runId, { text, request: null, email: null, topic: null, contactId: null });
}

async function runAutomatic(deps: EngineDeps, runId: number, initial: RunState): Promise<RunOutcome> {
  const events: StationEvent[] = [];
  let state = initial;
  let station: Destination = FIRST_STATION;
  while (station !== END && stationOf(deps.definition, station).decidedBy !== 'person') {
    const { event, result } = await runStation(deps, runId, events.length + 1, station, state);
    // D8: stored before anything else runs. If the store fails, the error stops the run here.
    await deps.store.append(event);
    events.push(event);
    if (result.status !== 'completed') return { runId, at: END, events };
    state = { ...state, ...result.next };
    station = nextStation(deps.definition, station, result.outcome);
  }
  return { runId, at: station, events };
}

async function runStation(
  deps: EngineDeps,
  runId: number,
  seq: number,
  station: StationId,
  state: RunState,
): Promise<{ readonly event: StationEvent; readonly result: StationResult }> {
  const handler = AUTOMATIC_STATIONS[station];
  if (handler === undefined) throw new Error(`La estación «${station}» no corre sola.`);
  const startedAt = deps.clock.now();
  const result = await settle(() => handler(state, deps));
  const finishedAt = deps.clock.now();
  const worker = workerOf(deps.definition, station, deps.model.name);
  return { event: eventOf(runId, seq, station, result, startedAt, finishedAt, worker), result };
}

/**
 * An error that is not a station's result: the station did not run, so settle lets it through
 * and no event is stored for it (ADR-0012 A4: a claim another call already holds).
 */
export class Unrecorded extends Error {
  override readonly name: string = 'Unrecorded';
}

/**
 * The station's result, or a failed one. Only the field name of an invalid reply is kept: a
 * port's error message can quote the request or the reply, so it is not stored (D2).
 */
export async function settle(work: () => Promise<StationResult>): Promise<StationResult> {
  try {
    const result = await work();
    return { ...result, usage: checkedUsage(result.usage) };
  } catch (error) {
    if (error instanceof Unrecorded) throw error;
    const detail: Detail = error instanceof InvalidInput ? { reason: 'invalid', field: error.field } : { reason: 'port_error' };
    return { outcome: 'error', status: 'failed', detail, usage: { tokensIn: null, tokensOut: null, costMicroUsd: null } };
  }
}

const isMeasure = (value: number | null): boolean => value === null || (Number.isSafeInteger(value) && value >= 0);

/** D9: whole numbers that are not negative, or null. An adapter that sends anything else fails its station. */
function checkedUsage(usage: Usage): Usage {
  if (!isMeasure(usage.tokensIn) || !isMeasure(usage.tokensOut) || !isMeasure(usage.costMicroUsd)) {
    throw new InvalidInput('usage');
  }
  return usage;
}

/**
 * Who worked a station, stored in the event's `model` field: the model's name for its
 * stations, and `code` or `person` for the others, which spend nothing (D9).
 */
export function workerOf(definition: CircuitDefinition, station: StationId, modelName: string): string {
  const { decidedBy } = stationOf(definition, station);
  return decidedBy === 'model' ? modelName : decidedBy;
}

export function eventOf(
  runId: number,
  seq: number,
  station: StationId,
  result: StationResult,
  startedAt: number,
  finishedAt: number,
  worker: string,
): StationEvent {
  const usage = worker === 'code' || worker === 'person' ? NO_USAGE : result.usage;
  return {
    runId,
    seq,
    station,
    outcome: result.outcome,
    status: result.status,
    startedAt: isoOf(startedAt),
    // A clock that goes back (an NTP step) would give a negative duration; the table refuses it.
    durationMs: Math.max(0, finishedAt - startedAt),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costMicroUsd: usage.costMicroUsd,
    model: worker,
    detail: result.detail,
  };
}

/** The Clock gives milliseconds; events store ISO 8601 in UTC. Pure: it reads no clock. */
export function isoOf(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
