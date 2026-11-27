import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { CircuitConfigError, readCircuitConfig, type CircuitConfig, type CircuitDatabaseConfig, type ModelChoice } from './config.ts';
import { CIRCUIT, LOW_CONFIDENCE_BELOW } from './modules/circuit/index.ts';
import { CRM_TOOLS } from './modules/crm-client/index.ts';
import { PgRunReader } from './modules/event-store/index.ts';
import { SIMULATOR_NAME } from './modules/model/index.ts';
import { InvalidScenario, loadScenario } from './modules/scenario/index.ts';
import { circuitPayload } from './server/api.ts';
import { readBoardFiles } from './server/board-files.ts';
import { errorCodes, stdoutLog, type LogSink } from './server/log.ts';
import { buildServer } from './server/server.ts';

// The circuit process (ADR-0011): `npm run circuit:start` runs this file with Node as it is, with
// no build (ADR-0006 D1). It reads its configuration from the environment, checks that
// circuit_app can log in, and serves the board and its read API on 127.0.0.1 only.

export const SCENARIOS_DIR = fileURLToPath(new URL('../../../scenarios/', import.meta.url));
export const BOARD_DIST_DIR = fileURLToPath(new URL('../../board/dist/', import.meta.url));

/** Shows in pg_stat_activity, so circuit's connections are told apart from the CRM's. */
const APPLICATION_NAME = 'circuit-board';
/** The board polls once a second per tab; a handful of connections is plenty on one machine. */
const POOL_SIZE = 4;
const CONNECT_TIMEOUT_MS = 5_000;
/** A read of the board that takes longer is a bug; it must not hold a connection. */
const STATEMENT_TIMEOUT_MS = 5_000;

/** The name each model choice stores in its events, which the board shows. */
const MODEL_NAMES: Readonly<Record<ModelChoice, string>> = { simulator: SIMULATOR_NAME };

const INVALID_PASSWORD = '28P01';
const UNKNOWN_DATABASE = '3D000';
const ADDRESS_IN_USE = 'EADDRINUSE';

/** Circuit could not start. Its message is safe to print: it never holds a value. */
export class CircuitStartupError extends Error {
  override readonly name = 'CircuitStartupError';
}

export interface RunningCircuit {
  readonly address: string;
  close(): Promise<void>;
}

export interface StartOptions {
  readonly log?: LogSink;
  /** apps/board/dist by default; a test passes its own folder. */
  readonly boardDir?: string;
}

function createPool(db: CircuitDatabaseConfig, log: LogSink): pg.Pool {
  const pool = new pg.Pool({
    ...db,
    ssl: false,
    max: POOL_SIZE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: APPLICATION_NAME,
  });
  // Without a listener, a dropped idle connection would throw out of the process, and printed
  // whole a pg error shows the password (CLAUDE.md §8).
  pool.on('error', (error) => {
    log({ event: 'pool_error', ...errorCodes(error) });
  });
  return pool;
}

async function checkDatabase(pool: pg.Pool, config: CircuitConfig): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const { sqlstate, code } = errorCodes(error);
    if (sqlstate === INVALID_PASSWORD) {
      throw new CircuitStartupError(`${config.db.user} no pudo entrar con CIRCUIT_DB_PASSWORD. Corre npm run db:users.`);
    }
    if (sqlstate === UNKNOWN_DATABASE) throw new CircuitStartupError('La base de POSTGRES_DB no existe. Corre npm run db:migrate.');
    throw new CircuitStartupError(
      `No se pudo conectar a PostgreSQL en ${config.db.host}:${config.db.port} (${sqlstate ?? code ?? 'sin código'}). ` +
        '¿Está levantado? docker compose up -d --wait db',
    );
  }
}

async function listen(app: FastifyInstance, config: CircuitConfig): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    if (errorCodes(error).code === ADDRESS_IN_USE) {
      throw new CircuitStartupError('El puerto de CIRCUIT_PORT ya está en uso: detén lo que lo usa o cambia CIRCUIT_PORT en .env.');
    }
    throw error;
  }
}

function scenarioOf(config: CircuitConfig) {
  try {
    return loadScenario(SCENARIOS_DIR, config.scenario);
  } catch (error) {
    if (error instanceof InvalidScenario) throw new CircuitStartupError(`El escenario de CIRCUIT_SCENARIO no se pudo cargar: ${error.message}`);
    throw new CircuitStartupError('El escenario de CIRCUIT_SCENARIO no existe en scenarios/.');
  }
}

export async function startCircuit(env: Readonly<Record<string, string | undefined>>, options: StartOptions = {}): Promise<RunningCircuit> {
  const log = options.log ?? stdoutLog;
  const config = readCircuitConfig(env);
  const scenario = scenarioOf(config);
  const board = readBoardFiles(options.boardDir ?? BOARD_DIST_DIR);
  if (board.size === 0) log({ event: 'board_missing', fix: 'npm run board:build' });
  const pool = createPool(config.db, log);
  try {
    await checkDatabase(pool, config);
    let port = config.port;
    const circuit = circuitPayload({
      definition: CIRCUIT,
      scenario: scenario.id,
      model: MODEL_NAMES[config.model],
      lowConfidenceBelow: LOW_CONFIDENCE_BELOW,
      documents: scenario.documents,
    });
    const app = buildServer({ reader: new PgRunReader(pool), circuit, tools: CRM_TOOLS, board, port: () => port, log });
    await listen(app, config);
    const bound = app.server.address() as AddressInfo;
    port = bound.port;
    const address = `http://${bound.address}:${bound.port}`;
    log({ event: 'listening', address });
    return {
      address,
      close: async () => {
        await app.close();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

/** One line for the terminal: our own messages as they are, anything else by its name only. */
export function startupMessage(error: unknown): string {
  if (error instanceof CircuitConfigError || error instanceof CircuitStartupError) return `Circuit no arrancó: ${error.message}`;
  return `Circuit no arrancó (${error instanceof Error ? error.name : typeof error}).`;
}

if (import.meta.main) {
  try {
    const running = await startCircuit(process.env);
    const stop = (): void => {
      void running.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    process.stderr.write(`${startupMessage(error)}\n`);
    process.exitCode = 1;
  }
}
