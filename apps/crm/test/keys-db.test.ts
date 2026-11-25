import { createHash } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { readLocalEnv } from '../../../database/env.ts';
import { adminConnector, runKeysCommand, type ConnectAdmin } from '../../../database/keys.ts';
import { testApiKey } from '../../../database/test/crm-fixture.ts';
import { bearer, useCrmUnderTest } from './crm-under-test.ts';

// ADR-0008 D3, D4, D6, D7 and D8: `npm run db:keys` as its function, on the disposable database
// of the HTTP tests, so a key it issues is tried against the real server as crm_app.

const crm = useCrmUnderTest();

/** A key anywhere in a text, written here and not taken from API_KEY_SHAPE. */
const KEY_IN_TEXT = /crmk_[A-Za-z0-9_-]{43}/g;
const PREFIX_LENGTH = 'crmk_'.length;

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

const env = () => ({ ...readLocalEnv(), POSTGRES_DB: crm().db.name });

async function keys(args: readonly string[], deps: { readonly connect?: ConnectAdmin; readonly newKey?: () => string } = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runKeysCommand(args, env(), { ...deps, out: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) } });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const issueArgs = (label: string, account = 'cuenta-a'): string[] => ['issue', '--account', account, '--label', label, '--permissions', 'read,write'];

/** Issues a key and returns it with the id the command printed. */
async function issue(label: string): Promise<{ readonly id: string; readonly key: string }> {
  const run = await keys(issueArgs(label));
  expect(run.code, run.err).toBe(0);
  const key = run.out.match(KEY_IN_TEXT)?.[0];
  const id = /Llave (\d+) emitida/.exec(run.out)?.[1];
  if (key === undefined || id === undefined) throw new Error(`La salida de issue no trae la llave y su id: ${run.out.length} caracteres.`);
  return { id, key };
}

interface KeyRow {
  readonly hash: Buffer;
  readonly label: string;
  readonly permissions: string[];
  readonly revoked: string | null;
  readonly json: string;
}

/** The row as the admin sees it, or undefined when it is gone. */
async function rowById(id: string): Promise<KeyRow | undefined> {
  const result = await crm().db.pool.query<KeyRow>(
    'SELECT k.key_hash AS hash, k.label, k.permissions, k.revoked_at::text AS revoked, to_jsonb(k)::text AS json FROM crm.api_keys AS k WHERE k.id = $1',
    [id],
  );
  return result.rows[0];
}

async function countKeys(): Promise<number> {
  const result = await crm().db.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM crm.api_keys');
  return Number(result.rows[0]?.n);
}

const read = (key: string) => crm().app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: bearer(key) });

/** The real admin connection, keeping every error the database raised, to show what it carried. */
function recordingConnector(errors: unknown[]): ConnectAdmin {
  const real = adminConnector(env());
  return async () => {
    const client = await real();
    return {
      query: <R extends pg.QueryResultRow>(text: string, values?: unknown[]) =>
        client.query<R>(text, values).catch((error: unknown) => {
          errors.push(error);
          throw error;
        }),
      end: () => client.end(),
    };
  };
}

/** The real admin connection, whose COMMIT fails with `failure()`; `refused` gets one entry per COMMIT. */
function failingCommitConnector(failure: () => Error, refused: string[] = []): ConnectAdmin {
  const real = adminConnector(env());
  return async () => {
    const client = await real();
    return {
      query: <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => {
        if (text !== 'COMMIT') return client.query<R>(text, values);
        refused.push(text);
        return Promise.reject<pg.QueryResult<R>>(failure());
      },
      end: () => client.end(),
    };
  };
}

describe('D4 · issue', () => {
  it('writes exactly one row and prints its id and the key once, on stdout only', async () => {
    const before = await countKeys();
    const run = await keys(issueArgs('emitida'));
    expect(run.code, run.err).toBe(0);
    expect(await countKeys()).toBe(before + 1);
    expect(run.out.match(KEY_IN_TEXT)).toHaveLength(1);
    expect(run.err).toBe('');
    const { id } = await issue('otra');
    expect((await rowById(id))?.label).toBe('otra');
  });

  it('an account that does not exist: exit 1, nothing written, nothing on stdout', async () => {
    const before = await countKeys();
    const run = await keys(issueArgs('perdida', 'cuenta-z'));
    expect([run.code, run.out]).toEqual([1, '']);
    expect(run.err).toContain('cuenta-z');
    expect(await countKeys()).toBe(before);
  });
});

describe('D3 · only the hash is stored', () => {
  it('the row holds the SHA-256 of the whole key and nothing that spells it, and the key reads', async () => {
    const { id, key } = await issue('hash');
    const row = await rowById(id);
    expect(row?.hash.equals(createHash('sha256').update(key).digest())).toBe(true);
    expect(row?.permissions).toEqual(['read', 'write']);
    for (const spelled of [key, key.slice(PREFIX_LENGTH)]) expect(row?.json).not.toContain(spelled);
    expect((await read(key)).statusCode).toBe(200);
  });
});

