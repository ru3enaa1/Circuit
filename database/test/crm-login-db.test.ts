import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CRM_DB_USER } from '../../apps/crm/src/config.ts';
import { OWNER_ROLES, SERVICE_ROLES } from '../config.ts';
import { readLocalEnv } from '../env.ts';
import {
  createOrUpdateCrmApp,
  describeFailure,
  ensureCrmAppUser,
  lockUserChanges,
  maintenanceConnection,
  MEMBERS_GUARD_MESSAGE,
  readCrmPassword,
  runUsersCommand,
  scramVerifier,
  USER_GUARD_MESSAGE,
  type Queryable,
} from '../users.ts';
import { inTransaction, seedFixture, sqlErrorOf, type CrmContext, type Fixture } from './crm-fixture.ts';
import { crmTablePrivilegesOf, EXPECTED_CRM_SERVICE_PRIVILEGES } from './crm-privileges.ts';
import {
  accountIdsIn,
  accountIdsInEveryTable,
  errorOf,
  expectRlsRejection,
  ownContext,
  READABLE_TABLES,
  SQLSTATE,
} from './crm-rules.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0006 D4 and D5: crm_app, the user the CRM logs in as. It is made the way `npm run
// db:users` makes it, and the rules of ADR-0005 are repeated connecting as crm_app, without
// SET ROLE (audit H11). crm_app belongs to the whole server; this is the only thing these tests
// change outside their disposable database, with the password from .env that db:users uses.
// Without CRM_DB_PASSWORD the file fails with the message that names it: it is never skipped.
const env = readLocalEnv();
const password = readCrmPassword(env);

const SCRAM_PREFIX = 'SCRAM-SHA-256$4096:';

let db: DisposableDatabase | undefined;
let fixture: Fixture;
let asApp: pg.Pool;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  fixture = await seedFixture(db.pool);
  await createOrUpdateCrmApp(db.connection, password);
  asApp = db.poolAs(CRM_DB_USER, password);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

/** Runs `work` as the admin, in a transaction on the server's maintenance database that is always rolled back. */
async function onServer<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(maintenanceConnection(db!.connection));
  await client.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

async function messageOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Se esperaba un error y la acción pasó.');
}

