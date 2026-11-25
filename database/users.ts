import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import pg from 'pg';

import { CRM_DB_USER, DB_PASSWORD_PATTERN, DB_PASSWORD_RULE } from '../apps/crm/src/config.ts';
import { OWNER_ROLES, SERVICE_ROLES } from './config.ts';
import { readAdminConnection, type AdminConnection } from './connection.ts';
import { readLocalEnv, type Env } from './env.ts';

// `npm run db:users` (ADR-0006 D4): creates or updates crm_app, the user the CRM logs in as.
// Migrations are public and never hold a login or a password (ADR-0005 D14), so this runs as
// the admin from .env, after db:migrate. The password never reaches the server: what it sends
// is a SCRAM-SHA-256 verifier computed here, so a failed statement, which PostgreSQL copies
// whole into its log (ADR-0005 audit H5), cannot leave the password there either.

/** Roles belong to the whole server; any database reaches them, and this one always exists. */
const MAINTENANCE_DB = 'postgres';
// PostgreSQL's own defaults for a verifier (src/include/common/scram-common.h).
const SCRAM_ITERATIONS = 4096;
const SCRAM_SALT_BYTES = 16;
const SCRAM_KEY_BYTES = 32;
const VERIFIER_SHAPE = /^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
/**
 * Serialises every run on the server: two sessions altering one role at once fail with "tuple
 * concurrently updated", and each test file runs this. Advisory locks are per database, so
 * every caller takes it in MAINTENANCE_DB. Held until the transaction ends.
 */
const USERS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('circuit.db-users'))";

export const USER_GUARD_MESSAGE = `${CRM_DB_USER} ya existe con atributos o membresías de más; revísalo a mano.`;
export const MEMBERS_GUARD_MESSAGE = `${SERVICE_ROLES.crm} solo puede tener a ${CRM_DB_USER} como miembro, y ${OWNER_ROLES.crm} y ${SERVICE_ROLES.circuit} a nadie.`;

