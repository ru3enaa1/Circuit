// Public face of station 6: the mentor approves, corrects or rejects what station 5 proposed.
// Nothing reaches the CRM without it (ADR-0001 D4, ADR-0012).
export { createDecisionDesk, InvalidMentor } from './desk.ts';
export type { DecisionDesk } from './desk.ts';
