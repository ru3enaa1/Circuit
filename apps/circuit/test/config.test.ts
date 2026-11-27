import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CircuitConfigError, DEFAULT_CIRCUIT_PORT, readCircuitConfig } from '../src/config.ts';

// ADR-0011 B6: the circuit server's configuration, from the environment only. It listens on
// 127.0.0.1 whatever the environment says, and no variable can change that.

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const VALID = {
  CIRCUIT_DB_PASSWORD: 'una-clave-de-prueba-larga',
  POSTGRES_DB: 'circuit',
  DB_PORT: '5432',
  CIRCUIT_SCENARIO: 'escuela',
} as const;

function errorOf(env: Record<string, string | undefined>): string {
  try {
    readCircuitConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitConfigError);
    return (error as Error).message;
  }
  throw new Error('readCircuitConfig no falló');
}

describe('B6 · readCircuitConfig', () => {
  it('listens on 127.0.0.1, on 4020 by default, as circuit_app', () => {
    const config = readCircuitConfig(VALID);

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(DEFAULT_CIRCUIT_PORT);
    expect(DEFAULT_CIRCUIT_PORT).toBe(4020);
    expect(config.db).toEqual({ host: '127.0.0.1', port: 5432, user: 'circuit_app', password: VALID.CIRCUIT_DB_PASSWORD, database: 'circuit' });
    expect(config).toMatchObject({ scenario: 'escuela', model: 'simulator' });
  });

  it('a CIRCUIT_HOST or a HOST in the environment changes nothing', () => {
    expect(readCircuitConfig({ ...VALID, CIRCUIT_HOST: '0.0.0.0', HOST: '0.0.0.0' }).host).toBe('127.0.0.1');
  });

  it('no file of apps/circuit/src and no line of .env.example names CIRCUIT_HOST', () => {
    const sources = readdirSync(join(APP_ROOT, 'src'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'));

    expect(sources.length).toBeGreaterThan(10);
    for (const name of sources) expect(readFileSync(join(APP_ROOT, 'src', name), 'utf8'), name).not.toContain('CIRCUIT_HOST');
    expect(readFileSync(join(REPO_ROOT, '.env.example'), 'utf8')).not.toContain('CIRCUIT_HOST');
  });

  it.each([
    ['0', 0],
    ['4021', 4021],
    ['', DEFAULT_CIRCUIT_PORT],
  ])('CIRCUIT_PORT=%s gives port %s', (value, port) => {
    expect(readCircuitConfig({ ...VALID, CIRCUIT_PORT: value }).port).toBe(port);
  });

  it('names every missing variable', () => {
    expect(errorOf({})).toBe('Faltan variables de entorno: CIRCUIT_DB_PASSWORD, POSTGRES_DB, DB_PORT, CIRCUIT_SCENARIO. Copia .env.example a .env y complétalo.');
  });

  it('names each invalid variable and never quotes its value', () => {
    const message = errorOf({
      CIRCUIT_DB_PASSWORD: 'corta',
      POSTGRES_DB: 'mi base',
      DB_PORT: '99999',
      CIRCUIT_SCENARIO: '../otro',
      CIRCUIT_PORT: '70000',
    });

    for (const name of ['CIRCUIT_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CIRCUIT_SCENARIO', 'CIRCUIT_PORT']) expect(message).toContain(name);
    for (const value of ['corta', 'mi base', '99999', '../otro', '70000']) expect(message).not.toContain(value);
  });

  it('CIRCUIT_MODEL other than the simulator stops the start-up by its name', () => {
    const message = errorOf({ ...VALID, CIRCUIT_MODEL: 'claude-real' });

    expect(message).toContain('CIRCUIT_MODEL');
    expect(message).not.toContain('claude-real');
  });

  it('a .env saved with a BOM is named as such', () => {
    const { CIRCUIT_DB_PASSWORD: password, ...rest } = VALID;

    expect(errorOf({ ...rest, [`${String.fromCharCode(0xfeff)}CIRCUIT_DB_PASSWORD`]: password })).toContain('BOM');
  });
});
