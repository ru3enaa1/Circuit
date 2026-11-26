import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as circuitConfig from '../../apps/circuit/src/config.ts';
import * as crmConfig from '../../apps/crm/src/config.ts';
import { SERVICE_ROLES } from '../config.ts';
import { readLocalEnv } from '../env.ts';
import {
  CIRCUIT_APP,
  CIRCUIT_USER_GUARD_MESSAGE,
  createOrUpdateCircuitApp,
  ensureAppUser,
  lockUserChanges,
  readCircuitPassword,
  runUsersCommand,
} from '../users.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0010 D11: circuit_app, made by `npm run db:users` the way crm_app is (ADR-0006 D4, H10).
// It belongs to the whole server, like crm_app; the password is CIRCUIT_DB_PASSWORD from .env.
const env = readLocalEnv();
const password = readCircuitPassword(env);
const { CIRCUIT_DB_USER } = circuitConfig;

let db: DisposableDatabase | undefined;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  await createOrUpdateCircuitApp(db.connection, password);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

async function roleOf(name: string): Promise<Record<string, unknown> | undefined> {
  const result = await db!.pool.query(
    `SELECT r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            ARRAY(SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                  WHERE m.member = r.oid ORDER BY 1) AS member_of,
            EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid AND m.admin_option) AS admin_option,
            (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
     FROM pg_roles r WHERE r.rolname = $1`,
    [name],
  );
  return result.rows[0];
}

describe('D11 · circuit_app', () => {
  it('has LOGIN and INHERIT, nothing else, and belongs to circuit_service only, without ADMIN OPTION', async () => {
    expect(await roleOf(CIRCUIT_DB_USER)).toEqual({
      rolcanlogin: true,
      rolinherit: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      member_of: [SERVICE_ROLES.circuit],
      admin_option: false,
      members: 0,
    });
  });

  it('logs in with CIRCUIT_DB_PASSWORD and with no other', async () => {
    const pool = db!.poolAs(CIRCUIT_DB_USER, password);
    expect((await pool.query('SELECT current_user')).rows).toEqual([{ current_user: CIRCUIT_DB_USER }]);
    const other = new pg.Client({ ...db!.connection, user: CIRCUIT_DB_USER, password: `${password}-otra` });
    await expect(other.connect()).rejects.toMatchObject({ code: '28P01' });
  });

  it('is stored as a SCRAM-SHA-256 verifier, never as the password', async () => {
    const result = await db!.pool.query<{ rolpassword: string }>('SELECT rolpassword FROM pg_authid WHERE rolname = $1', [CIRCUIT_DB_USER]);
    expect(result.rows[0]?.rolpassword.startsWith('SCRAM-SHA-256$4096:')).toBe(true);
    expect(result.rows[0]?.rolpassword).not.toContain(password);
  });

  it('refuses to go on when circuit_app has more than it needs, and changes nothing', async () => {
    const client = new pg.Client({ ...db!.connection, database: 'postgres' });
    await client.connect();
    try {
      await client.query('BEGIN');
      await lockUserChanges(client);
      await client.query(`ALTER ROLE ${CIRCUIT_DB_USER} CREATEDB`);
      await expect(ensureAppUser(client, CIRCUIT_APP, password)).rejects.toThrow(CIRCUIT_USER_GUARD_MESSAGE);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
    expect((await roleOf(CIRCUIT_DB_USER))?.['rolcreatedb']).toBe(false);
  });

  it('follows the same password rule as crm_app', () => {
    expect(circuitConfig.DB_PASSWORD_PATTERN.source).toBe(crmConfig.DB_PASSWORD_PATTERN.source);
    expect(circuitConfig.DB_PASSWORD_RULE).toBe(crmConfig.DB_PASSWORD_RULE);
  });
});

describe('D11 · npm run db:users makes both users', () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, out: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) } };
  };

  it('exits with 0 and names both', async () => {
    const { lines, out } = capture();
    expect(await runUsersCommand(env, out)).toBe(0);
    expect(lines.join('\n')).toContain(crmConfig.CRM_DB_USER);
    expect(lines.join('\n')).toContain(CIRCUIT_DB_USER);
  });

  it.each([
    ['without CIRCUIT_DB_PASSWORD', undefined, 'Falta CIRCUIT_DB_PASSWORD'],
    ['with a password that breaks the rule', 'corta', 'CIRCUIT_DB_PASSWORD debe ser'],
  ])('exits with 1 %s, naming it, never showing it, and before touching crm_app', async (_case, value, expected) => {
    const { lines, out } = capture();
    const before = await db!.pool.query("SELECT rolpassword FROM pg_authid WHERE rolname = 'crm_app'");

    expect(await runUsersCommand({ ...env, CIRCUIT_DB_PASSWORD: value }, out)).toBe(1);

    expect(lines.join('\n')).toContain(expected);
    if (value !== undefined) expect(lines.join('\n')).not.toContain(value);
    const after = await db!.pool.query("SELECT rolpassword FROM pg_authid WHERE rolname = 'crm_app'");
    expect(after.rows).toEqual(before.rows);
  });
});
