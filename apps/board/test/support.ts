import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CIRCUIT, LOW_CONFIDENCE_BELOW } from '../../circuit/src/modules/circuit/index.ts';
import { SIMULATOR_NAME } from '../../circuit/src/modules/model/index.ts';
import { loadScenario, loadTryouts } from '../../circuit/src/modules/scenario/index.ts';
import { circuitPayload } from '../../circuit/src/server/api.ts';
import type { CircuitInfo, RunEvent } from '../src/api.ts';

/**
 * What the board's tests read: the table as GET /api/circuit sends it, built by circuit's own
 * code, and the golden cases of ADR-0010, read from their events.json. The board's source never
 * imports circuit; only its tests do, so a change on either side shows up here.
 */

const GOLDEN_DIR = fileURLToPath(new URL('../../circuit/test/golden/', import.meta.url));
const SCENARIOS_DIR = fileURLToPath(new URL('../../../scenarios/', import.meta.url));

export const GOLDEN_CASES = ['normal', 'complaint', 'injection', 'low-confidence'] as const;
export type GoldenCase = (typeof GOLDEN_CASES)[number];

export function boardInfo(): CircuitInfo {
  const scenario = loadScenario(SCENARIOS_DIR, 'escuela');
  const payload = circuitPayload({
    definition: CIRCUIT,
    scenario: scenario.id,
    model: SIMULATOR_NAME,
    lowConfidenceBelow: LOW_CONFIDENCE_BELOW,
    documents: scenario.documents,
    samples: loadTryouts(SCENARIOS_DIR, 'escuela').samples,
    mentor: 'mentor',
  });
  // Through JSON, as the browser receives it.
  return JSON.parse(JSON.stringify(payload)) as CircuitInfo;
}

export function goldenEvents(name: GoldenCase): readonly RunEvent[] {
  return JSON.parse(readFileSync(`${GOLDEN_DIR}${name}/events.json`, 'utf8')) as RunEvent[];
}

export function goldenPersonal(name: GoldenCase): readonly string[] {
  return (JSON.parse(readFileSync(`${GOLDEN_DIR}${name}/input.json`, 'utf8')) as { personal: string[] }).personal;
}

/** Every prefix of a list, the empty one included: each frame the reveal can show. */
export function prefixes<T>(list: readonly T[]): readonly (readonly T[])[] {
  return Array.from({ length: list.length + 1 }, (_, length) => list.slice(0, length));
}

/** A status per station as one letter, in the table's order, so the expected views stay readable. */
export const LETTERS: Readonly<Record<string, string>> = {
  completed: 'c',
  stopped: 's',
  failed: 'f',
  waiting: 'w',
  skipped: 'k',
  pending: 'p',
};
