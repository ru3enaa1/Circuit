import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDecisionDesk } from '../../src/modules/approval/index.ts';
import { CIRCUIT, LOW_CONFIDENCE_BELOW, startRun, type CrmReader, type CrmWriter, type StationEvent } from '../../src/modules/circuit/index.ts';
import { CRM_TOOLS, type CrmTool } from '../../src/modules/crm-client/index.ts';
import type { RunReader, RunSummary } from '../../src/modules/event-store/index.ts';
import { SIMULATOR_NAME } from '../../src/modules/model/index.ts';
import { circuitPayload } from '../../src/server/api.ts';
import { readBoardFiles, type BoardFiles } from '../../src/server/board-files.ts';
import type { LogLine } from '../../src/server/log.ts';
import type { RunCommands } from '../../src/server/commands.ts';
import { buildServer } from '../../src/server/server.ts';
import { DOCUMENTS, KNOWN_CONTACT, MemoryStore, NORMAL_TEXT, engineDeps, fakeCrm, steppingClock } from './fakes.ts';

/** The mentor the tests' desk signs with, and the one sample they can try. */
export const TEST_MENTOR = 'mentor';
export const TEST_SAMPLES = Object.freeze([Object.freeze({ id: 'normal', label: 'Pide un programa', text: NORMAL_TEXT })]);

/** The board's two commands over a store and a CRM in memory, as main.ts wires them over PostgreSQL and HTTP. */
export function memoryCommands(store: MemoryStore, crm: CrmReader & CrmWriter = fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT })): RunCommands {
  const desk = createDecisionDesk({ definition: CIRCUIT, store, claims: store, clock: steppingClock(), writer: crm }, TEST_MENTOR);
  return {
    async tryout(sampleId) {
      const sample = TEST_SAMPLES.find((entry) => entry.id === sampleId);
      if (sample === undefined) return null;
      return { runId: (await startRun(engineDeps({ store, crmReader: crm }), sample.text)).runId };
    },
    async decide(runId, input) {
      await desk.decide(runId, input);
    },
  };
}

/** The port the tests' Host headers name; inject never opens it. */
export const TEST_PORT = 4020;
export const GOOD_HOST = `127.0.0.1:${TEST_PORT}`;

/** The RunReader over the store in memory, with the PostgreSQL reader's order and shape. */
export class MemoryRunReader implements RunReader {
  readonly calls: string[] = [];
  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  async latestRuns(limit: number): Promise<readonly RunSummary[]> {
    this.calls.push('latestRuns');
    return this.store.runs
      .map((run, index): RunSummary => {
        const events = this.store.stored.filter((event) => event.runId === index + 1);
        const last = events.at(-1);
        return {
          id: index + 1,
          startedAt: run.startedAt,
          events: events.length,
          lastStation: last?.station ?? null,
          lastOutcome: last?.outcome ?? null,
          lastStatus: last?.status ?? null,
        };
      })
      .reverse()
      .slice(0, limit);
  }

  async eventsAfter(runId: number, after: number): Promise<readonly StationEvent[] | null> {
    this.calls.push('eventsAfter');
    if (runId < 1 || runId > this.store.runs.length) return null;
    return this.store.stored.filter((event) => event.runId === runId && event.seq > after);
  }
}

/** A dist folder with an index, a script and a font, next to files the server must never serve. */
export function fakeBoardDir(): { readonly dir: string; readonly dist: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'circuit-board-'));
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Circuit</title><div id="root"></div>');
  writeFileSync(join(dist, 'assets', 'index-a1b2.js'), 'console.log(1);');
  writeFileSync(join(dist, 'assets', 'plex-latin-400.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  writeFileSync(join(dist, 'assets', 'notes.txt'), 'a type the list leaves out');
  writeFileSync(join(dir, 'package.json'), '{"secret":"package"}');
  writeFileSync(join(dir, '.env'), 'NOT_SERVED=never-served');
  return { dir, dist, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface TestServerOptions {
  readonly store?: MemoryStore;
  readonly tools?: readonly CrmTool[];
  readonly board?: BoardFiles;
  readonly crm?: CrmReader & CrmWriter;
}

/** The circuit server over a store in memory, with its log kept for the test. */
export function testServer(options: TestServerOptions = {}) {
  const store = options.store ?? new MemoryStore();
  const reader = new MemoryRunReader(store);
  const lines: LogLine[] = [];
  const crm = options.crm ?? fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT });
  const circuit = circuitPayload({
    definition: CIRCUIT,
    scenario: 'escuela',
    model: SIMULATOR_NAME,
    lowConfidenceBelow: LOW_CONFIDENCE_BELOW,
    documents: DOCUMENTS,
    samples: TEST_SAMPLES,
    mentor: TEST_MENTOR,
  });
  const app = buildServer({
    reader,
    circuit,
    tools: options.tools ?? CRM_TOOLS,
    board: options.board ?? new Map(),
    port: () => TEST_PORT,
    log: (line) => lines.push(line),
    commands: memoryCommands(store, crm),
  });
  return { app, reader, store, lines, crm };
}

export { readBoardFiles };
