import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseScenario, type Scenario } from '../../apps/crm/src/scenario.ts';
import { REPO_ROOT } from '../config.ts';
import { runKeysCommand } from '../keys.ts';
import { AGENT_KEY_LABEL, AGENT_KEY_PERMISSIONS } from '../seed.ts';
import { sha256, testApiKey } from './crm-fixture.ts';
import { createDisposableDatabase, DATABASE_HOOK_TIMEOUT_MS, runMigrations, type DisposableDatabase } from './disposable-db.ts';
import {
  interceptingConnector,
  KEY_IN_TEXT,
  newKeyFile,
  REAL_SCENARIO,
  removeKeyFiles,
  seed,
  seedEnv,
  seedParsed,
  SEED_TEST_TIMEOUT_MS,
  useMigratedDatabase,
  type SeedRun,
} from './seed-tools.ts';

// ADR-0009 D17–D20: the agent's key that the seed leaves, and what its output never shows.

const scenario = parseScenario(JSON.parse(readFileSync(join(REPO_ROOT, 'scenarios', REAL_SCENARIO, 'crm.json'), 'utf8')));
/** Every name and address of the package: none may reach an output (D17). Slugs are ids, and may. */
const PERSONAL = scenario.accounts.flatMap((account) => [
  account.name,
  ...account.companies.map((company) => company.name),
  ...account.contacts.flatMap((contact) => [contact.fullName, contact.email]),
]);

interface KeyRow {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly permissions: string[];
  readonly revoked: boolean;
  readonly hash: Buffer;
}

async function keyRows(pool: pg.Pool): Promise<KeyRow[]> {
  const result = await pool.query<KeyRow>(
    `SELECT k.id::text AS id, a.slug, k.label, k.permissions, k.revoked_at IS NOT NULL AS revoked, k.key_hash AS hash
       FROM crm.api_keys AS k JOIN crm.accounts AS a ON a.id = k.account_id ORDER BY k.id`,
  );
  return result.rows;
}

const keyOf = (file: string): string => readFileSync(file, 'utf8').trimEnd();

afterAll(removeKeyFiles, DATABASE_HOOK_TIMEOUT_MS);

