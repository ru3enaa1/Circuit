import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../../database/config.ts';
import { readLocalEnv } from '../../../database/env.ts';
import { seedFixture, type Fixture } from '../../../database/test/crm-fixture.ts';
import { createDisposableDatabase, runMigrations, type DisposableDatabase } from '../../../database/test/disposable-db.ts';
import { createOrUpdateCrmApp, readCrmPassword } from '../../../database/users.ts';
import { ConfigError } from '../src/config.ts';
import type { LogLine } from '../src/log.ts';
import { startCrm, StartupError, startupMessage } from '../src/main.ts';

// ADR-0006 D7: the CRM listens on 127.0.0.1 only, and the real process starts with node, with
// no build and no loader (D1). The only test that opens a port; CRM_PORT=0 lets the system
// pick a free one. It points at a disposable database, never the development one.

const MAIN = join(REPO_ROOT, 'apps', 'crm', 'src', 'main.ts');
const STARTUP_TIMEOUT_MS = 15_000;
// Above the start-up wait, so a slow start fails with its own message. Under `npm run check`
// every file runs at once, with coverage, and a new Node process can take more than the
// default 5 s to listen.
const PROCESS_TEST_TIMEOUT_MS = STARTUP_TIMEOUT_MS + 5_000;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;

const password = readCrmPassword(readLocalEnv());
let db: DisposableDatabase | undefined;
/** Two seeded accounts, so the real process has a key to write with (ADR-0007 D17). */
let fixture: Fixture | undefined;
const children: ChildProcess[] = [];

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  fixture = await seedFixture(db.pool);
  await createOrUpdateCrmApp(db.connection, password);
});

afterAll(async () => {
  // Before the database goes: a live CRM holds connections to it.
  // A process ended by a signal keeps exitCode null and sets signalCode instead.
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
  await db?.drop();
});

function crmEnv(overrides: Readonly<Record<string, string | undefined>> = {}): Record<string, string | undefined> {
  return {
    CRM_DB_PASSWORD: password,
    POSTGRES_DB: db!.name,
    DB_PORT: String(db!.connection.port),
    CRM_PORT: '0',
    ...overrides,
  };
}

