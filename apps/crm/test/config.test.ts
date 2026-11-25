import { describe, expect, it } from 'vitest';

import { ConfigError, CRM_DB_USER, readCrmConfig } from '../src/config.ts';

// ADR-0006 D6: the configuration comes only from the environment, and every refusal names the
// variable and never its value. Synthetic values only: nothing here reads .env.

const PASSWORD = 'clave-de-prueba-0123456789';
const VALID = { CRM_DB_PASSWORD: PASSWORD, POSTGRES_DB: 'circuit', DB_PORT: '5432', CRM_PORT: '4010' } as const;
const BOM = '﻿';

function refusalOf(env: Readonly<Record<string, string | undefined>>): ConfigError {
  try {
    readCrmConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('Se esperaba un ConfigError y la configuración pasó.');
}

describe('D6 · the CRM configuration', () => {
  it('reads the four variables, with the user and the hosts fixed', () => {
    expect(readCrmConfig({ ...VALID, POSTGRES_USER: 'circuit_admin' })).toEqual({
      host: '127.0.0.1',
      port: 4010,
      db: { host: '127.0.0.1', port: 5432, user: CRM_DB_USER, password: PASSWORD, database: 'circuit' },
    });
  });

  it('accepts CRM_PORT=0, which lets the system pick a free port', () => {
    expect(readCrmConfig({ ...VALID, CRM_PORT: '0' }).port).toBe(0);
  });

  it.each(['CRM_DB_PASSWORD', 'POSTGRES_DB', 'DB_PORT', 'CRM_PORT'] as const)('stops without %s, naming it', (name) => {
    const error = refusalOf({ ...VALID, [name]: undefined });
    expect(error.message).toContain(`Faltan variables de entorno: ${name}.`);
    expect(error.message).not.toContain(PASSWORD);
  });

  it.each([
    ['DB_PORT', '70000'],
    ['DB_PORT', '0'],
    ['CRM_PORT', '-1'],
    ['CRM_PORT', '40 10'],
    ['CRM_DB_PASSWORD', 'corta'],
    ['CRM_DB_PASSWORD', 'con espacio y más de dieciséis'],
    ['POSTGRES_DB', 'circuit;otra'],
  ] as const)('refuses %s=%s, naming the variable and never its value', (name, value) => {
    const error = refusalOf({ ...VALID, [name]: value });
    expect(error.message).toMatch(new RegExp(`^${name} debe ser `));
    expect(error.message).not.toContain(value);
  });

  it('says when a variable starts with a BOM, without its value', () => {
    const { CRM_DB_PASSWORD: _password, ...rest } = VALID;
    const error = refusalOf({ ...rest, [`${BOM}CRM_DB_PASSWORD`]: PASSWORD });
    expect(error.message).toBe('CRM_DB_PASSWORD empieza con un BOM: guarda .env como UTF-8 sin BOM.');
  });
});
