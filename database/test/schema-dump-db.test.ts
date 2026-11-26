import { execFileSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import { DOCKER_TEST_TIMEOUT_MS } from './docker-tools.ts';

// R8 and ADR-0005 D16: database/schema.sql is not written by hand. It is the schema-only dump
// of a freshly migrated disposable database, grants and policies included, and this test
// fails when the file and the migrations drift apart.

const REGENERATE = 'npm run db:dump-schema';
// pg_dump 18 writes a random \restrict key into every dump unless it is given one.
const RESTRICT_KEY = 'circuit';
// Stands in for the admin from .env, which a clone may name differently.
const ADMIN_PLACEHOLDER = '<admin>';
const SCHEMA_FILE = '../schema.sql';

const HEADER = [
  '-- Circuit · esquema vigente de PostgreSQL, para leerlo de un vistazo.',
  '-- Es el pg_dump --schema-only de una base desechable recién migrada: no se edita a mano.',
  `-- Lo regenera ${REGENERATE}; database/test/schema-dump-db.test.ts falla si difiere.`,
  '',
  '',
].join('\n');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * pg_dump runs inside the database container, the same 18.7 as the server; it is not
 * installed on the host. Inside the container the local socket needs no password.
 */
function dumpSchema(database: string, adminUser: string): string {
  const dump = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'pg_dump',
      '--schema-only',
      '--no-owner',
      `--restrict-key=${RESTRICT_KEY}`,
      '--username',
      adminUser,
      '--dbname',
      database,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return dump.replace(new RegExp(`\\b${escapeRegExp(adminUser)}\\b`, 'g'), ADMIN_PLACEHOLDER);
}

describe('database/schema.sql', () => {
  let db: DisposableDatabase | undefined;

  beforeAll(async () => {
    db = await createDisposableDatabase();
    await runMigrations(db.pool);
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  it('is the dump of a freshly migrated database', async () => {
    const dump = dumpSchema(db!.name, db!.connection.user);
    // The file must show the rules, not only the tables (D16).
    for (const part of ['CREATE TABLE crm.contacts', 'CREATE POLICY', 'GRANT SELECT', 'CREATE TRIGGER', 'SECURITY DEFINER']) {
      expect(dump, `the dump has no ${part}`).toContain(part);
    }
    await expect(
      HEADER + dump,
      `database/schema.sql no coincide con las migraciones. Regenéralo con ${REGENERATE}.`,
    ).toMatchFileSnapshot(SCHEMA_FILE);
  }, DOCKER_TEST_TIMEOUT_MS);
});
