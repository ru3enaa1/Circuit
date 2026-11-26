import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { SLUG_PATTERN } from '../apps/crm/src/db/schema.ts';
import { adminUserOf, CommandError, describeFailure, hashFile, shown, systemCodeOf } from './command.ts';
import { REPO_ROOT } from './config.ts';
import { BACKUP_TEMP_PREFIX, composeDocker, containerPath, containerTemp, hashInside, inside, mustRun, removeInside, type Docker } from './docker.ts';
import { readLocalEnv, type Env } from './env.ts';

// `npm run db:backup` (ADR-0009 D1–D3, R6): a backup of one database, made with the tools of
// the database container, never through a pipe of the terminal. PowerShell 5.1 rewrote a dump
// that `>` redirected (41 435 bytes became 42 466, exit 0: ADR-0009 baseline), so the dump is
// written to a temporary file inside the container, its index is read there, and it is copied
// out with `docker compose cp`. A backup counts only if the SHA-256 outside is the one inside.
// It runs as the admin of .env over the container's local socket, which needs no password, so
// no order carries one (D3).

/** Where backups go; git ignores it (CLAUDE.md §7). */
export const BACKUPS_DIR = join(REPO_ROOT, 'database', 'backups');
export const DUMP_FILE = 'circuit.dump';
/** sha256sum's own format, `<hash>  <file>`, so `sha256sum -c` can check it too. */
export const HASH_SUFFIX = '.sha256';
/** ADR-0009 D4: an unquoted PostgreSQL name in lowercase, within its 63 bytes. */
export const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

const SLUG = new RegExp(SLUG_PATTERN);

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
    if (systemCodeOf(error) === 'EEXIST') throw new CommandError(`Ya existe ${shown(folder)}: no se escribe en una carpeta que existe.`);
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
