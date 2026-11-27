import { validateActions } from './actions.ts';
import type { EventStatus, Outcome, StationId } from './definition.ts';
import { delimit, findInjection, redact } from './filter.ts';
import { checkCitation } from './knowledge.ts';
import type { CrmReader, Detail, ModelPort, SourceDocument, Usage } from './ports.ts';
import { InvalidInput, requireOneOf, requirePattern, requireRecord, requireUnitInterval } from './validate.ts';

/**
 * The stations the engine runs on its own: 1 and 2 (code) and 3 to 5 (model). Each one returns
 * its outcome and detail; none of them chooses the next station (ADR-0010 D1, ADR-0001 D1).
 */

/** Rule 3 (CLAUDE.md §3), question 1 accepted on 2026-11-26: below 0.7 the person decides. */
export const LOW_CONFIDENCE_BELOW = 0.7;
/** Longer than this is not a request but a document; the CRM's note limit is 4000. */
export const MAX_INPUT_LENGTH = 4000;

export const INTENTS = ['request', 'complaint', 'out_of_scope'] as const;
export const URGENCIES = ['low', 'medium', 'high'] as const;
/** A topic is a key of the scenario (a program), shaped like the CRM's slugs. */
const TOPIC_PATTERN = /^[a-z0-9-]{1,40}$/;

/** What the run carries from one station to the next. Only `text` is raw, and it never leaves memory. */
export interface RunState {
  readonly text: string;
  readonly request: string | null;
  readonly email: string | null;
  readonly topic: string | null;
  readonly contactId: number | null;
}

export interface StationResult {
  readonly outcome: Outcome;
  readonly status: EventStatus;
  readonly detail: Detail;
  readonly usage: Usage;
  readonly next?: Partial<RunState>;
}

export interface StationDeps {
  readonly model: ModelPort;
  readonly crmReader: CrmReader;
  readonly documents: readonly SourceDocument[];
}

export type StationHandler = (state: RunState, deps: StationDeps) => Promise<StationResult>;

/** Code stations spend nothing (D9). */
export const NO_USAGE: Usage = Object.freeze({ tokensIn: 0, tokensOut: 0, costMicroUsd: 0 });

const completed = (outcome: Outcome, detail: Detail, usage: Usage, next?: Partial<RunState>): StationResult =>
  next === undefined ? { outcome, status: 'completed', detail, usage } : { outcome, status: 'completed', detail, usage, next };

async function intake(state: RunState): Promise<StationResult> {
  const { text } = state;
  if (text.trim().length === 0 || text.length > MAX_INPUT_LENGTH || text.includes('\u0000') || !text.isWellFormed()) {
    throw new InvalidInput('text');
  }
  return completed('ok', { length: text.length }, NO_USAGE);
}

async function filter(state: RunState): Promise<StationResult> {
  const pattern = findInjection(state.text);
  if (pattern !== null) {
    // D5: the id of the pattern, never the text that matched, and no model call.
    return { outcome: 'injection', status: 'stopped', detail: { pattern }, usage: NO_USAGE };
  }
  const redaction = redact(state.text);
  // ADR-0010 A1 (the owner, 2026-11-26): the redacted text, undelimited, so the board can show what
  // the person wrote. The email, phones and documents are already out of it; the raw text never is stored.
  const detail = {
    text: redaction.text,
    hasEmail: redaction.email !== null,
    phones: redaction.phones,
    documents: redaction.documents,
  };
  return completed('ok', detail, NO_USAGE, { request: delimit(redaction.text), email: redaction.email });
}

function requestOf(state: RunState): string {
  // The engine only reaches a model station after the filter set the request.
  if (state.request === null) throw new Error('Una estación del modelo corrió sin la solicitud delimitada.');
  return state.request;
}

async function classification(state: RunState, deps: StationDeps): Promise<StationResult> {
  const reply = await deps.model.classify(requestOf(state));
  const output = requireRecord(reply.output, 'classification');
  const intent = requireOneOf(output['intent'], 'intent', INTENTS);
  const urgency = requireOneOf(output['urgency'], 'urgency', URGENCIES);
  const confidence = requireUnitInterval(output['confidence'], 'confidence');
  const topic = output['topic'] === null || output['topic'] === undefined ? null : requirePattern(output['topic'], 'topic', TOPIC_PATTERN);
  const detail = { intent, topic, urgency, confidence };
  return completed(outcomeOf(intent, confidence), detail, reply.usage, { topic });
}

function outcomeOf(intent: (typeof INTENTS)[number], confidence: number): Outcome {
  if (intent === 'complaint') return 'complaint';
  if (intent === 'out_of_scope') return 'out_of_scope';
  return confidence < LOW_CONFIDENCE_BELOW ? 'low_confidence' : 'ok';
}

async function knowledge(state: RunState, deps: StationDeps): Promise<StationResult> {
  const reply = await deps.model.answer(requestOf(state), deps.documents);
  const check = checkCitation(reply.output, deps.documents);
  // D13: without a source the answer is dropped, and the event only says why.
  if (!check.ok) return completed('no_source', { reason: check.reason }, reply.usage);
  return completed('ok', { documentId: check.documentId, quote: check.quote, answer: check.answer }, reply.usage);
}

async function crm(state: RunState, deps: StationDeps): Promise<StationResult> {
  const contact = state.email === null ? null : await deps.crmReader.findContactByEmail(state.email);
  const reply = await deps.model.proposeCrm(requestOf(state), { contact, topic: state.topic });
  const output = requireRecord(reply.output, 'crm');
  const actions = validateActions(output['actions'], { contactKnown: contact !== null, email: state.email });
  const contactId = contact?.id ?? null;
  return completed('ok', { contactId, actions }, reply.usage, { contactId });
}

/** The stations the engine runs without waiting for anyone, by id. */
export const AUTOMATIC_STATIONS: Readonly<Partial<Record<StationId, StationHandler>>> = Object.freeze({
  intake,
  filter,
  classification,
  knowledge,
  crm,
});
