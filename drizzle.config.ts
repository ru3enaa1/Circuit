import { defineConfig } from 'drizzle-kit';

import { MIGRATIONS_DIR, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, SCHEMA_FILE } from './database/config.js';
import { readAdminConnection } from './database/connection.js';
import { readLocalEnv } from './database/env.js';

// `npm run db:generate` writes a migration from database/schema.ts; `npm run db:migrate`
// applies the pending ones to the local database. Both run from the repository root.
export default defineConfig({
  dialect: 'postgresql',
  schema: SCHEMA_FILE,
  out: MIGRATIONS_DIR,
  // Local loopback connection; there is no TLS to negotiate.
  dbCredentials: { ...readAdminConnection(readLocalEnv()), ssl: false },
  migrations: { schema: MIGRATIONS_SCHEMA, table: MIGRATIONS_TABLE },
  strict: true,
});
