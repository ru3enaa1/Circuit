import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CIRCUIT,
  decideRun,
  delimit,
  redact,
  startRun,
  type ContactSummary,
  type EventStore,
  type StationEvent,
} from '../../src/modules/circuit/index.ts';
import { createSimulator, parseSimulatorFile } from '../../src/modules/model/index.ts';
import { loadScenario } from '../../src/modules/scenario/index.ts';
import { MemoryStore, fakeCrm, sha256Digest, steppingClock } from '../support/fakes.ts';

/**
 * The golden cases (ADR-0010 D15): each one runs with the simulator, a clock that moves 10 ms
 * per reading and a store in memory, and its events are compared byte for byte with
 * events.json. golden.test.ts reads; only update.ts (`npm run golden:update`) writes.
 */

export const GOLDEN_DIR = fileURLToPath(new URL('.', import.meta.url));
export const SCENARIOS_DIR = fileURLToPath(new URL('../../../../scenarios/', import.meta.url));
/** The package the cases run against. A golden case is a fixture, so it names its scenario. */
export const GOLDEN_SCENARIO = 'escuela';
export const GOLDEN_CASES = ['normal', 'complaint', 'injection', 'low-confidence'] as const;
export type GoldenCase = (typeof GOLDEN_CASES)[number];
export const GOLDEN_MENTOR = 'mentor';

export interface GoldenInput {
  readonly text: string;
  /** What the CRM gives back for the request's email; null when it has no such contact. */
  readonly contact: ContactSummary | null;
  /** The mentor's decision, for a case that reaches station 6. */
  readonly decision: unknown;
  /** Strings that must never reach an event (D6). */
  readonly personal: readonly string[];
}

export function readInput(name: GoldenCase): GoldenInput {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, name, 'input.json'), 'utf8')) as GoldenInput;
}

export const eventsPath = (name: GoldenCase): string => join(GOLDEN_DIR, name, 'events.json');

/** The request as the model receives it, whose SHA-256 is the simulator's key. */
export function modelRequestOf(text: string): string {
  return delimit(redact(text).text);
}

/** Runs one case from intake to its end, deciding at station 6 when the case says so. */
export async function runCase(name: GoldenCase, store: EventStore = new MemoryStore()): Promise<readonly StationEvent[]> {
  const input = readInput(name);
  const scenario = loadScenario(SCENARIOS_DIR, GOLDEN_SCENARIO);
  const crm = fakeCrm(input.contact === null ? {} : { [emailOf(input.text)]: input.contact });
  const clock = steppingClock();
  const model = createSimulator(parseSimulatorFile(scenario.simulator));
  const deps = { definition: CIRCUIT, store, clock, digest: sha256Digest, model, crmReader: crm, documents: scenario.documents, scenario: scenario.id };
  const started = await startRun(deps, input.text);
  if (started.at === 'end' || input.decision === null) return started.events;
  const done = await decideRun({ definition: CIRCUIT, store, clock, writer: crm }, started.runId, input.decision, GOLDEN_MENTOR);
  return done.events;
}

function emailOf(text: string): string {
  const email = redact(text).email;
  if (email === null) throw new Error('Un caso con contacto necesita un correo en el texto.');
  return email;
}

/** Every object with its keys in code-point order, arrays kept as they are. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, inner]) => [key, canonical(inner)]));
}

/**
 * The file's exact content: keys in order, two-space JSON, LF and a final newline. The keys are
 * sorted because jsonb keeps them in its own order (shorter first), so the events read back from
 * PostgreSQL (D16) and the ones kept in memory only match byte for byte in a canonical form.
 */
export function serialize(events: readonly StationEvent[]): string {
  return `${JSON.stringify(canonical(events), null, 2)}\n`;
}