/** What `query` needs here: a pg client, or a test double that records each statement. */
export interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** RFC 5802 §3, as PostgreSQL stores it in pg_authid.rolpassword. */
export function scramVerifier(password: string, salt: Buffer = randomBytes(SCRAM_SALT_BYTES)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, SCRAM_KEY_BYTES, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  const encode = (bytes: Buffer): string => bytes.toString('base64');
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${encode(salt)}$${encode(storedKey)}:${encode(serverKey)}`;
}

/** CRM_DB_PASSWORD from the environment, or a message that names it and never shows it. */
export function readCrmPassword(env: Env): string {
  const password = env['CRM_DB_PASSWORD'];
  if (!password) throw new Error('Falta CRM_DB_PASSWORD en .env o en el entorno; ver .env.example.');
  if (!DB_PASSWORD_PATTERN.test(password)) throw new Error(`CRM_DB_PASSWORD debe ser ${DB_PASSWORD_RULE}.`);
  return password;
}

interface RoleState {
  readonly login: boolean;
  readonly inherit: boolean;
  /** Any of SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS. */
  readonly admin: boolean;
  /** A membership WITH ADMIN OPTION: the role could grant it to anyone (audit of ADR-0006, H7). */
  readonly grantsMemberships: boolean;
  readonly memberOf: readonly string[];
  readonly members: readonly string[];
}

async function roleState(client: Queryable, role: string): Promise<RoleState | undefined> {
  const result = await client.query<RoleState>(
    `SELECT r.rolcanlogin AS login, r.rolinherit AS inherit,
            r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS admin,
            EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members AS m
                   WHERE m.member = r.oid AND m.admin_option) AS "grantsMemberships",
            ARRAY(SELECT DISTINCT g.rolname::text FROM pg_catalog.pg_auth_members AS m
                  JOIN pg_catalog.pg_roles AS g ON g.oid = m.roleid WHERE m.member = r.oid ORDER BY 1) AS "memberOf",
            ARRAY(SELECT DISTINCT u.rolname::text FROM pg_catalog.pg_auth_members AS m
                  JOIN pg_catalog.pg_roles AS u ON u.oid = m.member WHERE m.roleid = r.oid ORDER BY 1) AS members
     FROM pg_catalog.pg_roles AS r WHERE r.rolname = $1`,
    [role],
  );
  return result.rows[0];
}

/** More than crm_app needs: an admin attribute, a membership it can grant, a role besides crm_service, or a member. */
function hasMoreThanItNeeds(state: RoleState): boolean {
  return (
    state.admin ||
    state.grantsMemberships ||
    state.memberOf.some((role) => role !== SERVICE_ROLES.crm) ||
    state.members.length > 0
  );
}

/** The verifier as a SQL literal. CREATE ROLE takes no bind parameters, so it goes in the text. */
function verifierLiteral(password: string): string {
  const verifier = scramVerifier(password);
  if (!VERIFIER_SHAPE.test(verifier)) throw new Error('El verificador SCRAM no tiene la forma esperada.');
  return pg.escapeLiteral(verifier);
}

async function checkFinalState(client: Queryable): Promise<void> {
  const user = await roleState(client, CRM_DB_USER);
  const clean =
    user !== undefined && user.login && user.inherit && !hasMoreThanItNeeds(user) && user.memberOf.length === 1;
  if (!clean) throw new Error(USER_GUARD_MESSAGE);
  const service = await roleState(client, SERVICE_ROLES.crm);
  const owner = await roleState(client, OWNER_ROLES.crm);
  const circuit = await roleState(client, SERVICE_ROLES.circuit);
  const membersOk =
    service?.members.join() === CRM_DB_USER && (owner?.members.length ?? 0) === 0 && (circuit?.members.length ?? 0) === 0;
  if (!membersOk) throw new Error(MEMBERS_GUARD_MESSAGE);
}

/**
 * Creates crm_app, or updates its password, LOGIN and INHERIT, and makes it a member of
 * crm_service. Runs inside the caller's transaction on MAINTENANCE_DB, which it never ends:
 * the caller commits, or rolls back on any error, so a failed check leaves nothing behind.
 */
export async function ensureCrmAppUser(client: Queryable, password: string): Promise<void> {
  await client.query(USERS_LOCK);
  if ((await roleState(client, SERVICE_ROLES.crm)) === undefined) {
    throw new Error(`Falta el rol ${SERVICE_ROLES.crm}: corre npm run db:migrate antes.`);
  }
  const before = await roleState(client, CRM_DB_USER);
  if (before !== undefined && hasMoreThanItNeeds(before)) throw new Error(USER_GUARD_MESSAGE);
  // Both names are constants, never input.
  const verb = before === undefined ? 'CREATE' : 'ALTER';
  await client.query(`${verb} ROLE ${CRM_DB_USER} WITH LOGIN INHERIT PASSWORD ${verifierLiteral(password)}`);
  if (!(before?.memberOf.includes(SERVICE_ROLES.crm) ?? false)) {
    await client.query(`GRANT ${SERVICE_ROLES.crm} TO ${CRM_DB_USER}`);
  }
  await checkFinalState(client);
}

/** Takes the lock ensureCrmAppUser takes, for a test that changes crm_app before calling it. */
export async function lockUserChanges(client: Queryable): Promise<void> {
  await client.query(USERS_LOCK);
}

export function maintenanceConnection(connection: AdminConnection): AdminConnection {
  return { ...connection, database: MAINTENANCE_DB };
}

/** One transaction on the server: crm_app is made and checked, or nothing changes. */
export async function createOrUpdateCrmApp(connection: AdminConnection, password: string): Promise<void> {
  const client = new pg.Client(maintenanceConnection(connection));
  await client.connect();
  try {
    await client.query('BEGIN');
    await ensureCrmAppUser(client, password);
    await client.query('COMMIT');
  } catch (error) {
    // The error that stopped the run is the one reported. A failed ROLLBACK means the
    // connection is gone, and PostgreSQL rolls back a transaction whose connection drops.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** One line for the terminal: our own messages as they are, and a database error by its code. */
export function describeFailure(error: unknown): string {
  if (error instanceof pg.DatabaseError) return `db:users falló (SQLSTATE ${error.code}): ${error.message}`;
  if (error instanceof Error) return `db:users falló: ${error.message}`;
  return 'db:users falló.';
}

export async function runUsersCommand(env: Env, out: Pick<Console, 'log' | 'error'> = console): Promise<number> {
  try {
    await createOrUpdateCrmApp(readAdminConnection(env), readCrmPassword(env));
    out.log(`${CRM_DB_USER} listo: entra con CRM_DB_PASSWORD y es miembro solo de ${SERVICE_ROLES.crm}.`);
    return 0;
  } catch (error) {
    out.error(describeFailure(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runUsersCommand(readLocalEnv());
