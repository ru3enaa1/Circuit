import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as crmSchema from '../../apps/crm/src/db/schema.ts';
import { OWNER_ROLES, SERVICE_ROLES } from '../config.ts';
import { crmTablePrivilegesOf, EXPECTED_CRM_SERVICE_PRIVILEGES } from './crm-privileges.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';

// ADR-0005, the structure the migrations leave: read from the catalogs of a freshly migrated
// disposable database and compared with fixed lists. Changing the schema means changing a
// list here, and that change shows in the diff.

const NOT_NULL = 'NOT NULL';
const NULLABLE = 'NULL';
const TIMESTAMPTZ = 'timestamp with time zone';

// D1, D2 and D6. Read column by column before changing it: name and email in contacts are
// the only personal data the schema may hold (D2).
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  accounts: ['id bigint NOT NULL', 'slug text NOT NULL', 'name text NOT NULL', `created_at ${TIMESTAMPTZ} NOT NULL`],
  api_keys: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'label text NOT NULL',
    'key_hash bytea NOT NULL',
    'permissions text[] NOT NULL',
    `created_at ${TIMESTAMPTZ} NOT NULL`,
    `revoked_at ${TIMESTAMPTZ} NULL`,
  ],
  audit_log: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    `occurred_at ${TIMESTAMPTZ} NOT NULL`,
    'table_name text NOT NULL',
    'row_id bigint NOT NULL',
    'operation text NOT NULL',
    'changed_columns text[] NOT NULL',
    'api_key_id bigint NULL',
    'proposed_by text NOT NULL',
    'approved_by text NOT NULL',
    'approval_ref text NULL',
  ],
  companies: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'name text NOT NULL',
    'industry text NULL',
    'size_range text NULL',
    'revenue_range text NULL',
    `created_at ${TIMESTAMPTZ} NOT NULL`,
    `archived_at ${TIMESTAMPTZ} NULL`,
  ],
  contacts: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'company_id bigint NULL',
    'stage_id bigint NOT NULL',
    'full_name text NOT NULL',
    'email text NOT NULL',
    `created_at ${TIMESTAMPTZ} NOT NULL`,
    `archived_at ${TIMESTAMPTZ} NULL`,
  ],
  notes: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'contact_id bigint NOT NULL',
    'body text NOT NULL',
    `created_at ${TIMESTAMPTZ} NOT NULL`,
    `archived_at ${TIMESTAMPTZ} NULL`,
  ],
  pipeline_stages: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'key text NOT NULL',
    'label text NOT NULL',
    'position integer NOT NULL',
  ],
  tasks: [
    'id bigint NOT NULL',
    'account_id bigint NOT NULL',
    'contact_id bigint NOT NULL',
    'title text NOT NULL',
    'due_on date NULL',
    `completed_at ${TIMESTAMPTZ} NULL`,
    `created_at ${TIMESTAMPTZ} NOT NULL`,
    `archived_at ${TIMESTAMPTZ} NULL`,
  ],
};

/** Column names that would mean personal data beyond name and email (D2). */
const PERSONAL_DATA_NAME = /phone|mobile|address|street|city|birth|document|passport|national|tax|ssn|gender/i;

// D3: every foreign key that does not point at accounts carries the account first.
const EXPECTED_FOREIGN_KEYS = [
  'api_keys(account_id) -> accounts(id)',
  'audit_log(account_id) -> accounts(id)',
  'audit_log(account_id,api_key_id) -> api_keys(account_id,id)',
  'companies(account_id) -> accounts(id)',
  'contacts(account_id) -> accounts(id)',
  'contacts(account_id,company_id) -> companies(account_id,id)',
  'contacts(account_id,stage_id) -> pipeline_stages(account_id,id)',
  'notes(account_id) -> accounts(id)',
  'notes(account_id,contact_id) -> contacts(account_id,id)',
  'pipeline_stages(account_id) -> accounts(id)',
  'tasks(account_id) -> accounts(id)',
  'tasks(account_id,contact_id) -> contacts(account_id,id)',
];

// D4: one policy per command, for crm_service only, and none that removes rows.
const OWN_ACCOUNT_RW = ['INSERT', 'SELECT', 'UPDATE'];
const EXPECTED_POLICIES: Readonly<Record<string, readonly string[]>> = {
  accounts: ['SELECT'],
  audit_log: ['SELECT'],
  companies: OWN_ACCOUNT_RW,
  contacts: OWN_ACCOUNT_RW,
  notes: OWN_ACCOUNT_RW,
  pipeline_stages: ['SELECT'],
  tasks: OWN_ACCOUNT_RW,
};

// D5: the matrix of crm_service lives in crm-privileges.ts, shared with crm-login-db.test.ts.

// D12: what every function in crm must look like.
const PINNED_SEARCH_PATH = ['search_path=pg_catalog, pg_temp'];
const EXPECTED_FUNCTIONS = [
  { name: 'context_account_id', definer: false, config: PINNED_SEARCH_PATH, publicExecute: false, crmServiceExecute: true },
  { name: 'resolve_api_key', definer: true, config: PINNED_SEARCH_PATH, publicExecute: false, crmServiceExecute: true },
  { name: 'write_audit_log', definer: true, config: PINNED_SEARCH_PATH, publicExecute: false, crmServiceExecute: false },
];

