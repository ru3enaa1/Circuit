import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pg from 'pg';

import { SLUG_PATTERN } from '../apps/crm/src/db/schema.ts';
import { REPO_ROOT } from './config.ts';
import { readLocalEnv, type Env } from './env.ts';

// `npm run db:backup` (ADR-0009 D1–D3, R6): a backup of one database, made with the tools of
// the database container, never through a pipe of the terminal. PowerShell 5.1 rewrote a dump
// that `>` redirected (41 435 bytes became 42 466, exit 0: ADR-0009 baseline), so the dump is
// written to a temporary file inside the container, its index is read there, and it is copied
// out with `docker compose cp`. A backup counts only if the SHA-256 outside is the one inside.
// It runs as the admin of .env over the container's local socket, which needs no password, so
// no order carries one (D3). db:restore (restore.ts) shares the docker helpers below.

/** Where backups go; git ignores it (CLAUDE.md §7). */
export const BACKUPS_DIR = join(REPO_ROOT, 'database', 'backups');
export const DUMP_FILE = 'circuit.dump';
/** sha256sum's own format, `<hash>  <file>`, so `sha256sum -c` can check it too. */
export const HASH_SUFFIX = '.sha256';
/** ADR-0009 D4: an unquoted PostgreSQL name in lowercase, within its 63 bytes. */
export const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
/** The temporary files of the two commands, so a test can look for any that was left behind. */
export const BACKUP_TEMP_PREFIX = 'circuit-backup-';
export const RESTORE_TEMP_PREFIX = 'circuit-restore-';

/** The Compose service of the database (compose.yaml). */
const SERVICE = 'db';
/** Two runs at once must not share a temporary (ADR-0009, «Restricciones»). */
const TEMP_SUFFIX_BYTES = 6;
const SHA256_HEX = /^([0-9a-f]{64})\b/;
/** Only `pg_restore --list` prints much (130 lines for the development database). */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SLUG = new RegExp(SLUG_PATTERN);

/** A refusal or a failure of ours: its message is safe to print as it is. */
export class CommandError extends Error {
  override readonly name = 'CommandError';
}

export interface DockerRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `docker compose <args>`, from the repository root, where Compose finds its project. A test
 * passes one that records each order, alters a copy or fails if it is called at all. It takes
 * no environment of its own: whatever the container gets goes in `args`, where a test sees it.
 */
export type Docker = (args: readonly string[]) => Promise<DockerRun>;

/** A failure to start docker is exit code -1; it never rejects. */
export const composeDocker: Docker = (args) =>
  new Promise((done) => {
    execFile(
      'docker',
      ['compose', ...args],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
        done({ code, stdout, stderr });
      },
    );
  });

/** An order inside the database container. -T: no terminal, so nothing is translated. */
export function inside(...command: string[]): string[] {
  return ['exec', '-T', SERVICE, ...command];
}

export function containerPath(path: string): string {
  return `${SERVICE}:${path}`;
}

export function containerTemp(prefix: string): string {
  return `/tmp/${prefix}${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.dump`;
}

/**
 * Runs an order and fails unless it exits with 0. Its output is not printed: pg_restore can
 * quote a row, and only our own words reach the terminal.
 */
export async function mustRun(docker: Docker, args: readonly string[], step: string): Promise<DockerRun> {
  const run = await docker(args);
  if (run.code === -1) throw new CommandError(`No se pudo correr docker para ${step}. ¿Está levantado? docker compose up -d --wait db`);
  if (run.code !== 0) throw new CommandError(`${step} falló (salida ${run.code}).`);
  return run;
}

