import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import { EVENT_STATUSES, OUTCOMES, STATION_IDS } from '../../apps/circuit/src/modules/circuit/index.ts';
import { CHECKED_LISTS } from '../../apps/circuit/src/modules/event-store/index.ts';
import { OWNER_ROLES, SERVICE_ROLES } from '../config.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, readCircuitPassword } from '../users.ts';
import { sqlErrorOf } from './crm-fixture.ts';
import { SQLSTATE } from './crm-rules.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0010 D10: circuit.runs and circuit.station_events only grow. Checked as circuit_app, the
// user circuit logs in as, on a disposable database: what the grants refuse is refused to the
// real user, not to a role reached with SET ROLE. Without CIRCUIT_DB_PASSWORD the file fails
// with the message that names it: it is never skipped.
const password = readCircuitPassword(readLocalEnv());

let db: DisposableDatabase | undefined;
let asApp: pg.Pool;
let runId: number;

const EVENT_COLUMNS =
  'run_id, seq, station, outcome, status, started_at, duration_ms, tokens_in, tokens_out, cost_micro_usd, model, detail';
const SHA = 'a'.repeat(64);

/** A valid event row for `run`, with `change` laid over it, as the parameters of an INSERT. */
function eventValues(run: number, change: Record<string, unknown> = {}): unknown[] {
  const row: Record<string, unknown> = {
    run_id: run,
    seq: 1,
    station: 'intake',
    outcome: 'ok',
    status: 'completed',
    started_at: '2026-11-26T09:00:00.010Z',
    duration_ms: 10,
    tokens_in: 0,
    tokens_out: 0,
    cost_micro_usd: 0,
    model: 'code',
    detail: '{"length": 10}',
    ...change,
  };
  return EVENT_COLUMNS.split(', ').map((column) => row[column]);
}

