-- ADR-0005: what drizzle-kit cannot express, in one file to read at once. The database
-- enforces the rules, so a forgotten WHERE in the API fails closed: zero rows, or the
-- write is rejected. Written by hand; drizzle-kit only records that it ran.

-- 1. Service roles (D14). Roles belong to the whole server, not to one database, so a
--    second database, or a test migrating next to this one, may find them already made.
--    When two migrations create the same role at once, the second waits and then gets
--    unique_violation instead of duplicate_object: both are expected.
--    NOLOGIN: the users that connect inherit from these roles and arrive in F1.2.
DO $$
BEGIN
  CREATE ROLE crm_service NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE ROLE circuit_service NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
-- A role found already there may have been made by hand. It is checked and not altered:
-- two migrations altering the same role at once fail with "tuple concurrently updated".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname IN ('crm_service', 'circuit_service')
      AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
           OR r.rolreplication OR r.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m WHERE m.member = r.oid))
  ) THEN
    RAISE EXCEPTION 'crm: un rol de servicio ya existe con atributos o membresías de más';
  END IF;
END
$$;
--> statement-breakpoint

-- 2. The context of the current transaction. F1.2 sets crm.account_id, crm.api_key_id,
--    crm.proposed_by, crm.approved_by and crm.approval_ref with set_config(..., true), so
--    they last one transaction. A value never set reads as NULL; one set by an earlier
--    transaction of the same session reads as ''. nullif turns both into NULL, and NULL
--    matches no row. BEGIN ATOMIC parses the body now, so no search_path can redirect it.
CREATE FUNCTION crm.context_account_id() RETURNS bigint
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT nullif(current_setting('crm.account_id', true), '')::bigint;
END;
--> statement-breakpoint

-- 3. Row-level security on every table (D4). The policies name crm_service only. The owner,
--    which runs the migrations and the seed, is not bound by them.
ALTER TABLE crm.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.pipeline_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- api_keys has no policy at all: even a grant added by mistake would show crm_service no row.
-- One policy per command and none for removing rows: a grant added by mistake still
-- removes nothing.
CREATE POLICY accounts_select_own ON crm.accounts FOR SELECT TO crm_service
  USING (id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY pipeline_stages_select_own ON crm.pipeline_stages FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY audit_log_select_own ON crm.audit_log FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY companies_select_own ON crm.companies FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY companies_insert_own ON crm.companies FOR INSERT TO crm_service
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY companies_update_own ON crm.companies FOR UPDATE TO crm_service
  USING (account_id = crm.context_account_id())
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY contacts_select_own ON crm.contacts FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY contacts_insert_own ON crm.contacts FOR INSERT TO crm_service
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY contacts_update_own ON crm.contacts FOR UPDATE TO crm_service
  USING (account_id = crm.context_account_id())
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY notes_select_own ON crm.notes FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY notes_insert_own ON crm.notes FOR INSERT TO crm_service
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY notes_update_own ON crm.notes FOR UPDATE TO crm_service
  USING (account_id = crm.context_account_id())
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY tasks_select_own ON crm.tasks FOR SELECT TO crm_service
  USING (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY tasks_insert_own ON crm.tasks FOR INSERT TO crm_service
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint
CREATE POLICY tasks_update_own ON crm.tasks FOR UPDATE TO crm_service
  USING (account_id = crm.context_account_id())
  WITH CHECK (account_id = crm.context_account_id());
--> statement-breakpoint

-- 4. Table grants (D5, D13). Read the account, its stages and its audit trail; read, add
--    and change the four business tables. Nothing on api_keys (only resolve_api_key reads
--    it) and no write on audit_log (only the trigger writes it). circuit_service gets
--    nothing in crm; its own grants arrive with its tables in F2.1.
GRANT USAGE ON SCHEMA crm TO crm_service;
--> statement-breakpoint
GRANT SELECT ON crm.accounts, crm.pipeline_stages, crm.audit_log TO crm_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON crm.companies, crm.contacts, crm.notes, crm.tasks TO crm_service;
--> statement-breakpoint

-- 5. Key lookup (D10). Returns the one live key whose SHA-256 matches, with its account,
--    and nothing for a revoked or unknown one. It runs as its owner because crm_service
--    holds no privilege on api_keys.
CREATE FUNCTION crm.resolve_api_key(presented_hash bytea)
  RETURNS TABLE (api_key_id bigint, account_id bigint, account_slug text, permissions text[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
BEGIN ATOMIC
  SELECT k.id, k.account_id, a.slug, k.permissions
  FROM crm.api_keys AS k
  JOIN crm.accounts AS a ON a.id = k.account_id
  WHERE k.key_hash = presented_hash AND k.revoked_at IS NULL;
END;
--> statement-breakpoint

-- 6. The audit trail (D7, D8, D9). One row per inserted or updated row, in the same
--    transaction, with the names of the columns written and never their values. Without
--    an author the write fails and leaves nothing behind. It runs as its owner because
--    crm_service may not write audit_log itself. pg_temp goes last in search_path so a
--    temporary object can never stand in for a catalog one.
CREATE FUNCTION crm.write_audit_log() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  proposer text := nullif(current_setting('crm.proposed_by', true), '');
  approver text := nullif(current_setting('crm.approved_by', true), '');
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  written text[];
BEGIN
  IF proposer IS NULL OR approver IS NULL THEN
    RAISE EXCEPTION 'crm: escritura sin autor' USING ERRCODE = 'P0001';
  END IF;
  -- An insert lists the columns it filled; an update, the ones whose value changed.
  SELECT coalesce(array_agg(field.key ORDER BY field.key), '{}')
    INTO written
    FROM jsonb_each(new_row) AS field
   WHERE CASE
           WHEN old_row IS NULL THEN field.value <> 'null'::jsonb
           ELSE field.value IS DISTINCT FROM old_row -> field.key
         END;
  INSERT INTO crm.audit_log
    (account_id, table_name, row_id, operation, changed_columns,
     api_key_id, proposed_by, approved_by, approval_ref)
  VALUES
    (NEW.account_id, TG_TABLE_NAME, NEW.id, lower(TG_OP), written,
     nullif(current_setting('crm.api_key_id', true), '')::bigint,
     proposer, approver, nullif(current_setting('crm.approval_ref', true), ''));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER companies_audit AFTER INSERT OR UPDATE ON crm.companies
  FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();
--> statement-breakpoint
CREATE TRIGGER contacts_audit AFTER INSERT OR UPDATE ON crm.contacts
  FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();
--> statement-breakpoint
CREATE TRIGGER notes_audit AFTER INSERT OR UPDATE ON crm.notes
  FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();
--> statement-breakpoint
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE ON crm.tasks
  FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();
--> statement-breakpoint

-- 7. Who may call what (D12). Every new function is executable by PUBLIC by default; that
--    is taken back, and crm_service gets the two it calls. A trigger fires without the
--    EXECUTE privilege, so write_audit_log is granted to nobody.
REVOKE ALL ON FUNCTION crm.context_account_id(), crm.resolve_api_key(bytea), crm.write_audit_log()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION crm.context_account_id(), crm.resolve_api_key(bytea) TO crm_service;
