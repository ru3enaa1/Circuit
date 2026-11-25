import { describe, expect, it } from 'vitest';

import { runKeysCommand, USAGE } from '../../../database/keys.ts';

// ADR-0008 D5: the issuer refuses a bad order before it connects. Every case runs with a
// connection factory that counts its calls and fails, so a refusal that came from the database
// would show as a call. The three valid orders are the control that the count counts.

async function run(args: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  let connections = 0;
  const code = await runKeysCommand(args, {}, {
    connect: () => {
      connections += 1;
      return Promise.reject(new Error('sin base en esta prueba'));
    },
    out: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  });
  return { code, connections, out: out.join('\n'), err: err.join('\n') };
}

const issue = (permissions: string, label = 'agente'): string[] => [
  'issue',
  '--account',
  'cuenta-a',
  '--label',
  label,
  '--permissions',
  permissions,
];

describe('D5 · the issuer validates before it connects', () => {
  it.each([
    ['permissions without read', issue('write')],
    ['an unknown permission', issue('read,admin')],
    ['a repeated permission', issue('read,read')],
    ['no permissions', issue('')],
    ['a label with a space', issue('read', 'dos palabras')],
    ['a label with @', issue('read', 'ana@correo')],
    ['an account that is not a slug', ['list', '--account', 'Cuenta A']],
    ['issue without --account', ['issue', '--label', 'agente', '--permissions', 'read']],
    ['an unknown order', ['borrar', '--id', '3']],
    ['no order at all', []],
    ['an order twice', ['list', 'list', '--account', 'cuenta-a']],
    ['an unknown option', ['list', '--account', 'cuenta-a', '--hash', 'x']],
    ['an option of another order', ['revoke', '--id', '3', '--account', 'cuenta-a']],
    ['an option without its value', ['list', '--account']],
    ['an id that is not a number', ['revoke', '--id', 'tres']],
    ['an id of zero', ['revoke', '--id', '0']],
    ['an order spelled like an object key', ['constructor']],
  ])('%s: exit 1 with the usage, and no connection', async (_case, args) => {
    const result = await run(args);
    expect(result).toMatchObject({ code: 1, connections: 0, out: '' });
    expect(result.err).toContain(USAGE);
  });

  it.each([
    ['issue', issue('write,read')],
    ['list', ['list', '--account', 'cuenta-a']],
    ['revoke', ['revoke', '--id', '3']],
  ])('a valid %s reaches the connection (control)', async (_case, args) => {
    const result = await run(args);
    expect(result).toMatchObject({ code: 1, connections: 1 });
    expect(result.err).not.toContain(USAGE);
  });
});
