import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES } from '../src/server/limits.ts';
import { APPROVAL, bearer, bodyOf, errorCodeOf, rowCounts, sendJson, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0007 D2 and D3, through the real server on a disposable database as crm_app. Every 403
// has a 2xx next to it as control, made with a key that holds the permission, so a refusal for
// another reason (a missing row, a broken route) does not pass for this one.

const crm = useCrmUnderTest();

interface Write {
  readonly route: string;
  readonly method: 'POST' | 'PATCH';
  /** The path after /accounts/<slug>/. */
  readonly path: string;
  readonly body: object;
}

let sequence = 0;
function newContactBody(): object {
  sequence += 1;
  return { fullName: 'Persona de prueba', email: `permiso-${sequence}@cuenta-a.test`, stageId: Number(crm().fixture.a.stageId), approval: APPROVAL };
}

/** The four routes that take `write`, each with a valid body, on the fixture's contact of a. */
function writeRoutes(): readonly Write[] {
  const { contactId } = crm().fixture.a;
  return [
    { route: 'create', method: 'POST', path: 'contacts', body: newContactBody() },
    { route: 'update', method: 'PATCH', path: `contacts/${contactId}`, body: { fullName: 'Otro nombre', approval: APPROVAL } },
    { route: 'note', method: 'POST', path: `contacts/${contactId}/notes`, body: { body: 'Una nota', approval: APPROVAL } },
    { route: 'task', method: 'POST', path: `contacts/${contactId}/tasks`, body: { title: 'Una tarea', approval: APPROVAL } },
  ];
}

function archiveRoute(contactId: string): Write {
  return { route: 'archive', method: 'POST', path: `contacts/${contactId}/archive`, body: { approval: APPROVAL } };
}

function send(write: Write, headers: Record<string, string>, body: unknown = write.body, slug = 'cuenta-a'): Promise<LightMyRequestResponse> {
  return sendJson(crm().app, write.method, `/accounts/${slug}/${write.path}`, headers, body);
}

function expectForbidden(response: LightMyRequestResponse, message: string): void {
  expect(response.statusCode, response.body).toBe(403);
  expect(bodyOf(response)).toEqual({ error: { code: 'sin_permiso', message } });
}

async function contactArchivedAt(contactId: string): Promise<unknown> {
  const result = await crm().db.pool.query<{ archived_at: unknown }>('SELECT archived_at FROM crm.contacts WHERE id = $1', [contactId]);
  return result.rows[0]?.archived_at;
}

describe('D2 · each route requires its permission', () => {
  it('a key with read only: 403 «escritura» on the four routes that write, and nothing is written', async () => {
    const before = await rowCounts(crm().db.pool);
    const key = bearer(crm().fixture.extras.readOnlyKey);
    for (const write of writeRoutes()) expectForbidden(await send(write, key), 'La llave no tiene permiso de escritura.');
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it("the agent's key (read, write) archiving: 403 «borrado», and the contact stays active", async () => {
    const { a } = crm().fixture;
    const before = await rowCounts(crm().db.pool);
    expectForbidden(await send(archiveRoute(a.contactId), bearer(a.apiKey)), 'La llave no tiene permiso de borrado.');
    expect(await contactArchivedAt(a.contactId)).toBeNull();
    expect(await rowCounts(crm().db.pool)).toEqual(before);
  });

  it('a key with read only archiving: 403 «borrado» as well', async () => {
    const key = bearer(crm().fixture.extras.readOnlyKey);
    expectForbidden(await send(archiveRoute(crm().fixture.a.contactId), key), 'La llave no tiene permiso de borrado.');
  });

  it('controls: the write-only key creates (201), and the read-write-delete key archives what it made (204)', async () => {
    const { extras } = crm().fixture;
    const created = await send(writeRoutes()[0]!, bearer(extras.writeOnlyKey));
    expect(created.statusCode, created.body).toBe(201);
    const { contact } = bodyOf(created) as { contact: { id: number } };
    const archived = await send(archiveRoute(String(contact.id)), bearer(extras.deleteKey));
    expect(archived.statusCode, archived.body).toBe(204);
    expect(await contactArchivedAt(String(contact.id))).not.toBeNull();
  });

  it('a key without read: 403 «lectura» on the audit trail, which the read-only key reads (control)', async () => {
    const { extras } = crm().fixture;
    const url = '/accounts/cuenta-a/audit-log';
    expectForbidden(await crm().app.inject({ method: 'GET', url, headers: bearer(extras.writeOnlyKey) }), 'La llave no tiene permiso de lectura.');
    expect((await crm().app.inject({ method: 'GET', url, headers: bearer(extras.readOnlyKey) })).statusCode).toBe(200);
  });
});

describe('D3 · the key, the account and the permission come before the input', () => {
  const broken = '{"approval": rota';

  function everyWrite(): readonly Write[] {
    return [...writeRoutes(), archiveRoute(crm().fixture.a.contactId)];
  }

  it('without a key, an invalid body is 401 sin_llave on every write, never 400', async () => {
    for (const write of everyWrite()) {
      const response = await send(write, {}, broken);
      expect([write.route, response.statusCode, errorCodeOf(response)]).toEqual([write.route, 401, 'sin_llave']);
    }
  });

  it("with a's key on account b, an invalid body is 403 cuenta_ajena, never 400", async () => {
    for (const write of everyWrite()) {
      const response = await send(write, bearer(crm().fixture.a.apiKey), broken, 'cuenta-b');
      expect([write.route, response.statusCode, errorCodeOf(response)]).toEqual([write.route, 403, 'cuenta_ajena']);
    }
  });

  it('with a key without the permission, an invalid body is 403 sin_permiso, never 400', async () => {
    const { a, extras } = crm().fixture;
    for (const write of writeRoutes()) {
      const response = await send(write, bearer(extras.readOnlyKey), broken);
      expect([write.route, response.statusCode, errorCodeOf(response)]).toEqual([write.route, 403, 'sin_permiso']);
    }
    const archive = await send(archiveRoute(a.contactId), bearer(a.apiKey), broken);
    expect([archive.statusCode, errorCodeOf(archive)]).toEqual([403, 'sin_permiso']);
  });

  it('with a key that holds the permission, the same body is 400 «cuerpo» (control)', async () => {
    const { a, extras } = crm().fixture;
    for (const write of writeRoutes()) expect((await send(write, bearer(a.apiKey), broken)).statusCode).toBe(400);
    expect((await send(archiveRoute(a.contactId), bearer(extras.deleteKey), broken)).statusCode).toBe(400);
  });

  it('without a key, a body over 16 KiB is 401, not 413', async () => {
    const huge = JSON.stringify({ body: 'x'.repeat(MAX_BODY_BYTES * 2) });
    for (const write of everyWrite()) {
      const response = await send(write, {}, huge);
      expect([write.route, response.statusCode, errorCodeOf(response)]).toEqual([write.route, 401, 'sin_llave']);
    }
  });

  it('with a key, the same body is 413 demasiado_grande (control)', async () => {
    const huge = JSON.stringify({ body: 'x'.repeat(MAX_BODY_BYTES * 2) });
    const response = await send(writeRoutes()[2]!, bearer(crm().fixture.a.apiKey), huge);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([413, 'demasiado_grande']);
  });
});
