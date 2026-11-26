import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { SLUG_PATTERN } from '../apps/crm/src/db/schema.ts';
import { API_KEY_SHAPE, generateApiKey, hashApiKey } from '../apps/crm/src/keys.ts';
import { parseScenario, ScenarioError, type Scenario, type ScenarioAccount } from '../apps/crm/src/scenario.ts';
import { adminClient, CommandError, describeFailure, randomSuffix, shown, systemCodeOf } from './command.ts';
import { REPO_ROOT } from './config.ts';
import { readAdminConnection } from './connection.ts';
import { readLocalEnv, type Env } from './env.ts';
import { insertKey, KeysError, revokeKey, type AdminClient, type ConnectAdmin } from './keys.ts';

// `npm run db:seed` (ADR-0009 D11–D21): loads the CRM part of the scenario that CIRCUIT_SCENARIO
// names, scenarios/<id>/crm.json, into the database of POSTGRES_DB, as the admin of .env and in
// one transaction. Once per account: an account of the package that does not exist is born with
// all its rows; one whose slug exists is skipped whole, so nothing the agent wrote since, with the
// mentor's approval, is undone or doubled (D13). Every row is signed `seed` (ADR-0005, answer 7
// and H13) and dated by the package, so two clones get the same rows and ids (D15). Then the
// agent's key: kept if the file of CRM_AGENT_KEY_FILE holds a live one, or else issued anew with
// the issuer's own step, and written to that file only after the COMMIT (D18–D20).

/** D18: fixed here, never in the package: a package cannot widen the agent's key. */
export const AGENT_KEY_LABEL = 'agente';
export const AGENT_KEY_PERMISSIONS = ['read', 'write'] as const;
/** ADR-0005 answer 7 and H13: who proposes and approves what the seed writes. */
export const SEED_AUTHOR = 'seed';
/** D16: serialises two seeds of one database; a session lock, released when the session ends. */
export const SEED_LOCK_NAME = 'circuit.db-seed';
const SEED_LOCK = `SELECT pg_advisory_lock(hashtext('${SEED_LOCK_NAME}'))`;
const SCENARIOS_DIR = join(REPO_ROOT, 'scenarios');
const PACKAGE_FILE = 'crm.json';
const SLUG = new RegExp(SLUG_PATTERN);
/** A package saved by Windows PowerShell 5.1 starts with one, and JSON.parse refuses it. */
const BYTE_ORDER_MARK = /^\uFEFF/;
/** D20: only its owner reads or writes it. NTFS keeps only the read-only bit (ADR-0009, «Restricciones»). */
const KEY_FILE_MODE = 0o600;
const KEY_DIR_MODE = 0o700;

interface SeedRequest {
  readonly scenarioId: string;
  readonly keyFile: string;
}

/** D7, D21: both variables, checked before anything is read or connected. */
function readRequest(args: readonly string[], env: Env): SeedRequest {
  if (args.length > 0) throw new CommandError('db:seed no lleva argumentos: el escenario lo nombra CIRCUIT_SCENARIO.');
  const scenarioId = env['CIRCUIT_SCENARIO'];
  if (!scenarioId) throw new CommandError('Falta CIRCUIT_SCENARIO en .env o en el entorno; ver .env.example.');
  // A slug cannot climb out of scenarios/ with `..` or a separator.
  if (!SLUG.test(scenarioId)) throw new CommandError('CIRCUIT_SCENARIO va en minúsculas, cifras y guiones: es una carpeta de scenarios/.');
  const keyFile = env['CRM_AGENT_KEY_FILE'];
  if (!keyFile) throw new CommandError('Falta CRM_AGENT_KEY_FILE en .env o en el entorno; ver .env.example.');
  return { scenarioId, keyFile: isAbsolute(keyFile) ? keyFile : join(REPO_ROOT, keyFile) };
}

