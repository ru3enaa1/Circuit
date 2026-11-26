import { readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from '../../../database/test/disposable-db.ts';
import { newKeyFile, seed, seedEnv, SEED_TEST_TIMEOUT_MS, tableCounts } from '../../../database/test/seed-tools.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../../../database/users.ts';
import { readLocalEnv } from '../../../database/env.ts';
import { CRM_DB_USER } from '../src/config.ts';
import { buildServer } from '../src/server/server.ts';
import { APPROVAL, bearer, bodyOf, rowCounts, sendJson } from './crm-under-test.ts';

// ADR-0009 D22: the criterion of F1 on the seeded data. A disposable database seeded with the real
// package, crm_app made as db:users makes it, and the real server on crm_app's pool. The key is
// the one the seed left in its file: it reads (200) and writes (201) in escuela-andamio, and is
// refused archiving, exporting and cuenta-vecina, which exists and has contacts; no refusal
// changes a row. Then D13 after a real write: seeding again leaves the agent's note where it is.

const password = readCrmPassword(readLocalEnv());
const keyFile = newKeyFile();
let db: DisposableDatabase | undefined;
let app: FastifyInstance | undefined;
let key = '';

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  const run = await seed(seedEnv(db.name, keyFile));
  if (run.code !== 0) throw new Error(`La semilla falló: ${run.err}`);
  key = readFileSync(keyFile, 'utf8').trimEnd();
  await createOrUpdateCrmApp(db.connection, password);
  app = buildServer({ pool: db.poolAs(CRM_DB_USER, password), log: () => undefined });
  await app.ready();
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await app?.close();
  rmSync(dirname(keyFile), { recursive: true, force: true });
  await db?.drop();
}, DATABASE_HOOK_TIMEOUT_MS);

/** The first contact of an account, read as the admin. */
async function firstContactOf(slug: string): Promise<string> {
  const result = await db!.pool.query<{ id: string }>(
    'SELECT c.id::text AS id FROM crm.contacts AS c JOIN crm.accounts AS a ON a.id = c.account_id WHERE a.slug = $1 ORDER BY c.id LIMIT 1',
    [slug],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`La cuenta ${slug} no tiene contactos.`);
  return id;
}

async function counted(request: () => Promise<LightMyRequestResponse>) {
  const before = await rowCounts(db!.pool);
  const response = await request();
  return { response, before, after: await rowCounts(db!.pool) };
}

function expectRefused(response: LightMyRequestResponse, code: string, message: string): void {
  expect(response.statusCode, response.body).toBe(403);
  expect(bodyOf(response)).toEqual({ error: { code, message } });
}

describe("D22 · the seeded agent's key, against the real server", () => {
  it('reads a contact of escuela-andamio (200)', async () => {
    const id = await firstContactOf('escuela-andamio');
    const response = await app!.inject({ method: 'GET', url: `/accounts/escuela-andamio/contacts/${id}`, headers: bearer(key) });
    expect(response.statusCode, response.body).toBe(200);
  }, SEED_TEST_TIMEOUT_MS);

  it('archiving is 403 «borrado», and no row changes', async () => {
    const id = await firstContactOf('escuela-andamio');
    const { response, before, after } = await counted(() =>
      sendJson(app!, 'POST', `/accounts/escuela-andamio/contacts/${id}/archive`, bearer(key), { approval: APPROVAL }),
    );
    expectRefused(response, 'sin_permiso', 'La llave no tiene permiso de borrado.');
    expect(after).toEqual(before);
  }, SEED_TEST_TIMEOUT_MS);

  it('exporting is 403 «exportación», and no row changes', async () => {
    const { response, before, after } = await counted(() => app!.inject({ method: 'GET', url: '/accounts/escuela-andamio/export', headers: bearer(key) }));
    expectRefused(response, 'sin_permiso', 'La llave no tiene permiso de exportación.');
    expect(after).toEqual(before);
  }, SEED_TEST_TIMEOUT_MS);

  it('cuenta-vecina, which exists and has contacts, is 403 cuenta_ajena to read and to write, and no row changes', async () => {
    const id = await firstContactOf('cuenta-vecina');
    const read = await counted(() => app!.inject({ method: 'GET', url: `/accounts/cuenta-vecina/contacts/${id}`, headers: bearer(key) }));
    const write = await counted(() =>
      sendJson(app!, 'POST', `/accounts/cuenta-vecina/contacts/${id}/notes`, bearer(key), { body: 'Nota ajena', approval: APPROVAL }),
    );
    for (const { response, before, after } of [read, write]) {
      expectRefused(response, 'cuenta_ajena', 'La llave no es de esta cuenta.');
      expect(after).toEqual(before);
    }
  }, SEED_TEST_TIMEOUT_MS);

  it('writes a note in escuela-andamio (201), and D13: seeding again keeps it and changes no count', async () => {
    const id = await firstContactOf('escuela-andamio');
    const { response } = await counted(() =>
      sendJson(app!, 'POST', `/accounts/escuela-andamio/contacts/${id}/notes`, bearer(key), { body: 'Nota del agente, aprobada', approval: APPROVAL }),
    );
    expect(response.statusCode, response.body).toBe(201);
    const noteId = (bodyOf(response) as { note?: { id?: unknown } }).note?.id;
    expect(noteId).toBeDefined();
    const before = await tableCounts(db!.pool);
    const again = await seed(seedEnv(db!.name, keyFile));
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain('escuela-andamio: ya estaba');
    expect(await tableCounts(db!.pool)).toEqual(before);
    const note = await db!.pool.query('SELECT 1 FROM crm.notes WHERE id = $1 AND body = $2', [noteId, 'Nota del agente, aprobada']);
    expect(note.rowCount).toBe(1);
  }, SEED_TEST_TIMEOUT_MS);
});
