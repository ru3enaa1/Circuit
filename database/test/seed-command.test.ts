import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';
import type { ConnectAdmin } from '../keys.ts';
import { runSeedCommand } from '../seed.ts';
import { BROKEN_PACKAGES, validPackage } from './scenario-cases.ts';

// ADR-0009 D7, D8 and D21: what db:seed refuses before it connects. The connection here counts
// each call and fails, so a refusal that connected first shows as a count above zero.

const dir = mkdtempSync(join(tmpdir(), 'circuit-seed-command-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let connections = 0;
const counting: ConnectAdmin = async () => {
  connections += 1;
  throw new Error('la prueba no abre conexiones');
};

/** A package folder of this test, `scenarios/<id>/crm.json`, with `text` as its file. */
function packageDir(id: string, text: string): string {
  const scenarios = mkdtempSync(join(dir, 'scenarios-'));
  mkdirSync(join(scenarios, id));
  writeFileSync(join(scenarios, id, 'crm.json'), text);
  return scenarios;
}

async function run(env: Record<string, string | undefined>, scenariosDir: string, args: string[] = []) {
  connections = 0;
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSeedCommand(args, env, {
    connect: counting,
    scenariosDir,
    out: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  });
  return { code, text: [...out, ...err].join('\n'), err: err.join('\n') };
}

const envFor = (id: string) => ({ CIRCUIT_SCENARIO: id, CRM_AGENT_KEY_FILE: join(dir, 'llave') });

describe('D8, D9 · a broken package is refused before connecting', () => {
  it.each(BROKEN_PACKAGES)('$rule: exit 1, 0 connections, «$path» named', async ({ json, path, value }) => {
    const result = await run(envFor('roto'), packageDir('roto', json));
    expect(result.code).toBe(1);
    expect(connections).toBe(0);
    expect(result.err).toContain(`«${path}»`);
    if (value.length > 0) expect(result.text).not.toContain(value);
  });

  it('the valid package, saved with a BOM as PowerShell 5.1 saves it, gets to connect (control)', async () => {
    const result = await run(envFor('valido'), packageDir('valido', `﻿${JSON.stringify(validPackage())}`));
    expect(result.code).toBe(1);
    expect(connections).toBe(1);
  });

  it('a file that is not JSON is refused without quoting it', async () => {
    const result = await run(envFor('roto'), packageDir('roto', '{"accounts": [contenido-secreto'));
    expect(result.code).toBe(1);
    expect(connections).toBe(0);
    expect(result.err).toContain('no es JSON válido');
    expect(result.text).not.toContain('contenido-secreto');
  });
});

describe('D7, D21 · the variables and the scenario, checked before connecting', () => {
  const scenarios = packageDir('valido', JSON.stringify(validPackage()));

  it.each([
    ['without CIRCUIT_SCENARIO', { CRM_AGENT_KEY_FILE: join(dir, 'llave') }, 'Falta CIRCUIT_SCENARIO'],
    ['with an empty CIRCUIT_SCENARIO', { CIRCUIT_SCENARIO: '', CRM_AGENT_KEY_FILE: join(dir, 'llave') }, 'Falta CIRCUIT_SCENARIO'],
    ['with a CIRCUIT_SCENARIO that climbs out of scenarios/', { CIRCUIT_SCENARIO: '../valido', CRM_AGENT_KEY_FILE: join(dir, 'llave') }, 'CIRCUIT_SCENARIO va en'],
    ['without CRM_AGENT_KEY_FILE', { CIRCUIT_SCENARIO: 'valido' }, 'Falta CRM_AGENT_KEY_FILE'],
    ['with a scenario that does not exist', envFor('no-existe'), 'No existe el escenario no-existe'],
  ] as const)('%s: exit 1, named, 0 connections', async (_case, env, message) => {
    const result = await run(env, scenarios);
    expect(result.code).toBe(1);
    expect(connections).toBe(0);
    expect(result.err).toContain(message);
  });

  it('with an argument: exit 1, 0 connections', async () => {
    const result = await run(envFor('valido'), scenarios, ['escuela']);
    expect(result.code).toBe(1);
    expect(connections).toBe(0);
    expect(result.err).toContain('no lleva argumentos');
  });
});

describe('D21 · where the key goes by default', () => {
  it('git ignores the CRM_AGENT_KEY_FILE that .env.example sets', () => {
    const line = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8').match(/^CRM_AGENT_KEY_FILE=(.+)$/m);
    const path = line?.[1]?.trim() ?? '';
    expect(path).toBe('.secrets/crm-agent-key');
    // check-ignore exits with 0 for an ignored path and 1 for one git would add.
    const run = spawnSync('git', ['check-ignore', '-q', path], { cwd: REPO_ROOT });
    expect(run.status).toBe(0);
  });
});

/** The production files of the seed and the format: every .ts of database/ and of each app's src/. */
function productionFiles(): string[] {
  const top = readdirSync(join(REPO_ROOT, 'database')).filter((name) => name.endsWith('.ts')).map((name) => join('database', name));
  const apps = readdirSync(join(REPO_ROOT, 'apps')).flatMap((app) =>
    readdirSync(join(REPO_ROOT, 'apps', app, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join('apps', app, 'src', name)),
  );
  return [...top, ...apps];
}

describe('D7 · the code names no scenario and runs none', () => {
  const files = productionFiles();

  it('reads the files it should (control)', () => {
    expect(files).toEqual(expect.arrayContaining([join('database', 'seed.ts'), join('apps', 'crm', 'src', 'scenario.ts')]));
  });

  it('no production file names the first package', () => {
    const naming = files.filter((file) => /andamio|diagn[oó]stico|escuela/i.test(readFileSync(join(REPO_ROOT, file), 'utf8')));
    expect(naming).toEqual([]);
  });

  it('the seed and the format load no module at run time', () => {
    for (const file of [join('database', 'seed.ts'), join('apps', 'crm', 'src', 'scenario.ts')]) {
      expect(readFileSync(join(REPO_ROOT, file), 'utf8'), file).not.toMatch(/\bimport\(|\brequire\(/);
    }
  });
});
