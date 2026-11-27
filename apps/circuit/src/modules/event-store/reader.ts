import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import { isOutcome, isStationId, type EventStatus, type Outcome, type StationEvent, type StationId } from '../circuit/index.ts';
import { runs, stationEvents } from './schema.ts';
import { eventOfRow } from './store.ts';

/**
 * What the board reads (ADR-0011 B5): the latest runs and the events of one run after a seq.
 * Read only, as circuit_app, whose role cannot change a row. It is not a port of the core: the
 * engine never lists runs, only the circuit server does.
 */

export interface RunSummary {
  readonly id: number;
  /** ISO 8601 in UTC. */
  readonly startedAt: string;
  readonly events: number;
  /** The run's last event; null while it has none. */
  readonly lastStation: StationId | null;
  readonly lastOutcome: Outcome | null;
  readonly lastStatus: EventStatus | null;
}

export interface RunReader {
  /** Newest first. */
  latestRuns(limit: number): Promise<readonly RunSummary[]>;
  /** The run's events with a seq above `after`, in order; null when the run does not exist. */
  eventsAfter(runId: number, after: number): Promise<readonly StationEvent[] | null>;
}

const STATUSES: readonly string[] = ['completed', 'stopped', 'failed'] satisfies readonly EventStatus[];

interface SummaryRow extends Record<string, unknown> {
  readonly id: string | number;
  readonly started_at: string;
  readonly events: string | number;
  readonly station: string | null;
  readonly outcome: string | null;
  readonly status: string | null;
}

export class PgRunReader implements RunReader {
  private readonly db;

  constructor(pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  async latestRuns(limit: number): Promise<readonly RunSummary[]> {
    // One statement: each run with its event count and its last event, newest run first.
    const result = await this.db.execute<SummaryRow>(sql`
      SELECT r.id, r.started_at,
             (SELECT count(*) FROM circuit.station_events c WHERE c.run_id = r.id) AS events,
             last.station, last.outcome, last.status
        FROM circuit.runs r
        LEFT JOIN LATERAL (
          SELECT e.station, e.outcome, e.status
            FROM circuit.station_events e
           WHERE e.run_id = r.id
           ORDER BY e.seq DESC
           LIMIT 1
        ) last ON true
       ORDER BY r.id DESC
       LIMIT ${limit}`);
    return result.rows.map(summaryOf);
  }

  async eventsAfter(runId: number, after: number): Promise<readonly StationEvent[] | null> {
    const [run] = await this.db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId));
    if (run === undefined) return null;
    const rows = await this.db
      .select()
      .from(stationEvents)
      .where(and(eq(stationEvents.runId, runId), gt(stationEvents.seq, after)))
      .orderBy(asc(stationEvents.seq));
    return rows.map(eventOfRow);
  }
}

/** A row is data like any other: a value outside the core's lists is refused, not passed on. */
function summaryOf(row: SummaryRow): RunSummary {
  const station = row.station === null ? null : isStationId(row.station) ? row.station : undefined;
  const outcome = row.outcome === null ? null : isOutcome(row.outcome) ? row.outcome : undefined;
  const status = row.status === null ? null : STATUSES.includes(row.status) ? (row.status as EventStatus) : undefined;
  if (station === undefined || outcome === undefined || status === undefined) {
    throw new Error(`La corrida ${row.id} no tiene la forma de una corrida del circuito.`);
  }
  return {
    id: Number(row.id),
    startedAt: new Date(row.started_at).toISOString(),
    events: Number(row.events),
    lastStation: station,
    lastOutcome: outcome,
    lastStatus: status,
  };
}
