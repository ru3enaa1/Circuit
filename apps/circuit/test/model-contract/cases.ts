import { redact, type ContactSummary, type Outcome, type StationId } from '../../src/modules/circuit/index.ts';
import { loadScenario, loadTryouts, type ScenarioPackage } from '../../src/modules/scenario/index.ts';
import { GOLDEN_SCENARIO, readInput, SCENARIOS_DIR, type GoldenCase } from '../golden/harness.ts';

/**
 * The cases the model contract runs (ADR-0015 K3): every sample of the scenario's samples.json,
 * the same requests «Probar una solicitud» offers and `npm run model:record` will record.
 */

/** The three stations a model works on (ADR-0001 D3). */
export type ModelStation = Extract<StationId, 'classification' | 'knowledge' | 'crm'>;

export interface ContractCase {
  readonly id: string;
  /** The raw text, as a person sends it. */
  readonly text: string;
  /** What the CRM gives back for each email. */
  readonly contacts: Readonly<Record<string, ContactSummary>>;
  /** The stations the engine visits until the run ends or waits for a person, in order. */
  readonly route: readonly StationId[];
  /** The outcome each model station on the route must give. */
  readonly outcomes: Readonly<Partial<Record<ModelStation, Outcome>>>;
}

export interface Expectation {
  readonly route: readonly StationId[];
  readonly outcomes: Readonly<Partial<Record<ModelStation, Outcome>>>;
}

/**
 * Written here, not read from the replies, so a reply that sends a request down another route
 * fails. A sample with no line here fails too: a new sample needs its expectation.
 */
export const SCENARIO_EXPECTATIONS: Readonly<Record<string, Expectation>> = {
  normal: {
    route: ['intake', 'filter', 'classification', 'knowledge', 'crm'],
    outcomes: { classification: 'ok', knowledge: 'ok', crm: 'ok' },
  },
  complaint: { route: ['intake', 'filter', 'classification'], outcomes: { classification: 'complaint' } },
  injection: { route: ['intake', 'filter'], outcomes: {} },
  'low-confidence': { route: ['intake', 'filter', 'classification'], outcomes: { classification: 'low_confidence' } },
};

export function contractScenario(): ScenarioPackage {
  return loadScenario(SCENARIOS_DIR, GOLDEN_SCENARIO);
}

/** The contact a golden case with the sample's id gives the CRM, keyed by the text's email. */
function contactsOf(id: string, text: string): Readonly<Record<string, ContactSummary>> {
  let contact: ContactSummary | null;
  try {
    contact = readInput(id as GoldenCase).contact;
  } catch {
    // No golden case with that id: the CRM has nobody for it.
    return {};
  }
  const email = redact(text).email;
  return contact === null || email === null ? {} : { [email]: contact };
}

export function scenarioCases(): readonly ContractCase[] {
  return loadTryouts(SCENARIOS_DIR, GOLDEN_SCENARIO).samples.map((sample) => {
    const expectation = SCENARIO_EXPECTATIONS[sample.id];
    if (expectation === undefined) throw new Error(`La muestra «${sample.id}» no tiene su ruta esperada en SCENARIO_EXPECTATIONS.`);
    return { id: sample.id, text: sample.text, contacts: contactsOf(sample.id, sample.text), ...expectation };
  });
}
