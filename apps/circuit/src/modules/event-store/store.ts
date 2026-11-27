import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import {
  isOutcome,
  isRecord,
  isStationId,
  type Detail,
  type EventStatus,
  type EventStore,
  type NewRun,
  type StationEvent,
} from '../circuit/index.ts';
import { runs, stationEvents } from './schema.ts';

/**
 * The core's EventStore over PostgreSQL (ADR-0010 D10, D16). It connects as circuit_app, whose
 * role inserts and reads and nothing else, so a bug here cannot rewrite an event: the database
 * refuses it. What it reads back is checked again, because a row is data like any other.
 */

const STATUSES: readonly string[] = ['completed', 'stopped', 'failed'] satisfies readonly EventStatus[];

export class PgEventStore implements EventStore {
  private readonly db;

  constructor(pool: pg.Pool) {
    this.db = drizzle({ client: pool });
  }

  async createRun(run: NewRun): Promise<number> {
    const [row] = await this.db
      .insert(runs)
      .values({ scenario: run.scenario, inputSha256: run.inputSha256, startedAt: run.startedAt })
      .returning({ id: runs.id });
    if (row === undefined) throw new Error('La base no devolvió el id de la corrida.');
    return row.id;
  }

  async append(event: StationEvent): Promise<void> {
    await this.db.insert(stationEvents).values({
      runId: event.runId,
      seq: event.seq,
      station: event.station,
      outcome: event.outcome,
      status: event.status,
      startedAt: event.startedAt,
      durationMs: event.durationMs,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costMicroUsd: event.costMicroUsd,
      model: event.model,
      detail: event.detail,
    });
  }

  async events(runId: number): Promise<readonly StationEvent[]> {
    const rows = await this.db.select().from(stationEvents).where(eq(stationEvents.runId, runId)).orderBy(asc(stationEvents.seq));
    return rows.map(eventOfRow);
  }
}

export type EventRow = typeof stationEvents.$inferSelect;

export function eventOfRow(row: EventRow): StationEvent {
  if (!isStationId(row.station) || !isOutcome(row.outcome) || !STATUSES.includes(row.status) || !isRecord(row.detail)) {
    throw new Error(`El evento ${row.id} no tiene la forma de un evento del circuito.`);
  }
  return {
    runId: row.runId,
    seq: row.seq,
    station: row.station,
    outcome: row.outcome,
    status: row.status as EventStatus,
    // PostgreSQL gives `2026-11-26 09:00:00.01+00`; the core speaks ISO 8601 in UTC.
    startedAt: new Date(row.startedAt).toISOString(),
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costMicroUsd: row.costMicroUsd,
    model: row.model,
    detail: row.detail as Detail,
  };
}
