import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';

// compose.yaml as Docker will run it, from `docker compose config`: variables interpolated
// and the short port syntax expanded, so the test checks what actually binds.

const LOOPBACK = '127.0.0.1';
const PINNED_BY_DIGEST = /@sha256:[0-9a-f]{64}$/;
// What Docker does when a port mapping has no host IP.
const ALL_INTERFACES = '0.0.0.0 (all interfaces)';

interface PublishedPort {
  readonly host_ip?: string;
  readonly target: number;
}

interface ComposeService {
  readonly image?: string;
  readonly ports?: readonly PublishedPort[];
}

function resolvedServices(): ReadonlyArray<readonly [string, ComposeService]> {
  const output = execFileSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
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

describe('compose.yaml', () => {
  const services = resolvedServices();

  it('defines the database service', () => {
    expect(services.map(([name]) => name)).toContain('db');
  });

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
  });

  it('pins every image by digest', () => {
    const unpinned = services
      .filter(([, definition]) => !PINNED_BY_DIGEST.test(definition.image ?? ''))
      .map(([service]) => service);
    expect(unpinned).toEqual([]);
  });
});