const insertEvent = (pool: pg.Pool, values: unknown[]) =>
  pool.query(`INSERT INTO circuit.station_events (${EVENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, values);

async function newRun(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO circuit.runs (scenario, input_sha256, started_at) VALUES ('escuela', $1, '2026-11-26T09:00:00Z') RETURNING id",
    [SHA],
  );
  return Number(result.rows[0]?.id);
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await createOrUpdateCircuitApp(db.connection, password);
  asApp = db.poolAs(CIRCUIT_DB_USER, password);
  runId = await newRun(asApp);
  await insertEvent(asApp, eventValues(runId));
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

describe('D10 · circuit_app inserts and reads, and nothing more', () => {
  it('connects as circuit_app, without SET ROLE', async () => {
    const who = await asApp.query('SELECT current_user, session_user');
    expect(who.rows).toEqual([{ current_user: CIRCUIT_DB_USER, session_user: CIRCUIT_DB_USER }]);
  });

  it('reads back what it inserted', async () => {
    const found = await asApp.query('SELECT station, outcome, detail FROM circuit.station_events WHERE run_id = $1', [runId]);
    expect(found.rows).toEqual([{ station: 'intake', outcome: 'ok', detail: { length: 10 } }]);
  });

  it.each([
    ['UPDATE an event', "UPDATE circuit.station_events SET outcome = 'error'"],
    ['UPDATE a run', "UPDATE circuit.runs SET scenario = 'otro'"],
    ['DELETE an event', 'DELETE FROM circuit.station_events'],
    ['DELETE a run', 'DELETE FROM circuit.runs'],
    ['TRUNCATE the events', 'TRUNCATE circuit.station_events'],
    ['TRUNCATE the runs', 'TRUNCATE circuit.runs'],
    ['read the CRM', 'SELECT * FROM crm.contacts'],
    ['create a table in circuit', 'CREATE TABLE circuit.planted (id int)'],
  ])('refuses to %s with 42501', async (_name, statement) => {
    const error = await sqlErrorOf(() => asApp.query(statement));
    expect(error.code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('refuses a second event of the same station in the same run with 23505', async () => {
    const error = await sqlErrorOf(() => insertEvent(asApp, eventValues(runId, { seq: 2 })));
    expect(error.code).toBe(SQLSTATE.uniqueViolation);
    expect(error.constraint).toBe('station_events_run_station');
  });

  it('refuses a second event with the same seq in the same run with 23505', async () => {
    const error = await sqlErrorOf(() => insertEvent(asApp, eventValues(runId, { station: 'filter' })));
    expect(error.constraint).toBe('station_events_run_seq');
  });

  it('refuses an event of a run that does not exist with 23503', async () => {
    const error = await sqlErrorOf(() => insertEvent(asApp, eventValues(999_999)));
    expect(error.code).toBe(SQLSTATE.foreignKeyViolation);
  });
});

describe('D9, D10 · the checks of the table', () => {
  it.each([
    ['a negative duration', { duration_ms: -1 }, 'station_events_measures_not_negative'],
    ['a negative token count', { tokens_in: -1 }, 'station_events_measures_not_negative'],
    ['a negative cost', { cost_micro_usd: -1 }, 'station_events_measures_not_negative'],
    ['seq 0', { seq: 0 }, 'station_events_seq_positive'],
    ['a station off the list', { station: 'otra' }, 'station_events_station_known'],
    ['an outcome off the list', { outcome: 'goto' }, 'station_events_outcome_known'],
    ['a status off the list', { status: 'waiting' }, 'station_events_status_known'],
    ['an empty model', { model: '' }, 'station_events_model_length'],
    ['a detail that is not an object', { detail: '[1]' }, 'station_events_detail_object'],
  ])('refuses %s with 23514', async (_name, change, constraint) => {
    const run = await newRun(asApp);
    const error = await sqlErrorOf(() => insertEvent(asApp, eventValues(run, change)));
    expect(error.code).toBe(SQLSTATE.checkViolation);
    expect(error.constraint).toBe(constraint);
  });

  it('refuses a decimal cost or token count, which an integer column cannot hold', async () => {
    const run = await newRun(asApp);
    const error = await sqlErrorOf(() => insertEvent(asApp, eventValues(run, { cost_micro_usd: 0.5 })));
    expect(error.code).toBe(SQLSTATE.invalidText);
  });

  it('refuses a run whose input hash or scenario is not of its shape', async () => {
    for (const [scenario, sha] of [['escuela', 'no-hex'], ['Con Espacios', SHA]]) {
      const error = await sqlErrorOf(() =>
        asApp.query("INSERT INTO circuit.runs (scenario, input_sha256, started_at) VALUES ($1, $2, now())", [scenario, sha]),
      );
      expect(error.code).toBe(SQLSTATE.checkViolation);
    }
  });

  it('lists in its CHECKs exactly the core\'s stations, outcomes and statuses', () => {
    const listOf = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');
    expect(CHECKED_LISTS).toEqual({ stations: listOf(STATION_IDS), outcomes: listOf(OUTCOMES), statuses: listOf(EVENT_STATUSES) });
  });
});

describe('D10 · who owns circuit, and what circuit_service holds', () => {
  it('circuit_owner owns the schema, both tables and their sequences', async () => {
    const owned = await db!.pool.query<{ kind: string; name: string; owner: string }>(
      `SELECT 'schema' AS kind, n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner
       FROM pg_namespace n WHERE n.nspname = 'circuit'
       UNION ALL
       SELECT 'relation ' || c.relkind::text, c.relname, pg_get_userbyid(c.relowner)
       FROM pg_class c WHERE c.relnamespace = 'circuit'::regnamespace AND c.relkind IN ('r', 'S')`,
    );
    // Sorted here, by code point: the server's collation would put 'r' before 'S'.
    const byKindAndName = (row: { kind: string; name: string }) => `${row.kind} ${row.name}`;
    const sorted = [...owned.rows].sort((a, b) => (byKindAndName(a) < byKindAndName(b) ? -1 : 1));
    expect(sorted).toEqual([
      { kind: 'relation S', name: 'runs_id_seq', owner: OWNER_ROLES.circuit },
      { kind: 'relation S', name: 'station_events_id_seq', owner: OWNER_ROLES.circuit },
      { kind: 'relation r', name: 'runs', owner: OWNER_ROLES.circuit },
      { kind: 'relation r', name: 'station_events', owner: OWNER_ROLES.circuit },
      { kind: 'schema', name: 'circuit', owner: OWNER_ROLES.circuit },
    ]);
  });

  it('circuit_service holds SELECT and INSERT on both tables and nothing on the sequences', async () => {
    const grants = await db!.pool.query<{ grant: string }>(
      `SELECT table_name || ' ' || privilege_type AS grant FROM information_schema.role_table_grants
       WHERE grantee = $1 ORDER BY 1`,
      [SERVICE_ROLES.circuit],
    );
    expect(grants.rows.map((row) => row.grant)).toEqual(['runs INSERT', 'runs SELECT', 'station_events INSERT', 'station_events SELECT']);
    const sequences = await db!.pool.query<{ usable: boolean }>(
      `SELECT bool_or(has_sequence_privilege($1, c.oid, 'USAGE, SELECT, UPDATE')) AS usable
       FROM pg_class c WHERE c.relnamespace = 'circuit'::regnamespace AND c.relkind = 'S'`,
      [SERVICE_ROLES.circuit],
    );
    expect(sequences.rows).toEqual([{ usable: false }]);
  });

  it('circuit_owner cannot log in and has no attribute, membership or member', async () => {
    const found = await db!.pool.query(
      `SELECT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS risky,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid OR m.roleid = r.oid) AS memberships
       FROM pg_roles r WHERE r.rolname = $1`,
      [OWNER_ROLES.circuit],
    );
    expect(found.rows).toEqual([{ risky: false, memberships: 0 }]);
  });
});
