CREATE TABLE "crm"."accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_slug_key" UNIQUE("slug"),
	CONSTRAINT "accounts_slug_format" CHECK (slug ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "accounts_name_length" CHECK (char_length(name) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "crm"."api_keys" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"label" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"permissions" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_account_id_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_key_hash_length" CHECK (octet_length(key_hash) = 32),
	CONSTRAINT "api_keys_permissions_valid" CHECK (cardinality(permissions) > 0 AND array_ndims(permissions) = 1 AND permissions <@ ARRAY['read', 'write', 'delete', 'export']::text[]),
	CONSTRAINT "api_keys_label_length" CHECK (char_length(label) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "crm"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" bigint NOT NULL,
	"operation" text NOT NULL,
	"changed_columns" text[] NOT NULL,
	"api_key_id" bigint,
	"proposed_by" text NOT NULL,
	"approved_by" text NOT NULL,
	"approval_ref" text,
	CONSTRAINT "audit_log_table_name_valid" CHECK (table_name IN ('companies', 'contacts', 'notes', 'tasks')),
	CONSTRAINT "audit_log_operation_valid" CHECK (operation IN ('insert', 'update')),
	CONSTRAINT "audit_log_proposed_by_length" CHECK (char_length(proposed_by) BETWEEN 1 AND 200),
	CONSTRAINT "audit_log_approved_by_length" CHECK (char_length(approved_by) BETWEEN 1 AND 200),
	CONSTRAINT "audit_log_approval_ref_length" CHECK (char_length(approval_ref) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "crm"."companies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"size_range" text,
	"revenue_range" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "companies_account_id_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "companies_name_length" CHECK (char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "companies_industry_length" CHECK (char_length(industry) BETWEEN 1 AND 200),
	CONSTRAINT "companies_size_range_length" CHECK (char_length(size_range) BETWEEN 1 AND 200),
	CONSTRAINT "companies_revenue_range_length" CHECK (char_length(revenue_range) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "crm"."contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"company_id" bigint,
	"stage_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contacts_account_id_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "contacts_full_name_length" CHECK (char_length(full_name) BETWEEN 1 AND 200),
	CONSTRAINT "contacts_email_length" CHECK (char_length(email) BETWEEN 1 AND 254),
	CONSTRAINT "contacts_email_lowercase" CHECK (email = lower(email)),
	CONSTRAINT "contacts_email_shape" CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "crm"."notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"contact_id" bigint NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "notes_body_length" CHECK (char_length(body) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "crm"."pipeline_stages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."pipeline_stages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pipeline_stages_account_id_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "pipeline_stages_account_id_key_key" UNIQUE("account_id","key"),
	CONSTRAINT "pipeline_stages_account_id_position_key" UNIQUE("account_id","position"),
	CONSTRAINT "pipeline_stages_key_format" CHECK (key ~ '^[a-z0-9-]{1,40}$'),
	CONSTRAINT "pipeline_stages_label_length" CHECK (char_length(label) BETWEEN 1 AND 200),
	CONSTRAINT "pipeline_stages_position_range" CHECK (position >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm"."tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crm"."tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"contact_id" bigint NOT NULL,
	"title" text NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tasks_title_length" CHECK (char_length(title) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "crm"."api_keys" ADD CONSTRAINT "api_keys_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ADD CONSTRAINT "audit_log_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ADD CONSTRAINT "audit_log_api_key_fk" FOREIGN KEY ("account_id","api_key_id") REFERENCES "crm"."api_keys"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."companies" ADD CONSTRAINT "companies_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_company_fk" FOREIGN KEY ("account_id","company_id") REFERENCES "crm"."companies"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contacts" ADD CONSTRAINT "contacts_stage_fk" FOREIGN KEY ("account_id","stage_id") REFERENCES "crm"."pipeline_stages"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."notes" ADD CONSTRAINT "notes_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."notes" ADD CONSTRAINT "notes_contact_fk" FOREIGN KEY ("account_id","contact_id") REFERENCES "crm"."contacts"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_account_fk" FOREIGN KEY ("account_id") REFERENCES "crm"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_contact_fk" FOREIGN KEY ("account_id","contact_id") REFERENCES "crm"."contacts"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_account_id_table_name_row_id_idx" ON "crm"."audit_log" USING btree ("account_id","table_name","row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_account_email_active_key" ON "crm"."contacts" USING btree ("account_id","email") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notes_account_id_contact_id_idx" ON "crm"."notes" USING btree ("account_id","contact_id");--> statement-breakpoint
CREATE INDEX "tasks_account_id_contact_id_idx" ON "crm"."tasks" USING btree ("account_id","contact_id");