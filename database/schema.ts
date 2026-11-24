import { pgSchema } from 'drizzle-orm/pg-core';

// One PostgreSQL schema per service (ADR-0003): in F1 each service gets a user that sees only
// its own schema (M4). Tables arrive with their phase: crm in F1.1, circuit's events in F2.1.
// Keep in step with SERVICE_SCHEMAS in config.ts; the migration test checks both exist.

export const circuit = pgSchema('circuit');
export const crm = pgSchema('crm');
