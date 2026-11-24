import { fileURLToPath } from 'node:url';

// Paths and names shared by drizzle-kit (drizzle.config.ts) and the migration tests, so the
// tool that writes migrations and the test that applies them cannot drift apart.

/** The repository root, resolved from this file and not from the directory a command runs in. */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Relative to the repository root, the form drizzle-kit expects. Each service owns its
 * tables (ADR-0005); the migrations stay in one folder, with one history.
 */
export const SCHEMA_FILES = ['database/schema.ts', 'apps/crm/src/db/schema.ts'] as const;
export const MIGRATIONS_DIR = 'database/migrations';

/** Where drizzle records the migrations it applied. Kept apart from every service schema. */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** One PostgreSQL schema per service (ADR-0003). Must match the schema files above. */
export const SERVICE_SCHEMAS = ['circuit', 'crm'] as const;

/**
 * One NOLOGIN role per service, created by 0002_crm_security.sql (ADR-0005 D14). The users
 * that log in inherit from them and arrive in F1.2, with their passwords in .env.
 */
export const SERVICE_ROLES = { crm: 'crm_service', circuit: 'circuit_service' } as const;
