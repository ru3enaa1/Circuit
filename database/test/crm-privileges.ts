import type pg from 'pg';

// ADR-0005 D5: the table privileges of crm_service, as a fixed list. crm-structure-db.test.ts
// reads them for crm_service, and crm-login-db.test.ts for crm_app, which must hold exactly
// the same through its membership and nothing of its own (ADR-0006 D5, audit H11).

/**
 * Every table privilege PostgreSQL 18 has (MAINTAIN arrived in 17). The first four can also be
 * granted per column, so they are read with has_any_column_privilege, which a column-level
 * grant cannot slip past.
 */
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

export const EXPECTED_CRM_SERVICE_PRIVILEGES = [
  'accounts SELECT',
  'audit_log SELECT',
  'companies INSERT',
  'companies SELECT',
  'companies UPDATE',
  'contacts INSERT',
  'contacts SELECT',
  'contacts UPDATE',
  'notes INSERT',
  'notes SELECT',
  'notes UPDATE',
  'pipeline_stages SELECT',
  'tasks INSERT',
  'tasks SELECT',
  'tasks UPDATE',
];

/** Each `table privilege` that `role` holds on the tables of crm, in order. */
export async function crmTablePrivilegesOf(pool: pg.Pool, role: string): Promise<string[]> {
  const held = await pool.query<{ grant: string }>(
    `SELECT c.relname || ' ' || p.privilege AS grant
     FROM pg_class c CROSS JOIN unnest($2::text[]) AS p(privilege)
     WHERE c.relnamespace = 'crm'::regnamespace AND c.relkind = 'r'
       AND CASE WHEN p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                THEN has_any_column_privilege($1, c.oid, p.privilege)
                ELSE has_table_privilege($1, c.oid, p.privilege) END
     ORDER BY 1`,
    [role, TABLE_PRIVILEGES],
  );
  return held.rows.map((row) => row.grant);
}
