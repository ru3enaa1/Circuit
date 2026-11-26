import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readModelChoice } from '../src/config.ts';
import { delimit } from '../src/modules/circuit/index.ts';
import { createSimulator, DEFAULT_REPLIES, InvalidSimulatorFile, parseSimulatorFile, requestSha256, SIMULATOR_NAME } from '../src/modules/model/index.ts';
import { InvalidScenario, loadScenario } from '../src/modules/scenario/index.ts';

// ADR-0010 D12: the simulator answers from the scenario's file, by the SHA-256 of the request.
const REQUEST = delimit('Una solicitud conocida.');
const KNOWN = [{ case: 'conocida', requestSha256: requestSha256(REQUEST), classify: { intent: 'request', topic: null, urgency: 'low', confidence: 0.8 } }];

describe('the simulator (ADR-0010 D12)', () => {
  it('answers a known request from its file, with no usage numbers', async () => {
    const model = createSimulator(parseSimulatorFile({ replies: KNOWN }));

    expect(model.name).toBe(SIMULATOR_NAME);
    expect(await model.classify(REQUEST)).toEqual({
      output: KNOWN[0]?.classify,
      usage: { tokensIn: null, tokensOut: null, costMicroUsd: null },
    });
  });

  it('gives an unknown request the default replies: out of scope with no confidence, no source, no actions', async () => {
    const model = createSimulator(parseSimulatorFile({ replies: KNOWN }));
    const other = delimit('Otra cosa.');

    expect((await model.classify(other)).output).toEqual(DEFAULT_REPLIES.classify);
    expect((await model.answer(other, [])).output).toEqual({});
    expect((await model.proposeCrm(other, { contact: null, topic: null })).output).toEqual({ actions: [] });
    expect(DEFAULT_REPLIES.classify).toEqual({ intent: 'out_of_scope', topic: null, urgency: 'low', confidence: 0 });
  });

  it('falls back to the default for a reply its entry leaves out', async () => {
    const model = createSimulator(parseSimulatorFile({ replies: KNOWN }));

    expect((await model.answer(REQUEST, [])).output).toEqual({});
  });

  it('gives each caller its own copy, so no run changes the next one\'s reply', async () => {
    const model = createSimulator(parseSimulatorFile({ replies: KNOWN }));
    const first = (await model.classify(REQUEST)).output as { confidence: number };
    first.confidence = 0;

    expect(((await model.classify(REQUEST)).output as { confidence: number }).confidence).toBe(0.8);
  });

  it.each([
    ['no replies list', {}, 'replies'],
    ['a field beside replies', { replies: [], extra: 1 }, 'replies'],
    ['a case name with spaces', { replies: [{ ...KNOWN[0], case: 'con espacio' }] }, 'replies[0].case'],
    ['a key that is not a SHA-256', { replies: [{ ...KNOWN[0], requestSha256: 'abc' }] }, 'replies[0].requestSha256'],
    ['the same key twice', { replies: [KNOWN[0], { ...KNOWN[0], case: 'otra' }] }, 'replies[1].requestSha256'],
    ['a reply the model has no port for', { replies: [{ ...KNOWN[0], nextStation: 'close' }] }, 'replies[0]'],
  ])('refuses a file with %s, naming where', (_name, file, where) => {
    expect(() => parseSimulatorFile(file)).toThrow(InvalidSimulatorFile);
    expect(() => parseSimulatorFile(file)).toThrow(`«${where}»`);
  });
});

describe('CIRCUIT_MODEL (ADR-0010 D12)', () => {
  it('is the simulator when unset or empty', () => {
    expect(readModelChoice({})).toBe('simulator');
    expect(readModelChoice({ CIRCUIT_MODEL: '' })).toBe('simulator');
    expect(readModelChoice({ CIRCUIT_MODEL: 'simulator' })).toBe('simulator');
  });

  it('stops on any other value, naming the variable and not quoting the value', () => {
    expect(() => readModelChoice({ CIRCUIT_MODEL: 'otro-modelo' })).toThrow('CIRCUIT_MODEL');
    expect(() => readModelChoice({ CIRCUIT_MODEL: 'otro-modelo' })).not.toThrow('otro-modelo');
  });
});

describe('the scenario package (CLAUDE.md §3, rule 4)', () => {
  const root = mkdtempSync(join(tmpdir(), 'circuit-scenario-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function packageWith(id: string, documents: Readonly<Record<string, string>>, simulator = '{"replies": []}'): void {
    mkdirSync(join(root, id, 'documents'), { recursive: true });
    for (const [name, text] of Object.entries(documents)) writeFileSync(join(root, id, 'documents', name), text);
    writeFileSync(join(root, id, 'simulator.json'), simulator);
  }

  it('loads the documents in name order, with the file name as id and the first heading as title', () => {
    packageWith('bueno', { 'b-dos.md': '# Dos\ntexto dos', 'a-uno.md': '# Uno\ntexto uno', 'notas.txt': 'no' });

    const loaded = loadScenario(root, 'bueno');

    expect(loaded.documents.map((document) => [document.id, document.title])).toEqual([['a-uno', 'Uno'], ['b-dos', 'Dos']]);
    expect(loaded.simulator).toEqual({ replies: [] });
  });

  it.each([
    ['an id that could be a path', '../fuera', {}],
    ['a document with a capital in its name', 'mayuscula', { 'Uno.md': '# Uno' }],
    ['a document without a title', 'sin-titulo', { 'uno.md': 'texto' }],
    ['no documents', 'vacio', {}],
  ])('refuses %s', (_name, id, documents) => {
    if (!id.includes('/')) packageWith(id, documents);
    expect(() => loadScenario(root, id)).toThrow(InvalidScenario);
  });

  it('refuses a simulator.json that is not JSON, without quoting it', () => {
    packageWith('roto', { 'uno.md': '# Uno' }, '{ secreto');

    expect(() => loadScenario(root, 'roto')).toThrow('simulator.json');
    expect(() => loadScenario(root, 'roto')).not.toThrow('secreto');
  });
});
