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
    expect(tryouts.stages).toEqual(['nueva', 'diagnostico', 'programa-propuesto', 'conversacion-agendada', 'inscrita', 'descartada']);
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
  const STAGES = [{ key: 'segunda', position: 1 }, { key: 'primera', position: 0 }];
  /** A crm.json with the agent's account and its stages; another account's stages never count. */
  const crmOf = (agentAccount: string, stages: unknown = STAGES) => ({
    agentAccount,
    accounts: [{ slug: 'otra', stages: [{ key: 'ajena', position: 0 }] }, { slug: agentAccount, stages }],
  });

  it("(control) loads a small one, with the agent account's stages by position", () => {
    write('bueno', crmOf('cuenta-a'), { samples: [SAMPLE] });

    expect(loadTryouts(root, 'bueno')).toEqual({ agentAccount: 'cuenta-a', stages: ['primera', 'segunda'], samples: [SAMPLE] });
  });

  it.each([
    ['no agent account', {}, { samples: [SAMPLE] }],
    ['an account that is not a slug', { agentAccount: '../x' }, { samples: [SAMPLE] }],
    ['no samples', crmOf('a'), { samples: [] }],
    ['a repeated id', crmOf('a'), { samples: [SAMPLE, SAMPLE] }],
    ['a field of more', crmOf('a'), { samples: [{ ...SAMPLE, email: 'x@y.test' }] }],
    ['an empty text', crmOf('a'), { samples: [{ ...SAMPLE, text: ' ' }] }],
    ['a label of 61 characters', crmOf('a'), { samples: [{ ...SAMPLE, label: 'x'.repeat(61) }] }],
    ['a key of more at the top', crmOf('a'), { samples: [SAMPLE], other: 1 }],
    ['an agent account with no stages', { agentAccount: 'a', accounts: [{ slug: 'otra', stages: STAGES }] }, { samples: [SAMPLE] }],
    ['a stage key out of shape', crmOf('a', [{ key: 'Con Espacios', position: 0 }]), { samples: [SAMPLE] }],
    ['a stage with no position', crmOf('a', [{ key: 'primera' }]), { samples: [SAMPLE] }],
    ['samples.json that is not JSON', crmOf('a'), '{ secreto'],
  ])('refuses %s, without quoting the file', (name, crm, samples) => {
    const id = `caso-${name.replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
    write(id, crm, samples);

    expect(() => loadTryouts(root, id)).toThrow(InvalidScenario);
    expect(() => loadTryouts(root, id)).not.toThrow('secreto');
  });
});
