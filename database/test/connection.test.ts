import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readAdminConnection } from '../connection.ts';
import { readLocalEnv, type Env } from '../env.ts';

const SECRET = 'secret-value-that-must-not-leak';
const COMPLETE: Env = {
  POSTGRES_USER: 'admin',
  POSTGRES_PASSWORD: SECRET,
  POSTGRES_DB: 'circuit',
  DB_PORT: '5432',
};

function errorFrom(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected the action to throw an Error');
}

describe('readAdminConnection', () => {
  it('reads a complete environment, always on loopback', () => {
    expect(readAdminConnection(COMPLETE)).toEqual({
      host: '127.0.0.1',
      port: 5432,
      user: 'admin',
      password: SECRET,
      database: 'circuit',
    });
  });

  it('names every missing or empty variable', () => {
    const error = errorFrom(() => readAdminConnection({ POSTGRES_USER: 'admin', POSTGRES_PASSWORD: '' }));
    expect(error.message).toContain('POSTGRES_PASSWORD, POSTGRES_DB, DB_PORT');
  });

  it.each(['0', '65536', '5432.5', 'abc', ' '])('rejects DB_PORT=%j', (port) => {
    expect(() => readAdminConnection({ ...COMPLETE, DB_PORT: port })).toThrow(/DB_PORT/);
  });

  it('never puts a value in its errors', () => {
    const missing = errorFrom(() => readAdminConnection({ ...COMPLETE, POSTGRES_DB: '' }));
    const badPort = errorFrom(() => readAdminConnection({ ...COMPLETE, DB_PORT: SECRET }));
    expect(missing.message).not.toContain(SECRET);
    expect(badPort.message).not.toContain(SECRET);
  });
});

describe('ADR-0020 D2 · readAdminConnection in a container', () => {
  it('(control) without CIRCUIT_IN_CONTAINER, loopback, even inside a container', () => {
    expect(readAdminConnection(COMPLETE, () => true).host).toBe('127.0.0.1');
  });

  it('inside a container, the Compose service db', () => {
    expect(readAdminConnection({ ...COMPLETE, CIRCUIT_IN_CONTAINER: '1' }, () => true).host).toBe('db');
  });

  it('on the host, or with another value, it stops naming the variable', () => {
    expect(() => readAdminConnection({ ...COMPLETE, CIRCUIT_IN_CONTAINER: '1' }, () => false)).toThrow(/CIRCUIT_IN_CONTAINER/);
    expect(() => readAdminConnection({ ...COMPLETE, CIRCUIT_IN_CONTAINER: 'true' }, () => true)).toThrow(/CIRCUIT_IN_CONTAINER/);
  });
});

describe('readLocalEnv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'circuit-env-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function envFile(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('lets the process environment win over the file', () => {
    const file = envFile('precedence.env', 'DB_PORT=5432\nPOSTGRES_DB=from_file\n');
    expect(readLocalEnv(file, { DB_PORT: '6543' })).toMatchObject({
      DB_PORT: '6543',
      POSTGRES_DB: 'from_file',
    });
  });

  it('reads the first variable of a file saved with a BOM', () => {
    const file = envFile('bom.env', '﻿POSTGRES_USER=admin\n');
    expect(readLocalEnv(file, {})['POSTGRES_USER']).toBe('admin');
  });

  it('works without a file', () => {
    expect(readLocalEnv(join(dir, 'absent.env'), { DB_PORT: '5432' })).toEqual({ DB_PORT: '5432' });
  });
});
