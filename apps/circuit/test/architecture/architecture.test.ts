import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CRM_PACKAGE, MODULE_NAMES } from './module-map.ts';
import {
  checkSourceFiles,
  declaredDependencies,
  type RuleId,
  type SourceFile,
} from './module-rules.ts';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
// This folder's fixtures plant violations on purpose; scanning it would report them.
const OWN_FOLDER = 'test/architecture/';

/** Every source file under `dir`, with app-relative forward-slash paths, in a stable order. */
function readTree(dir: string): SourceFile[] {
  return readdirSync(join(APP_ROOT, dir), { recursive: true, encoding: 'utf8' })
    .map((path) => `${dir}/${path.split(sep).join('/')}`)
    .filter((path) => SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)))
    .sort()
    .map((path) => ({ path, source: readFileSync(join(APP_ROOT, path), 'utf8') }));
}

const rulesBrokenBy = (path: string, source: string): RuleId[] =>
  checkSourceFiles([{ path, source }]).map((violation) => violation.rule);

describe('architecture of apps/circuit, on the real code (ADR-0001 D2, ADR-0003 M1–M3)', () => {
  it('src/modules holds exactly the modules of the map, each with an index.ts', () => {
    const folders = readdirSync(join(APP_ROOT, 'src/modules'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(folders).toEqual([...MODULE_NAMES].sort());
    for (const name of MODULE_NAMES) {
      expect(existsSync(join(APP_ROOT, 'src/modules', name, 'index.ts')), name).toBe(true);
    }
  });

  it('the source respects every rule', () => {
    const files = readTree('src');

    // Not vacuous: at least each module's index.ts was read.
    expect(files.length).toBeGreaterThanOrEqual(MODULE_NAMES.length);
    expect(checkSourceFiles(files)).toEqual([]);
  });

  it('the tests do not reach into other apps (M3)', () => {
    const files = readTree('test').filter((file) => !file.path.startsWith(OWN_FOLDER));
    const leaving = checkSourceFiles(files).filter((violation) => violation.rule === 'leaves-app');

    expect(files.length).toBeGreaterThan(0);
    expect(leaving).toEqual([]);
  });

  it('package.json declares no dependency on the CRM (M3)', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));

    expect(typeof manifest).toBe('object');
    expect(declaredDependencies(manifest as Record<string, unknown>)).not.toContain(CRM_PACKAGE);
  });
});

describe('positive controls: each rule catches the violation it targets', () => {
  it.each<[string, string, string, RuleId[]]>([
    [
      'the core imports the model SDK (D2, M2)',
      'src/modules/circuit/engine.ts',
      "import Anthropic from '@anthropic-ai/sdk';",
      ['package-owner', 'package-not-allowed'],
    ],
    [
      'the core imports another module (M2)',
      'src/modules/circuit/engine.ts',
      "import { simulator } from '../model/index.ts';",
      ['module-not-allowed'],
    ],
    [
      'the core imports a framework (M2)',
      'src/modules/circuit/engine.ts',
      "import Fastify from 'fastify';",
      ['package-not-allowed'],
    ],
    [
      'the core imports a Node built-in (M2)',
      'src/modules/circuit/clock.ts',
      "import { randomUUID } from 'node:crypto';",
      ['package-not-allowed'],
    ],
    [
      'a module reaches into the core instead of its index (M1)',
      'src/modules/model/simulator.ts',
      "import type { Station } from '../circuit/stations.ts';",
      ['not-through-index'],
    ],
    [
      'a module imports a module the map does not allow',
      'src/modules/approval/review.ts',
      "import { client } from '../crm-client/index.ts';",
      ['module-not-allowed'],
    ],
    [
      'a module imports the composition root',
      'src/modules/scenario/load.ts',
      "import '../../main.ts';",
      ['module-not-allowed'],
    ],
    [
      'the composition root reaches into a module (M1)',
      'src/main.ts',
      "import { createSimulator } from './modules/model/simulator.ts';",
      ['not-through-index'],
    ],
    [
      'the composition root imports the model SDK (D2)',
      'src/main.ts',
      "import Anthropic from '@anthropic-ai/sdk';",
      ['package-owner'],
    ],
    [
      'a relative import into the CRM app (M3)',
      'src/main.ts',
      "import { db } from '../../crm/src/db.ts';",
      ['leaves-app'],
    ],
    [
      'the CRM workspace imported by name (M3)',
      'src/main.ts',
      `import { db } from '${CRM_PACKAGE}';`,
      ['leaves-app'],
    ],
    [
      'an absolute file URL',
      'src/main.ts',
      "import { db } from 'file:///anywhere/db.js';",
      ['leaves-app'],
    ],
    [
      'an import with a computed target',
      'src/modules/circuit/engine.ts',
      'const adapter = await import(adapterName);',
      ['computed-import'],
    ],
  ])('%s', (_name, path, source, expected) => {
    expect(rulesBrokenBy(path, source)).toEqual(expected);
  });

  it('flags a manifest that declares the CRM (M3)', () => {
    const manifest = { devDependencies: { [CRM_PACKAGE]: '0.0.0' } };

    expect(declaredDependencies(manifest)).toContain(CRM_PACKAGE);
  });
});

describe('negative controls: allowed code stays green', () => {
  it.each<[string, string, string]>([
    [
      'a module imports the core through its index',
      'src/modules/model/simulator.ts',
      "import type { ModelPort } from '../circuit/index.ts';",
    ],
    [
      'a module imports its own internals',
      'src/modules/circuit/engine.ts',
      "import { STATIONS } from './stations.ts';",
    ],
    [
      'the composition root imports module indexes',
      'src/main.ts',
      "import { createSimulator } from './modules/model/index.ts';",
    ],
    [
      'the composition root imports a framework',
      'src/main.ts',
      "import Fastify from 'fastify';",
    ],
    [
      'a commented-out import of the SDK in the core',
      'src/modules/circuit/engine.ts',
      "// import Anthropic from '@anthropic-ai/sdk';",
    ],
  ])('%s', (_name, path, source) => {
    expect(rulesBrokenBy(path, source)).toEqual([]);
  });
});
