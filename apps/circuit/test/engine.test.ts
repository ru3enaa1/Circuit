import { describe, expect, it } from 'vitest';

import { DELIMITER_CLOSE, DELIMITER_OPEN, LOW_CONFIDENCE_BELOW, startRun, type ModelPort } from '../src/modules/circuit/index.ts';
import {
  CLOCK_START_MS,
  CLOCK_STEP_MS,
  KNOWN_CONTACT,
  MemoryStore,
  NORMAL_REPLIES,
  NORMAL_TEXT,
  engineDeps,
  fakeCrm,
  scriptedModel,
  type ScriptedReplies,
} from './support/fakes.ts';

const classifyAs = (output: unknown): ScriptedReplies => ({ ...NORMAL_REPLIES, classify: output });
const stationsOf = (events: readonly { readonly station: string }[]): string[] => events.map((event) => event.station);
const NORMAL_UP_TO_PERSON = ['intake', 'filter', 'classification', 'knowledge', 'crm'];

describe('the engine walks the circuit by the table alone (ADR-0010 D1, D7)', () => {
  it('runs the normal route up to the person, one event per station, seq 1…n', async () => {
    const run = await startRun(engineDeps(), NORMAL_TEXT);

    expect(stationsOf(run.events)).toEqual(NORMAL_UP_TO_PERSON);
    expect(run.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(run.events.every((event) => event.status === 'completed' && event.runId === run.runId)).toBe(true);
    expect(run.at).toBe('person');
  });

  it.each([
    ['complaint', { intent: 'complaint', topic: null, urgency: 'high', confidence: 0.95 }, 'complaint'],
    ['out of scope', { intent: 'out_of_scope', topic: null, urgency: 'low', confidence: 0.9 }, 'out_of_scope'],
  ])('jumps from 3 to the person on a %s', async (_name, output, outcome) => {
    const model = scriptedModel(classifyAs(output));

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(stationsOf(run.events)).toEqual(['intake', 'filter', 'classification']);
    expect(run.events[2]?.outcome).toBe(outcome);
    expect(run.at).toBe('person');
    expect(model.calls.answer).toHaveLength(0);
    expect(model.calls.proposeCrm).toHaveLength(0);
  });

  // ADR-0010 A1 (2026-11-26): the redacted text is kept, in the filter event only; the raw text and
  // what was redacted out of it never are.
  it('stores the run with the SHA-256 of the raw text, and only the redacted text in the filter event', async () => {
    const store = new MemoryStore();

    await startRun(engineDeps({ store }), NORMAL_TEXT);

    expect(store.runs).toEqual([
      { scenario: 'prueba', inputSha256: expect.stringMatching(/^[0-9a-f]{64}$/), startedAt: '2026-11-26T09:00:00.000Z' },
    ]);
    const stored = JSON.stringify(store);
    expect(stored).not.toContain(NORMAL_TEXT);
    expect(stored).not.toContain('lucia@hiloverde.test');
    expect(stored).not.toContain('300 123 4567');
    const withText = store.stored.filter((event) => 'text' in event.detail).map((event) => event.station);
    expect(withText).toEqual(['filter']);
  });

  it('fails station 1 on a text it cannot take, and runs nothing after it', async () => {
    for (const text of ['   ', 'x'.repeat(4001), 'hola\u0000', 'hola\uD800']) {
      const model = scriptedModel(NORMAL_REPLIES);
      const run = await startRun(engineDeps({ model }), text);

      expect(stationsOf(run.events)).toEqual(['intake']);
      expect(run.events[0]).toMatchObject({ status: 'failed', outcome: 'error', detail: { reason: 'invalid', field: 'text' } });
      expect(run.at).toBe('end');
      expect(model.calls.classify).toHaveLength(0);
    }
  });
});

describe('a model reply cannot choose the route (ADR-0010 D2, ADR-0001 D1)', () => {
  it.each([
    ['nextStation', { nextStation: 'close' }],
    ['goto', { goto: 7 }],
    ['station', { station: 'person', outcome: 'approved' }],
  ])('ignores a field %s and walks the normal route', async (_name, extra) => {
    const model = scriptedModel({
      classify: { ...(NORMAL_REPLIES.classify as object), ...extra },
      answer: { ...(NORMAL_REPLIES.answer as object), ...extra },
      proposeCrm: { ...(NORMAL_REPLIES.proposeCrm as object), ...extra },
    });

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(stationsOf(run.events)).toEqual(NORMAL_UP_TO_PERSON);
    expect(JSON.stringify(run.events)).not.toContain('nextStation');
    expect(JSON.stringify(run.events)).not.toContain('goto');
  });

  it.each([
    ['confidence 1.5', { confidence: 1.5 }, 'confidence'],
    ['confidence NaN', { confidence: Number.NaN }, 'confidence'],
    ['confidence -0.1', { confidence: -0.1 }, 'confidence'],
    ['confidence as text', { confidence: '0.9' }, 'confidence'],
    ['an intent off the list', { intent: 'otra' }, 'intent'],
    ['an urgency off the list', { urgency: 'ya' }, 'urgency'],
    ['a topic with spaces', { topic: 'dos palabras' }, 'topic'],
  ])('fails station 3 on %s and runs nothing after it', async (_name, change, field) => {
    const model = scriptedModel(classifyAs({ ...(NORMAL_REPLIES.classify as object), ...change }));

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(stationsOf(run.events)).toEqual(['intake', 'filter', 'classification']);
    expect(run.events[2]).toMatchObject({ status: 'failed', outcome: 'error', detail: { reason: 'invalid', field } });
    expect(run.at).toBe('end');
    expect(model.calls.answer).toHaveLength(0);
  });

  it('fails station 3 on a reply that is not an object', async () => {
    for (const output of [null, 'ok', [1], 42]) {
      const run = await startRun(engineDeps({ model: scriptedModel(classifyAs(output)) }), NORMAL_TEXT);

      expect(run.events.at(-1)).toMatchObject({ station: 'classification', status: 'failed' });
    }
  });

  it('fails a station whose port throws, and keeps none of the error message', async () => {
    const throwing = scriptedModel({
      ...NORMAL_REPLIES,
      answer: () => {
        throw new Error('el modelo citó lucia@hiloverde.test');
      },
    });

    const run = await startRun(engineDeps({ model: throwing }), NORMAL_TEXT);

    expect(run.events.at(-1)).toMatchObject({ station: 'knowledge', status: 'failed', detail: { reason: 'port_error' } });
    expect(JSON.stringify(run.events)).not.toContain('lucia');
  });
});

describe('a low confidence goes to the person (ADR-0010 D3, rule 3)', () => {
  it('names the threshold 0.7', () => {
    expect(LOW_CONFIDENCE_BELOW).toBe(0.7);
  });

  it.each([
    [0.69, 'low_confidence', ['intake', 'filter', 'classification']],
    [0, 'low_confidence', ['intake', 'filter', 'classification']],
    [0.7, 'ok', NORMAL_UP_TO_PERSON],
    [1, 'ok', NORMAL_UP_TO_PERSON],
  ])('with confidence %s the outcome is %s', async (confidence, outcome, stations) => {
    const model = scriptedModel(classifyAs({ ...(NORMAL_REPLIES.classify as object), confidence }));

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(run.events[2]?.outcome).toBe(outcome);
    expect(stationsOf(run.events)).toEqual(stations);
    expect(run.at).toBe('person');
  });
});

describe('the model receives the request delimited and redacted (ADR-0010 D4)', () => {
  it('sends every model port the same delimited text, without the email or the phone', async () => {
    const model = scriptedModel(NORMAL_REPLIES);

    await startRun(engineDeps({ model }), NORMAL_TEXT);

    const sent = [...model.calls.classify, ...model.calls.answer, ...model.calls.proposeCrm.map((call) => call.request)];
    expect(sent).toHaveLength(3);
    for (const request of sent) {
      expect(request.startsWith(`${DELIMITER_OPEN}\n`)).toBe(true);
      expect(request.endsWith(`\n${DELIMITER_CLOSE}`)).toBe(true);
      expect(request).not.toContain('lucia@hiloverde.test');
      expect(request).not.toContain('4567');
      expect(request).toContain('Cada pedido grande');
    }
  });

  it('tells station 5 the contact it found, but never the email', async () => {
    const model = scriptedModel(NORMAL_REPLIES);

    await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(model.calls.proposeCrm[0]?.context).toEqual({ contact: KNOWN_CONTACT, topic: 'radiografia' });
    expect(JSON.stringify(model.calls.proposeCrm)).not.toContain('@');
  });
});

describe('each event is stored before the next station runs (ADR-0010 D8)', () => {
  it('stops at a store that fails on the third event: no port is called after it', async () => {
    const store = new MemoryStore();
    store.failOnAppend = 3;
    const model = scriptedModel(NORMAL_REPLIES);
    const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });

    await expect(startRun(engineDeps({ store, model, crmReader: crm }), NORMAL_TEXT)).rejects.toThrow('almacén caído');

    expect(stationsOf(store.stored)).toEqual(['intake', 'filter']);
    expect(model.calls.classify).toHaveLength(1);
    expect(model.calls.answer).toHaveLength(0);
    expect(model.calls.proposeCrm).toHaveLength(0);
    expect(crm.lookups).toHaveLength(0);
  });

  it('has each event in the store by the time the next station is called', async () => {
    const store = new MemoryStore();
    const seen: number[] = [];
    const base = scriptedModel(NORMAL_REPLIES);
    const watching: ModelPort = {
      name: base.name,
      classify: async (request) => (seen.push(store.stored.length), base.classify(request)),
      answer: async (request, documents) => (seen.push(store.stored.length), base.answer(request, documents)),
      proposeCrm: async (request, context) => (seen.push(store.stored.length), base.proposeCrm(request, context)),
    };

    await startRun(engineDeps({ store, model: watching }), NORMAL_TEXT);

    expect(seen).toEqual([2, 3, 4]);
  });
});

