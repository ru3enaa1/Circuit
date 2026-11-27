import { existsSync } from 'node:fs';

import { z } from 'zod';

// The CRM's configuration (ADR-0006 D6), read once at start-up and only from the environment:
// `npm run crm:start` loads .env into it with --env-file-if-exists, and a test passes its own.
// Every message names the variable and never its value: these lines reach terminals and CI logs.

/** The CRM serves on loopback only, like the database it reads (compose.yaml, ADR-0002). */
export const CRM_HOST = '127.0.0.1';
export const CRM_DB_HOST = '127.0.0.1';

/**
 * ADR-0020 D2: inside a container, 127.0.0.1 is the container itself, so with CIRCUIT_IN_CONTAINER=1
 * the CRM listens on every interface of the container (only Compose's own network reaches it: its port is not published) and finds the base at the Compose
 * service db. The variable counts only where Docker left its mark, so a .env on the host cannot open
 * the CRM to the local network.
 */
export const CONTAINER_MARK = '/.dockerenv';
export const CONTAINER_LISTEN_HOST = '0.0.0.0';
export const CONTAINER_DB_HOST = 'db';
const CONTAINER_VARIABLE = 'CIRCUIT_IN_CONTAINER';
/** Whether this process runs in a Docker container; a test passes its own answer. */
export type InContainer = () => boolean;
const dockerMarkExists: InContainer = () => existsSync(CONTAINER_MARK);
/** The CRM's own login, created by `npm run db:users` (database/users.ts). Never the admin. */
export const CRM_DB_USER = 'crm_app';

/**
 * ASCII only, so the SCRAM verifier database/users.ts computes is the one PostgreSQL would
 * (SASLprep leaves such a password as it is); and none of these characters needs quoting in .env.
 */
export const DB_PASSWORD_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
export const DB_PASSWORD_RULE = 'de 16 a 128 letras, dígitos, «-», «_», «.» o «~»';

const MAX_TCP_PORT = 65_535;
/** PostgreSQL truncates identifiers at 63 bytes (NAMEDATALEN - 1). */
const DB_NAME_PATTERN = /^[A-Za-z0-9_]{1,63}$/;
// A .env saved by Windows PowerShell 5.1 starts with a BOM; Node's --env-file then glues it to
// the first variable's name (checked on 2026-11-24, ADR-0006 baseline).
const BYTE_ORDER_MARK = '﻿';

const VARIABLES = ['CRM_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CRM_PORT'] as const;
type Variable = (typeof VARIABLES)[number];

/** What each variable must be, said without its value. */
const RULES: Readonly<Record<Variable, string>> = {
  CRM_DB_PASSWORD: DB_PASSWORD_RULE,
  POSTGRES_DB: 'un nombre de base de 1 a 63 letras, dígitos o «_»',
  DB_PORT: `un puerto entre 1 y ${MAX_TCP_PORT}`,
  CRM_PORT: `un puerto entre 0 y ${MAX_TCP_PORT} (0 deja que el sistema elija uno libre)`,
};

const port = (lowest: number) =>
  z
    .string()
    .regex(/^[0-9]{1,5}$/)
    .transform(Number)
    .pipe(z.number().int().min(lowest).max(MAX_TCP_PORT));

const SCHEMA = z.object({
  CRM_DB_PASSWORD: z.string().regex(DB_PASSWORD_PATTERN),
  POSTGRES_DB: z.string().regex(DB_NAME_PATTERN),
  DB_PORT: port(1),
  CRM_PORT: port(0),
});

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface CrmConfig {
  readonly host: string;
  readonly port: number;
  readonly db: DatabaseConfig;
}

/** A configuration the CRM cannot start with. Its message is safe to print. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function isVariable(name: unknown): name is Variable {
  return typeof name === 'string' && (VARIABLES as readonly string[]).includes(name);
}


/** D2: true only with CIRCUIT_IN_CONTAINER=1 inside a container; any other use stops the start-up. */
function containerMode(env: Readonly<Record<string, string | undefined>>, inContainer: InContainer): boolean {
  const value = env[CONTAINER_VARIABLE];
  if (value === undefined || value === '') return false;
  if (value !== '1') throw new ConfigError(`${CONTAINER_VARIABLE} debe ser 1 o no estar.`);
  if (!inContainer()) throw new ConfigError(`${CONTAINER_VARIABLE}=1 solo vale dentro de un contenedor de Docker (docker compose up).`);
  return true;
}

export function readCrmConfig(env: Readonly<Record<string, string | undefined>>, inContainer: InContainer = dockerMarkExists): CrmConfig {
  const container = containerMode(env, inContainer);
  const withBom = VARIABLES.filter((name) => env[name] === undefined && env[BYTE_ORDER_MARK + name] !== undefined);
  if (withBom.length > 0) {
    throw new ConfigError(`${withBom.join(', ')} empieza con un BOM: guarda .env como UTF-8 sin BOM.`);
  }
  const missing = VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ConfigError(`Faltan variables de entorno: ${missing.join(', ')}. Copia .env.example a .env y complétalo.`);
  }
  const parsed = SCHEMA.safeParse(Object.fromEntries(VARIABLES.map((name) => [name, env[name]])));
  if (!parsed.success) {
    // The issues carry the variable's name in their path; zod's own messages are not used.
    const invalid = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))].filter(isVariable);
    throw new ConfigError(invalid.map((name) => `${name} debe ser ${RULES[name]}.`).join(' '));
  }
  const values = parsed.data;
  return {
    host: container ? CONTAINER_LISTEN_HOST : CRM_HOST,
    port: values.CRM_PORT,
    db: {
      host: container ? CONTAINER_DB_HOST : CRM_DB_HOST,
      port: values.DB_PORT,
      user: CRM_DB_USER,
      password: values.CRM_DB_PASSWORD,
      database: values.POSTGRES_DB,
    },
  };
}