const AUDIT_TRIGGERS = ['companies_audit', 'contacts_audit', 'notes_audit', 'tasks_audit'];

// ADR-0006 D3: what crm holds, by kind, so an owner check over an empty list cannot pass.
// 8 tables, the 8 sequences of their identity columns, and the indexes behind their keys.
const CRM_FUNCTIONS = EXPECTED_FUNCTIONS.map((fn) => fn.name);
const CRM_TABLE_COUNT = 8;

function columnsFromSchemaFile(): Record<string, string[]> {
  const exported: readonly unknown[] = Object.values(crmSchema);
  const tables = exported.filter((value): value is PgTable => is(value, PgTable));
  return Object.fromEntries(
    tables.map((table) => {
      const config = getTableConfig(table);
      const columns = config.columns.map(
        (column) => `${column.name} ${column.getSQLType()} ${column.notNull ? NOT_NULL : NULLABLE}`,
      );
      return [config.name, columns];
    }),
  );
}


let db: DisposableDatabase | undefined;

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

async function rows<T extends object>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = await db!.pool.query<T>(text, [...values]);
  return result.rows;
}

async function columnsInDatabase(): Promise<Record<string, string[]>> {
  const found = await rows<{ table_name: string; columns: string[] }>(
    `SELECT c.relname AS table_name,
            array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' ||
                      CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END ORDER BY a.attnum) AS columns
     FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'crm'::regnamespace AND c.relkind = 'r'
     GROUP BY c.relname`,
  );
  return Object.fromEntries(found.map((row) => [row.table_name, row.columns]));
}

/** Each foreign key of crm as `table(columns) -> table(columns)`, in key order. */
async function foreignKeysInDatabase(): Promise<string[]> {
  const columnsOf = (keys: string, table: string) =>
    `array_to_string(ARRAY(SELECT a.attname FROM unnest(c.${keys}) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.${table} AND a.attnum = k.attnum ORDER BY k.ord), ',')`;
  const found = await rows<{ fk: string }>(
    `SELECT src.relname || '(' || ${columnsOf('conkey', 'conrelid')} || ') -> ' ||
            dst.relname || '(' || ${columnsOf('confkey', 'confrelid')} || ')' AS fk
     FROM pg_constraint c
     JOIN pg_class src ON src.oid = c.conrelid
     JOIN pg_class dst ON dst.oid = c.confrelid
     WHERE c.contype = 'f' AND src.relnamespace = 'crm'::regnamespace
     ORDER BY 1`,
  );
  return found.map((row) => row.fk);
}

describe('D1, D2, D6 · the columns of the list', () => {
  it('crm has the tables and columns of the list (D1, D6)', async () => {
    expect(await columnsInDatabase()).toEqual(EXPECTED_COLUMNS);
  });

  it('the migrated database matches apps/crm/src/db/schema.ts (D1)', async () => {
    const fromSchemaFile = columnsFromSchemaFile();
    // Without this, a schema module that exported no table would match an empty database.
    expect(Object.keys(fromSchemaFile).sort()).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
    expect(await columnsInDatabase()).toEqual(fromSchemaFile);
  });

  it('holds no personal data beyond the contact name and email (D2)', async () => {
    const all = Object.entries(await columnsInDatabase()).flatMap(([table, columns]) =>
      columns.map((column) => `${table}.${column.split(' ')[0]}`),
    );
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((column) => PERSONAL_DATA_NAME.test(column))).toEqual([]);
    expect(EXPECTED_COLUMNS['contacts']?.map((column) => column.split(' ')[0])).toEqual(
      ['id', 'account_id', 'company_id', 'stage_id', 'full_name', 'email', 'created_at', 'archived_at'],
    );
  });
});

describe('D3 · the account in every table and every foreign key', () => {
  it('every table but accounts carries account_id bigint NOT NULL', async () => {
    const columns = await columnsInDatabase();
    const missing = Object.entries(columns)
      .filter(([table, list]) => table !== 'accounts' && !list.includes('account_id bigint NOT NULL'))
      .map(([table]) => table);
    expect(Object.keys(columns).length).toBe(Object.keys(EXPECTED_COLUMNS).length);
    expect(missing).toEqual([]);
  });

  it('every foreign key carries the account', async () => {
    const foreignKeys = await foreignKeysInDatabase();
    expect(foreignKeys).toEqual(EXPECTED_FOREIGN_KEYS);
    // The rule itself, so a new key that skips the account fails even if the list is edited.
    const withoutAccount = foreignKeys.filter(
      (fk) => !fk.endsWith('-> accounts(id)') && !/^\w+\(account_id,\w+\) -> \w+\(account_id,id\)$/.test(fk),
    );
    expect(withoutAccount).toEqual([]);
  });
});

