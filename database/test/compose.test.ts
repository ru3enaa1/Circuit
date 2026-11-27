import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';
import { DOCKER_TEST_TIMEOUT_MS } from './docker-tools.ts';

// compose.yaml as Docker will run it, from `docker compose config`: variables interpolated
// and the short port syntax expanded, so the test checks what actually binds.

const LOOPBACK = '127.0.0.1';
const PINNED_BY_DIGEST = /@sha256:[0-9a-f]{64}$/;
// What Docker does when a port mapping has no host IP.
const ALL_INTERFACES = '0.0.0.0 (all interfaces)';
/** ADR-0020 D1: the services of `docker compose up`, and the one image the three of Node share. */
const SERVICES = ['circuit', 'crm', 'db', 'setup'];
const APP_SERVICES = ['circuit', 'crm', 'setup'];
const APP_IMAGE = 'circuit-app:local';
/** ADR-0020 D6: the real model is never on in Compose. */
const MODEL_VARIABLES = ['ANTHROPIC_API_KEY', 'CIRCUIT_MODEL'];
/** What a fresh clone does not have: a .env, and these variables in the environment (CI sets some). */
const LOCAL_VARIABLES = /^(POSTGRES_|CRM_|CIRCUIT_|DB_PORT$|ANTHROPIC_)/;

interface PublishedPort {
  readonly host_ip?: string;
  readonly target: number;
  readonly published?: string;
}

interface ComposeService {
  readonly image?: string;
  readonly build?: { readonly context: string; readonly dockerfile?: string };
  readonly ports?: readonly PublishedPort[];
  readonly environment?: Readonly<Record<string, string | null>>;
}

function composeConfig(args: readonly string[], env: NodeJS.ProcessEnv): ReadonlyArray<readonly [string, ComposeService]> {
  const output = execFileSync('docker', ['compose', ...args, 'config', '--format', 'json'], { cwd: REPO_ROOT, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  let config: unknown;
  try {
    config = JSON.parse(output);
  } catch {
    // The output carries interpolated secrets; a parse error must not quote any of it.
    throw new Error('docker compose config no devolvió JSON válido.');
  }
  const services = (config as { services?: Record<string, ComposeService> }).services;
  return Object.entries(services ?? {});
}

const resolvedServices = () => composeConfig([], process.env);

describe('compose.yaml', () => {
  const services = resolvedServices();
  const byName = new Map(services);

  it('defines the four services of ADR-0020', () => {
    expect(services.map(([name]) => name).sort()).toEqual(SERVICES);
  }, DOCKER_TEST_TIMEOUT_MS);

  it('publishes every port on loopback only', () => {
    const published = services.flatMap(([service, definition]) =>
      (definition.ports ?? []).map((port) => ({
        service,
        target: port.target,
        hostIp: port.host_ip ?? ALL_INTERFACES,
      })),
    );
    // Without this, a file with no published ports would pass vacuously.
    expect(published.length).toBeGreaterThan(0);
    expect(published.filter((port) => port.hostIp !== LOOPBACK)).toEqual([]);
  }, DOCKER_TEST_TIMEOUT_MS);

  it('ADR-0020 D3: publishes the board on the same port inside and out, and never the CRM', () => {
    const board = byName.get('circuit')?.ports ?? [];
    expect(board).toHaveLength(1);
    expect(String(board[0]?.target)).toBe(board[0]?.published);
    expect(byName.get('circuit')?.environment?.['CIRCUIT_PORT']).toBe(board[0]?.published);
    expect(byName.get('crm')?.ports ?? []).toEqual([]);
    expect(byName.get('setup')?.ports ?? []).toEqual([]);
  }, DOCKER_TEST_TIMEOUT_MS);

  it('pins every pulled image by digest, and builds the rest from a Dockerfile pinned by digest', () => {
    const pulled = services.filter(([, definition]) => definition.build === undefined);
    expect(pulled.filter(([, definition]) => !PINNED_BY_DIGEST.test(definition.image ?? '')).map(([service]) => service)).toEqual([]);

    const built = services.filter(([, definition]) => definition.build !== undefined);
    expect(built.map(([service]) => service).sort()).toEqual(APP_SERVICES);
    for (const [service, definition] of built) expect(definition.image, service).toBe(APP_IMAGE);
    const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8');
    const bases = dockerfile.split('\n').filter((line) => /^FROM\s/i.test(line));
    expect(bases.length).toBeGreaterThan(0);
    for (const line of bases) expect(line.split(/\s+/)[1] ?? '', line).toMatch(PINNED_BY_DIGEST);
  }, DOCKER_TEST_TIMEOUT_MS);

  it('ADR-0020 D1: the image runs as node, not as root', () => {
    const dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8');
    const users = dockerfile.split('\n').filter((line) => /^USER\s/i.test(line));
    expect(users.at(-1)).toBe('USER node');
  }, DOCKER_TEST_TIMEOUT_MS);

  it('ADR-0020 D2, D6: every Node service runs in container mode, and none can turn the real model on', () => {
    for (const service of APP_SERVICES) {
      const environment = byName.get(service)?.environment ?? {};
      expect(environment['CIRCUIT_IN_CONTAINER'], service).toBe('1');
      for (const name of MODEL_VARIABLES) expect(Object.keys(environment), service).not.toContain(name);
    }
  }, DOCKER_TEST_TIMEOUT_MS);

  it('ADR-0020 D4: the CRM and circuit never get the admin password', () => {
    for (const service of ['crm', 'circuit']) expect(Object.keys(byName.get(service)?.environment ?? {}), service).not.toContain('POSTGRES_PASSWORD');
  }, DOCKER_TEST_TIMEOUT_MS);
});

describe('ADR-0020 · a fresh clone, with no .env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'circuit-compose-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it(
    'docker compose config works with an empty env file and none of the local variables',
    () => {
      const empty = join(dir, 'empty.env');
      writeFileSync(empty, '');
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !LOCAL_VARIABLES.test(name)));
      const services = new Map(composeConfig(['--env-file', empty], env));

      expect([...services.keys()].sort()).toEqual(SERVICES);
      expect(services.get('db')?.environment?.['POSTGRES_PASSWORD']).toBe('');
      expect(services.get('circuit')?.ports?.[0]?.published).toBe('4020');
    },
    DOCKER_TEST_TIMEOUT_MS,
  );
});
