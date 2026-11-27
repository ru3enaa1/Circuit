-- Circuit · esquema vigente de PostgreSQL, para leerlo de un vistazo.
-- Es el pg_dump --schema-only de una base desechable recién migrada: no se edita a mano.
-- Lo regenera npm run db:dump-schema; database/test/schema-dump-db.test.ts falla si difiere.

--
-- PostgreSQL database dump
--

\restrict circuit

-- Dumped from database version 18.7 (Debian 18.7-1.pgdg13+5)
-- Dumped by pg_dump version 18.7 (Debian 18.7-1.pgdg13+5)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: circuit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA circuit;


--
-- Name: crm; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA crm;


--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: context_account_id(); Type: FUNCTION; Schema: crm; Owner: -
--

CREATE FUNCTION crm.context_account_id() RETURNS bigint
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    BEGIN ATOMIC
 SELECT (NULLIF(current_setting('crm.account_id'::text, true), ''::text))::bigint AS "nullif";
END;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.accounts (
    id bigint NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
    CONSTRAINT accounts_slug_format CHECK ((slug ~ '^[a-z0-9-]{1,40}$'::text))
);


--
-- Name: api_keys; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.api_keys (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    label text NOT NULL,
    key_hash bytea NOT NULL,
    permissions text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT api_keys_key_hash_length CHECK ((octet_length(key_hash) = 32)),
    CONSTRAINT api_keys_label_length CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200))),
    CONSTRAINT api_keys_permissions_valid CHECK (((cardinality(permissions) > 0) AND (array_ndims(permissions) = 1) AND (permissions <@ ARRAY['read'::text, 'write'::text, 'delete'::text, 'export'::text])))
);


--
-- Name: resolve_api_key(bytea); Type: FUNCTION; Schema: crm; Owner: -
--

