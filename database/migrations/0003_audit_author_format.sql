ALTER TABLE "crm"."audit_log" DROP CONSTRAINT "audit_log_proposed_by_length";--> statement-breakpoint
ALTER TABLE "crm"."audit_log" DROP CONSTRAINT "audit_log_approved_by_length";--> statement-breakpoint
ALTER TABLE "crm"."audit_log" DROP CONSTRAINT "audit_log_approval_ref_length";--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ADD CONSTRAINT "audit_log_proposed_by_format" CHECK (proposed_by ~ '^[a-z0-9-]{1,40}$');--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ADD CONSTRAINT "audit_log_approved_by_format" CHECK (approved_by ~ '^[a-z0-9-]{1,40}$');--> statement-breakpoint
ALTER TABLE "crm"."audit_log" ADD CONSTRAINT "audit_log_approval_ref_format" CHECK (approval_ref ~ '^[a-z0-9-]{1,40}$');