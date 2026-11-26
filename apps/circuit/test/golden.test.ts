import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSimulator, parseSimulatorFile, requestSha256 } from '../src/modules/model/index.ts';
import { loadScenario } from '../src/modules/scenario/index.ts';
import { eventsPath, GOLDEN_CASES, GOLDEN_SCENARIO, modelRequestOf, readInput, runCase, SCENARIOS_DIR, serialize, type GoldenCase } from './golden/harness.ts';

// ADR-0010 D15: the four golden cases, byte for byte against events.json. This file only reads:
// `npm run golden:update` (golden/update.ts) is the only thing that rewrites the files.

/** Written here, not read from events.json, so a file rewritten with a wrong route still fails. */
const EXPECTED_ROUTES: Readonly<Record<GoldenCase, readonly string[]>> = {
  normal: ['intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close'],
  complaint: ['intake', 'filter', 'classification', 'person', 'close'],
  injection: ['intake', 'filter'],
  'low-confidence': ['intake', 'filter', 'classification', 'person', 'close'],
};

const EXPECTED_ENDINGS: Readonly<Record<GoldenCase, readonly [string, string]>> = {
  normal: ['done', 'completed'],
  complaint: ['done', 'completed'],
  injection: ['injection', 'stopped'],
  'low-confidence': ['done', 'completed'],
};

function stored(name: GoldenCase): string {
  const text = readFileSync(eventsPath(name), 'utf8');
  // An empty or missing file is a failure, never a pass with nothing to compare.
  expect(text.length, `${name}/events.json está vacío`).toBeGreaterThan(2);
  return text;
}

describe.each(GOLDEN_CASES)('golden case %s (ADR-0010 D15)', (name) => {
  it('gives events.json byte for byte, twice in the same process', async () => {
    const first = serialize(await runCase(name));
    const second = serialize(await runCase(name));

    expect(first).toBe(stored(name));
    expect(second).toBe(first);
  });

  it('walks the route written here, and ends where it should', async () => {
    const events = await runCase(name);

    expect(events.map((event) => event.station)).toEqual(EXPECTED_ROUTES[name]);
    expect([events.at(-1)?.outcome, events.at(-1)?.status]).toEqual(EXPECTED_ENDINGS[name]);
  });

  it('keeps every personal string of its input out of the events (D6)', () => {
    const text = stored(name);
    const { personal } = readInput(name);

    expect(personal.length).toBeGreaterThan(0);
    for (const value of personal) expect(text, value).not.toContain(value);
  });

  it('has its own reply in the simulator, unless the filter stops it first', () => {
    const scenario = loadScenario(SCENARIOS_DIR, GOLDEN_SCENARIO);
    const keys = parseSimulatorFile(scenario.simulator).map((entry) => entry.requestSha256);
    const key = requestSha256(modelRequestOf(readInput(name).text));

    // A change to how station 2 redacts changes the key; this says so instead of a silent default reply.
    expect(keys.includes(key), `${name}: simulator.json no tiene la clave de su solicitud`).toBe(name !== 'injection');
  });
});

describe('the simulator is deterministic (ADR-0010 D12)', () => {
  it('gives the same reply to the same request a hundred times', async () => {
    const scenario = loadScenario(SCENARIOS_DIR, GOLDEN_SCENARIO);
    const model = createSimulator(parseSimulatorFile(scenario.simulator));
    const request = modelRequestOf(readInput('normal').text);

    const replies = await Promise.all(Array.from({ length: 100 }, () => model.classify(request)));

    expect(new Set(replies.map((reply) => JSON.stringify(reply))).size).toBe(1);
  });
});
