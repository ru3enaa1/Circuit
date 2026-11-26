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
