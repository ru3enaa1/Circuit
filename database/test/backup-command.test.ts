import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { CommandError, describeFailure, runBackupCommand, type Docker } from '../backup.ts';
import { runRestoreCommand } from '../restore.ts';

// ADR-0009 D1, D4: what db:backup and db:restore refuse before docker or the database, and how
// a failure is told. No database and no docker: every docker here is a double.

const root = mkdtempSync(join(tmpdir(), 'circuit-backup-command-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ENV = { POSTGRES_USER: 'admin_de_prueba', POSTGRES_DB: 'circuit' } as const;

function capture() {
  const err: string[] = [];
  return { err, out: { log: () => undefined, error: (line: string) => err.push(line) } };
}

let dockerCalls = 0;
const counting: Docker = async () => {
  dockerCalls += 1;
  return { code: 1, stdout: '', stderr: '' };
};

describe('db:backup refuses before docker', () => {
  it.each([
    ['an unknown option', ['--label', 'x', '--otra', 'y'], ENV, 'Uso: npm run db:backup'],
    ['a positional argument', ['suelto'], ENV, 'Uso: npm run db:backup'],
    ['no label', [], ENV, 'La etiqueta (--label)'],
    ['a database name that is not one', ['--label', 'x', '--database', 'Base; drop'], ENV, 'no es un nombre válido'],
    ['no POSTGRES_DB', ['--label', 'x'], { POSTGRES_USER: 'admin' }, 'no es un nombre válido'],
    ['no POSTGRES_USER', ['--label', 'x'], { POSTGRES_DB: 'circuit' }, 'Falta POSTGRES_USER'],
  ] as const)('%s', async (_case, args, env, message) => {
    dockerCalls = 0;
    const { err, out } = capture();
    expect(await runBackupCommand([...args, '--backups-dir', root], env, { docker: counting, out })).toBe(1);
    expect(err.join('\n')).toContain(message);
    expect(dockerCalls).toBe(0);
  });

  it('a docker that cannot start is named, with the command that starts the database', async () => {
    const { err, out } = capture();
    const missing: Docker = async () => ({ code: -1, stdout: '', stderr: '' });
    expect(await runBackupCommand(['--label', 'x', '--backups-dir', root], ENV, { docker: missing, out })).toBe(1);
    expect(err.join('\n')).toContain('docker compose up -d --wait db');
  });
});

describe('db:restore refuses before the database', () => {
  const file = join(root, 'circuit.dump');
  writeFileSync(file, 'no es un respaldo');
  const noConnection = async () => {
    throw new Error('no debía conectarse');
  };

  it.each([
    ['no option', []],
    ['no --into', ['--file', file]],
    ['an unknown option', ['--file', file, '--into', 'copia', '--otra', 'x']],
  ] as const)('%s: the usage', async (_case, args) => {
    const { err, out } = capture();
    expect(await runRestoreCommand(args, ENV, { connect: noConnection, docker: counting, out })).toBe(1);
    expect(err.join('\n')).toContain('Uso: npm run db:restore');
  });

  it('a .sha256 without a hash in it', async () => {
    writeFileSync(`${file}.sha256`, 'nada\n');
    const { err, out } = capture();
    expect(await runRestoreCommand(['--file', file, '--into', 'copia'], ENV, { connect: noConnection, docker: counting, out })).toBe(1);
    expect(err.join('\n')).toContain('no trae un SHA-256');
    rmSync(`${file}.sha256`);
  });
});

describe('describeFailure', () => {
  it('tells our own message, a SQLSTATE, a system code or nothing, never the message of another error', () => {
    const database = new pg.DatabaseError('el valor secreto@correo.test', 0, 'error');
    database.code = '23505';
    const system = Object.assign(new Error('conexión con la contraseña'), { code: 'ECONNREFUSED' });
    expect(describeFailure('db:backup', new CommandError('Lo nuestro.'))).toBe('db:backup: Lo nuestro.');
    expect(describeFailure('db:backup', database)).toBe('db:backup falló (SQLSTATE 23505).');
    expect(describeFailure('db:restore', system)).toBe('db:restore falló (ECONNREFUSED).');
    expect(describeFailure('db:restore', new Error('mensaje con datos'))).toBe('db:restore falló.');
  });
});
