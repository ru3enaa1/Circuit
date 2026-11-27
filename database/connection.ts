import { existsSync } from 'node:fs';

import type { Env } from './env.ts';

// The admin connection: it runs migrations and creates the disposable test databases.
// Services connect with their own least-privilege users, created in F1 (ADR-0003, M4).

/** compose.yaml publishes the database on loopback only, so the host is not configurable. */
export const DB_HOST = '127.0.0.1';
/**
 * ADR-0020 D2: inside Compose (the setup service) the base is the service db. CIRCUIT_IN_CONTAINER=1
 * counts only where Docker left its mark: the same rule as the CRM's and circuit's configuration.
 */
export const CONTAINER_DB_HOST = 'db';
const CONTAINER_MARK = '/.dockerenv';
const CONTAINER_VARIABLE = 'CIRCUIT_IN_CONTAINER';
const dockerMarkExists = (): boolean => existsSync(CONTAINER_MARK);

function hostOf(env: Env, inContainer: () => boolean): string {
  const value = env[CONTAINER_VARIABLE];
  if (value === undefined || value === '') return DB_HOST;
  if (value !== '1') throw new Error(`${CONTAINER_VARIABLE} debe ser 1 o no estar.`);
  if (!inContainer()) throw new Error(`${CONTAINER_VARIABLE}=1 solo vale dentro de un contenedor de Docker (docker compose up).`);
  return CONTAINER_DB_HOST;
}

const MAX_TCP_PORT = 65_535;

const REQUIRED_VARS = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DB_PORT'] as const;
type RequiredVar = (typeof REQUIRED_VARS)[number];

export interface AdminConnection {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export function readAdminConnection(env: Env, inContainer: () => boolean = dockerMarkExists): AdminConnection {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    // Names only, never values: this message ends up in terminals and CI logs.
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}. Copia .env.example a .env y complétalo.`,
    );
  }
  // Every variable was checked above; `?? ''` only satisfies the index-signature type.
  const read = (name: RequiredVar): string => env[name] ?? '';

  const port = Number(read('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > MAX_TCP_PORT) {
    throw new Error(`DB_PORT debe ser un número de puerto entre 1 y ${MAX_TCP_PORT}.`);
  }
  return {
    host: hostOf(env, inContainer),
    port,
    user: read('POSTGRES_USER'),
    password: read('POSTGRES_PASSWORD'),
    database: read('POSTGRES_DB'),
  };
}
