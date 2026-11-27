-- ADR-0012 A4: the claim station 7 inserts before its first request to the CRM, so a decision is
-- applied once, also after a restart. The CREATE TABLE and the foreign key are drizzle-kit's, from
-- apps/circuit/src/modules/event-store/schema.ts; the owner and the grants at the end are written
-- by hand, as 0005 did for the events.

CREATE TABLE "circuit"."apply_claims" (
	"run_id" bigint PRIMARY KEY NOT NULL,
	"claimed_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "circuit"."apply_claims" ADD CONSTRAINT "apply_claims_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "circuit"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The table changes hands from the admin of .env to circuit_owner, as every table of circuit.
ALTER TABLE circuit.apply_claims OWNER TO circuit_owner;
--> statement-breakpoint

-- circuit_service reads and adds a claim, and nothing more: a claim made is a claim kept, so a
-- run cut off in the middle of applying stays in sight and is never applied twice.
GRANT SELECT, INSERT ON circuit.apply_claims TO circuit_service;
