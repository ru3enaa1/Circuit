-- ADR-0006 D3 (audit H3 of ADR-0005): the crm schema and everything in it change hands, from
-- the admin of .env, a superuser, to crm_owner, a role that cannot connect and has no members.
-- The two SECURITY DEFINER functions then run with the rights of the owner of crm and nothing
-- more: a mistake in them can no longer reach the rest of the server.
-- Written by hand; drizzle-kit only records that it ran.

-- 1. The owner role. Roles belong to the whole server, so it may already be there: made
--    before (duplicate_object) or by another database migrating at the same moment, which
--    makes the second one wait and then get unique_violation (ADR-0005 D14).
DO $$
BEGIN
  CREATE ROLE crm_owner NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
-- Checked and not altered, as in 0002: two migrations altering one role at once fail with
-- "tuple concurrently updated". No attribute, no membership in another role, and no member:
-- a member would act as the owner of crm, past every policy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'crm_owner'
      AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
           OR r.rolreplication OR r.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m
                      WHERE m.member = r.oid OR m.roleid = r.oid))
  ) THEN
    RAISE EXCEPTION 'crm: crm_owner ya existe con atributos o membresías de más';
  END IF;
END
$$;
--> statement-breakpoint

-- 2. The schema, its tables and its functions. A table takes its indexes and the sequences of
--    its identity columns with it. The grants of 0002 stay where they are: PostgreSQL rewrites
--    them with the new owner as grantor. Every table added to crm later needs its own
--    OWNER TO crm_owner; crm-structure-db.test.ts fails without it.
ALTER SCHEMA crm OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.accounts OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.api_keys OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.pipeline_stages OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.companies OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.contacts OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.notes OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.tasks OWNER TO crm_owner;
--> statement-breakpoint
ALTER TABLE crm.audit_log OWNER TO crm_owner;
--> statement-breakpoint
ALTER FUNCTION crm.context_account_id() OWNER TO crm_owner;
--> statement-breakpoint
ALTER FUNCTION crm.resolve_api_key(bytea) OWNER TO crm_owner;
--> statement-breakpoint
ALTER FUNCTION crm.write_audit_log() OWNER TO crm_owner;