describe('D4 · row-level security', () => {
  it('every table has it, with one policy per command for crm_service', async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'crm'::regnamespace AND relkind = 'r' ORDER BY 1",
    );
    expect(tables.map((table) => table.relname)).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
    expect(tables.filter((table) => !table.relrowsecurity)).toEqual([]);

    const policies = await rows<{ tablename: string; commands: string[]; roles: string[] }>(
      `SELECT tablename, array_agg(cmd ORDER BY cmd) AS commands,
              array_agg(DISTINCT r::text ORDER BY r::text) AS roles
       FROM pg_policies, unnest(roles) AS r
       WHERE schemaname = 'crm' GROUP BY tablename ORDER BY tablename`,
    );
    expect(Object.fromEntries(policies.map((policy) => [policy.tablename, policy.commands]))).toEqual(
      EXPECTED_POLICIES,
    );
    expect(policies.flatMap((policy) => policy.roles).filter((role) => role !== SERVICE_ROLES.crm)).toEqual([]);
  });
});

describe('D5 · the privileges of crm_service', () => {
  it('are exactly those of the matrix', async () => {
    expect(await crmTablePrivilegesOf(db!.pool, SERVICE_ROLES.crm)).toEqual(EXPECTED_CRM_SERVICE_PRIVILEGES);
  });

  it('include nothing on the sequences: identity columns draw ids without it', async () => {
    const sequences = await rows<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'crm'::regnamespace AND relkind = 'S'
         AND (has_sequence_privilege($1, oid, 'USAGE') OR has_sequence_privilege($1, oid, 'SELECT')
              OR has_sequence_privilege($1, oid, 'UPDATE'))`,
      [SERVICE_ROLES.crm],
    );
    expect(sequences).toEqual([]);
  });
});

describe('D7 · the audit triggers', () => {
  it('every audited table has one', async () => {
    const triggers = await rows<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'crm'::regnamespace AND NOT t.tgisinternal ORDER BY 1`,
    );
    expect(triggers.map((trigger) => trigger.tgname)).toEqual(AUDIT_TRIGGERS);
  });
});

describe('D12, D13 · functions and schemas', () => {
  it('every crm function pins search_path, and PUBLIC executes none (D12)', async () => {
    const functions = await rows<(typeof EXPECTED_FUNCTIONS)[number]>(
      `SELECT p.proname AS name, p.prosecdef AS definer, p.proconfig AS config,
              has_function_privilege('public', p.oid, 'EXECUTE') AS "publicExecute",
              has_function_privilege($1, p.oid, 'EXECUTE') AS "crmServiceExecute"
       FROM pg_proc p WHERE p.pronamespace = 'crm'::regnamespace ORDER BY 1`,
      [SERVICE_ROLES.crm],
    );
    expect(functions).toEqual(EXPECTED_FUNCTIONS);
  });

  it('crm_owner owns the schema and every relation and function in it (ADR-0006 D3, audit H3)', async () => {
    const owned = await rows<{ kind: string; name: string; owner: string }>(
      `SELECT 'schema' AS kind, n.nspname AS name, pg_get_userbyid(n.nspowner) AS owner
       FROM pg_namespace n WHERE n.nspname = 'crm'
       UNION ALL
       SELECT 'relation ' || c.relkind::text, c.relname, pg_get_userbyid(c.relowner)
       FROM pg_class c WHERE c.relnamespace = 'crm'::regnamespace
       UNION ALL
       SELECT 'function', p.proname, pg_get_userbyid(p.proowner)
       FROM pg_proc p WHERE p.pronamespace = 'crm'::regnamespace
       ORDER BY 1, 2`,
    );
    const named = (kind: string) => owned.filter((row) => row.kind === kind).map((row) => row.name);
    expect(named('schema')).toEqual(['crm']);
    expect(named('function')).toEqual(CRM_FUNCTIONS);
    expect(named('relation r')).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
    expect(named('relation S')).toHaveLength(CRM_TABLE_COUNT);
    expect(named('relation i').length).toBeGreaterThan(CRM_TABLE_COUNT);
    expect(owned.filter((row) => row.owner !== OWNER_ROLES.crm)).toEqual([]);
  });

  it('crm_owner cannot log in and has no attribute, membership or member (ADR-0006 D3)', async () => {
    const found = await rows<Record<string, unknown>>(
      `SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
       FROM pg_roles r WHERE r.rolname = $1`,
      [OWNER_ROLES.crm],
    );
    expect(found).toEqual([
      {
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        member_of: 0,
        members: 0,
      },
    ]);
  });

  it('neither service role reaches the schema of the other one (D13)', async () => {
    const reach = await rows<{ grant: string }>(
      `SELECT r.role || ' ' || s.schema || ' ' || p.privilege AS grant
       FROM unnest($1::text[]) AS r(role)
       CROSS JOIN unnest(ARRAY['circuit', 'crm', 'drizzle']) AS s(schema)
       CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
       WHERE has_schema_privilege(r.role, s.schema, p.privilege)
       ORDER BY 1`,
      [[SERVICE_ROLES.crm, SERVICE_ROLES.circuit]],
    );
    expect(reach.map((row) => row.grant)).toEqual([`${SERVICE_ROLES.crm} crm USAGE`]);
  });
});
