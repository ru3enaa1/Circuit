import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pg from 'pg';

import { DATABASE_NAME, HASH_SUFFIX } from './backup.ts';
import { adminClient, adminUserOf, CommandError, describeFailure, hashFile, SHA256_HEX, shown } from './command.ts';
import { readAdminConnection } from './connection.ts';
import { composeDocker, containerPath, containerTemp, hashInside, inside, mustRun, removeInside, RESTORE_TEMP_PREFIX, type Docker } from './docker.ts';
import { readLocalEnv, type Env } from './env.ts';

// `npm run db:restore` (ADR-0009 D4, D5): restores a backup of db:backup into a new database
// that it creates, and nowhere else. A database that exists, the development one included, is
// refused untouched: a restore over it would turn a bad backup into the loss of the only copy.
// Moving to the restored database is the owner's decision, by pointing POSTGRES_DB at it. The
// file is checked against its .sha256 before anything is created, and again inside the
// container; pg_restore runs there, in one transaction, and a failure leaves no database.

/** Roles and databases belong to the server; CREATE DATABASE is issued from this one. */
const MAINTENANCE_DB = 'postgres';
const DUPLICATE_DATABASE = '42P04';
const OPTIONS = { file: { type: 'string' }, into: { type: 'string' } } as const;

interface RestoreRequest {
  readonly file: string;
  readonly into: string;
  readonly adminUser: string;
}

function parseRequest(args: readonly string[], env: Env): RestoreRequest {
  let values;
  try {
    ({ values } = parseArgs({ args: [...args], options: OPTIONS, allowPositionals: false, strict: true }));
  } catch {
    throw new CommandError('Uso: npm run db:restore -- --file <circuit.dump> --into <base nueva>');
  }
  if (values.file === undefined || values.into === undefined) {
    throw new CommandError('Uso: npm run db:restore -- --file <circuit.dump> --into <base nueva>');
  }
  if (!DATABASE_NAME.test(values.into)) {
    throw new CommandError('La base nueva (--into) va en minúsculas, cifras y guiones bajos, y empieza con una letra.');
  }
  const file = resolve(values.file);
  if (!existsSync(file) || !statSync(file).isFile()) throw new CommandError(`No existe el respaldo ${shown(file)}.`);
  return { file, into: values.into, adminUser: adminUserOf(env) };
}

/** D4: the file's SHA-256, checked against the .sha256 beside it when there is one. */
function verifiedHash(file: string): string {
  const actual = hashFile(file);
  const hashFilePath = `${file}${HASH_SUFFIX}`;
  if (!existsSync(hashFilePath)) return actual;
  const expected = SHA256_HEX.exec(readFileSync(hashFilePath, 'utf8'))?.[1];
  if (expected === undefined) throw new CommandError(`${shown(hashFilePath)} no trae un SHA-256.`);
  if (expected !== actual) throw new CommandError(`El respaldo no tiene el SHA-256 de ${shown(hashFilePath)}: no se restaura.`);
  return actual;
}

/** D4: CREATE DATABASE fails on a name that exists, so checking and creating are one step. */
async function createDatabase(admin: AdminSession, name: string): Promise<void> {
  try {
    // The name passed DATABASE_NAME: lowercase letters, digits and underscores only.
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === DUPLICATE_DATABASE) {
      throw new CommandError(`La base ${name} ya existe: db:restore solo restaura en una base nueva, y no la tocó.`);
    }
    throw error;
  }
}

/** D5: inside the container, all or nothing. */
async function load(request: RestoreRequest, hash: string, docker: Docker, out: Pick<Console, 'error'>): Promise<void> {
  const temp = containerTemp(RESTORE_TEMP_PREFIX);
  try {
    await mustRun(docker, ['cp', request.file, containerPath(temp)], 'docker compose cp');
    if ((await hashInside(docker, temp)) !== hash) throw new CommandError('El respaldo llegó al contenedor con otro SHA-256: no se restaura.');
    const user = `--username=${request.adminUser}`;
    await mustRun(docker, inside('pg_restore', '--exit-on-error', '--single-transaction', user, `--dbname=${request.into}`, temp), 'pg_restore');
  } finally {
    await removeInside(docker, temp, out);
  }
}

export interface AdminSession {
  query(text: string): Promise<unknown>;
  end(): Promise<void>;
}

export interface RestoreDeps {
  readonly docker?: Docker;
  readonly connect?: () => Promise<AdminSession>;
  readonly out?: Pick<Console, 'log' | 'error'>;
}

function maintenanceConnector(env: Env): () => Promise<AdminSession> {
  return async () => {
    const client = adminClient({ ...readAdminConnection(env), database: MAINTENANCE_DB });
    await client.connect();
    return client;
  };
}

/** D4, D5: the database this run created is the only one it ever drops. */
async function restore(request: RestoreRequest, env: Env, deps: RestoreDeps, out: Pick<Console, 'log' | 'error'>): Promise<string> {
  const hash = verifiedHash(request.file);
  const admin = await (deps.connect ?? maintenanceConnector(env))();
  try {
    await createDatabase(admin, request.into);
    try {
      await load(request, hash, deps.docker ?? composeDocker, out);
    } catch (error) {
      await admin.query(`DROP DATABASE IF EXISTS "${request.into}" WITH (FORCE)`).catch(() => {
        out.error(`Aviso: no se pudo borrar la base ${request.into}, que esta corrida creó; bórrala a mano.`);
      });
      throw error;
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
  return `Respaldo restaurado en la base nueva ${request.into} (SHA-256 ${hash}). Para usarla, apunta POSTGRES_DB a ella.`;
}

export async function runRestoreCommand(args: readonly string[], env: Env, deps: RestoreDeps = {}): Promise<number> {
  const out = deps.out ?? console;
  try {
    out.log(await restore(parseRequest(args, env), env, deps, out));
    return 0;
  } catch (error) {
    out.error(describeFailure('db:restore', error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runRestoreCommand(process.argv.slice(2), readLocalEnv());
