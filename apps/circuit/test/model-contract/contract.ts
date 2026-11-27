import { describe, expect, it } from 'vitest';

import {
  CIRCUIT,
  delimit,
  redact,
  startRun,
  type CrmContext,
  type ModelPort,
  type ModelReply,
  type SourceDocument,
  type StationEvent,
} from '../../src/modules/circuit/index.ts';
import { fakeCrm, MemoryStore, sha256Digest, steppingClock } from '../support/fakes.ts';
import type { ContractCase, ModelStation } from './cases.ts';

/**
 * The model contract (ADR-0015, F3.1): what any ModelPort must do for the core to use it. The
 * simulator runs it today; the Anthropic adapter, over a fake transport, and the replay of
 * recorded runs will run the same function. It does not judge how well a model classifies:
 * only that the core can use what it gives back.
 */

/** circuit.station_events.model accepts 1 to 80 characters (migration 0005). */
export const MODEL_NAME_MAX_LENGTH = 80;

type Method = 'classify' | 'answer' | 'proposeCrm';

interface Call {
  readonly method: Method;
  readonly request: string;
  readonly documents?: readonly SourceDocument[];
  readonly context?: CrmContext;
  readonly reply: ModelReply;
}

/** Freezes a value and everything inside it, so a write by the model throws (K4). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** The model as the engine sees it, frozen inputs in, every reply kept. */
function watched(model: ModelPort, calls: Call[]): ModelPort {
  return {
    name: model.name,
    async classify(request) {
      const reply = await model.classify(request);
      calls.push({ method: 'classify', request, reply });
      return reply;
    },
    async answer(request, documents) {
      const reply = await model.answer(request, deepFreeze(documents));
      calls.push({ method: 'answer', request, documents, reply });
      return reply;
    },
    async proposeCrm(request, context) {
      const reply = await model.proposeCrm(request, deepFreeze(context));
      calls.push({ method: 'proposeCrm', request, context, reply });
      return reply;
    },
  };
}

interface Walk {
  readonly events: readonly StationEvent[];
  readonly calls: readonly Call[];
}

async function walk(model: ModelPort, testCase: ContractCase, documents: readonly SourceDocument[]): Promise<Walk> {
  const calls: Call[] = [];
  const crmReader = fakeCrm(Object.fromEntries(Object.entries(testCase.contacts).map(([email, contact]) => [email, deepFreeze({ ...contact })])));
  const deps = {
    definition: CIRCUIT,
    store: new MemoryStore(),
    clock: steppingClock(),
    digest: sha256Digest,
    model: watched(model, calls),
    crmReader,
    documents: deepFreeze(documents),
    scenario: 'contrato',
  };
  const { events } = await startRun(deps, testCase.text);
  return { events, calls };
}

const isMeasure = (value: unknown): boolean => value === null || (Number.isSafeInteger(value) && (value as number) >= 0);

/** Calls the same method again with what the engine sent the first time. */
function again(model: ModelPort, call: Call): Promise<ModelReply> {
  if (call.method === 'classify') return model.classify(call.request);
  if (call.method === 'answer') return model.answer(call.request, call.documents ?? []);
  return model.proposeCrm(call.request, call.context ?? { contact: null, topic: null });
}

/** Writes into a reply's output, the way a careless caller would. */
function scribble(output: unknown): void {
  if (Array.isArray(output)) output.push('garabato');
  else if (typeof output === 'object' && output !== null) (output as Record<string, unknown>)['garabato'] = true;
}

const MODEL_STATIONS: readonly ModelStation[] = ['classification', 'knowledge', 'crm'];

export function describeModelContract(
  label: string,
  make: () => ModelPort | Promise<ModelPort>,
  cases: readonly ContractCase[],
  documents: () => readonly SourceDocument[],
): void {
  describe(`model contract · ${label} (ADR-0015)`, () => {
    it('K1 · has a name the event table can store, the same on every call', async () => {
      const model = await make();
      const before = model.name;
      expect(typeof before).toBe('string');
      expect(before.length).toBeGreaterThanOrEqual(1);
      expect(before.length).toBeLessThanOrEqual(MODEL_NAME_MAX_LENGTH);
      for (const testCase of cases) await walk(model, testCase, documents());
      expect(model.name).toBe(before);
    });

    it('has at least one case, and every case is one the engine can start', () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    describe.each(cases.map((testCase) => [testCase.id, testCase] as const))('case %s', (_id, testCase) => {
      it('K3 · walks the expected route with no failed event, and each model station gives its outcome', async () => {
        const { events } = await walk(await make(), testCase, documents());

        expect(events.map((event) => event.station)).toEqual(testCase.route);
        expect(events.filter((event) => event.status === 'failed').map((event) => [event.station, event.detail])).toEqual([]);
        for (const station of MODEL_STATIONS) {
          const event = events.find((candidate) => candidate.station === station);
          expect(event?.outcome, station).toBe(testCase.outcomes[station]);
        }
      });

      it('K2 · gives every measure as null or a whole number, never negative', async () => {
        const { calls } = await walk(await make(), testCase, documents());

        for (const { method, reply } of calls) {
          const { tokensIn, tokensOut, costMicroUsd } = reply.usage;
          expect([tokensIn, tokensOut, costMicroUsd].every(isMeasure), `${method}: ${JSON.stringify(reply.usage)}`).toBe(true);
        }
      });

      it('K5 and K6 · gives a fresh, equal reply when asked the same again', async () => {
        const model = await make();
        const { calls } = await walk(model, testCase, documents());

        for (const call of calls) {
          const pristine = JSON.stringify(call.reply.output);
          scribble(call.reply.output);
          const second = await again(model, call);
          expect(JSON.stringify(second.output), call.method).toBe(pristine);
        }
      });
    });

    it('K4 · works with its inputs frozen, and receives each request only delimited and redacted (ADR-0010 D4)', async () => {
      const model = await make();
      for (const testCase of cases) {
        const { calls } = await walk(model, testCase, documents());
        const expected = delimit(redact(testCase.text).text);
        for (const call of calls) expect(call.request, `${testCase.id} · ${call.method}`).toBe(expected);
      }
    });
  });
}
