import { pgSchema } from 'drizzle-orm/pg-core';

// One PostgreSQL schema per service (ADR-0003). Each service owns its tables: crm's live in
// apps/crm/src/db/schema.ts (ADR-0005), and circuit's events arrive in F2.1. Until then the
// circuit schema is declared here so drizzle-kit keeps it.
// Keep in step with SERVICE_SCHEMAS in config.ts; the migration test checks both exist.

export const circuit = pgSchema('circuit');
