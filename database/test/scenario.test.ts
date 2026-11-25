import { describe, expect, it } from 'vitest';

import { parseScenario, ScenarioError } from '../../apps/crm/src/scenario.ts';
import { BROKEN_PACKAGES, validPackage } from './scenario-cases.ts';

// ADR-0009 D8 and D9: the package format refuses each broken package, naming where to look and
// never what was there.

function refusalOf(json: string): ScenarioError {
  try {
    parseScenario(JSON.parse(json));
  } catch (error) {
    if (error instanceof ScenarioError) return error;
    throw error;
  }
  throw new Error('El paquete roto pasó la validación.');
}

describe('D8, D9 · the package format', () => {
  it('takes the valid package, with the lists a contact may leave out (control)', () => {
    const scenario = parseScenario(validPackage());
    expect(scenario.accounts.map((account) => account.slug)).toEqual(['cuenta-a', 'cuenta-b']);
    expect(scenario.accounts[0]?.contacts[1]?.notes).toEqual([]);
    expect(scenario.accounts[1]?.companies).toEqual([]);
  });

  it.each(BROKEN_PACKAGES)('refuses $rule, naming $path', ({ json, path, value }) => {
    const { message } = refusalOf(json);
    expect(message).toContain(`«${path}»`);
    if (value.length > 0) expect(message).not.toContain(value);
  });

  it('names at most five places, and how many more there are', () => {
    const pkg = validPackage();
    for (let index = 0; index < 7; index += 1) pkg[`extra${index}`] = index;
    const { message } = refusalOf(JSON.stringify(pkg));
    expect(message.match(/«/g)).toHaveLength(5);
    expect(message).toContain('y 2 más');
  });

  it('refuses what is not a package at all, naming the root', () => {
    expect(refusalOf('[]').message).toContain('«(raíz)»');
  });
});
