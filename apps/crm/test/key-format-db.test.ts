import { describe, expect, it } from 'vitest';

import { testApiKey } from '../../../database/test/crm-fixture.ts';
import type { Connector } from '../src/db/scope.ts';
import { buildServer } from '../src/server/server.ts';
import { useCrmUnderTest } from './crm-under-test.ts';

// ADR-0008 D2: a key without the shape of D1 is refused before it is looked up, with the 401
// of a well-formed key that does not exist, byte for byte, and without taking a connection.
// The server here takes crm_app's pool through a connector that counts, so the gate shows in
// what it does not do. The well-formed unknown key is the control that the count counts.

const crm = useCrmUnderTest();

interface Attempt {
  readonly status: number;
  readonly authenticate: unknown;
  readonly body: string;
  readonly connections: number;
}

async function attempt(authorization: string): Promise<Attempt> {
  let connections = 0;
  const pool: Connector = {
    connect: () => {
      connections += 1;
      return crm().pool.connect();
    },
  };
  const app = buildServer({ pool, log: () => undefined });
  try {
    const response = await app.inject({ method: 'GET', url: '/accounts/cuenta-a/stages', headers: { authorization } });
    return { status: response.statusCode, authenticate: response.headers['www-authenticate'], body: response.body, connections };
  } finally {
    await app.close();
  }
}

const wellFormed = testApiKey('desconocida-bien-formada');
const tail = wellFormed.slice('crmk_'.length);

const malformed = [
  ['the prefix in capitals', `CRMK_${tail}`],
  ['without the prefix', tail],
  ['42 characters', `crmk_${tail.slice(0, 42)}`],
  ['44 characters', `crmk_${tail}A`],
  ['with = at the end', `crmk_${tail}=`],
  ['with +', `crmk_+${tail.slice(1)}`],
  ['with /', `crmk_/${tail.slice(1)}`],
  ['a last character 32 bytes cannot end in', `crmk_${tail.slice(0, 42)}B`],
  ['the shape of the keys before F1.4', 'llave-de-prueba'],
] as const;

describe('D2 · a key without the shape is refused before it is looked up', () => {
  it('a well-formed key that does not exist: 401 llave_invalida, after one connection (control)', async () => {
    const control = await attempt(`Bearer ${wellFormed}`);
    expect(control).toMatchObject({ status: 401, authenticate: 'Bearer', connections: 1 });
    expect(JSON.parse(control.body)).toEqual({ error: { code: 'llave_invalida', message: 'La llave no es válida.' } });
  });

  it.each(malformed)('%s: the same 401, byte for byte, and no connection', async (_case, key) => {
    const control = await attempt(`Bearer ${wellFormed}`);
    const refused = await attempt(`Bearer ${key}`);
    expect(refused).toEqual({ ...control, connections: 0 });
  });
});
