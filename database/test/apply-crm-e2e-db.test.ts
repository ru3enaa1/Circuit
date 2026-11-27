import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CATALOG } from '../../apps/board/src/texts.ts';
import { CIRCUIT_DB_USER } from '../../apps/circuit/src/config.ts';
import { CIRCUIT, decideRun, startRun, type StationEvent } from '../../apps/circuit/src/modules/circuit/index.ts';
import { HttpCrmClient, readAgentKey, type Fetch } from '../../apps/circuit/src/modules/crm-client/index.ts';
import { PgEventStore } from '../../apps/circuit/src/modules/event-store/index.ts';
import { createSimulator, parseSimulatorFile, requestSha256 } from '../../apps/circuit/src/modules/model/index.ts';
import { loadScenario, loadTryouts } from '../../apps/circuit/src/modules/scenario/index.ts';
import { GOLDEN_DIR, readInput, SCENARIOS_DIR } from '../../apps/circuit/test/golden/harness.ts';
import { steppingClock } from '../../apps/circuit/test/support/fakes.ts';
import { REPO_ROOT } from '../config.ts';
import { readLocalEnv } from '../env.ts';
import { createOrUpdateCircuitApp, createOrUpdateCrmApp, readCircuitPassword, readCrmPassword } from '../users.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import { newKeyFile, removeKeyFiles, seed, seedEnv } from './seed-tools.ts';

// ADR-0012 A3 and A10 with the real CRM: a separate process (apps/circuit never imports its code,
// ADR-0003 M3) on a disposable database seeded with the real package, and circuit's engine on the
// same database as circuit_app. The normal golden case runs to station 7, and the CRM's own audit
// trail, read with the agent's key, says who proposed and who approved each write.

const env = readLocalEnv();
const crmPassword = readCrmPassword(env);
const circuitPassword = readCircuitPassword(env);
const CRM_MAIN = join(REPO_ROOT, 'apps', 'crm', 'src', 'main.ts');
const STARTUP_TIMEOUT_MS = 15_000;
/** Above the start-up wait, and enough for a run over HTTP under `npm run check` (CLAUDE.md §8). */
const PROCESS_TEST_TIMEOUT_MS = STARTUP_TIMEOUT_MS + 5_000;
const MENTOR = 'mentor';

let db: DisposableDatabase | undefined;
let crm: ChildProcess | undefined;
let address: string;
let key: string;
let account: string;
/** Every body circuit sent the CRM, kept by the fetch it was given. */
const sent: { readonly method: string; readonly url: string; readonly body: string }[] = [];

