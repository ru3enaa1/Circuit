import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FICTITIOUS_MARK, parseScenario } from '../../apps/crm/src/scenario.ts';
import { REPO_ROOT } from '../config.ts';

// ADR-0009 D10: the first package, scenarios/escuela/crm.json, carries the inputs of F1 the owner
// accepted on 2026-11-24: the school, its six stages in order, four or five companies with sector,
// size and a fictitious revenue, and a second account so isolation shows in the real database.

const scenario = parseScenario(JSON.parse(readFileSync(join(REPO_ROOT, 'scenarios', 'escuela', 'crm.json'), 'utf8')));
const account = (slug: string) => scenario.accounts.find((row) => row.slug === slug);

describe('D10 · scenarios/escuela/crm.json', () => {
  it("passes the format, and escuela-andamio is the agent's account", () => {
    expect(scenario.agentAccount).toBe('escuela-andamio');
    expect(scenario.accounts.map((row) => row.slug)).toEqual(['escuela-andamio', 'cuenta-vecina']);
  });

  it('has the six stages of F1, in their order', () => {
    const stages = [...(account('escuela-andamio')?.stages ?? [])].sort((a, b) => a.position - b.position);
    expect(stages.map((row) => row.key)).toEqual(['nueva', 'diagnostico', 'programa-propuesto', 'conversacion-agendada', 'inscrita', 'descartada']);
  });

  it('has four or five companies, each with sector, size and a revenue marked fictitious', () => {
    const companies = account('escuela-andamio')?.companies ?? [];
    expect(companies.length).toBeGreaterThanOrEqual(4);
    expect(companies.length).toBeLessThanOrEqual(5);
    for (const company of companies) {
      expect(company.industry, company.name).toBeDefined();
      expect(company.sizeRange, company.name).toBeDefined();
      expect(company.revenueRange, company.name).toContain(FICTITIOUS_MARK);
    }
  });

  it('gives the school contacts with notes and tasks, and the neighbour at least one contact', () => {
    const contacts = account('escuela-andamio')?.contacts ?? [];
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.some((row) => row.notes.length > 0)).toBe(true);
    expect(contacts.some((row) => row.tasks.length > 0)).toBe(true);
    expect(account('cuenta-vecina')?.contacts.length).toBeGreaterThanOrEqual(1);
  });
});
