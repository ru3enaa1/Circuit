import pg from 'pg';

import type { DatabaseConfig } from '../config.ts';
import { errorCodes, type LogSink } from '../log.ts';
import { CONNECT_TIMEOUT_MS, IDLE_IN_TRANSACTION_TIMEOUT_MS, POOL_SIZE, STATEMENT_TIMEOUT_MS } from '../server/limits.ts';

/** Shows in pg_stat_activity, so a connection of the CRM is told apart from the admin's. */
const APPLICATION_NAME = 'circuit-crm';

/** The CRM's connections, as crm_app (ADR-0006 D4). They never log in as the admin. */
export function createCrmPool(db: DatabaseConfig, log: LogSink): pg.Pool {
  const pool = new pg.Pool({
    ...db,
    // Local loopback connection; there is no TLS to negotiate.
    ssl: false,
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    application_name: APPLICATION_NAME,
  });
  // An idle connection that drops is reported here. Without a listener, pg would throw the
  // error out of the process, and printed whole it shows the password (CLAUDE.md §8).
  pool.on('error', (error) => {
    log({ event: 'pool_error', ...errorCodes(error) });
  });
  return pool;
}
