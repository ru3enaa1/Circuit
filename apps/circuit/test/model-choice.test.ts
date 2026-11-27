import { describe, expect, it } from 'vitest';

import { CircuitStartupError, modelFor, type ModelInputs } from '../src/main.ts';
import { ANTHROPIC_MODEL, SIMULATOR_NAME } from '../src/modules/model/index.ts';
import { FAKE_API_KEY, fakeAnthropic } from './support/fake-anthropic.ts';
import { DOCUMENTS } from './support/fakes.ts';

// ADR-0015: CIRCUIT_MODEL chooses the model, and turning the real one on is configuration, not
// code. Over the fake transport only (A1): the adapter talks to the fetch it is given (K8).

const INPUTS: ModelInputs = { replies: [], documents: DOCUMENTS, stages: ['nueva', 'diagnostico'] };
const REQUEST = '<solicitud>\nHola.\n</solicitud>';
const notCalled = (() => {
  throw new Error('El simulador no debía usar la red.');
}) as unknown as typeof globalThis.fetch;

describe('modelFor (ADR-0015)', () => {
  it('(control) the simulator, by default, never touches the fetch', async () => {
    const model = modelFor({ model: 'simulator', anthropicApiKey: null }, INPUTS, notCalled);

    expect(model.name).toBe(SIMULATOR_NAME);
    await expect(model.classify(REQUEST)).resolves.toMatchObject({ usage: { tokensIn: null } });
  });

  it('anthropic: the adapter, with the scenario documents as topics and its stages, over the given fetch', async () => {
    const transport = fakeAnthropic([{ text: JSON.stringify({ intent: 'request', topic: 'radiografia', urgency: 'low', confidence: 0.9 }) }]);
    const model = modelFor({ model: 'anthropic', anthropicApiKey: FAKE_API_KEY }, INPUTS, transport.fetch);

    expect(model.name).toBe(ANTHROPIC_MODEL);
    await model.classify(REQUEST);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.headers.get('authorization')).toBe(`Bearer ${FAKE_API_KEY}`);
    const schema = (transport.sent[0]!.body['output_config'] as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    expect(schema.properties['topic']).toEqual({ anyOf: [{ type: 'string', enum: ['radiografia'] }, { type: 'null' }] });
  });

  it('anthropic with no key, or a scenario stage out of shape, stops the start-up with a message safe to print', () => {
    expect(() => modelFor({ model: 'anthropic', anthropicApiKey: null }, INPUTS, notCalled)).toThrow(CircuitStartupError);
    const badStage = () => modelFor({ model: 'anthropic', anthropicApiKey: FAKE_API_KEY }, { ...INPUTS, stages: ['Mala Etapa'] }, notCalled);
    expect(badStage).toThrow(CircuitStartupError);
    expect(badStage).not.toThrow(/Mala Etapa|clave-de-prueba/);
  });
});
