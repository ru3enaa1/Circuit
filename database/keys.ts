import { parseArgs } from 'node:util';

import pg from 'pg';

import { API_KEY_PERMISSIONS, SLUG_PATTERN } from '../apps/crm/src/db/schema.ts';
import { API_KEY_SHAPE, generateApiKey, hashApiKey } from '../apps/crm/src/keys.ts';
import { readAdminConnection } from './connection.ts';
import { readLocalEnv, type Env } from './env.ts';

// `npm run db:keys` (ADR-0008 D4–D9): issues, lists and revokes the CRM's keys. The API never
// does (D9): crm_service holds no privilege on api_keys (ADR-0005 D5), so a key cannot make
// another. This runs as the admin from .env, like db:users, one transaction per run. A new key
// is shown once, after its COMMIT, and only its SHA-256 is stored (D3).

export const USAGE = [
  'Uso: npm run db:keys -- <orden>',
  '  issue --account <cuenta> --label <etiqueta> --permissions <read,...>',
  '  list --account <cuenta>',
  '  revoke --id <id>',
].join('\n');

const OPTIONS = {
  account: { type: 'string' },
  label: { type: 'string' },
  permissions: { type: 'string' },
  id: { type: 'string' },
} as const;
type OptionName = keyof typeof OPTIONS;

/** D5: what each order takes. Every option of an order is required, and no other is accepted. */
const ORDERS: ReadonlyMap<string, readonly OptionName[]> = new Map([
  ['issue', ['account', 'label', 'permissions']],
  ['list', ['account']],
  ['revoke', ['id']],
]);

/** D5: an account and a label are slugs, so a label cannot carry a person's name or address. */
const SLUG = new RegExp(SLUG_PATTERN);
/** A bigint identity: positive, and short enough for a JavaScript number to hold it exactly. */
const ID_SHAPE = /^[1-9][0-9]{0,14}$/;
/** D5, H2 (a) made a rule: every key this issues can read, so none sees only what it writes. */
const REQUIRED_PERMISSION = 'read';

/** A refusal of ours: its message is safe to print as it is, and some come with the usage. */
class KeysError extends Error {
  override readonly name = 'KeysError';
  readonly withUsage: boolean;

  constructor(message: string, withUsage = false) {
    super(message);
    this.withUsage = withUsage;
  }
}

type KeysOrder =
  | { readonly order: 'issue'; readonly account: string; readonly label: string; readonly permissions: readonly string[] }
  | { readonly order: 'list'; readonly account: string }
  | { readonly order: 'revoke'; readonly id: string };

/** What the step that issues needs; the seed (ADR-0009 D18) builds one for the agent's key. */
export type IssueOrder = Extract<KeysOrder, { order: 'issue' }>;

function refuse(reason: string): never {
  throw new KeysError(reason, true);
}

function readArgs(args: readonly string[]): { readonly order: string; readonly values: Partial<Record<OptionName, string>> } {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], options: OPTIONS, allowPositionals: true, strict: true });
  } catch {
    return refuse('Hay una opción desconocida o sin valor.');
  }
  const [order, ...rest] = parsed.positionals;
  if (order === undefined || rest.length > 0) refuse('Va una sola orden: issue, list o revoke.');
  return { order: order ?? '', values: parsed.values };
}

function slugOf(value: string, what: string): string {
  if (!SLUG.test(value)) refuse(`${what} va en minúsculas, cifras y guiones, hasta 40 caracteres.`);
  return value;
}

/** D5: a non-empty subset of the four, without repeats and always with read, in canonical order. */
function permissionsOf(list: string): readonly string[] {
  const asked = list.split(',');
  const known: readonly string[] = API_KEY_PERMISSIONS;
  if (!asked.every((permission) => known.includes(permission)) || new Set(asked).size !== asked.length) {
    refuse(`Los permisos son una lista, sin repetidos, de ${API_KEY_PERMISSIONS.join(', ')}.`);
  }
  if (!asked.includes(REQUIRED_PERMISSION)) refuse(`Toda llave lleva ${REQUIRED_PERMISSION} (ADR-0008 D5).`);
  return known.filter((permission) => asked.includes(permission));
}

/** D5: the whole order is checked here, before anything connects. */
function parseOrder(args: readonly string[]): KeysOrder {
  const { order, values } = readArgs(args);
  const takes = ORDERS.get(order) ?? refuse('La orden es issue, list o revoke.');
  const given = Object.keys(values);
  if (given.length !== takes.length || !takes.every((name) => values[name] !== undefined)) {
    refuse(`${order} lleva ${takes.map((name) => `--${name}`).join(', ')}, y nada más.`);
  }
  const value = (name: OptionName): string => values[name] ?? '';
  if (order === 'revoke') {
    if (!ID_SHAPE.test(value('id'))) refuse('El id es un número entero positivo.');
    return { order, id: value('id') };
  }
  const account = slugOf(value('account'), 'La cuenta');
  if (order === 'list') return { order, account };
  return { order: 'issue', account, label: slugOf(value('label'), 'La etiqueta'), permissions: permissionsOf(value('permissions')) };
}

/** What the issuer needs of a connection; a test passes one that fails, or that fails at COMMIT. */
export interface AdminClient {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  end(): Promise<void>;
}

export type ConnectAdmin = () => Promise<AdminClient>;

