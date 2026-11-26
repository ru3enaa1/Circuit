import type { EventStatus, Outcome, StationId } from './definition.ts';
import type { CrmAction } from './actions.ts';

/**
 * The ports the core declares (ADR-0001 D2, ADR-0003 M2). Adapters implement them in other
 * modules; the core never imports one, so it stays without I/O, clock or randomness.
 */

/** A JSON value, the only thing an event's detail may hold. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Detail = { readonly [key: string]: JsonValue };

/** One event per visited station (ADR-0010 D7). Measures are whole numbers (D9). */
export interface StationEvent {
  readonly runId: number;
  /** 1, 2, … with no gaps. */
  readonly seq: number;
  readonly station: StationId;
  readonly outcome: Outcome;
  readonly status: EventStatus;
  /** ISO 8601 in UTC, from the Clock port. */
  readonly startedAt: string;
  readonly durationMs: number;
  /** Null when the source has no number to give, as the simulator (D9). */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costMicroUsd: number | null;
  /** `code` for the stations the core runs alone; the model's name otherwise. */
  readonly model: string;
  readonly detail: Detail;
}

export interface NewRun {
  readonly scenario: string;
  /** SHA-256 of the raw text, so two runs with the same input can be told apart (question 7). */
  readonly inputSha256: string;
  readonly startedAt: string;
}

/** Where the events live (ADR-0010 D10). It only grows: there is no update and no delete. */
export interface EventStore {
  createRun(run: NewRun): Promise<number>;
  append(event: StationEvent): Promise<void>;
  /** The run's events in `seq` order; empty when the run does not exist. */
  events(runId: number): Promise<readonly StationEvent[]>;
}

/** Milliseconds since the epoch, as a whole number. The only source of time in the core. */
export interface Clock {
  now(): number;
}

/** SHA-256 in lowercase hex. The core cannot import node:crypto, so it asks for it. */
export interface Digest {
  sha256(text: string): string;
}

/** What the model spent on one call. Null when there is no source for the number (D9). */
export interface Usage {
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costMicroUsd: number | null;
}

/** A model reply is unknown until the core validates it (D2). */
export interface ModelReply {
  readonly output: unknown;
  readonly usage: Usage;
}

export interface SourceDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface ContactSummary {
  readonly id: number;
  readonly fullName: string;
  /** The stage key in the scenario's CRM. */
  readonly stage: string;
}

/** What station 5 tells the model about the CRM: never the email (D4). */
export interface CrmContext {
  readonly contact: ContactSummary | null;
  readonly topic: string | null;
}

/**
 * The model port: stations 3, 4 and 5 (ADR-0001 D3). Every method receives the request already
 * delimited and redacted (D4), never the raw text.
 */
export interface ModelPort {
  /** The name stored in each event the model worked on. */
  readonly name: string;
  classify(request: string): Promise<ModelReply>;
  answer(request: string, documents: readonly SourceDocument[]): Promise<ModelReply>;
  proposeCrm(request: string, context: CrmContext): Promise<ModelReply>;
}

/** Reading the CRM: the only CRM port stations 1 to 6 receive (D14). */
export interface CrmReader {
  findContactByEmail(email: string): Promise<ContactSummary | null>;
}

/** What one write to the CRM gave back: the id of the row it touched. */
export interface AppliedAction {
  readonly id: number;
}

/** Writing to the CRM: only station 7 receives it, and only for approved actions. */
export interface CrmWriter {
  apply(action: CrmAction, contactId: number | null): Promise<AppliedAction>;
}
