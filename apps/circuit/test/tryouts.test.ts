import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvalidScenario, loadTryouts } from '../src/modules/scenario/index.ts';
import { GOLDEN_CASES, GOLDEN_SCENARIO, readInput, SCENARIOS_DIR } from './golden/harness.ts';

// ADR-0012 A12: «Probar una solicitud» offers the scenario's samples, which are the simulator's
// cases, and the agent works in the account crm.json names.

describe('the real package', () => {
  it('offers one sample per golden case, with the same text, so the simulator answers each one', () => {
    const tryouts = loadTryouts(SCENARIOS_DIR, GOLDEN_SCENARIO);

    expect(tryouts.agentAccount).toBe('escuela-andamio');
    expect(tryouts.samples.map((sample) => sample.id)).toEqual([...GOLDEN_CASES]);
    for (const sample of tryouts.samples) expect(sample.text, sample.id).toBe(readInput(sample.id as (typeof GOLDEN_CASES)[number]).text);
  });

  it('labels each sample by what it asks, never by who wrote it', () => {
    for (const sample of loadTryouts(SCENARIOS_DIR, GOLDEN_SCENARIO).samples) {
      expect(sample.label).not.toMatch(/Lucía|Andrés|Mateo|@/);
      expect(sample.label.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('a package that is not well formed', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'circuit-tryouts-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(id: string, crm: unknown, samples: unknown): void {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'crm.json'), JSON.stringify(crm));
    writeFileSync(join(root, id, 'samples.json'), typeof samples === 'string' ? samples : JSON.stringify(samples));
  }

  const SAMPLE = { id: 'uno', label: 'Uno', text: 'Hola.' };

  it('(control) loads a small one', () => {
    write('bueno', { agentAccount: 'cuenta-a' }, { samples: [SAMPLE] });

    expect(loadTryouts(root, 'bueno')).toEqual({ agentAccount: 'cuenta-a', samples: [SAMPLE] });
  });

  it.each([
    ['no agent account', {}, { samples: [SAMPLE] }],
    ['an account that is not a slug', { agentAccount: '../x' }, { samples: [SAMPLE] }],
    ['no samples', { agentAccount: 'a' }, { samples: [] }],
    ['a repeated id', { agentAccount: 'a' }, { samples: [SAMPLE, SAMPLE] }],
    ['a field of more', { agentAccount: 'a' }, { samples: [{ ...SAMPLE, email: 'x@y.test' }] }],
    ['an empty text', { agentAccount: 'a' }, { samples: [{ ...SAMPLE, text: ' ' }] }],
    ['a label of 61 characters', { agentAccount: 'a' }, { samples: [{ ...SAMPLE, label: 'x'.repeat(61) }] }],
    ['a key of more at the top', { agentAccount: 'a' }, { samples: [SAMPLE], other: 1 }],
    ['samples.json that is not JSON', { agentAccount: 'a' }, '{ secreto'],
  ])('refuses %s, without quoting the file', (name, crm, samples) => {
    const id = `caso-${name.replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
    write(id, crm, samples);

    expect(() => loadTryouts(root, id)).toThrow(InvalidScenario);
    expect(() => loadTryouts(root, id)).not.toThrow('secreto');
  });
});