CREATE FUNCTION crm.resolve_api_key(presented_hash bytea) RETURNS TABLE(api_key_id bigint, account_id bigint, account_slug text, permissions text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    BEGIN ATOMIC
 SELECT k.id,
     k.account_id,
     a.slug,
     k.permissions
    FROM (crm.api_keys k
      JOIN crm.accounts a ON ((a.id = k.account_id)))
   WHERE ((k.key_hash = resolve_api_key.presented_hash) AND (k.revoked_at IS NULL));
END;


--
-- Name: write_audit_log(); Type: FUNCTION; Schema: crm; Owner: -
--

CREATE FUNCTION crm.write_audit_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
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


--
-- Name: apply_claims; Type: TABLE; Schema: circuit; Owner: -
--

CREATE TABLE circuit.apply_claims (
    run_id bigint NOT NULL,
    claimed_at timestamp(3) with time zone DEFAULT now() NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: circuit; Owner: -
--

CREATE TABLE circuit.runs (
    id bigint NOT NULL,
    scenario text NOT NULL,
    input_sha256 text NOT NULL,
    started_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT runs_input_sha256_shape CHECK ((input_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT runs_scenario_shape CHECK ((scenario ~ '^[a-z0-9-]{1,40}$'::text))
);


--
-- Name: runs_id_seq; Type: SEQUENCE; Schema: circuit; Owner: -
--

ALTER TABLE circuit.runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME circuit.runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: station_events; Type: TABLE; Schema: circuit; Owner: -
--

CREATE TABLE circuit.station_events (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    seq integer NOT NULL,
    station text NOT NULL,
    outcome text NOT NULL,
    status text NOT NULL,
    started_at timestamp(3) with time zone NOT NULL,
    duration_ms integer NOT NULL,
    tokens_in integer,
    tokens_out integer,
    cost_micro_usd bigint,
    model text NOT NULL,
    detail jsonb NOT NULL,
    CONSTRAINT station_events_detail_object CHECK ((jsonb_typeof(detail) = 'object'::text)),
    CONSTRAINT station_events_measures_not_negative CHECK (((duration_ms >= 0) AND ((tokens_in IS NULL) OR (tokens_in >= 0)) AND ((tokens_out IS NULL) OR (tokens_out >= 0)) AND ((cost_micro_usd IS NULL) OR (cost_micro_usd >= 0)))),
    CONSTRAINT station_events_model_length CHECK (((char_length(model) >= 1) AND (char_length(model) <= 80))),
    CONSTRAINT station_events_outcome_known CHECK ((outcome = ANY (ARRAY['ok'::text, 'injection'::text, 'complaint'::text, 'out_of_scope'::text, 'low_confidence'::text, 'no_source'::text, 'approved'::text, 'corrected'::text, 'rejected'::text, 'done'::text, 'error'::text]))),
    CONSTRAINT station_events_seq_positive CHECK ((seq >= 1)),
    CONSTRAINT station_events_station_known CHECK ((station = ANY (ARRAY['intake'::text, 'filter'::text, 'classification'::text, 'knowledge'::text, 'crm'::text, 'person'::text, 'close'::text]))),
    CONSTRAINT station_events_status_known CHECK ((status = ANY (ARRAY['completed'::text, 'stopped'::text, 'failed'::text])))
);


--
-- Name: station_events_id_seq; Type: SEQUENCE; Schema: circuit; Owner: -
--

ALTER TABLE circuit.station_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME circuit.station_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.accounts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.api_keys ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_log; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.audit_log (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    table_name text NOT NULL,
    row_id bigint NOT NULL,
    operation text NOT NULL,
    changed_columns text[] NOT NULL,
    api_key_id bigint,
    proposed_by text NOT NULL,
    approved_by text NOT NULL,
    approval_ref text,
    CONSTRAINT audit_log_approval_ref_format CHECK ((approval_ref ~ '^[a-z0-9-]{1,40}$'::text)),
    CONSTRAINT audit_log_approved_by_format CHECK ((approved_by ~ '^[a-z0-9-]{1,40}$'::text)),
    CONSTRAINT audit_log_operation_valid CHECK ((operation = ANY (ARRAY['insert'::text, 'update'::text]))),
    CONSTRAINT audit_log_proposed_by_format CHECK ((proposed_by ~ '^[a-z0-9-]{1,40}$'::text)),
    CONSTRAINT audit_log_table_name_valid CHECK ((table_name = ANY (ARRAY['companies'::text, 'contacts'::text, 'notes'::text, 'tasks'::text])))
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: companies; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.companies (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    name text NOT NULL,
    industry text,
    size_range text,
    revenue_range text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT companies_industry_length CHECK (((char_length(industry) >= 1) AND (char_length(industry) <= 200))),
    CONSTRAINT companies_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200))),
    CONSTRAINT companies_revenue_range_length CHECK (((char_length(revenue_range) >= 1) AND (char_length(revenue_range) <= 200))),
    CONSTRAINT companies_size_range_length CHECK (((char_length(size_range) >= 1) AND (char_length(size_range) <= 200)))
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.companies ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: contacts; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.contacts (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    company_id bigint,
    stage_id bigint NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT contacts_email_length CHECK (((char_length(email) >= 1) AND (char_length(email) <= 254))),
    CONSTRAINT contacts_email_lowercase CHECK ((email = lower(email))),
    CONSTRAINT contacts_email_shape CHECK ((email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text)),
    CONSTRAINT contacts_full_name_length CHECK (((char_length(full_name) >= 1) AND (char_length(full_name) <= 200)))
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.contacts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notes; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.notes (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    contact_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT notes_body_length CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)))
);


--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.notes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.pipeline_stages (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT pipeline_stages_key_format CHECK ((key ~ '^[a-z0-9-]{1,40}$'::text)),
    CONSTRAINT pipeline_stages_label_length CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200))),
    CONSTRAINT pipeline_stages_position_range CHECK (("position" >= 0))
);


--
-- Name: pipeline_stages_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.pipeline_stages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.pipeline_stages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tasks; Type: TABLE; Schema: crm; Owner: -
--

