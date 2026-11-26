/**
 * The circuit as data (ADR-0010 D1): the seven stations in order and every transition. The
 * engine and the board read this one value; nothing else decides which station comes next.
 * Adding a branch means changing a row here, and by ADR-0001 that asks for another ADR.
 */

export const STATION_IDS = ['intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close'] as const;
export type StationId = (typeof STATION_IDS)[number];

/** Every result a station can give, as one closed list. `error` is the result of a failed station. */
export const OUTCOMES = [
  'ok',
  'injection',
  'complaint',
  'out_of_scope',
  'low_confidence',
  'no_source',
  'approved',
  'corrected',
  'rejected',
  'done',
  'error',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** `completed` moves on; `stopped` ends the run on purpose (the filter); `failed` ends it on an error. */
export const EVENT_STATUSES = ['completed', 'stopped', 'failed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Where a transition leads: a station, or the end of the run. */
export const END = 'end';
export type Destination = StationId | typeof END;

/** Who does the work of a station (the proposal's table): the engine runs code and model stations, and waits for a person. */
export const DECIDERS = ['code', 'model', 'person'] as const;
export type Decider = (typeof DECIDERS)[number];

export interface StationDefinition {
  readonly id: StationId;
  /** The number the board shows, 1 to 7. */
  readonly number: number;
  readonly decidedBy: Decider;
}

export interface Transition {
  readonly from: StationId;
  readonly outcome: Outcome;
  readonly to: Destination;
}

export interface CircuitDefinition {
  readonly stations: readonly StationDefinition[];
  readonly transitions: readonly Transition[];
}

const DECIDED_BY: Readonly<Record<StationId, Decider>> = {
  intake: 'code',
  filter: 'code',
  classification: 'model',
  // Code searches the documents and checks the citation; the model writes the answer.
  knowledge: 'model',
  crm: 'model',
  person: 'person',
  close: 'code',
};

const transition = (from: StationId, outcome: Outcome, to: Destination): Transition => ({ from, outcome, to });

export const CIRCUIT: CircuitDefinition = Object.freeze({
  stations: Object.freeze(STATION_IDS.map((id, index) => Object.freeze({ id, number: index + 1, decidedBy: DECIDED_BY[id] }))),
  transitions: Object.freeze([
    transition('intake', 'ok', 'filter'),
    transition('filter', 'ok', 'classification'),
    // An injection attempt stops at 2 and stays on record (CLAUDE.md §3, rule 1).
    transition('filter', 'injection', END),
    transition('classification', 'ok', 'knowledge'),
    // A complaint, something out of scope or a doubtful classification goes to the person (rules 1 and 3).
    transition('classification', 'complaint', 'person'),
    transition('classification', 'out_of_scope', 'person'),
    transition('classification', 'low_confidence', 'person'),
    // Without a source there is no answer, but the request still reaches the CRM proposal.
    transition('knowledge', 'ok', 'crm'),
    transition('knowledge', 'no_source', 'crm'),
    transition('crm', 'ok', 'person'),
    transition('person', 'approved', 'close'),
    transition('person', 'corrected', 'close'),
    transition('person', 'rejected', 'close'),
    transition('close', 'done', END),
  ].map((entry) => Object.freeze(entry))),
});

/** The station the circuit starts at: the first of the list. */
export const FIRST_STATION: StationId = 'intake';

/**
 * The destination of a completed station's outcome, read only from the definition. An outcome
 * the table does not list for that station is a bug in the core, not a route, so it throws.
 */
export function nextStation(definition: CircuitDefinition, from: StationId, outcome: Outcome): Destination {
  const found = definition.transitions.find((entry) => entry.from === from && entry.outcome === outcome);
  if (found === undefined) {
    throw new Error(`El circuito no tiene una salida «${outcome}» para la estación «${from}».`);
  }
  return found.to;
}

/** A station of the definition, or an error: every id the engine reaches comes from the table. */
export function stationOf(definition: CircuitDefinition, id: StationId): StationDefinition {
  const found = definition.stations.find((station) => station.id === id);
  if (found === undefined) throw new Error(`El circuito no tiene la estación «${id}».`);
  return found;
}

export function isStationId(value: unknown): value is StationId {
  return typeof value === 'string' && (STATION_IDS as readonly string[]).includes(value);
}

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}
