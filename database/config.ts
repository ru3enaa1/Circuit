import { fileURLToPath } from 'node:url';

// Paths and names shared by drizzle-kit (drizzle.config.ts) and the migration tests, so the
// tool that writes migrations and the test that applies them cannot drift apart.

/** The repository root, resolved from this file and not from the directory a command runs in. */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Relative to the repository root, the form drizzle-kit expects. */
export const SCHEMA_FILE = 'database/schema.ts';
export const MIGRATIONS_DIR = 'database/migrations';

/** Where drizzle records the migrations it applied. Kept apart from every service schema. */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** One PostgreSQL schema per service (ADR-0003). Must match database/schema.ts. */
export const SERVICE_SCHEMAS = ['circuit', 'crm'] as const;