/** The admin from .env, on the database .env names. Its errors name variables, never values. */
export function adminConnector(env: Env): ConnectAdmin {
  return async () => {
    let connection;
    try {
      connection = readAdminConnection(env);
    } catch (error) {
      throw new KeysError(error instanceof Error ? error.message : 'Falta la conexión de .env.');
    }
    const client = new pg.Client(connection);
    await client.connect();
    return client;
  };
}

async function inTransaction<T>(connect: ConnectAdmin, access: 'READ ONLY' | 'READ WRITE', work: (client: AdminClient) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query(`BEGIN TRANSACTION ${access}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // The error that stopped the run is the one reported; PostgreSQL rolls back a transaction
    // whose connection drops, so a failed ROLLBACK leaves nothing behind either.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function accountIdOf(client: AdminClient, slug: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id::text AS id FROM crm.accounts WHERE slug = $1', [slug]);
  const row = result.rows[0];
  if (row === undefined) throw new KeysError(`No existe la cuenta ${slug}.`);
  return row.id;
}

/**
 * D4: exactly one row. The key leaves this function only once the caller has committed. The
 * seed issues the agent's key with this same step, inside its own transaction (ADR-0009 D18).
 */
export async function insertKey(client: AdminClient, order: IssueOrder, key: string): Promise<string> {
  // The shape the server accepts (D1): a key it would refuse is never stored.
  if (!API_KEY_SHAPE.test(key)) throw new KeysError('La llave nueva no tiene la forma de ADR-0008 D1.');
  const accountId = await accountIdOf(client, order.account);
  const result = await client.query<{ id: string }>(
    'INSERT INTO crm.api_keys (account_id, label, key_hash, permissions) VALUES ($1, $2, $3, $4) RETURNING id::text AS id',
    [accountId, order.label, hashApiKey(key), [...order.permissions]],
  );
  const row = result.rows[0];
  if (row === undefined) throw new KeysError('La inserción no devolvió un id.');
  return row.id;
}

/** D8: the columns are the ones this SELECT names, printed as they come, so a hash selected would show. */
async function listKeys(client: AdminClient, slug: string): Promise<readonly string[]> {
  const accountId = await accountIdOf(client, slug);
  const result = await client.query(
    `SELECT id::text AS id, label AS etiqueta, permissions AS permisos, created_at AS creada, revoked_at AS revocada
       FROM crm.api_keys WHERE account_id = $1 ORDER BY id`,
    [accountId],
  );
  const cell = (value: unknown): string => {
    if (value === null) return '-';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.join(',');
    if (Buffer.isBuffer(value)) return value.toString('hex');
    return String(value);
  };
  const header = result.fields.map((field) => field.name).join('\t');
  return [header, ...result.rows.map((row) => Object.values(row).map(cell).join('\t'))];
}

/**
 * D7: a live key only, and only its revoked_at. Revoking is final: nothing sets it back. The
 * seed revokes a stale agent's key with this same step (ADR-0009 D19).
 */
export async function revokeKey(client: AdminClient, id: string): Promise<void> {
  const result = await client.query('UPDATE crm.api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  if (result.rowCount !== 1) throw new KeysError(`No hay una llave viva con el id ${id}.`);
}

/** The lines to print, returned only after the transaction has committed (D6). */
async function perform(order: KeysOrder, connect: ConnectAdmin, newKey: () => string): Promise<readonly string[]> {
  switch (order.order) {
    case 'issue': {
      const key = newKey();
      const id = await inTransaction(connect, 'READ WRITE', (client) => insertKey(client, order, key));
      const permissions = order.permissions.join(',');
      return [`Llave ${id} emitida para ${order.account} (${order.label}, ${permissions}). Se muestra una sola vez:`, key];
    }
    case 'list':
      return inTransaction(connect, 'READ ONLY', (client) => listKeys(client, order.account));
    case 'revoke':
      await inTransaction(connect, 'READ WRITE', (client) => revokeKey(client, order.id));
      return [`Llave ${order.id} revocada.`];
  }
}

/**
 * D6: one line for the terminal. Our own messages as they are; a database error by its SQLSTATE
 * and constraint, never its message or detail, which can carry a value; anything else by its
 * system code, never its message, which can carry the connection.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof KeysError) return `db:keys: ${error.message}`;
  if (error instanceof pg.DatabaseError) {
    const constraint = error.constraint === undefined ? '' : `, ${error.constraint}`;
    return `db:keys falló (SQLSTATE ${error.code}${constraint}).`;
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' ? `db:keys falló (${code}).` : 'db:keys falló.';
}

export interface KeysDeps {
  readonly connect?: ConnectAdmin;
  readonly newKey?: () => string;
  readonly out?: Pick<Console, 'log' | 'error'>;
}

export async function runKeysCommand(args: readonly string[], env: Env, deps: KeysDeps = {}): Promise<number> {
  const out = deps.out ?? console;
  try {
    const order = parseOrder(args);
    const lines = await perform(order, deps.connect ?? adminConnector(env), deps.newKey ?? generateApiKey);
    for (const line of lines) out.log(line);
    return 0;
  } catch (error) {
    out.error(describeFailure(error));
    if (error instanceof KeysError && error.withUsage) out.error(USAGE);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runKeysCommand(process.argv.slice(2), readLocalEnv());
