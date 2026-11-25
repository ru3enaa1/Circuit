import type { AddressInfo } from 'node:net';

import pg from 'pg';

import { ConfigError, readCrmConfig, type CrmConfig } from './config.ts';
import { createCrmPool } from './db/pool.ts';
import { errorCodes, stdoutLog, type LogSink } from './log.ts';
import { buildServer } from './server/server.ts';

// The CRM process (ADR-0006 D7): `npm run crm:start` runs this file with Node as it is, with
// no build and no loader (D1). It reads its configuration from the environment, checks that
// crm_app can log in, and serves on 127.0.0.1 only.

const INVALID_PASSWORD = '28P01';
const UNKNOWN_DATABASE = '3D000';

/** The CRM could not start. Its message is safe to print: it never holds a value. */
export class StartupError extends Error {
  override readonly name = 'StartupError';
}

export interface RunningCrm {
  readonly address: string;
  close(): Promise<void>;
}

/** Fails at start-up, with the command that fixes it, instead of on the first request. */
async function checkDatabase(pool: pg.Pool, config: CrmConfig): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const { sqlstate, code } = errorCodes(error);
    if (sqlstate === INVALID_PASSWORD) {
      throw new StartupError(`${config.db.user} no pudo entrar con CRM_DB_PASSWORD. Corre npm run db:users.`);
    }
    if (sqlstate === UNKNOWN_DATABASE) throw new StartupError('La base de POSTGRES_DB no existe. Corre npm run db:migrate.');
    throw new StartupError(
      `No se pudo conectar a PostgreSQL en ${config.db.host}:${config.db.port} (${sqlstate ?? code ?? 'sin código'}). ` +
        '¿Está levantado? docker compose up -d --wait db',
    );
  }
}

export async function startCrm(env: Readonly<Record<string, string | undefined>>, log: LogSink = stdoutLog): Promise<RunningCrm> {
  const config = readCrmConfig(env);
  const pool = createCrmPool(config.db, log);
  try {
    await checkDatabase(pool, config);
    const app = buildServer({ pool, log });
    await app.listen({ host: config.host, port: config.port });
    const bound = app.server.address() as AddressInfo;
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
  if (error instanceof ConfigError || error instanceof StartupError) return `El CRM no arrancó: ${error.message}`;
  return `El CRM no arrancó (${error instanceof Error ? error.name : typeof error}).`;
}

if (import.meta.main) {
  try {
    const crm = await startCrm(process.env);
    const stop = (): void => {
      void crm.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    process.stderr.write(`${startupMessage(error)}\n`);
    process.exitCode = 1;
  }
}