describe('D18–D20 · the key the seed leaves, over three runs', () => {
  let db: DisposableDatabase | undefined;
  const keyFile = newKeyFile();
  const runs: SeedRun[] = [];

  beforeAll(async () => {
    db = await createDisposableDatabase();
    await runMigrations(db.pool);
    runs.push(await seed(seedEnv(db.name, keyFile)));
    if (runs[0]?.code !== 0) throw new Error(`La semilla falló: ${runs[0]?.err}`);
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    rmSync(dirname(keyFile), { recursive: true, force: true });
    await db?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  it("D18: one live key, agente, exactly {read,write}, in the agent's account and none in the other", async () => {
    const rows = await keyRows(db!.pool);
    expect(rows.map(({ slug, label, permissions, revoked }) => ({ slug, label, permissions, revoked }))).toEqual([
      { slug: 'escuela-andamio', label: AGENT_KEY_LABEL, permissions: [...AGENT_KEY_PERMISSIONS], revoked: false },
    ]);
    expect(rows[0]?.hash.equals(sha256(keyOf(keyFile)))).toBe(true);
  }, SEED_TEST_TIMEOUT_MS);

  it('D20: the file is the key and a newline, nothing more, with nothing left beside it', () => {
    expect(readFileSync(keyFile, 'utf8')).toMatch(new RegExp(`^${KEY_IN_TEXT.source}\\n$`));
    expect(readdirSync(dirname(keyFile))).toEqual(['crm-agent-key']);
  }, SEED_TEST_TIMEOUT_MS);

  it.skipIf(process.platform === 'win32')('D20: only its owner can read or write it (Linux, in CI)', () => {
    expect(statSync(keyFile).mode & 0o077).toBe(0);
  }, SEED_TEST_TIMEOUT_MS);

  it('D19: a second run keeps the same row and the file byte for byte; a mentor key issued in between stays live', async () => {
    const env = seedEnv(db!.name, keyFile);
    const mentor = await runKeysCommand(['issue', '--account', 'escuela-andamio', '--label', 'mentor', '--permissions', 'read,write'], env, {
      out: { log: () => undefined, error: () => undefined },
    });
    expect(mentor).toBe(0);
    const before = { rows: await keyRows(db!.pool), bytes: readFileSync(keyFile) };
    runs.push(await seed(env));
    expect(runs[1]?.code, runs[1]?.err).toBe(0);
    expect(await keyRows(db!.pool)).toEqual(before.rows);
    expect(readFileSync(keyFile).equals(before.bytes)).toBe(true);
  }, SEED_TEST_TIMEOUT_MS);

  it('D19: without the file, a third run revokes the agent key, keeps its row, and leaves a new live one in the file', async () => {
    const before = await keyRows(db!.pool);
    rmSync(keyFile);
    runs.push(await seed(seedEnv(db!.name, keyFile)));
    expect(runs[2]?.code, runs[2]?.err).toBe(0);
    const after = await keyRows(db!.pool);
    const agent = before.find((row) => row.label === AGENT_KEY_LABEL);
    expect(after.find((row) => row.id === agent?.id)?.revoked).toBe(true);
    expect(after.find((row) => row.label === 'mentor')?.revoked).toBe(false);
    const live = after.filter((row) => row.label === AGENT_KEY_LABEL && !row.revoked);
    expect(live).toHaveLength(1);
    expect(live[0]?.hash.equals(sha256(keyOf(keyFile)))).toBe(true);
  }, SEED_TEST_TIMEOUT_MS);

  it('D17, D20: no output of the three runs shows the key, a name or an address', () => {
    expect(runs).toHaveLength(3);
    const text = runs.map((run) => `${run.out}\n${run.err}`).join('\n');
    // Control: the outputs are the seed's, with the slugs and the file in them.
    expect(text).toContain('escuela-andamio');
    expect(text).toContain(keyFile);
    expect(text).not.toMatch(KEY_IN_TEXT);
    for (const value of PERSONAL) expect(text, value).not.toContain(value);
  }, SEED_TEST_TIMEOUT_MS);
});

describe("D17 · a database refusal is told by its SQLSTATE and constraint, never by PostgreSQL's words", () => {
  let db: DisposableDatabase | undefined;

  beforeAll(async () => {
    db = await createDisposableDatabase();
    await runMigrations(db.pool);
  }, DATABASE_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.drop();
  }, DATABASE_HOOK_TIMEOUT_MS);

  it('a repeated address, past the format, is 23505 on the index of addresses and shows no address', async () => {
    const clashing: Scenario = structuredClone(scenario);
    const contacts = clashing.accounts[0]?.contacts ?? [];
    const repeated = contacts[0]?.email ?? '';
    if (contacts[1] !== undefined) contacts[1].email = repeated;
    const keyFile = newKeyFile();
    const env = seedEnv(db!.name, keyFile);
    const errors: unknown[] = [];
    const run = await seedParsed(clashing, keyFile, env, { connect: interceptingConnector(env, () => false, errors) });
    // Control: what PostgreSQL said does carry the address, so leaving it out is the seed's doing.
    const raised = errors.find((error): error is pg.DatabaseError => error instanceof pg.DatabaseError);
    expect(raised?.detail).toContain(repeated);
    expect(run.code).toBe(1);
    expect(run.err).toBe('db:seed falló (SQLSTATE 23505, contacts_account_email_active_key).');
    expect(`${run.out}\n${run.err}`).not.toContain(repeated);
    expect(readdirSync(dirname(keyFile))).toEqual([]);
  }, SEED_TEST_TIMEOUT_MS);
});

describe('D19 · a file whose key the seed must not keep (audit of ADR-0009, H4)', () => {
  const db = useMigratedDatabase();
  const keyFile = newKeyFile();
  const quiet = { log: () => undefined, error: () => undefined };

  beforeAll(async () => {
    const first = await seed(seedEnv(db().name, keyFile));
    if (first.code !== 0) throw new Error(`La semilla falló: ${first.err}`);
  }, DATABASE_HOOK_TIMEOUT_MS);

  /** After a run, exactly one live agent key, and it is the one in the file. */
  async function expectOneLiveAgentKeyInFile(run: SeedRun): Promise<void> {
    expect(run.code, run.err).toBe(0);
    expect(run.out).toContain('Llave del agente nueva');
    const live = (await keyRows(db().pool)).filter((row) => row.label === AGENT_KEY_LABEL && !row.revoked);
    expect(live).toHaveLength(1);
    expect(live[0]?.hash.equals(sha256(keyOf(keyFile)))).toBe(true);
  }

  it('a file with another shape: a new key, and the old one revoked', async () => {
    const before = (await keyRows(db().pool)).find((row) => row.label === AGENT_KEY_LABEL && !row.revoked);
    writeFileSync(keyFile, 'no-es-una-llave\n');
    await expectOneLiveAgentKeyInFile(await seed(seedEnv(db().name, keyFile)));
    expect((await keyRows(db().pool)).find((row) => row.id === before?.id)?.revoked).toBe(true);
  }, SEED_TEST_TIMEOUT_MS);

  it('a key of the right shape that this database never issued: a new key', async () => {
    writeFileSync(keyFile, `${testApiKey('de-otra-base')}\n`);
    await expectOneLiveAgentKeyInFile(await seed(seedEnv(db().name, keyFile)));
  }, SEED_TEST_TIMEOUT_MS);

  it('the agent key itself, revoked with db:keys: a new key, and the revoked one stays revoked', async () => {
    const env = seedEnv(db().name, keyFile);
    const current = (await keyRows(db().pool)).find((row) => row.label === AGENT_KEY_LABEL && !row.revoked);
    expect(await runKeysCommand(['revoke', '--id', current?.id ?? ''], env, { out: quiet })).toBe(0);
    await expectOneLiveAgentKeyInFile(await seed(env));
    expect((await keyRows(db().pool)).find((row) => row.id === current?.id)?.revoked).toBe(true);
  }, SEED_TEST_TIMEOUT_MS);

  it("a live {read,write} key with another label, the mentor's: a new agent key, and the mentor's stays live", async () => {
    const env = seedEnv(db().name, keyFile);
    const out: string[] = [];
    const issued = await runKeysCommand(['issue', '--account', 'escuela-andamio', '--label', 'mentor', '--permissions', 'read,write'], env, {
      out: { log: (line: string) => out.push(line), error: () => undefined },
    });
    const mentorKey = KEY_IN_TEXT.exec(out.join('\n'))?.[0];
    expect(issued).toBe(0);
    writeFileSync(keyFile, `${mentorKey}\n`);
    await expectOneLiveAgentKeyInFile(await seed(env));
    expect(keyOf(keyFile)).not.toBe(mentorKey);
    expect((await keyRows(db().pool)).filter((row) => row.label === 'mentor' && !row.revoked)).toHaveLength(1);
  }, SEED_TEST_TIMEOUT_MS);
});
