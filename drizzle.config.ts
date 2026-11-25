import { defineConfig } from 'drizzle-kit';

import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, SCHEMA_FILES } from './database/config.ts';
import { readAdminConnection } from './database/connection.ts';
import { readLocalEnv } from './database/env.ts';

// `npm run db:generate` writes a migration from the schema files; `npm run db:migrate`
// applies the pending ones to the local database. Both run from the repository root.
// There is no `db:push` on purpose: push would drop the grants, policies and trigger that
// 0002_crm_security.sql adds by hand, because drizzle-kit does not know them (ADR-0005).
export default defineConfig({
  dialect: 'postgresql',
  schema: [...SCHEMA_FILES],
  out: MIGRATIONS_DIR,
  // Local loopback connection; there is no TLS to negotiate.
  dbCredentials: { ...readAdminConnection(readLocalEnv()), ssl: false },
  migrations: { schema: MIGRATIONS_SCHEMA, table: MIGRATIONS_TABLE },
  strict: true,
});
