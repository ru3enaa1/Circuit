import { createHash } from 'node:crypto';

import {
  CIRCUIT,
  type AppliedAction,
  type Clock,
  type ContactSummary,
  type CrmAction,
  type CrmContext,
  type CrmReader,
  type CrmWriter,
  type Digest,
  type EngineDeps,
  type EventStore,
  type ModelPort,
  type ModelReply,
  type NewRun,
  type SourceDocument,
  type StationEvent,
} from '../../src/modules/circuit/index.ts';

/** The step the golden cases use too (ADR-0010 D15): each reading of the clock moves 10 ms. */
export const CLOCK_STEP_MS = 10;
export const CLOCK_START_MS = Date.UTC(2026, 10, 26, 9, 0, 0);

export function steppingClock(start = CLOCK_START_MS, step = CLOCK_STEP_MS): Clock {
  let next = start;
  return {
    now() {
      const value = next;
      next += step;
      return value;
    },
  };
}

export const sha256Digest: Digest = {
  sha256: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
};

/** The store in memory: it only grows, and it refuses what the table would (seq gaps, a station twice). */
export class MemoryStore implements EventStore {
  readonly runs: NewRun[] = [];
  readonly stored: StationEvent[] = [];
  /** Throws on this append (1-based), to see that the engine stops there (D8). */
  failOnAppend: number | null = null;
  private appends = 0;

  async createRun(run: NewRun): Promise<number> {
    this.runs.push(run);
    return this.runs.length;
  }

  async append(event: StationEvent): Promise<void> {
    this.appends += 1;
    if (this.failOnAppend === this.appends) throw new Error('almacén caído');
    const mine = this.stored.filter((stored) => stored.runId === event.runId);
    if (event.seq !== mine.length + 1) throw new Error(`seq ${event.seq} con ${mine.length} eventos`);
    if (mine.some((stored) => stored.station === event.station)) throw new Error(`${event.station} dos veces`);
    // A copy through JSON, as a real store would give back: nothing shared with the engine.
    this.stored.push(JSON.parse(JSON.stringify(event)) as StationEvent);
  }

  async events(runId: number): Promise<readonly StationEvent[]> {
    return this.stored.filter((event) => event.runId === runId);
  }
}

export interface ModelCalls {
  readonly classify: string[];
  readonly answer: string[];
  readonly proposeCrm: { readonly request: string; readonly context: CrmContext }[];
}

const NULL_USAGE = { tokensIn: null, tokensOut: null, costMicroUsd: null };

export interface ScriptedReplies {
  readonly classify?: unknown;
  readonly answer?: unknown;
  readonly proposeCrm?: unknown;
}

/** A model that answers from a script and keeps what it was sent. A function in the script throws or varies. */
export function scriptedModel(replies: ScriptedReplies): ModelPort & { readonly calls: ModelCalls } {
  const calls: ModelCalls = { classify: [], answer: [], proposeCrm: [] };
  const reply = (value: unknown): ModelReply => ({
    output: typeof value === 'function' ? (value as () => unknown)() : value,
    usage: NULL_USAGE,
  });
  return {
    name: 'fake-model',
    calls,
    async classify(request) {
      calls.classify.push(request);
      return reply(replies.classify);
    },
    async answer(request) {
      calls.answer.push(request);
      return reply(replies.answer);
    },
    async proposeCrm(request, context) {
      calls.proposeCrm.push({ request, context });
      return reply(replies.proposeCrm);
    },
  };
}

export const DOCUMENTS: readonly SourceDocument[] = [
  {
    id: 'radiografia',
    title: 'Radiografía de la operación',
    text: 'El programa empieza por dibujar cómo funciona hoy la empresa,   proceso por proceso,\ny dónde se va el tiempo del fundador.',
  },
];

export const NORMAL_REPLIES: ScriptedReplies = {
  classify: { intent: 'request', topic: 'radiografia', urgency: 'medium', confidence: 0.92 },
  answer: {
    answer: 'Radiografía de la operación empieza por dibujar sus procesos.',
    documentId: 'radiografia',
    quote: 'dibujar cómo funciona hoy la empresa, proceso por proceso',
  },
  proposeCrm: {
    actions: [
      { type: 'add_note', body: 'Pide ayuda para ordenar sus procesos.' },
      { type: 'move_stage', stage: 'programa-propuesto' },
    ],
  },
};

export const KNOWN_CONTACT: ContactSummary = { id: 7, fullName: 'Lucía Restrepo Arango', stage: 'diagnostico' };

export function fakeCrm(contacts: Readonly<Record<string, ContactSummary>> = {}): CrmReader & CrmWriter & {
  readonly lookups: string[];
  readonly writes: { readonly action: CrmAction; readonly contactId: number | null }[];
  failOnWrite: number | null;
} {
  let nextId = 100;
  return {
    lookups: [],
    writes: [],
    failOnWrite: null,
    async findContactByEmail(email) {
      this.lookups.push(email);
      return contacts[email] ?? null;
    },
    async apply(action, contactId): Promise<AppliedAction> {
      this.writes.push({ action, contactId });
      if (this.failOnWrite === this.writes.length) throw new Error('500 del CRM');
      nextId += 1;
      return { id: nextId };
    },
  };
}

export function engineDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    definition: CIRCUIT,
    store: new MemoryStore(),
    clock: steppingClock(),
    digest: sha256Digest,
    model: scriptedModel(NORMAL_REPLIES),
    crmReader: fakeCrm({ 'lucia@hiloverde.test': KNOWN_CONTACT }),
    documents: DOCUMENTS,
    scenario: 'prueba',
    ...overrides,
  };
}

export const NORMAL_TEXT =
  'Hola, soy Lucía (lucia@hiloverde.test, 300 123 4567). Cada pedido grande pasa por mí y no sé en qué se me va la semana.';
