import type { MigrationHashes } from './migration-rules.ts';

/**
 * The SHA-256 of every migration as committed (ADR-0005 D15, audit H6), the same hash drizzle
 * records in drizzle.__drizzle_migrations. This list only grows: a new migration adds its
 * line in the same commit; editing a migration that is already in the list turns
 * migration-files.test.ts red. The fix is a new migration, never a new hash for an old one.
 * Checked on 2026-11-24: 0000 to 0002 match the hashes recorded in the development database.
 */
export const MIGRATION_SHA256: MigrationHashes = {
  '0000_init': 'fc1d31702c3866dc7e5b8cb1550f080ecd65be4bfc559c988c462bfc7b549c32',
  '0001_crm_tables': '6837df8e25be4399419eec15aa1b08d55ff7e2a69fa26ce273fae432231ce404',
  '0002_crm_security': 'ad846e41ce3386f35c22ccb423b77c97ed62e16ed3bcea3afac5db5b503b8fb7',
  '0003_audit_author_format': '8028a65c7e1e5bba7d730596b18746b343dff627cc3c79e2d5d7b9b84229a746',
};
