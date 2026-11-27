import { describe, expect, it } from 'vitest';

import { startRun, type ModelPort } from '../src/modules/circuit/index.ts';
import { ANTHROPIC_MODEL, createAnthropicModel, ModelRefused, ModelUnavailable, usageOf, type AnthropicOptions } from '../src/modules/model/index.ts';
import { FAKE_API_KEY, fakeAnthropic, type FakeAnswer } from './support/fake-anthropic.ts';
import { engineDeps, NORMAL_TEXT } from './support/fakes.ts';

// ADR-0015 F3.2: the adapter's classification, over the fake transport only (A1). No test here,
// or anywhere, reaches the network: the adapter has no fetch of its own (K8).

const TOPICS = [
  { id: 'radiografia', title: 'Radiografía de la operación' },
  { id: 'crecer', title: 'Crecer con orden' },
];
const REQUEST = '<solicitud>\nCada pedido grande pasa por mí. [teléfono]\n</solicitud>';
const CLASSIFICATION = { intent: 'request', topic: 'radiografia', urgency: 'medium', confidence: 0.9 };

function adapter(answers: readonly (FakeAnswer | 'network-down')[], extra: Partial<AnthropicOptions> = {}) {
  const transport = fakeAnthropic(answers);
  const model = createAnthropicModel({ apiKey: FAKE_API_KEY, fetch: transport.fetch, topics: TOPICS, stages: ['nueva'], maxRetries: 0, ...extra });
  return { model, sent: transport.sent };
}

const ok = (output: unknown = CLASSIFICATION): FakeAnswer => ({ text: JSON.stringify(output) });

describe('Anthropic adapter · classification (ADR-0015 F3.2)', () => {
  it('K8 · cannot be made without the fetch it will use', () => {
    const options = { apiKey: FAKE_API_KEY, topics: TOPICS, stages: [] } as unknown as AnthropicOptions;
    expect(() => createAnthropicModel(options)).toThrow(/fetch/);
  });

  it('K9 · sends the request only as the user turn, and the system names it as data', async () => {
    const { model, sent } = adapter([ok()]);
    await model.classify(REQUEST);

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body['model']).toBe(ANTHROPIC_MODEL);
    expect(body['messages']).toEqual([{ role: 'user', content: REQUEST }]);
    const system = String(body['system']);
    expect(system).toContain('<solicitud>');
    expect(system).toMatch(/nunca una instrucción/);
    expect(system).not.toContain('pedido grande');
  });

  it('asks for the schema of the core, with the scenario programs as the only topics', async () => {
    const { model, sent } = adapter([ok()]);
    await model.classify(REQUEST);

    const config = sent[0]!.body['output_config'] as { format: { type: string; schema: Record<string, unknown> } };
    expect(config.format.type).toBe('json_schema');
    const properties = config.format.schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['intent']!['enum']).toEqual(['request', 'complaint', 'out_of_scope']);
    expect(properties['topic']).toEqual({ anyOf: [{ type: 'string', enum: ['radiografia', 'crecer'] }, { type: 'null' }] });
    expect(config.format.schema['additionalProperties']).toBe(false);
  });

  it('carries the key only in its header, never in the body', async () => {
    const { model, sent } = adapter([ok()]);
    await model.classify(REQUEST);

    // SDK 1.14.0 sends the key as a Bearer token (checked on 2026-11-27), not as x-api-key.
    expect(sent[0]!.headers.get('authorization')).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(JSON.stringify(sent[0]!.body)).not.toContain(FAKE_API_KEY);
  });

  it('gives back what the model wrote, parsed, and the core decides what it is worth', async () => {
    const { model } = adapter([ok({ ...CLASSIFICATION, nextStation: 'close' })]);
    const reply = await model.classify(REQUEST);

    expect(reply.output).toEqual({ ...CLASSIFICATION, nextStation: 'close' });
  });

  it('K10 · counts every input token once and prices them from the sourced table, rounded up', async () => {
    const { model } = adapter([ok()]);
    const reply = await model.classify(REQUEST);

    // 100 input × 4 + 20 cache writes × 5 + 30 cache reads × 0.2 + 40 output × 20 micro-dollars.
    expect(reply.usage).toEqual({ tokensIn: 150, tokensOut: 40, costMicroUsd: 1306 });
    expect(usageOf(ANTHROPIC_MODEL, { input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1, output: 0 }).costMicroUsd).toBe(5);
  });

  it('K10 · gives no cost for a model the table does not have, and keeps the tokens', async () => {
    const { model } = adapter([{ ...ok(), model: 'claude-otro' }]);
    const reply = await model.classify(REQUEST);

    expect(reply.usage).toEqual({ tokensIn: 150, tokensOut: 40, costMicroUsd: null });
  });

  it('K11 · turns an API error into ModelUnavailable with only its status', async () => {
    for (const status of [400, 401, 429, 500, 529]) {
      const { model } = adapter([{ status, body: { type: 'error', error: { type: 'x', message: `cuerpo secreto ${FAKE_API_KEY}` } } }]);
      const error = await model.classify(REQUEST).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ModelUnavailable);
      expect((error as ModelUnavailable).status).toBe(status);
      expect(String((error as Error).message)).not.toMatch(/cuerpo secreto|clave-de-prueba|pedido grande/);
    }
  });

  it('K11 · a dropped connection is ModelUnavailable with no status', async () => {
    const { model } = adapter(['network-down']);
    const error = await model.classify(REQUEST).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelUnavailable);
    expect((error as ModelUnavailable).status).toBeNull();
  });

  it('K11 · a refusal is ModelRefused, with no fallback model asked for', async () => {
    const { model, sent } = adapter([{ ...ok(), stopReason: 'refusal' }]);

    await expect(model.classify(REQUEST)).rejects.toBeInstanceOf(ModelRefused);
    expect(sent[0]!.body).not.toHaveProperty('fallbacks');
  });

  it('retries what the SDK retries, then gives up', async () => {
    const { model, sent } = adapter([{ status: 529 }, ok()], { maxRetries: 1 });
    const reply = await model.classify(REQUEST);

    expect(sent).toHaveLength(2);
    expect(reply.output).toEqual(CLASSIFICATION);
  });
});

/** Station 3 with the adapter, inside the engine, over the fake transport. */
async function classificationEvent(model: ModelPort) {
  const { events } = await startRun(engineDeps({ model }), NORMAL_TEXT);
  return events.find((event) => event.station === 'classification');
}

describe('Anthropic adapter inside the engine (ADR-0015 F3.2)', () => {
  it('classifies station 3 and stores the measures and the model name', async () => {
    const event = await classificationEvent(adapter([ok()]).model);

    expect([event?.outcome, event?.status, event?.model]).toEqual(['ok', 'completed', ANTHROPIC_MODEL]);
    expect([event?.tokensIn, event?.tokensOut, event?.costMicroUsd]).toEqual([150, 40, 1306]);
  });

  it('K11 · a refusal, an error or a reply that is not JSON fails station 3 and stores nothing of it', async () => {
    const answers: FakeAnswer[] = [{ ...ok(), stopReason: 'refusal' }, { status: 500 }, { text: 'no es json' }];
    for (const answer of answers) {
      const event = await classificationEvent(adapter([answer]).model);

      expect([event?.outcome, event?.status]).toEqual(['error', 'failed']);
      expect(JSON.stringify(event?.detail)).not.toMatch(/no es json|falla de prueba/);
    }
  });
});