/** Starts main.ts as a real process and resolves with what it printed when it stopped or announced itself. */
function launch(env: Record<string, string | undefined>): Promise<{ child: ChildProcess; listening: string | undefined; stderr: string }> {
  // The parent's environment for what Windows needs (SystemRoot, PATH), without the CRM's own
  // variables, which CI sets: each test says exactly which ones the process gets.
  const base = { ...process.env };
  for (const name of ['CRM_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CRM_PORT', 'NODE_OPTIONS']) delete base[name];
  const child = spawn(process.execPath, [MAIN], { cwd: REPO_ROOT, env: { ...base, ...env } });
  children.push(child);
  let stdout = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El CRM no anunció nada en ${STARTUP_TIMEOUT_MS} ms. stderr: ${stderr}`)), STARTUP_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const line = stdout.split('\n').find((text) => text.includes('"event":"listening"'));
      if (line === undefined) return;
      clearTimeout(timer);
      resolve({ child, listening: (JSON.parse(line) as LogLine)['address'] as string, stderr });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ child, listening: undefined, stderr });
    });
  });
}

describe('D7 · the real process', () => {
  it('starts with node, listens on 127.0.0.1 and answers /health', async () => {
    const { child, listening, stderr } = await launch(crmEnv());
    expect(listening, stderr).toMatch(LOOPBACK);
    const health = await fetch(`${listening}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    child.kill();
    await once(child, 'exit');
  }, PROCESS_TEST_TIMEOUT_MS);

  // ADR-0007 D17: the write path end to end, in the process npm run crm:start runs.
  it('writes: a note through the real process leaves its audit row, signed by the key', async () => {
    const { a } = fixture!;
    const { child, listening, stderr } = await launch(crmEnv());
    expect(listening, stderr).toMatch(LOOPBACK);
    const response = await fetch(`${listening}/accounts/cuenta-a/contacts/${a.contactId}/notes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Nota del proceso real', approval: { approvedBy: 'mentor', approvalRef: 'aprobacion-proceso' } }),
    });
    expect(response.status).toBe(201);
    const { note } = (await response.json()) as { note: { id: number } };
    const audit = await db!.pool.query(
      "SELECT api_key_id::text, proposed_by, approved_by, approval_ref FROM crm.audit_log WHERE table_name = 'notes' AND row_id = $1",
      [note.id],
    );
    expect(audit.rows).toEqual([
      { api_key_id: a.apiKeyId, proposed_by: `key-${a.apiKeyId}`, approved_by: 'mentor', approval_ref: 'aprobacion-proceso' },
    ]);
    child.kill();
    await once(child, 'exit');
  }, PROCESS_TEST_TIMEOUT_MS);

  it('without its variables, exits with 1 and names them, never a value', async () => {
    const { child, listening, stderr } = await launch({ POSTGRES_DB: db!.name });
    expect(listening).toBeUndefined();
    expect(child.exitCode).toBe(1);
    expect(stderr).toContain('El CRM no arrancó: Faltan variables de entorno: CRM_DB_PASSWORD, DB_PORT, CRM_PORT.');
    expect(stderr).not.toContain(db!.name);
  }, PROCESS_TEST_TIMEOUT_MS);
});

describe('D7 · startCrm, in this process', () => {
  it('announces its address on 127.0.0.1 and closes', async () => {
    const logs: LogLine[] = [];
    const crm = await startCrm(crmEnv(), (line) => logs.push(line));
    try {
      expect(crm.address).toMatch(LOOPBACK);
      expect(logs).toEqual([{ event: 'listening', address: crm.address }]);
      expect((await fetch(`${crm.address}/accounts/cuenta-a/stages`)).status).toBe(401);
    } finally {
      await crm.close();
    }
  });

  it.each([
    ['a wrong password', { CRM_DB_PASSWORD: 'otra-clave-de-prueba-000' }, 'Corre npm run db:users.'],
    ['a database that does not exist', { POSTGRES_DB: 'circuit_test_000000000000' }, 'Corre npm run db:migrate.'],
    ['nothing listening on the port', { DB_PORT: '1' }, 'docker compose up -d --wait db'],
  ])('with %s, stops with the command that fixes it', async (_case, overrides, hint) => {
    const error = await startCrm(crmEnv(overrides), () => undefined).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(StartupError);
    expect((error as Error).message).toContain(hint);
    // Host and port are named on purpose (they are not secret); the password and the name are not.
    const { CRM_DB_PASSWORD: sentPassword, POSTGRES_DB: sentName } = overrides as Record<string, string | undefined>;
    for (const value of [sentPassword, sentName]) if (value !== undefined) expect((error as Error).message).not.toContain(value);
  });

  // Audit of ADR-0006, H3: before, this printed only «El CRM no arrancó (Error).».
  it('with CRM_PORT already taken, stops naming the variable, never its value', async () => {
    const taken = createServer();
    taken.listen(0, '127.0.0.1');
    await once(taken, 'listening');
    const { port } = taken.address() as AddressInfo;
    try {
      const error = await startCrm(crmEnv({ CRM_PORT: String(port) }), () => undefined).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(StartupError);
      expect((error as Error).message).toContain('cambia CRM_PORT en .env');
      expect((error as Error).message).not.toContain(String(port));
    } finally {
      taken.close();
      await once(taken, 'close');
    }
  });

  it('prints its own errors as they are, and any other by its name only', () => {
    expect(startupMessage(new ConfigError('Falta X.'))).toBe('El CRM no arrancó: Falta X.');
    expect(startupMessage(new TypeError(`no se lee ${password}`))).toBe('El CRM no arrancó (TypeError).');
    expect(startupMessage('raro')).toBe('El CRM no arrancó (string).');
  });
});
