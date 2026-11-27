import { decideRun, isApprover, type DecisionDeps, type RunOutcome } from '../circuit/index.ts';

/**
 * Station 6 as the server reaches it (ADR-0012 A6, A7): the mentor is fixed when the desk is made,
 * from CIRCUIT_MENTOR, so no request can name who approves. The core still checks the name again
 * on every decision, and stores it in the event station 7 reads.
 */

export interface DecisionDesk {
  /** The mentor every decision is signed with. */
  readonly mentor: string;
  decide(runId: number, input: unknown): Promise<RunOutcome>;
}

export class InvalidMentor extends Error {
  override readonly name = 'InvalidMentor';

  constructor() {
    super('CIRCUIT_MENTOR debe ser de 1 a 40 minúsculas, dígitos o «-», y no key-<n>.');
  }
}

export function createDecisionDesk(deps: DecisionDeps, mentor: string): DecisionDesk {
  if (!isApprover(mentor)) throw new InvalidMentor();
  return Object.freeze({ mentor, decide: (runId: number, input: unknown) => decideRun(deps, runId, input, mentor) });
}
