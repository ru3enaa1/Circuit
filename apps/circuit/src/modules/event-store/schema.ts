import { sql } from 'drizzle-orm';
import { bigint, check, integer, jsonb, pgSchema, text, timestamp, unique } from 'drizzle-orm/pg-core';

// ADR-0010 D10: circuit's own tables, in its own schema (ADR-0003). They only grow: the service
// role inserts and reads, and never updates or deletes, which 0005_circuit_events.sql enforces
// with its grants. drizzle-kit reads this file (database/config.ts, SCHEMA_FILES) and writes the
// tables; the owner, the grants and the role are written by hand at the end of 0005.
// The lists in the CHECKs repeat the core's (definition.ts); event-schema.test.ts compares them.

export const circuit = pgSchema('circuit');

const STATION_LIST = "'intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close'";
const OUTCOME_LIST =
  "'ok', 'injection', 'complaint', 'out_of_scope', 'low_confidence', 'no_source', 'approved', 'corrected', 'rejected', 'done', 'error'";
const STATUS_LIST = "'completed', 'stopped', 'failed'";

/** A scenario id has the shape of a CRM slug (ADR-0009). */
export const SCENARIO_PATTERN = '^[a-z0-9-]{1,40}$';
export const SHA256_HEX_PATTERN = '^[0-9a-f]{64}$';
/** The model's name as stored: `code`, `person`, `simulator`, or a model id in F3. */
export const WORKER_MAX_LENGTH = 80;

export const runs = circuit.table(
  'runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    scenario: text('scenario').notNull(),
    inputSha256: text('input_sha256').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string', precision: 3 }).notNull(),
  },
  (table) => [
    check('runs_scenario_shape', sql`${table.scenario} ~ ${sql.raw(`'${SCENARIO_PATTERN}'`)}`),
    check('runs_input_sha256_shape', sql`${table.inputSha256} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`),
  ],
);

export const stationEvents = circuit.table(
  'station_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    station: text('station').notNull(),
    outcome: text('outcome').notNull(),
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string', precision: 3 }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }),
    model: text('model').notNull(),
    detail: jsonb('detail').notNull(),
  },
  (table) => [
    // One event per station visited (ADR-0001 D5), enforced by the database and not only by the engine.
    unique('station_events_run_seq').on(table.runId, table.seq),
    unique('station_events_run_station').on(table.runId, table.station),
    check('station_events_seq_positive', sql`${table.seq} >= 1`),
    check('station_events_station_known', sql`${table.station} IN (${sql.raw(STATION_LIST)})`),
    check('station_events_outcome_known', sql`${table.outcome} IN (${sql.raw(OUTCOME_LIST)})`),
    check('station_events_status_known', sql`${table.status} IN (${sql.raw(STATUS_LIST)})`),
    check(
      'station_events_measures_not_negative',
      sql`${table.durationMs} >= 0 AND (${table.tokensIn} IS NULL OR ${table.tokensIn} >= 0) AND (${table.tokensOut} IS NULL OR ${table.tokensOut} >= 0) AND (${table.costMicroUsd} IS NULL OR ${table.costMicroUsd} >= 0)`,
    ),
    check('station_events_model_length', sql`char_length(${table.model}) BETWEEN 1 AND ${sql.raw(String(WORKER_MAX_LENGTH))}`),
    check('station_events_detail_object', sql`jsonb_typeof(${table.detail}) = 'object'`),
  ],
);

/**
 * ADR-0012 A4: one row per run whose station 7 started applying, inserted before its first
 * request to the CRM. The primary key refuses a second claim, also after a restart; a claim with
 * no event of station 7 is an application cut off, which nothing repeats on its own.
 */
export const applyClaims = circuit.table('apply_claims', {
  runId: bigint('run_id', { mode: 'number' })
    .primaryKey()
    .references(() => runs.id),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string', precision: 3 }).notNull().defaultNow(),
});

/** The lists of the CHECKs, for the test that compares them with the core's. */
export const CHECKED_LISTS = { stations: STATION_LIST, outcomes: OUTCOME_LIST, statuses: STATUS_LIST } as const;