describe('D6 · the key is shown only after its COMMIT', () => {
  it('an insert that fails exits 1 with 23505, and the key shows nowhere', async () => {
    const repeated = testApiKey('repetida');
    const newKey = () => repeated;
    expect((await keys(issueArgs('primera'), { newKey })).code).toBe(0);
    const before = await countKeys();
    const run = await keys(issueArgs('segunda'), { newKey });
    expect(run.code).toBe(1);
    expect(run.err).toContain('23505');
    expect(`${run.out}\n${run.err}`).not.toContain(repeated.slice(PREFIX_LENGTH));
    expect(await countKeys()).toBe(before);
  });

  it('a COMMIT that fails leaves no key on stdout and no row', async () => {
    const before = await countKeys();
    const run = await keys(issueArgs('sin-commit'), { connect: failingCommitConnector(() => new Error('COMMIT falló a propósito')) });
    expect(run.code).toBe(1);
    expect(run.out.match(KEY_IN_TEXT)).toBeNull();
    expect(await countKeys()).toBe(before);
  });
});

// ADR-0008 A1 (H1 of its audit): the rest of D6. pg's detail of a 23505 spells the hash, and the
// message of an unexpected error can carry anything, the connection included; neither is printed.
describe('D6 · an error shows neither the hash of the key nor its own message', () => {
  it('a 23505 names its SQLSTATE, and not the hash that the detail of pg carries', async () => {
    const repeated = testApiKey('repetida-hash');
    const newKey = () => repeated;
    expect((await keys(issueArgs('primera-hash'), { newKey })).code).toBe(0);
    const errors: unknown[] = [];
    const run = await keys(issueArgs('segunda-hash'), { newKey, connect: recordingConnector(errors) });
    expect([run.code, run.out]).toEqual([1, '']);
    expect(run.err).toContain('23505');
    const hex = createHash('sha256').update(repeated).digest('hex');
    // The premise: what is kept out was there to leak, or this would pass with nothing to hide.
    const duplicate = errors.find((error) => error instanceof pg.DatabaseError && error.code === '23505');
    expect(duplicate instanceof pg.DatabaseError ? duplicate.detail : undefined).toContain(hex);
    expect(run.err).not.toContain(hex);
  });

  // describeFailure has a branch for an error with a system code and one for an error without.
  it.each([
    { kind: 'without a code', code: undefined, said: 'db:keys falló.' },
    { kind: 'with a system code', code: 'ECONNRESET', said: 'db:keys falló (ECONNRESET).' },
  ])('an unexpected error $kind says that db:keys failed, without its message and without the key', async ({ kind, code, said }) => {
    const planted = `COMMIT falló a propósito (${kind}), con un texto que no debe salir`;
    const failure = () => Object.assign(new Error(planted), code === undefined ? {} : { code });
    const label = code === undefined ? 'sin-commit-mensaje' : 'sin-commit-codigo';
    const key = testApiKey(label);
    const refused: string[] = [];
    const run = await keys(issueArgs(label), { newKey: () => key, connect: failingCommitConnector(failure, refused) });
    expect(refused).toEqual(['COMMIT']);
    expect([run.code, run.out]).toEqual([1, '']);
    expect(run.err).toContain(said);
    expect(run.err).not.toContain(planted);
    expect(run.err).not.toContain(key.slice(PREFIX_LENGTH));
  });
});

describe('D7 · revoke', () => {
  it('the key reads before and gets the 401 of an unknown key after; the row stays as it was', async () => {
    const { id, key } = await issue('revocable');
    expect((await read(key)).statusCode).toBe(200);
    const before = await rowById(id);
    const run = await keys(['revoke', '--id', id]);
    expect(run.code, run.err).toBe(0);
    const after = await read(key);
    const unknown = await read(testApiKey('desconocida'));
    expect([after.statusCode, after.body]).toEqual([401, unknown.body]);
    const row = await rowById(id);
    expect(row?.revoked).not.toBeNull();
    expect({ ...row, revoked: null, json: '' }).toEqual({ ...before, json: '' });
  });

  it('revoking again, or an id that does not exist, exits 1 and changes nothing', async () => {
    const { id } = await issue('dos-veces');
    expect((await keys(['revoke', '--id', id])).code).toBe(0);
    const first = await rowById(id);
    const again = await keys(['revoke', '--id', id]);
    const missing = await keys(['revoke', '--id', '999999']);
    expect([again.code, missing.code]).toEqual([1, 1]);
    expect((await rowById(id))?.revoked).toBe(first?.revoked);
  });
});

describe('D8 · list', () => {
  it('prints id, label, permissions, created and revoked of each key of the account, and never the hash', async () => {
    const { b } = crm().fixture;
    const run = await keys(['list', '--account', 'cuenta-b']);
    expect(run.code, run.err).toBe(0);
    const [header, ...rows] = run.out.split('\n').map((line) => line.split('\t'));
    expect(header).toEqual(['id', 'etiqueta', 'permisos', 'creada', 'revocada']);
    const created = await crm().db.pool.query<{ created: Date }>('SELECT created_at AS created FROM crm.api_keys WHERE id = $1', [b.apiKeyId]);
    expect(rows).toEqual([[b.apiKeyId, 'agente', 'read,write', created.rows[0]?.created.toISOString(), '-']]);
    const hash = createHash('sha256').update(b.apiKey).digest();
    for (const spelled of [hash.toString('hex'), hash.toString('base64'), hash.toString('base64url')]) expect(run.out).not.toContain(spelled);
  });
});