/** D7: data only. JSON.parse's message quotes the text, so it is never shown. */
function loadScenario(dir: string, id: string): Scenario {
  const file = join(dir, id, PACKAGE_FILE);
  if (!existsSync(file)) throw new CommandError(`No existe el escenario ${id}: falta scenarios/${id}/${PACKAGE_FILE}.`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(BYTE_ORDER_MARK, ''));
  } catch {
    throw new CommandError(`scenarios/${id}/${PACKAGE_FILE} no es JSON válido.`);
  }
  return parseScenario(data);
}

/** The admin of .env. Its errors name variables, never values. */
function seedConnector(env: Env): ConnectAdmin {
  return async () => {
    let connection;
    try {
      connection = readAdminConnection(env);
    } catch (error) {
      throw new CommandError(error instanceof Error ? error.message : 'Falta la conexión de .env.');
    }
    const client = adminClient(connection);
    await client.connect();
    return client;
  };
}

async function idOf(client: AdminClient, text: string, values: unknown[]): Promise<string> {
  const id = (await client.query<{ id: string }>(text, values)).rows[0]?.id;
  if (id === undefined) throw new CommandError('Una inserción de la semilla no devolvió un id.');
  return id;
}

function required(ids: ReadonlyMap<string, string>, key: string, what: string): string {
  const id = ids.get(key);
  if (id === undefined) throw new CommandError(`Un contacto apunta a ${what} que su cuenta no tiene.`);
  return id;
}

/** D15: by position, so the ids follow the order of the pipeline and not of the file. */
async function insertStages(client: AdminClient, accountId: string, account: ScenarioAccount): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const stage of [...account.stages].sort((a, b) => a.position - b.position)) {
    const text = 'INSERT INTO crm.pipeline_stages (account_id, key, label, position) VALUES ($1, $2, $3, $4) RETURNING id::text AS id';
    ids.set(stage.key, await idOf(client, text, [accountId, stage.key, stage.label, stage.position]));
  }
  return ids;
}

async function insertCompanies(client: AdminClient, accountId: string, account: ScenarioAccount, at: Dated): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const company of account.companies) {
    const text = `INSERT INTO crm.companies (account_id, name, industry, size_range, revenue_range, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`;
    const values = [accountId, company.name, company.industry ?? null, company.sizeRange ?? null, company.revenueRange ?? null, at(company.createdAt)];
    ids.set(company.name, await idOf(client, text, values));
  }
  return ids;
}

/** D15: the stages, the companies, every contact, then every note and every task, each list in the order of the package. */
async function insertRows(client: AdminClient, accountId: string, account: ScenarioAccount, at: Dated): Promise<void> {
  const stages = await insertStages(client, accountId, account);
  const companies = await insertCompanies(client, accountId, account, at);
  const contacts: string[] = [];
  for (const contact of account.contacts) {
    const companyId = contact.company === undefined ? null : required(companies, contact.company, 'una empresa');
    const text = `INSERT INTO crm.contacts (account_id, company_id, stage_id, full_name, email, created_at)
                  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`;
    const values = [accountId, companyId, required(stages, contact.stage, 'una etapa'), contact.fullName, contact.email, at(contact.createdAt)];
    contacts.push(await idOf(client, text, values));
  }
  for (const [index, contact] of account.contacts.entries()) {
    for (const note of contact.notes) {
      await client.query('INSERT INTO crm.notes (account_id, contact_id, body, created_at) VALUES ($1, $2, $3, $4)', [accountId, contacts[index], note.body, at(note.createdAt)]);
    }
  }
  for (const [index, contact] of account.contacts.entries()) {
    for (const task of contact.tasks) {
      const text = 'INSERT INTO crm.tasks (account_id, contact_id, title, due_on, completed_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)';
      await client.query(text, [accountId, contacts[index], task.title, task.dueOn ?? null, task.completedAt ?? null, at(task.createdAt)]);
    }
  }
}

/** D15: the row's own date, or the package's. */
type Dated = (own: string | undefined) => string;

