import { parseStoredActions, type CrmAction } from './actions.ts';
import { stationOf, type CircuitDefinition } from './definition.ts';
import type { JsonValue, StationEvent } from './ports.ts';
import { InvalidInput } from './validate.ts';

/**
 * The only thing that lets station 7 write to the CRM (ADR-0012 A1). An Approval is a marked
 * type: its mark is a symbol this file declares and never exports, so no other code can write an
 * object literal that passes for one. approvalFrom builds it, and only from a stored event of the
 * person station that approved or corrected, for the run it is asked about.
 */

declare const APPROVED: unique symbol;

export interface Approval {
  readonly runId: number;
  /** The configured mentor, as the decision stored it (A7). */
  readonly approvedBy: string;
  /** What the CRM's audit trail keeps to find every write of the run (A3, question 3). */
  readonly approvalRef: string;
  readonly contactId: number | null;
  /** Exactly the actions the decision approved, in order. */
  readonly actions: readonly CrmAction[];
  readonly [APPROVED]: true;
}

/** The CRM's audit author shape; a key's own name (`key-<n>`) never approves (ADR-0007 D7). */
export const APPROVER_PATTERN = /^[a-z0-9-]{1,40}$/;
const KEY_AUTHOR = /^key-[0-9]+$/;

export function isApprover(value: unknown): value is string {
  return typeof value === 'string' && APPROVER_PATTERN.test(value) && !KEY_AUTHOR.test(value);
}

/** `run-<id>`: 20 characters at most for a safe integer, inside the 40 of the author shape. */
export function approvalRefOf(runId: number): string {
  return `run-${runId}`;
}

/** The event cannot approve this run; the field says why, never what the event held. */
export class NotAnApproval extends Error {
  override readonly name = 'NotAnApproval';
  readonly field: string;

  constructor(field: string) {
    super(`El evento no aprueba la corrida (${field}).`);
    this.field = field;
  }
}

/** A contact id as an event stores it: a whole positive number, or null when there is none. */
export function contactIdOf(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new InvalidInput('contactId');
  return value;
}

const APPROVING = new Set(['approved', 'corrected']);

/**
 * The approval a stored event gives, or NotAnApproval. Everything is read again from the event,
 * as data: the run, the station, the decision, the mentor and the actions (A2).
 */
export function approvalFrom(definition: CircuitDefinition, runId: number, event: StationEvent): Approval {
  if (event.runId !== runId) throw new NotAnApproval('runId');
  if (stationOf(definition, event.station).decidedBy !== 'person') throw new NotAnApproval('station');
  if (event.status !== 'completed' || !APPROVING.has(event.outcome) || event.detail['decision'] !== event.outcome) {
    throw new NotAnApproval('decision');
  }
  const approvedBy = event.detail['approvedBy'];
  if (!isApprover(approvedBy)) throw new NotAnApproval('approvedBy');
  const actions = Object.freeze(parseStoredActions(event.detail['actions']).map((action) => Object.freeze(action)));
  const approval = { runId, approvedBy, approvalRef: approvalRefOf(runId), contactId: contactIdOf(event.detail['contactId']), actions };
  // The one place an Approval is made (A1); the ADR's grep for the cast finds only this line.
  return Object.freeze(approval) as Approval;
}