async function crmAppRole(pool: pg.Pool): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            ARRAY(SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                  WHERE m.member = r.oid ORDER BY 1) AS member_of
     FROM pg_roles r WHERE r.rolname = $1`,
    [CRM_DB_USER],
  );
  return result.rows[0];
}

const CLEAN_CRM_APP = {
  rolcanlogin: true,
  rolinherit: true,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolreplication: false,
  rolbypassrls: false,
  member_of: [SERVICE_ROLES.crm],
};

async function membersOf(role: string): Promise<string[]> {
  const result = await db!.pool.query<{ name: string }>(
    `SELECT u.rolname::text AS name FROM pg_auth_members m
     JOIN pg_roles u ON u.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
     WHERE g.rolname = $1 ORDER BY 1`,
    [role],
  );
  return result.rows.map((row) => row.name);
}

describe('D4 · crm_app logs in with its own password', () => {
  it('connects as crm_app, without SET ROLE', async () => {
    const who = await asApp.query<{ current_user: string; session_user: string }>('SELECT current_user, session_user');
    expect(who.rows).toEqual([{ current_user: CRM_DB_USER, session_user: CRM_DB_USER }]);
  });

  it('refuses another password with 28P01', async () => {
    const client = new pg.Client({ ...db!.connection, user: CRM_DB_USER, password: `${password}-otra` });
    const error = await sqlErrorOf(() => client.connect());
    expect(error.code).toBe(SQLSTATE.invalidPassword);
  });

  it('has LOGIN and INHERIT, nothing else, and belongs to crm_service only', async () => {
    expect(await crmAppRole(db!.pool)).toEqual(CLEAN_CRM_APP);
  });

  it('is the only member of crm_service, and crm_owner and circuit_service have none (H10)', async () => {
    expect(await membersOf(SERVICE_ROLES.crm)).toEqual([CRM_DB_USER]);
    expect(await membersOf(OWNER_ROLES.crm)).toEqual([]);
    expect(await membersOf(SERVICE_ROLES.circuit)).toEqual([]);
  });

  it('is stored as a SCRAM-SHA-256 verifier', async () => {
    const stored = await db!.pool.query<{ rolpassword: string }>('SELECT rolpassword FROM pg_authid WHERE rolname = $1', [
      CRM_DB_USER,
    ]);
    expect(stored.rows[0]?.rolpassword.startsWith(SCRAM_PREFIX)).toBe(true);
    expect(stored.rows[0]?.rolpassword).not.toContain(password);
  });
});

describe('D4 · db:users never sends the password', () => {
  it('no statement carries it, and one carries the verifier (control)', async () => {
    const sent: string[] = [];
    await onServer(async (client) => {
      const recording: Queryable = {
        query: (text, values) => {
          sent.push(text, JSON.stringify(values ?? []));
          return client.query(text, values);
        },
      };
      await ensureCrmAppUser(recording, password);
    });
    expect(sent.some((text) => text.includes('SCRAM-SHA-256$'))).toBe(true);
    expect(sent.filter((text) => text.includes(password))).toEqual([]);
  });

  it('computes the verifier from the salt it is given', () => {
    const salt = Buffer.alloc(16, 7);
    expect(scramVerifier(password, salt)).toBe(scramVerifier(password, salt));
    expect(scramVerifier(password, salt)).not.toBe(scramVerifier(`${password}x`, salt));
    expect(scramVerifier(password)).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
  });
});

// Each case changes a real role, because roles belong to the server, inside a transaction that
// is always rolled back and holds the same lock db:users takes. The last test proves nothing stayed.
describe('D4 · db:users refuses a crm_app with more than it needs', () => {
  // The role names are constants, never input.
  it.each([
    ['BYPASSRLS', `ALTER ROLE ${CRM_DB_USER} BYPASSRLS`, USER_GUARD_MESSAGE],
    ['CREATEDB', `ALTER ROLE ${CRM_DB_USER} CREATEDB`, USER_GUARD_MESSAGE],
    ['a second role', `GRANT pg_read_all_data TO ${CRM_DB_USER}`, USER_GUARD_MESSAGE],
    // It could make any other role a member of crm_service (audit of ADR-0006, H7).
    ['crm_service WITH ADMIN OPTION', `GRANT ${SERVICE_ROLES.crm} TO ${CRM_DB_USER} WITH ADMIN OPTION`, USER_GUARD_MESSAGE],
    ['a member of its own', `GRANT ${CRM_DB_USER} TO ${SERVICE_ROLES.circuit}`, USER_GUARD_MESSAGE],
    ['crm_service with another member', `GRANT ${SERVICE_ROLES.crm} TO ${SERVICE_ROLES.circuit}`, MEMBERS_GUARD_MESSAGE],
  ])('with %s, it fails with its message', async (_case, setup, message) => {
    const failure = await onServer(async (client) => {
      await lockUserChanges(client);
      await client.query(setup);
      return messageOf(() => ensureCrmAppUser(client, password));
    });
    expect(failure).toBe(message);
  });

  it('leaves crm_app as it was', async () => {
    expect(await crmAppRole(db!.pool)).toEqual(CLEAN_CRM_APP);
  });
});

describe('D4 · npm run db:users', () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, out: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) } };
  };

  it('exits with 0 and says what it made', async () => {
    const { lines, out } = capture();
    expect(await runUsersCommand(env, out)).toBe(0);
    expect(lines.join('\n')).toContain(CRM_DB_USER);
  });

  it.each([
    ['without CRM_DB_PASSWORD', undefined, 'Falta CRM_DB_PASSWORD'],
    ['with a password that breaks the rule', 'corta', 'CRM_DB_PASSWORD debe ser'],
  ])('exits with 1 %s, naming it and never showing its value', async (_case, value, expected) => {
    const { lines, out } = capture();
    expect(await runUsersCommand({ ...env, CRM_DB_PASSWORD: value }, out)).toBe(1);
    expect(lines.join('\n')).toContain(expected);
    if (value !== undefined) expect(lines.join('\n')).not.toContain(value);
  });

  it('describes a database error by its SQLSTATE', () => {
    const error = new pg.DatabaseError('falló', 0, 'error');
    error.code = '42501';
    expect(describeFailure(error)).toContain('SQLSTATE 42501');
    expect(describeFailure('raro')).toBe('db:users falló.');
  });
});

describe('D5 · as crm_app, ADR-0005 D4 and D5 still hold (H11)', () => {
  const asAppIn = <T>(context: CrmContext, work: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
    inTransaction(asApp, { context }, work);

  it.each(READABLE_TABLES)('%s: only the rows of the account in crm.account_id', async (table) => {
    expect(await asAppIn(ownContext(fixture), (client) => accountIdsIn(client, table))).toEqual([fixture.a.id]);
  });

  it('without an account, 0 rows in every table', async () => {
    expect(await asAppIn({}, accountIdsInEveryTable)).toEqual([]);
  });

  // Signed and with a key, so only the account can stop the first one.
  it.each([
    ['without an account', (f: Fixture): CrmContext => ({ apiKeyId: f.a.apiKeyId, proposedBy: 'agente', approvedBy: 'mentor' }), 'a'],
    ['into account b while account a is set', (f: Fixture): CrmContext => ownContext(f), 'b'],
  ] as const)('an insert %s fails with the message of RLS', async (_case, context, target) => {
    const error = await errorOf(asApp, { context: context(fixture) }, 'INSERT INTO crm.companies (account_id, name) VALUES ($1, $2)', [
      fixture[target].id,
      'Intrusa',
    ]);
    expectRlsRejection(error);
  });

  it.each([
    ['DELETE', 'DELETE FROM crm.notes'],
    ['TRUNCATE', 'TRUNCATE crm.notes'],
    ['reading api_keys', 'SELECT * FROM crm.api_keys'],
  ])('%s fails with 42501', async (_case, statement) => {
    expect((await errorOf(asApp, { context: ownContext(fixture) }, statement)).code).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('holds exactly the privileges of crm_service, and none of its own', async () => {
    expect(await crmTablePrivilegesOf(db!.pool, CRM_DB_USER)).toEqual(EXPECTED_CRM_SERVICE_PRIVILEGES);
  });
});
