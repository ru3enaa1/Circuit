import { isApprover } from './modules/circuit/index.ts';

// What circuit reads from its environment. apps/circuit never imports the CRM's code (ADR-0003
// M3), so the password rule is repeated here; database/test/circuit-login-db.test.ts checks
// it is the CRM's, character for character.

/** The user circuit logs in as: a member of circuit_service only (ADR-0010 D11). */
export const CIRCUIT_DB_USER = 'circuit_app';

/**
 * The same rule as CRM_DB_PASSWORD: long enough to resist guessing, and only characters that
 * need no escaping in a connection string or a .env line.
 */
export const DB_PASSWORD_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
export const DB_PASSWORD_RULE = 'de 16 a 128 letras, dígitos, «-», «_», «.» o «~»';

/** The models circuit can run with. Only the simulator until F3 (ADR-0010 D12, ADR-0001 D3). */
export const MODEL_CHOICES = ['simulator'] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

/**
 * CIRCUIT_MODEL, unset or `simulator`. Any other value stops the start-up naming the variable
 * and never quoting what it held: turning the real model on is a configuration change, and a
 * typo must not fall back to something else in silence.
 */
export function readModelChoice(env: Readonly<Record<string, string | undefined>>): ModelChoice {
  const value = env['CIRCUIT_MODEL'];
  if (value === undefined || value === '') return 'simulator';
  const found = MODEL_CHOICES.find((choice) => choice === value);
  if (found === undefined) throw new Error(`CIRCUIT_MODEL debe ser uno de: ${MODEL_CHOICES.join(', ')}.`);
  return found;
}

// ADR-0011 B6: what the circuit server reads at start-up, only from the environment. Like the
// CRM (ADR-0006 D6), every message names the variable and never its value.

/** The server listens on loopback only (ADR-0002 D3). No variable changes it, on purpose (B6). */
export const CIRCUIT_LISTEN_HOST = '127.0.0.1';
export const CIRCUIT_DB_HOST = '127.0.0.1';
/** Next to the CRM's 4010 (ADR-0011, question 1). */
export const DEFAULT_CIRCUIT_PORT = 4020;

const MAX_TCP_PORT = 65_535;
const PORT_SHAPE = /^[0-9]{1,5}$/;
/** PostgreSQL truncates identifiers at 63 bytes (NAMEDATALEN - 1). */
const DB_NAME_PATTERN = /^[A-Za-z0-9_]{1,63}$/;
const SCENARIO_PATTERN = /^[a-z0-9-]{1,40}$/;
// A .env saved by Windows PowerShell 5.1 starts with a BOM, which Node's --env-file glues to the
// first variable's name (ADR-0006 baseline).
const BYTE_ORDER_MARK = '\uFEFF';

/** ADR-0012 A7, question 1: who signs every decision when CIRCUIT_MENTOR is unset. */
export const DEFAULT_MENTOR = 'mentor';

// CRM_AGENT_KEY_FILE is required since F2.4: circuit reads and writes the CRM with that key. Its
// file and CRM_URL are read by crm-client (ADR-0012 A9), which knows their rules.
const REQUIRED = ['CIRCUIT_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CIRCUIT_SCENARIO', 'CRM_AGENT_KEY_FILE'] as const;
const OPTIONAL = ['CIRCUIT_PORT', 'CIRCUIT_MODEL', 'CIRCUIT_MENTOR', 'CRM_URL'] as const;

export interface CircuitDatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface CircuitConfig {
  readonly host: string;
  /** 0 lets the system choose a free port, for the tests that start the process. */
  readonly port: number;
  readonly scenario: string;
  readonly model: ModelChoice;
  /** The name every decision is signed with (A7). */
  readonly mentor: string;
  readonly db: CircuitDatabaseConfig;
}

/** A configuration circuit cannot start with. Its message is safe to print. */
export class CircuitConfigError extends Error {
  override readonly name = 'CircuitConfigError';
}

function portOf(value: string | undefined, lowest: number): number | null {
  if (value === undefined || !PORT_SHAPE.test(value)) return null;
  const port = Number(value);
  return port >= lowest && port <= MAX_TCP_PORT ? port : null;
}

function problemsOf(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  if (!DB_PASSWORD_PATTERN.test(env['CIRCUIT_DB_PASSWORD'] ?? '')) problems.push(`CIRCUIT_DB_PASSWORD debe ser ${DB_PASSWORD_RULE}.`);
  if (!DB_NAME_PATTERN.test(env['POSTGRES_DB'] ?? '')) problems.push('POSTGRES_DB debe ser un nombre de base de 1 a 63 letras, dígitos o «_».');
  if (portOf(env['DB_PORT'], 1) === null) problems.push(`DB_PORT debe ser un puerto entre 1 y ${MAX_TCP_PORT}.`);
  if (!SCENARIO_PATTERN.test(env['CIRCUIT_SCENARIO'] ?? '')) problems.push('CIRCUIT_SCENARIO debe ser de 1 a 40 minúsculas, dígitos o «-».');
  const mentor = env['CIRCUIT_MENTOR'];
  if (mentor !== undefined && mentor !== '' && !isApprover(mentor)) {
    // The CRM's audit author shape, and never a key's own name (ADR-0007 D7).
    problems.push('CIRCUIT_MENTOR debe ser de 1 a 40 minúsculas, dígitos o «-», y no key-<n>.');
  }
  const port = env['CIRCUIT_PORT'];
  if (port !== undefined && port !== '' && portOf(port, 0) === null) {
    problems.push(`CIRCUIT_PORT debe ser un puerto entre 0 y ${MAX_TCP_PORT} (0 deja que el sistema elija uno libre).`);
  }
  return problems;
}

/** readModelChoice's message names the variable only, so it is kept as a configuration error. */
function modelOf(env: Readonly<Record<string, string | undefined>>): ModelChoice {
  try {
    return readModelChoice(env);
  } catch (error) {
    throw new CircuitConfigError(error instanceof Error ? error.message : 'CIRCUIT_MODEL no es válido.');
  }
}

export function readCircuitConfig(env: Readonly<Record<string, string | undefined>>): CircuitConfig {
  const withBom = [...REQUIRED, ...OPTIONAL].filter((name) => env[name] === undefined && env[BYTE_ORDER_MARK + name] !== undefined);
  if (withBom.length > 0) throw new CircuitConfigError(`${withBom.join(', ')} empieza con un BOM: guarda .env como UTF-8 sin BOM.`);
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new CircuitConfigError(`Faltan variables de entorno: ${missing.join(', ')}. Copia .env.example a .env y complétalo.`);
  }
  const problems = problemsOf(env);
  if (problems.length > 0) throw new CircuitConfigError(problems.join(' '));
  const model = modelOf(env);
  const port = env['CIRCUIT_PORT'];
  return {
    host: CIRCUIT_LISTEN_HOST,
    port: port === undefined || port === '' ? DEFAULT_CIRCUIT_PORT : Number(port),
    scenario: env['CIRCUIT_SCENARIO'] as string,
    model,
    mentor: env['CIRCUIT_MENTOR'] || DEFAULT_MENTOR,
    db: {
      host: CIRCUIT_DB_HOST,
      port: Number(env['DB_PORT']),
      user: CIRCUIT_DB_USER,
      password: env['CIRCUIT_DB_PASSWORD'] as string,
      database: env['POSTGRES_DB'] as string,
    },
  };
}
