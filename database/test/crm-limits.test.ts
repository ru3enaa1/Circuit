import { describe, expect, it } from 'vitest';

import * as circuit from '../../apps/circuit/src/modules/circuit/index.ts';
import * as crm from '../../apps/crm/src/db/schema.ts';

// apps/circuit never imports the CRM's code (ADR-0003 M3), so the core repeats the CRM's limits
// for the actions station 5 proposes (ADR-0010 D14). This file may import both apps and fails
// if the copies drift apart: an action the core accepts and the CRM refuses would only show at
// station 7, after a person approved it (audit of ADR-0010, H4).
describe('the limits the core repeats are the CRM schema’s', () => {
  it.each([
    ['SHORT_TEXT_MAX_LENGTH', circuit.SHORT_TEXT_MAX_LENGTH, crm.SHORT_TEXT_MAX_LENGTH],
    ['NOTE_BODY_MAX_LENGTH', circuit.NOTE_BODY_MAX_LENGTH, crm.NOTE_BODY_MAX_LENGTH],
    ['EMAIL_MAX_LENGTH', circuit.EMAIL_MAX_LENGTH, crm.EMAIL_MAX_LENGTH],
  ])('%s', (_name, inCircuit, inCrm) => {
    expect(inCircuit).toBe(inCrm);
  });

  it('a stage key has the shape of the CRM’s slugs', () => {
    expect(circuit.STAGE_KEY_PATTERN.source).toBe(crm.SLUG_PATTERN);
    expect(circuit.STAGE_KEY_PATTERN.flags).toBe('');
  });
});
