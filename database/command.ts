import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

import pg from 'pg';

import { REPO_ROOT } from './config.ts';
import type { Env } from './env.ts';

// What the local commands of ADR-0009 share (db:backup, db:restore and db:seed): their own
// refusals, how a failure is told in one line, and how a path and a file's hash are shown. Kept
// apart from the docker helpers (docker.ts), so the seed, which never calls docker, does not
// depend on them (audit of ADR-0009, H11).

/** A SHA-256 in hex at the start of a line, as sha256sum and a .sha256 file write it. */
export const SHA256_HEX = /^([0-9a-f]{64})\b/;
/** Two runs at once must not share a temporary file (ADR-0009, «Restricciones»). */
const TEMP_SUFFIX_BYTES = 6;

/** A refusal or a failure of ours: its message is safe to print as it is. */
export class CommandError extends Error {
  override readonly name = 'CommandError';
}

export function randomSuffix(): string {
  return randomBytes(TEMP_SUFFIX_BYTES).toString('hex');
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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
 * A client of the admin whose lost connection is a failure the command reports, not a crash
 * (audit of ADR-0009, H1). When the server ends a session (a restart, or a database dropped WITH
 * FORCE), pg 8.23 rejects every pending query and also emits 'error' on the client; with no
 * listener, Node throws it as an unhandled error, which ends the process with a stack trace and
 * turns a test run red. The listener only swallows that event: the same error still reaches the
 * command through the query that was waiting, and a later query is refused because the client is
 * no longer queryable.
 */
export function adminClient(config: pg.ClientConfig): pg.Client {
  const client = new pg.Client(config);
  client.on('error', () => undefined);
  return client;
}

/** The system code of an error (ENOENT, ECONNREFUSED…), never its message, which can carry a path or the connection. */
export function systemCodeOf(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' ? code : undefined;
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
  const code = systemCodeOf(error);
  return code === undefined ? `${command} falló.` : `${command} falló (${code}).`;
}