CREATE TABLE crm.tasks (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    contact_id bigint NOT NULL,
    title text NOT NULL,
    due_on date,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT tasks_title_length CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: crm; Owner: -
--

ALTER TABLE crm.tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME crm.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: apply_claims apply_claims_pkey; Type: CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.apply_claims
    ADD CONSTRAINT apply_claims_pkey PRIMARY KEY (run_id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: station_events station_events_pkey; Type: CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.station_events
    ADD CONSTRAINT station_events_pkey PRIMARY KEY (id);


--
-- Name: station_events station_events_run_seq; Type: CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.station_events
    ADD CONSTRAINT station_events_run_seq UNIQUE (run_id, seq);


--
-- Name: station_events station_events_run_station; Type: CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.station_events
    ADD CONSTRAINT station_events_run_station UNIQUE (run_id, station);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_slug_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.accounts
    ADD CONSTRAINT accounts_slug_key UNIQUE (slug);


--
-- Name: api_keys api_keys_account_id_id_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.api_keys
    ADD CONSTRAINT api_keys_account_id_id_key UNIQUE (account_id, id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: companies companies_account_id_id_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.companies
    ADD CONSTRAINT companies_account_id_id_key UNIQUE (account_id, id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_account_id_id_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.contacts
    ADD CONSTRAINT contacts_account_id_id_key UNIQUE (account_id, id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_account_id_id_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.pipeline_stages
    ADD CONSTRAINT pipeline_stages_account_id_id_key UNIQUE (account_id, id);


--
-- Name: pipeline_stages pipeline_stages_account_id_key_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.pipeline_stages
    ADD CONSTRAINT pipeline_stages_account_id_key_key UNIQUE (account_id, key);


--
-- Name: pipeline_stages pipeline_stages_account_id_position_key; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.pipeline_stages
    ADD CONSTRAINT pipeline_stages_account_id_position_key UNIQUE (account_id, "position");


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: audit_log_account_id_table_name_row_id_idx; Type: INDEX; Schema: crm; Owner: -
--

CREATE INDEX audit_log_account_id_table_name_row_id_idx ON crm.audit_log USING btree (account_id, table_name, row_id);


--
-- Name: contacts_account_email_active_key; Type: INDEX; Schema: crm; Owner: -
--

CREATE UNIQUE INDEX contacts_account_email_active_key ON crm.contacts USING btree (account_id, email) WHERE (archived_at IS NULL);


--
-- Name: notes_account_id_contact_id_idx; Type: INDEX; Schema: crm; Owner: -
--

CREATE INDEX notes_account_id_contact_id_idx ON crm.notes USING btree (account_id, contact_id);


--
-- Name: tasks_account_id_contact_id_idx; Type: INDEX; Schema: crm; Owner: -
--

CREATE INDEX tasks_account_id_contact_id_idx ON crm.tasks USING btree (account_id, contact_id);


--
-- Name: companies companies_audit; Type: TRIGGER; Schema: crm; Owner: -
--

CREATE TRIGGER companies_audit AFTER INSERT OR UPDATE ON crm.companies FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();


--
-- Name: contacts contacts_audit; Type: TRIGGER; Schema: crm; Owner: -
--

CREATE TRIGGER contacts_audit AFTER INSERT OR UPDATE ON crm.contacts FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();


--
-- Name: notes notes_audit; Type: TRIGGER; Schema: crm; Owner: -
--

CREATE TRIGGER notes_audit AFTER INSERT OR UPDATE ON crm.notes FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();


--
-- Name: tasks tasks_audit; Type: TRIGGER; Schema: crm; Owner: -
--

CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE ON crm.tasks FOR EACH ROW EXECUTE FUNCTION crm.write_audit_log();


--
-- Name: apply_claims apply_claims_run_id_runs_id_fk; Type: FK CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.apply_claims
    ADD CONSTRAINT apply_claims_run_id_runs_id_fk FOREIGN KEY (run_id) REFERENCES circuit.runs(id);


--
-- Name: station_events station_events_run_id_runs_id_fk; Type: FK CONSTRAINT; Schema: circuit; Owner: -
--

ALTER TABLE ONLY circuit.station_events
    ADD CONSTRAINT station_events_run_id_runs_id_fk FOREIGN KEY (run_id) REFERENCES circuit.runs(id);


--
-- Name: api_keys api_keys_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.api_keys
    ADD CONSTRAINT api_keys_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: audit_log audit_log_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.audit_log
    ADD CONSTRAINT audit_log_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: audit_log audit_log_api_key_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.audit_log
    ADD CONSTRAINT audit_log_api_key_fk FOREIGN KEY (account_id, api_key_id) REFERENCES crm.api_keys(account_id, id);


--
-- Name: companies companies_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.companies
    ADD CONSTRAINT companies_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: contacts contacts_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.contacts
    ADD CONSTRAINT contacts_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: contacts contacts_company_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.contacts
    ADD CONSTRAINT contacts_company_fk FOREIGN KEY (account_id, company_id) REFERENCES crm.companies(account_id, id);


--
-- Name: contacts contacts_stage_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.contacts
    ADD CONSTRAINT contacts_stage_fk FOREIGN KEY (account_id, stage_id) REFERENCES crm.pipeline_stages(account_id, id);


--
-- Name: notes notes_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.notes
    ADD CONSTRAINT notes_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: notes notes_contact_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.notes
    ADD CONSTRAINT notes_contact_fk FOREIGN KEY (account_id, contact_id) REFERENCES crm.contacts(account_id, id);


--
-- Name: pipeline_stages pipeline_stages_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.pipeline_stages
    ADD CONSTRAINT pipeline_stages_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: tasks tasks_account_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.tasks
    ADD CONSTRAINT tasks_account_fk FOREIGN KEY (account_id) REFERENCES crm.accounts(id);


--
-- Name: tasks tasks_contact_fk; Type: FK CONSTRAINT; Schema: crm; Owner: -
--

ALTER TABLE ONLY crm.tasks
    ADD CONSTRAINT tasks_contact_fk FOREIGN KEY (account_id, contact_id) REFERENCES crm.contacts(account_id, id);


--
-- Name: accounts; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY accounts_select_own ON crm.accounts FOR SELECT TO crm_service USING ((id = crm.context_account_id()));


--
-- Name: api_keys; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY audit_log_select_own ON crm.audit_log FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: companies; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_insert_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY companies_insert_own ON crm.companies FOR INSERT TO crm_service WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: companies companies_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY companies_select_own ON crm.companies FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: companies companies_update_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY companies_update_own ON crm.companies FOR UPDATE TO crm_service USING ((account_id = crm.context_account_id())) WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: contacts; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_insert_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY contacts_insert_own ON crm.contacts FOR INSERT TO crm_service WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: contacts contacts_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY contacts_select_own ON crm.contacts FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: contacts contacts_update_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY contacts_update_own ON crm.contacts FOR UPDATE TO crm_service USING ((account_id = crm.context_account_id())) WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: notes; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notes notes_insert_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY notes_insert_own ON crm.notes FOR INSERT TO crm_service WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: notes notes_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY notes_select_own ON crm.notes FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: notes notes_update_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY notes_update_own ON crm.notes FOR UPDATE TO crm_service USING ((account_id = crm.context_account_id())) WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages pipeline_stages_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY pipeline_stages_select_own ON crm.pipeline_stages FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: tasks; Type: ROW SECURITY; Schema: crm; Owner: -
--

ALTER TABLE crm.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks_insert_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY tasks_insert_own ON crm.tasks FOR INSERT TO crm_service WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: tasks tasks_select_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY tasks_select_own ON crm.tasks FOR SELECT TO crm_service USING ((account_id = crm.context_account_id()));


--
-- Name: tasks tasks_update_own; Type: POLICY; Schema: crm; Owner: -
--

CREATE POLICY tasks_update_own ON crm.tasks FOR UPDATE TO crm_service USING ((account_id = crm.context_account_id())) WITH CHECK ((account_id = crm.context_account_id()));


--
-- Name: SCHEMA circuit; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA circuit TO circuit_service;


--
-- Name: SCHEMA crm; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA crm TO crm_service;


--
-- Name: FUNCTION context_account_id(); Type: ACL; Schema: crm; Owner: -
--

REVOKE ALL ON FUNCTION crm.context_account_id() FROM PUBLIC;
GRANT ALL ON FUNCTION crm.context_account_id() TO crm_service;


--
-- Name: TABLE accounts; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT ON TABLE crm.accounts TO crm_service;


--
-- Name: FUNCTION resolve_api_key(presented_hash bytea); Type: ACL; Schema: crm; Owner: -
--

REVOKE ALL ON FUNCTION crm.resolve_api_key(presented_hash bytea) FROM PUBLIC;
GRANT ALL ON FUNCTION crm.resolve_api_key(presented_hash bytea) TO crm_service;


--
-- Name: FUNCTION write_audit_log(); Type: ACL; Schema: crm; Owner: -
--

REVOKE ALL ON FUNCTION crm.write_audit_log() FROM PUBLIC;


--
-- Name: TABLE apply_claims; Type: ACL; Schema: circuit; Owner: -
--

GRANT SELECT,INSERT ON TABLE circuit.apply_claims TO circuit_service;


--
-- Name: TABLE runs; Type: ACL; Schema: circuit; Owner: -
--

GRANT SELECT,INSERT ON TABLE circuit.runs TO circuit_service;


--
-- Name: TABLE station_events; Type: ACL; Schema: circuit; Owner: -
--

GRANT SELECT,INSERT ON TABLE circuit.station_events TO circuit_service;


--
-- Name: TABLE audit_log; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT ON TABLE crm.audit_log TO crm_service;


--
-- Name: TABLE companies; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE crm.companies TO crm_service;


--
-- Name: TABLE contacts; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE crm.contacts TO crm_service;


--
-- Name: TABLE notes; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE crm.notes TO crm_service;


--
-- Name: TABLE pipeline_stages; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT ON TABLE crm.pipeline_stages TO crm_service;


--
-- Name: TABLE tasks; Type: ACL; Schema: crm; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE crm.tasks TO crm_service;


--
-- PostgreSQL database dump complete
--

\unrestrict circuit

