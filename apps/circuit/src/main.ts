import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import pg from 'pg';

import { CircuitConfigError, readCircuitConfig, type CircuitConfig, type CircuitDatabaseConfig, type ModelChoice } from './config.ts';
import { createDecisionDesk } from './modules/approval/index.ts';
import { CIRCUIT, LOW_CONFIDENCE_BELOW, startRun, type Clock, type EngineDeps } from './modules/circuit/index.ts';
import { CRM_TOOLS, CrmClientConfigError, HttpCrmClient, readCrmEndpoint } from './modules/crm-client/index.ts';
import { PgEventStore, PgRunReader } from './modules/event-store/index.ts';
import { createSimulator, InvalidSimulatorFile, parseSimulatorFile, requestSha256, SIMULATOR_NAME } from './modules/model/index.ts';
import { InvalidScenario, loadScenario, loadTryouts, type Tryouts } from './modules/scenario/index.ts';
import { circuitPayload } from './server/api.ts';
import { readBoardFiles } from './server/board-files.ts';
import type { RunCommands } from './server/commands.ts';
import { errorCodes, stdoutLog, type LogSink } from './server/log.ts';
import { buildServer } from './server/server.ts';

// The circuit process (ADR-0011): `npm run circuit:start` runs this file with Node as it is, with
// no build (ADR-0006 D1). It reads its configuration from the environment, checks that
// circuit_app can log in, and serves the board, its read API and its two commands (try a sample,
// decide) on 127.0.0.1 only. It reads and writes the CRM over HTTP with the agent's key (ADR-0012).

export const SCENARIOS_DIR = fileURLToPath(new URL('../../../scenarios/', import.meta.url));
export const BOARD_DIST_DIR = fileURLToPath(new URL('../../board/dist/', import.meta.url));
/** CRM_AGENT_KEY_FILE is relative to it, as the seed writes it (ADR-0009 D20). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The engine's only clock: the system's, in whole milliseconds. */
const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

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
    const scenario = loadScenario(SCENARIOS_DIR, config.scenario);
    return { scenario, replies: parseSimulatorFile(scenario.simulator), tryouts: loadTryouts(SCENARIOS_DIR, config.scenario) };
  } catch (error) {
    if (error instanceof InvalidScenario || error instanceof InvalidSimulatorFile) throw new CircuitStartupError(`El escenario de CIRCUIT_SCENARIO no se pudo cargar: ${error.message}`);
    throw new CircuitStartupError('El escenario de CIRCUIT_SCENARIO no existe en scenarios/.');
  }
}

/** The two commands of the board (ADR-0012 A6, A12), over the engine and the mentor's desk. */
function commandsOf(engine: EngineDeps, tryouts: Tryouts, decide: (runId: number, input: unknown) => Promise<unknown>): RunCommands {
  return {
    async tryout(sampleId) {
      const sample = tryouts.samples.find((entry) => entry.id === sampleId);
      if (sample === undefined) return null;
      return { runId: (await startRun(engine, sample.text)).runId };
    },
    async decide(runId, input) {
      await decide(runId, input);
    },
  };
}

export async function startCircuit(env: Readonly<Record<string, string | undefined>>, options: StartOptions = {}): Promise<RunningCircuit> {
  const log = options.log ?? stdoutLog;
  const config = readCircuitConfig(env);
  const { scenario, replies, tryouts } = scenarioOf(config);
  const endpoint = readCrmEndpoint(env, REPO_ROOT);
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
      samples: tryouts.samples,
      mentor: config.mentor,
    });
    const store = new PgEventStore(pool);
    const crm = new HttpCrmClient(endpoint, tryouts.agentAccount);
    const engine: EngineDeps = {
      definition: CIRCUIT,
      store,
      clock: SYSTEM_CLOCK,
      digest: { sha256: requestSha256 },
      model: createSimulator(replies),
      crmReader: crm,
      documents: scenario.documents,
      scenario: scenario.id,
    };
    const desk = createDecisionDesk({ definition: CIRCUIT, store, claims: store, clock: SYSTEM_CLOCK, writer: crm }, config.mentor);
    const commands = commandsOf(engine, tryouts, desk.decide);
    const app = buildServer({ reader: new PgRunReader(pool), circuit, tools: CRM_TOOLS, board, port: () => port, log, commands });
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
  if (error instanceof CircuitConfigError || error instanceof CircuitStartupError || error instanceof CrmClientConfigError) {
    return `Circuit no arrancó: ${error.message}`;
  }
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