/** How a count of one reads, for each column of countsOf; any other count keeps the plural. */
const SINGULAR: Readonly<Record<string, string>> = { etapas: 'etapa', empresas: 'empresa', contactos: 'contacto', notas: 'nota', tareas: 'tarea' };

/** D17: counts only, so the line says how much was written and nothing of what. */
async function countsOf(client: AdminClient, accountId: string): Promise<string> {
  const result = await client.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM crm.pipeline_stages WHERE account_id = $1)::int AS etapas,
            (SELECT count(*) FROM crm.companies WHERE account_id = $1)::int AS empresas,
            (SELECT count(*) FROM crm.contacts WHERE account_id = $1)::int AS contactos,
            (SELECT count(*) FROM crm.notes WHERE account_id = $1)::int AS notas,
            (SELECT count(*) FROM crm.tasks WHERE account_id = $1)::int AS tareas`,
    [accountId],
  );
  return Object.entries(result.rows[0] ?? {})
    .map(([what, count]) => `${count} ${count === 1 ? (SINGULAR[what] ?? what) : what}`)
    .join(', ');
}

/** D13: once per account. The line names the account by its slug, never by its name (D17). */
async function seedAccount(client: AdminClient, account: ScenarioAccount, at: Dated): Promise<string> {
  const existing = (await client.query<{ id: string }>('SELECT id::text AS id FROM crm.accounts WHERE slug = $1', [account.slug])).rows[0];
  if (existing !== undefined) return `${account.slug}: ya estaba; no se tocó (${await countsOf(client, existing.id)}).`;
  const accountId = await idOf(client, 'INSERT INTO crm.accounts (slug, name, created_at) VALUES ($1, $2, $3) RETURNING id::text AS id', [
    account.slug,
    account.name,
    at(account.createdAt),
  ]);
  await insertRows(client, accountId, account, at);
  return `${account.slug}: sembrada (${await countsOf(client, accountId)}).`;
}

/**
 * D19: the key in the file stays if it is a live `agente` {read,write} key of the agent's account.
 * Otherwise every live `agente` key of that account is revoked and a new one issued, both with the
 * issuer's own steps (D18). Keys with another label are not touched. Returns the new key, if any.
 */
async function convergeAgentKey(client: AdminClient, slug: string, inFile: string | undefined): Promise<string | undefined> {
  const accountId = await idOf(client, 'SELECT id::text AS id FROM crm.accounts WHERE slug = $1', [slug]);
  const live = `SELECT id::text AS id FROM crm.api_keys WHERE account_id = $1 AND label = $2 AND revoked_at IS NULL`;
  if (inFile !== undefined && API_KEY_SHAPE.test(inFile)) {
    const same = await client.query(`${live} AND key_hash = $3 AND permissions = $4::text[]`, [accountId, AGENT_KEY_LABEL, hashApiKey(inFile), [...AGENT_KEY_PERMISSIONS]]);
    if (same.rowCount === 1) return undefined;
  }
  for (const row of (await client.query<{ id: string }>(`${live} ORDER BY api_keys.id`, [accountId, AGENT_KEY_LABEL])).rows) await revokeKey(client, row.id);
  const key = generateApiKey();
  await insertKey(client, { order: 'issue', account: slug, label: AGENT_KEY_LABEL, permissions: AGENT_KEY_PERMISSIONS }, key);
  return key;
}

interface Outcome {
  readonly lines: readonly string[];
  readonly newKey: string | undefined;
}

/** D11, D12: signed `seed` for this transaction only; api_key_id and approval_ref stay unset, so NULL. */
async function seedAll(client: AdminClient, scenario: Scenario, inFile: string | undefined): Promise<Outcome> {
  const migrated = await client.query<{ present: boolean }>("SELECT to_regclass('crm.accounts') IS NOT NULL AS present");
  if (migrated.rows[0]?.present !== true) throw new CommandError('La base no tiene el esquema crm: corre npm run db:migrate antes.');
  await client.query("SELECT set_config('crm.proposed_by', $1, true), set_config('crm.approved_by', $1, true)", [SEED_AUTHOR]);
  const at: Dated = (own) => own ?? scenario.createdAt;
  const lines: string[] = [];
  for (const account of scenario.accounts) lines.push(await seedAccount(client, account, at));
  return { lines, newKey: await convergeAgentKey(client, scenario.agentAccount, inFile) };
}

/** D14: all or nothing; a failed COMMIT has rolled back already, and ROLLBACK then changes nothing. */
async function inOneTransaction<T>(client: AdminClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION READ WRITE');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function readKeyFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8').trimEnd() : undefined;
}

/** D20: a temporary beside it and a rename, so the file is always whole; the key and a newline only. */
function writeKeyFile(path: string, key: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: KEY_DIR_MODE });
  const temp = join(dirname(path), `.${basename(path)}.${randomSuffix()}.tmp`);
  try {
    writeFileSync(temp, `${key}\n`, { mode: KEY_FILE_MODE, flag: 'wx' });
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** D16: the lock comes before the file is read, so a second seed waiting for it sees the first one's key. */
async function seedUnderLock(client: AdminClient, scenario: Scenario, keyFile: string): Promise<readonly string[]> {
  await client.query(SEED_LOCK);
  const outcome = await inOneTransaction(client, () => seedAll(client, scenario, readKeyFile(keyFile)));
  if (outcome.newKey === undefined) return [...outcome.lines, `Llave del agente sin cambios, en ${shown(keyFile)}.`];
  try {
    writeKeyFile(keyFile, outcome.newKey);
  } catch (error) {
    // After the COMMIT: the rows are in and the old key is revoked, so the next run issues another (H9).
    const code = systemCodeOf(error) ?? 'sin código';
    throw new CommandError(
      `La base quedó sembrada, pero no se pudo escribir la llave en ${shown(keyFile)} (${code}); la anterior, si había, quedó revocada. Corre npm run db:seed otra vez y emitirá otra.`,
    );
  }
  return [...outcome.lines, `Llave del agente nueva, en ${shown(keyFile)}; la que había antes, si había, quedó revocada.`];
}

export interface SeedDeps {
  readonly connect?: ConnectAdmin;
  /** Where the packages are; the tests pass a folder of their own. */
  readonly scenariosDir?: string;
  readonly out?: Pick<Console, 'log' | 'error'>;
}

/** Our refusals, the format's and the issuer's, as they are: none of them carries a value (ADR-0008 D6). */
function describe(error: unknown): string {
  if (error instanceof ScenarioError || error instanceof KeysError) return `db:seed: ${error.message}`;
  return describeFailure('db:seed', error);
}

/** D17: the lines name accounts by slug and the file by its path; the key is never printed. */
export async function runSeed(scenario: Scenario, keyFile: string, env: Env, deps: SeedDeps = {}): Promise<number> {
  const out = deps.out ?? console;
  try {
    const client = await (deps.connect ?? seedConnector(env))();
    try {
      for (const line of await seedUnderLock(client, scenario, keyFile)) out.log(line);
    } finally {
      // Ending the session also releases the lock (D16).
      await client.end().catch(() => undefined);
    }
    return 0;
  } catch (error) {
    out.error(describe(error));
    return 1;
  }
}

export async function runSeedCommand(args: readonly string[], env: Env, deps: SeedDeps = {}): Promise<number> {
  let request: SeedRequest;
  let scenario: Scenario;
  try {
    request = readRequest(args, env);
    scenario = loadScenario(deps.scenariosDir ?? SCENARIOS_DIR, request.scenarioId);
  } catch (error) {
    (deps.out ?? console).error(describe(error));
    return 1;
  }
  return runSeed(scenario, request.keyFile, env, deps);
}

if (import.meta.main) process.exitCode = await runSeedCommand(process.argv.slice(2), readLocalEnv());
