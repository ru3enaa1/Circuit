import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { REPO_ROOT } from '../config.ts';
import { composeDocker, type Docker, type DockerRun } from '../docker.ts';

// What the tests of db:backup and db:restore (ADR-0009 D1–D6) share: a docker that records
// every order it runs, and the views of the container a test needs to check a result. Each
// view runs inside the container, like the commands do, because the host has no pg_dump.

/** Five orders to docker for each backup, each one a second or so, and every file running at once. */
export const DOCKER_TEST_TIMEOUT_MS = 60_000;
/** pg_dump 18 writes a random \restrict key into every text dump unless it is given one. */
const RESTRICT_KEY = 'circuit';
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** The temporaries of both commands, as they appear in an order: alone, or after `db:`. */
const COMMAND_TEMP = /(?:^|:)(\/tmp\/circuit-(?:backup|restore)-[0-9a-f]+\.dump)$/;

export interface RecordingDocker {
  readonly docker: Docker;
  /** Every order, in the order it ran, with what it printed. */
  readonly runs: { readonly args: readonly string[]; readonly result: DockerRun }[];
}

/** Records each order and passes it to `inner`, which can alter or refuse it. */
export function recordingDocker(inner: Docker = composeDocker): RecordingDocker {
  const runs: { args: readonly string[]; result: DockerRun }[] = [];
  const docker: Docker = async (args) => {
    const result = await inner(args);
    runs.push({ args: [...args], result });
    return result;
  };
  return { docker, runs };
}

/** A docker that must not be called: it fails the order, and the recording shows the call. */
export const unreachableDocker: Docker = async () => ({ code: 1, stdout: '', stderr: 'docker no debía llamarse' });

/** The container temporaries that `runs` named, so a test checks its own and not another file's. */
export function tempsOf(runs: RecordingDocker['runs']): string[] {
  const paths = runs.flatMap(({ args }) => args.map((arg) => COMMAND_TEMP.exec(arg)?.[1]));
  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

function dockerText(args: readonly string[]): string {
  // stdio given, so docker's progress lines stay out of the test output instead of going to its stderr.
  return execFileSync('docker', ['compose', ...args], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, stdio: 'pipe' });
}

/** The names in the container's /tmp. */
export function containerTmp(): string[] {
  return dockerText(['exec', '-T', 'db', 'ls', '-1', '/tmp']).split('\n').filter((name) => name.length > 0);
}

/** D6: the whole text dump of a database, with owners and privileges, data included. */
export function textDump(database: string, adminUser: string): string {
  return dockerText(['exec', '-T', 'db', 'pg_dump', `--restrict-key=${RESTRICT_KEY}`, `--username=${adminUser}`, `--dbname=${database}`]);
}

/** D3: what a backup holds, as SQL: pg_restore turns the custom format back into text inside the container. */
export function sqlOfBackup(file: string): string {
  const probe = `/tmp/circuit-probe-${randomBytes(6).toString('hex')}.dump`;
  dockerText(['cp', file, `db:${probe}`]);
  try {
    return dockerText(['exec', '-T', 'db', 'pg_restore', `--restrict-key=${RESTRICT_KEY}`, '--file=-', probe]);
  } finally {
    dockerText(['exec', '-T', 'db', 'rm', '-f', probe]);
  }
}