describe('the measures are whole numbers (ADR-0010 D9)', () => {
  it('times each station with the Clock port and gives code stations 0 and the simulator null', async () => {
    const run = await startRun(engineDeps(), NORMAL_TEXT);

    // createRun reads the clock once, then each station reads it twice.
    run.events.forEach((event, index) => {
      expect(event.startedAt).toBe(new Date(CLOCK_START_MS + CLOCK_STEP_MS * (1 + 2 * index)).toISOString());
      expect(event.durationMs).toBe(CLOCK_STEP_MS);
    });
    const [intake, filter, ...modelStations] = run.events;
    for (const event of [intake, filter]) {
      expect(event).toMatchObject({ tokensIn: 0, tokensOut: 0, costMicroUsd: 0, model: 'code' });
    }
    for (const event of modelStations) {
      expect(event).toMatchObject({ tokensIn: null, tokensOut: null, costMicroUsd: null, model: 'fake-model' });
    }
  });

  it('never stores a negative duration, even with a clock that goes back', async () => {
    let now = CLOCK_START_MS;
    const backwards = { now: () => (now -= CLOCK_STEP_MS) };

    const run = await startRun(engineDeps({ clock: backwards }), NORMAL_TEXT);

    expect(run.events.every((event) => event.durationMs === 0)).toBe(true);
  });

  it.each([
    ['a negative token count', { tokensIn: -1, tokensOut: 0, costMicroUsd: 0 }],
    ['a decimal cost', { tokensIn: 1, tokensOut: 1, costMicroUsd: 0.5 }],
    ['an unsafe integer', { tokensIn: 2 ** 53, tokensOut: 1, costMicroUsd: 1 }],
  ])('fails a model station whose adapter reports %s', async (_name, usage) => {
    const base = scriptedModel(NORMAL_REPLIES);
    const model: ModelPort = { ...base, classify: async (request) => ({ ...(await base.classify(request)), usage }) };

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(run.events.at(-1)).toMatchObject({ station: 'classification', status: 'failed', detail: { field: 'usage' } });
  });
});