function launchCrm(): Promise<string> {
  const base = { ...process.env };
  for (const name of ['CRM_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CRM_PORT', 'NODE_OPTIONS']) delete base[name];
  const child = spawn(process.execPath, [CRM_MAIN], {
    cwd: REPO_ROOT,
    env: { ...base, CRM_DB_PASSWORD: crmPassword, POSTGRES_DB: db!.name, DB_PORT: String(db!.connection.port), CRM_PORT: '0' },
  });
  crm = child;
  let stdout = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El CRM no anunció nada en ${STARTUP_TIMEOUT_MS} ms. stderr: ${stderr}`)), STARTUP_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const line = stdout.split('\n').find((text) => text.includes('"event":"listening"'));
      if (line === undefined) return;
      clearTimeout(timer);
      resolve((JSON.parse(line) as { address: string }).address);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error(`El CRM salió antes de escuchar. stderr: ${stderr}`));
    });
  });
}

beforeAll(async () => {
  db = await createDisposableDatabase();
  await runMigrations(db.pool);
  const keyFile = newKeyFile();
  const seeded = await seed(seedEnv(db.name, keyFile));
  if (seeded.code !== 0) throw new Error(`La semilla salió con ${seeded.code}: ${seeded.err}`);
  await createOrUpdateCrmApp(db.connection, crmPassword);
  await createOrUpdateCircuitApp(db.connection, circuitPassword);
  key = readAgentKey(keyFile, '/');
  account = loadTryouts(SCENARIOS_DIR, 'escuela').agentAccount;
  address = await launchCrm();
}, DATABASE_HOOK_TIMEOUT_MS);

afterAll(async () => {
  // Before the database goes: a live CRM holds connections to it. A signal leaves exitCode null.
  if (crm !== undefined && crm.exitCode === null && crm.signalCode === null) {
    crm.kill();
    await once(crm, 'exit');
  }
  await db?.drop();
  removeKeyFiles();
}, DATABASE_HOOK_TIMEOUT_MS);

interface AuditEntry {
  readonly id: number;
  readonly tableName: string;
  readonly apiKeyId: number | null;
  readonly proposedBy: string;
  readonly approvedBy: string;
  readonly approvalRef: string;
}

async function auditTrail(): Promise<readonly AuditEntry[]> {
  const response = await fetch(`${address}/accounts/${account}/audit-log?limit=100`, { headers: { authorization: `Bearer ${key}` } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { entries: AuditEntry[] }).entries;
}

/** The engine and the client as main.ts wires them, with a fetch that keeps what it sends. */
function circuitOverRealCrm() {
  const recording: Fetch = async (url, init) => {
    sent.push({ method: init.method ?? 'GET', url: url.pathname, body: typeof init.body === 'string' ? init.body : '' });
    return fetch(url, init);
  };
  const client = new HttpCrmClient({ baseUrl: new URL(address), key }, account, recording);
  const store = new PgEventStore(db!.poolAs(CIRCUIT_DB_USER, circuitPassword));
  const scenario = loadScenario(SCENARIOS_DIR, 'escuela');
  const engine = {
    definition: CIRCUIT,
    store,
    clock: steppingClock(),
    digest: { sha256: requestSha256 },
    model: createSimulator(parseSimulatorFile(scenario.simulator)),
    crmReader: client,
    documents: scenario.documents,
    scenario: scenario.id,
  };
  return { engine, decision: { definition: CIRCUIT, store, claims: store, clock: steppingClock(), writer: client } };
}

const routeOf = (events: readonly StationEvent[]) => events.map((event) => `${event.station}:${event.outcome}:${event.status}`);

describe('A3 · every write the run makes is signed by the mentor and the run, and proposed by the agent\'s key', () => {
  it('the normal case runs to station 7 on the real CRM, along the golden case\'s route', async () => {
    const { engine, decision } = circuitOverRealCrm();
    const seededTrail = await auditTrail();

    const started = await startRun(engine, readInput('normal').text);
    // Before the decision, the CRM's trail has nothing new: station 5 only proposed.
    expect(await auditTrail()).toEqual(seededTrail);
    const done = await decideRun(decision, started.runId, { decision: 'approved' }, MENTOR);

    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, 'normal', 'events.json'), 'utf8')) as StationEvent[];
    expect(routeOf(done.events)).toEqual(routeOf(golden));
    const results = done.events.at(-1)?.detail['results'];
    expect(results).toEqual([
      expect.objectContaining({ type: 'add_note', result: 'applied', status: 201 }),
      expect.objectContaining({ type: 'move_stage', result: 'applied', status: 200 }),
      expect.objectContaining({ type: 'create_task', result: 'applied', status: 201 }),
    ]);

    const seen = new Set(seededTrail.map((entry) => entry.id));
    const fresh = (await auditTrail()).filter((entry) => !seen.has(entry.id));
    const agentKeyIds = await db!.pool.query<{ id: string }>("SELECT id FROM crm.api_keys WHERE label = 'agente' AND revoked_at IS NULL");
    const agentKeyId = Number(agentKeyIds.rows[0]?.id);
    expect(fresh.map((entry) => entry.tableName).sort()).toEqual(['contacts', 'notes', 'tasks']);
    for (const entry of fresh) {
      expect(entry).toMatchObject({ approvedBy: MENTOR, approvalRef: `run-${started.runId}`, proposedBy: `key-${agentKeyId}`, apiKeyId: agentKeyId });
      expect(entry.approvedBy).not.toMatch(/^key-[0-9]+$/);
    }
  }, PROCESS_TEST_TIMEOUT_MS);
});

describe('A10 · no text of the board\'s catalog with tone «juego» reaches the CRM', () => {
  it('(control) circuit sent the CRM its writes, and the check reads them', () => {
    expect(sent.filter((request) => request.method !== 'GET').length).toBeGreaterThanOrEqual(4);
    expect(sent.some((request) => request.body.includes('Radiografía de la operación'))).toBe(true);
  }, PROCESS_TEST_TIMEOUT_MS);

  it('every body circuit sent is free of «juego» texts', () => {
    const play = CATALOG.flatMap((entries) => Object.values(entries)).filter((entry) => entry.tone === 'juego').map((entry) => entry.text);
    expect(play.length).toBeGreaterThan(0);

    for (const request of sent) for (const text of play) expect(request.body, `${request.method} ${request.url}`).not.toContain(text);
  }, PROCESS_TEST_TIMEOUT_MS);
});