/** The SHA-256 that sha256sum gives inside the container. */
export async function hashInside(docker: Docker, path: string): Promise<string> {
  const run = await mustRun(docker, inside('sha256sum', path), 'sha256sum');
  const hash = SHA256_HEX.exec(run.stdout)?.[1];
  if (hash === undefined) throw new CommandError('sha256sum no dio un SHA-256.');
  return hash;
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** D1: always, after a good run or a bad one. A temporary that stays is reported; the result stands. */
export async function removeInside(docker: Docker, path: string, out: Pick<Console, 'error'>): Promise<void> {
  const run = await docker(inside('rm', '-f', path)).catch(() => ({ code: -1 }));
  if (run.code !== 0) out.error(`Aviso: no se pudo borrar ${path} dentro del contenedor; bórralo a mano.`);
}

/** A path inside the repository, as the repository names it; any other, whole. */
export function shown(path: string): string {
  const inRepo = relative(REPO_ROOT, path);
  return inRepo.startsWith('..') || isAbsolute(inRepo) ? path : inRepo;
}

export function adminUserOf(env: Env): string {
  const user = env['POSTGRES_USER'];
  if (!user) throw new CommandError('Falta POSTGRES_USER en .env o en el entorno; ver .env.example.');
  return user;
}

/**
 * One line for the terminal: our own messages as they are; a database error by its SQLSTATE and
 * constraint, never its message or detail, which can carry a value (ADR-0009 D17, as ADR-0008
 * D6); anything else by its system code, never its message, which can carry the connection.
 */
export function describeFailure(command: string, error: unknown): string {
  if (error instanceof CommandError) return `${command}: ${error.message}`;
  if (error instanceof pg.DatabaseError) {
    const constraint = error.constraint === undefined ? '' : `, ${error.constraint}`;
    return `${command} falló (SQLSTATE ${error.code}${constraint}).`;
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' ? `${command} falló (${code}).` : `${command} falló.`;
}

/** D1: the time in UTC, to the second and with its Z, so folders sort by when they were made. */
export function folderStamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}Z`;
}

interface BackupRequest {
  readonly label: string;
  readonly database: string;
  readonly adminUser: string;
  readonly root: string;
}

const OPTIONS = { label: { type: 'string' }, database: { type: 'string' }, 'backups-dir': { type: 'string' } } as const;

/** D1: everything is checked here, before docker is called. */
function parseRequest(args: readonly string[], env: Env): BackupRequest {
  let values;
  try {
    ({ values } = parseArgs({ args: [...args], options: OPTIONS, allowPositionals: false, strict: true }));
  } catch {
    throw new CommandError('Uso: npm run db:backup -- --label <etiqueta>');
  }
  const label = values.label;
  if (label === undefined || !SLUG.test(label)) {
    throw new CommandError('La etiqueta (--label) va en minúsculas, cifras y guiones, hasta 40 caracteres.');
  }
  const database = values.database ?? env['POSTGRES_DB'];
  if (database === undefined || !DATABASE_NAME.test(database)) {
    throw new CommandError('La base (--database o POSTGRES_DB) no es un nombre válido de PostgreSQL en minúsculas.');
  }
  const root = values['backups-dir'] === undefined ? BACKUPS_DIR : resolve(values['backups-dir']);
  return { label, database, adminUser: adminUserOf(env), root };
}

/** D2: the dump is good only if its index reads inside and the copy outside has the same SHA-256. */
async function dumpAndCopy(request: BackupRequest, temp: string, folder: string, docker: Docker): Promise<string> {
  const user = `--username=${request.adminUser}`;
  await mustRun(docker, inside('pg_dump', '--format=custom', user, `--dbname=${request.database}`, `--file=${temp}`), 'pg_dump');
  await mustRun(docker, inside('pg_restore', '--list', temp), 'pg_restore --list');
  const hashIn = await hashInside(docker, temp);
  const dump = join(folder, DUMP_FILE);
  await mustRun(docker, ['cp', containerPath(temp), dump], 'docker compose cp');
  const hashOut = hashFile(dump);
  if (hashOut !== hashIn) throw new CommandError('La copia no tiene el SHA-256 que el respaldo tenía en el contenedor; no se guarda.');
  writeFileSync(join(folder, `${DUMP_FILE}${HASH_SUFFIX}`), `${hashOut}  ${DUMP_FILE}\n`, { flag: 'wx' });
  return hashOut;
}

/** D1, D2: a new folder, a whole backup in it or no folder at all. */
async function backUp(request: BackupRequest, deps: Required<BackupDeps>): Promise<string> {
  const folder = join(request.root, `${folderStamp(deps.now())}-${request.label}`);
  mkdirSync(request.root, { recursive: true });
  try {
    mkdirSync(folder);
  } catch (error) {
    const exists = typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
    if (exists) throw new CommandError(`Ya existe ${shown(folder)}: no se escribe en una carpeta que existe.`);
    throw error;
  }
  const temp = containerTemp(BACKUP_TEMP_PREFIX);
  try {
    const hash = await dumpAndCopy(request, temp, folder, deps.docker);
    const bytes = statSync(join(folder, DUMP_FILE)).size;
    return `Respaldo de ${request.database} listo en ${shown(folder)}: ${DUMP_FILE}, ${bytes} bytes, SHA-256 ${hash}.`;
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  } finally {
    await removeInside(deps.docker, temp, deps.out);
  }
}

export interface BackupDeps {
  readonly docker?: Docker;
  readonly now?: () => Date;
  readonly out?: Pick<Console, 'log' | 'error'>;
}

export async function runBackupCommand(args: readonly string[], env: Env, deps: BackupDeps = {}): Promise<number> {
  const full = { docker: deps.docker ?? composeDocker, now: deps.now ?? (() => new Date()), out: deps.out ?? console };
  try {
    full.out.log(await backUp(parseRequest(args, env), full));
    return 0;
  } catch (error) {
    full.out.error(describeFailure('db:backup', error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runBackupCommand(process.argv.slice(2), readLocalEnv());