describe('station 5 only reads the CRM and proposes from a closed list (ADR-0010 D14)', () => {
  it('looks the contact up by the email station 2 took out, and stores the proposal', async () => {
    const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });

    const run = await startRun(engineDeps({ crmReader: crm }), NORMAL_TEXT);

    expect(crm.lookups).toEqual(['lucia@hiloverde.test']);
    expect(crm.writes).toHaveLength(0);
    expect(run.events[4]?.detail).toEqual({
      contactId: KNOWN_CONTACT.id,
      actions: [
        { type: 'add_note', body: 'Pide ayuda para ordenar sus procesos.' },
        { type: 'move_stage', stage: 'programa-propuesto' },
      ],
    });
  });

  it.each([
    ['delete_contact', [{ type: 'delete_contact' }], 'actions[0].type'],
    ['export', [{ type: 'export' }], 'actions[0].type'],
    ['a note of 4001 characters', [{ type: 'add_note', body: 'x'.repeat(4001) }], 'actions[0].body'],
    ['a task due on year 0000', [{ type: 'create_task', title: 'Llamar', dueOn: '0000-01-01' }], 'actions[0].dueOn'],
    ['a task due on 2026-02-29', [{ type: 'create_task', title: 'Llamar', dueOn: '2026-02-29' }], 'actions[0].dueOn'],
    ['a stage with capitals', [{ type: 'move_stage', stage: 'Inscrita' }], 'actions[0].stage'],
    ['a create_contact for a contact that exists', [{ type: 'create_contact', fullName: 'Otra' }], 'actions[0].type'],
    ['six actions', Array.from({ length: 6 }, () => ({ type: 'add_note', body: 'x' })), 'actions'],
    ['no list', 'add_note', 'actions'],
  ])('fails station 5 on %s', async (_name, actions, field) => {
    const crm = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
    const model = scriptedModel({ ...NORMAL_REPLIES, proposeCrm: { actions } });

    const run = await startRun(engineDeps({ model, crmReader: crm }), NORMAL_TEXT);

    expect(run.events.at(-1)).toMatchObject({ station: 'crm', status: 'failed', detail: { reason: 'invalid', field } });
    expect(run.at).toBe('end');
    expect(crm.writes).toHaveLength(0);
  });

  it('lets a new contact be created first, with the email station 2 took and not one the model wrote', async () => {
    const crm = fakeCrm();
    const model = scriptedModel({
      ...NORMAL_REPLIES,
      proposeCrm: { actions: [{ type: 'create_contact', fullName: 'Lucía Restrepo', email: 'otro@x.test' }, { type: 'add_note', body: 'Nueva.' }] },
    });

    const run = await startRun(engineDeps({ model, crmReader: crm }), NORMAL_TEXT);

    expect(run.events[4]?.detail).toEqual({
      contactId: null,
      actions: [
        { type: 'create_contact', fullName: 'Lucía Restrepo', email: 'lucia@hiloverde.test' },
        { type: 'add_note', body: 'Nueva.' },
      ],
    });
  });

  // Audit of ADR-0010, H3: an email the stored proposal could not be read back with would leave
  // the run at station 6 for good, so station 5 refuses it before anything is stored.
  it('fails station 5 on a create_contact whose email is longer than the CRM takes', async () => {
    const longEmail = `${'a'.repeat(300)}@hiloverde.test`;
    const model = scriptedModel({ ...NORMAL_REPLIES, proposeCrm: { actions: [{ type: 'create_contact', fullName: 'Lucía Restrepo' }] } });

    const run = await startRun(engineDeps({ model, crmReader: fakeCrm() }), `Escribo desde ${longEmail}. ${NORMAL_TEXT}`);

    expect(run.events.at(-1)).toMatchObject({ station: 'crm', status: 'failed', detail: { reason: 'invalid', field: 'actions[0].email' } });
    expect(run.at).toBe('end');
    expect(JSON.stringify(run.events)).not.toContain(longEmail);
  });

  it('refuses an action on no contact at all: without an email, nothing can be created or noted', async () => {
    const model = scriptedModel({ ...NORMAL_REPLIES, proposeCrm: { actions: [{ type: 'add_note', body: 'Sin contacto.' }] } });

    const run = await startRun(engineDeps({ model }), 'Cada pedido grande pasa por mí y no sé en qué se me va la semana.');

    expect(run.events.at(-1)).toMatchObject({ station: 'crm', status: 'failed', detail: { field: 'actions[0].type' } });
  });

  it('accepts an empty proposal', async () => {
    const model = scriptedModel({ ...NORMAL_REPLIES, proposeCrm: { actions: [] } });

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(run.events[4]).toMatchObject({ status: 'completed', detail: { actions: [] } });
  });
});
