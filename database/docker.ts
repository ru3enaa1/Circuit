import { execFile } from 'node:child_process';

import { CommandError, randomSuffix, SHA256_HEX } from './command.ts';
import { REPO_ROOT } from './config.ts';

// The orders to the database container that db:backup and db:restore share (ADR-0009 D1–D5).
// pg_dump, pg_restore and sha256sum exist only inside it: the host has no psql (CLAUDE.md §5).

/** The temporary files of the two commands, so a test can look for any that was left behind. */
export const BACKUP_TEMP_PREFIX = 'circuit-backup-';
export const RESTORE_TEMP_PREFIX = 'circuit-restore-';

/** The Compose service of the database (compose.yaml). */
const SERVICE = 'db';
/** Only `pg_restore --list` prints much (130 lines for the development database). */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

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
  return `/tmp/${prefix}${randomSuffix()}.dump`;
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

/** D1: always, after a good run or a bad one. A temporary that stays is reported; the result stands. */
export async function removeInside(docker: Docker, path: string, out: Pick<Console, 'error'>): Promise<void> {
  const run = await docker(inside('rm', '-f', path)).catch(() => ({ code: -1 }));
  if (run.code !== 0) out.error(`Aviso: no se pudo borrar ${path} dentro del contenedor; bórralo a mano.`);
}
