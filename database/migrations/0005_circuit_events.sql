-- ADR-0010 D10: the events of the circuit, in tables that only grow. The two CREATE TABLE
-- statements and the foreign key are drizzle-kit's, from
-- apps/circuit/src/modules/event-store/schema.ts; the owner and the grants at the end are
-- written by hand, as 0002 and 0004 did for crm.

CREATE TABLE "circuit"."runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "circuit"."runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scenario" text NOT NULL,
	"input_sha256" text NOT NULL,
	"started_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "runs_scenario_shape" CHECK ("circuit"."runs"."scenario" ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "runs_input_sha256_shape" CHECK ("circuit"."runs"."input_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "circuit"."station_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "circuit"."station_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"station" text NOT NULL,
	"outcome" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp(3) with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micro_usd" bigint,
	"model" text NOT NULL,
	"detail" jsonb NOT NULL,
	CONSTRAINT "station_events_run_seq" UNIQUE("run_id","seq"),
	CONSTRAINT "station_events_run_station" UNIQUE("run_id","station"),
	CONSTRAINT "station_events_seq_positive" CHECK ("circuit"."station_events"."seq" >= 1),
	CONSTRAINT "station_events_station_known" CHECK ("circuit"."station_events"."station" IN ('intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close')),
	CONSTRAINT "station_events_outcome_known" CHECK ("circuit"."station_events"."outcome" IN ('ok', 'injection', 'complaint', 'out_of_scope', 'low_confidence', 'no_source', 'approved', 'corrected', 'rejected', 'done', 'error')),
	CONSTRAINT "station_events_status_known" CHECK ("circuit"."station_events"."status" IN ('completed', 'stopped', 'failed')),
	CONSTRAINT "station_events_measures_not_negative" CHECK ("circuit"."station_events"."duration_ms" >= 0 AND ("circuit"."station_events"."tokens_in" IS NULL OR "circuit"."station_events"."tokens_in" >= 0) AND ("circuit"."station_events"."tokens_out" IS NULL OR "circuit"."station_events"."tokens_out" >= 0) AND ("circuit"."station_events"."cost_micro_usd" IS NULL OR "circuit"."station_events"."cost_micro_usd" >= 0)),
	CONSTRAINT "station_events_model_length" CHECK (char_length("circuit"."station_events"."model") BETWEEN 1 AND 80),
	CONSTRAINT "station_events_detail_object" CHECK (jsonb_typeof("circuit"."station_events"."detail") = 'object')
);
--> statement-breakpoint
ALTER TABLE "circuit"."station_events" ADD CONSTRAINT "station_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "circuit"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The owner role, as 0004 made crm_owner. Roles belong to the whole server, so it may already
-- be there: made before (duplicate_object) or by another database migrating at the same moment,
-- which waits and then gets unique_violation (ADR-0005 D14).
DO $$
BEGIN
  CREATE ROLE circuit_owner NOLOGIN;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
-- Checked and not altered: two migrations altering one role at once fail with "tuple
-- concurrently updated". No attribute, no membership in another role, and no member: a member
-- would act as the owner of circuit and could rewrite an event.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'circuit_owner'
      AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
           OR r.rolreplication OR r.rolbypassrls
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS m
                      WHERE m.member = r.oid OR m.roleid = r.oid))
  ) THEN
    RAISE EXCEPTION 'circuit: circuit_owner ya existe con atributos o membresías de más';
  END IF;
END
$$;
--> statement-breakpoint
-- The schema and its tables change hands from the admin of .env to circuit_owner (ADR-0006 D3
-- for crm). A table takes the sequence of its identity column with it.
ALTER SCHEMA circuit OWNER TO circuit_owner;
--> statement-breakpoint
ALTER TABLE circuit.runs OWNER TO circuit_owner;
--> statement-breakpoint
ALTER TABLE circuit.station_events OWNER TO circuit_owner;
--> statement-breakpoint

-- circuit_service reads and adds, and nothing more: it can neither change a row nor remove one
-- (migration-files.test.ts reads comments too, so the commands go unnamed), and an event stored
-- is an event kept. Nothing on the sequences either: an identity column draws its
-- ids without USAGE on its sequence, as crm_service's do (ADR-0005 D5). And nothing in crm.
GRANT USAGE ON SCHEMA circuit TO circuit_service;
--> statement-breakpoint
GRANT SELECT, INSERT ON circuit.runs, circuit.station_events TO circuit_service;
