import type { CircuitTable, RunEvent } from './api.ts';

/**
 * The board's only source of station state (ADR-0011 B1): a pure function of the circuit's table
 * and a run's stored events. No clock, no randomness, no fetch. A component paints what this
 * returns and keeps nothing of its own, so the map shows only what the events say happened.
 */

export const STATION_STATUSES = ['completed', 'stopped', 'failed', 'waiting', 'skipped', 'pending'] as const;
export type StationStatus = (typeof STATION_STATUSES)[number];

/** Where a transition leads when it leaves the circuit (the table's END). */
export const END = 'end';

export interface StationView {
  readonly id: string;
  readonly number: number;
  readonly decidedBy: string;
  readonly status: StationStatus;
  /** The outcome of its event; null while it has none. */
  readonly outcome: string | null;
  readonly event: RunEvent | null;
}

/**
 * - `main`: from one station to the next by number.
 * - `branch`: one that jumps ahead (classification to person).
 * - `stop`: one that ends the run before the last station (the injection stop).
 * - `exit`: the last station's way out.
 */
export type EdgeKind = 'main' | 'branch' | 'stop' | 'exit';

export interface EdgeView {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /** Every outcome of `from` that leads to `to`. */
  readonly outcomes: readonly string[];
  /** The run went this way: the event of `from` gave one of `outcomes`. */
  readonly taken: boolean;
  /** Taken, and `to` is the station that waits: drawn dashed, as the run is still on it. */
  readonly toWaiting: boolean;
}

export interface RunView {
  readonly stations: readonly StationView[];
  readonly edges: readonly EdgeView[];
  /** The run ended: at the end of the table, or at a station that did not complete. */
  readonly finished: boolean;
  /** The station that comes next while the run goes on; null once it finished. */
  readonly waitingAt: string | null;
}

/** Where a station's outcome leads, read only from the table; undefined when the table has no such exit. */
export function destinationOf(table: CircuitTable, from: string, outcome: string): string | undefined {
  return table.transitions.find((transition) => transition.from === from && transition.outcome === outcome)?.to;
}

/** A run whose last event did not complete, or led out of the table, is over. */
export function isFinished(table: CircuitTable, last: Pick<RunEvent, 'station' | 'outcome' | 'status'> | null): boolean {
  if (last === null) return false;
  if (last.status !== 'completed') return true;
  const next = destinationOf(table, last.station, last.outcome);
  return next === undefined || next === END;
}

/** The first event of each station, in seq order: the table allows one per station (ADR-0010 D7). */
function eventsByStation(events: readonly RunEvent[]): ReadonlyMap<string, RunEvent> {
  const byStation = new Map<string, RunEvent>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (!byStation.has(event.station)) byStation.set(event.station, event);
  }
  return byStation;
}

function lastOf(events: readonly RunEvent[]): RunEvent | null {
  return events.reduce<RunEvent | null>((last, event) => (last === null || event.seq > last.seq ? event : last), null);
}

/** The station that waits: the destination of the last event, or the first station before any event. */
function waitingOf(table: CircuitTable, last: RunEvent | null): string | null {
  if (last === null) return table.stations[0]?.id ?? null;
  if (isFinished(table, last)) return null;
  return destinationOf(table, last.station, last.outcome) ?? null;
}

function edgeKind(table: CircuitTable, from: string, to: string): EdgeKind {
  const numberOf = (id: string) => table.stations.find((station) => station.id === id)?.number ?? 0;
  const lastNumber = Math.max(...table.stations.map((station) => station.number));
  if (to === END) return numberOf(from) === lastNumber ? 'exit' : 'stop';
  return numberOf(to) === numberOf(from) + 1 ? 'main' : 'branch';
}

/** One edge per pair of stations, in the table's order: person to close carries three outcomes. */
function edgesOf(table: CircuitTable, byStation: ReadonlyMap<string, RunEvent>, waitingAt: string | null): EdgeView[] {
  const pairs = new Map<string, { from: string; to: string; outcomes: string[] }>();
  for (const { from, outcome, to } of table.transitions) {
    const key = `${from}>${to}`;
    const pair = pairs.get(key) ?? { from, to, outcomes: [] };
    pair.outcomes.push(outcome);
    pairs.set(key, pair);
  }
  return [...pairs.values()].map(({ from, to, outcomes }) => {
    const outcome = byStation.get(from)?.outcome;
    const taken = outcome !== undefined && outcomes.includes(outcome);
    return { from, to, kind: edgeKind(table, from, to), outcomes, taken, toWaiting: taken && to === waitingAt };
  });
}

/**
 * A station with an event takes its event's status. The one that comes next, while the run goes
 * on, is `waiting`. A station the run left behind is `skipped`: one with a lower number than a
 * station already reached, or, once the run is over, any it never visited. The rest are `pending`.
 */
export function projectRun(table: CircuitTable, events: readonly RunEvent[]): RunView {
  const byStation = eventsByStation(events);
  const last = lastOf(events);
  const finished = isFinished(table, last);
  const waitingAt = waitingOf(table, last);
  const reached = table.stations.filter((station) => byStation.has(station.id) || station.id === waitingAt);
  const furthest = Math.max(0, ...reached.map((station) => station.number));

  const stations = table.stations.map((station): StationView => {
    const event = byStation.get(station.id) ?? null;
    const status: StationStatus =
      event !== null
        ? event.status
        : station.id === waitingAt
          ? 'waiting'
          : finished || station.number < furthest
            ? 'skipped'
            : 'pending';
    return { id: station.id, number: station.number, decidedBy: station.decidedBy, status, outcome: event?.outcome ?? null, event };
  });
  return { stations, edges: edgesOf(table, byStation, waitingAt), finished, waitingAt };
}

/** The circuit with no run: every station pending, no edge taken. */
export function idleView(table: CircuitTable): RunView {
  const view = projectRun(table, []);
  return {
    ...view,
    waitingAt: null,
    stations: view.stations.map((station) => ({ ...station, status: 'pending' })),
  };
}
