import { z } from 'zod';

// The CRM's configuration (ADR-0006 D6), read once at start-up and only from the environment:
// `npm run crm:start` loads .env into it with --env-file-if-exists, and a test passes its own.
// Every message names the variable and never its value: these lines reach terminals and CI logs.

/** The CRM serves on loopback only, like the database it reads (compose.yaml, ADR-0002). */
export const CRM_HOST = '127.0.0.1';
export const CRM_DB_HOST = '127.0.0.1';
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

export function readCrmConfig(env: Readonly<Record<string, string | undefined>>): CrmConfig {
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
    host: CRM_HOST,
    port: values.CRM_PORT,
    db: {
      host: CRM_DB_HOST,
      port: values.DB_PORT,
      user: CRM_DB_USER,
      password: values.CRM_DB_PASSWORD,
      database: values.POSTGRES_DB,
    },
  };
}
