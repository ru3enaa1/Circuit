import { describe, expect, it } from 'vitest';

import { CIRCUIT, END, nextStation, stationOf } from '../src/modules/circuit/index.ts';

// ADR-0010 D1: the definition, entry by entry, against a copy written here and not read from
// the code. A change to the circuit has to change this copy too, where the diff shows it.
const EXPECTED_STATIONS = [
  { id: 'intake', number: 1, decidedBy: 'code' },
  { id: 'filter', number: 2, decidedBy: 'code' },
  { id: 'classification', number: 3, decidedBy: 'model' },
  { id: 'knowledge', number: 4, decidedBy: 'model' },
  { id: 'crm', number: 5, decidedBy: 'model' },
  { id: 'person', number: 6, decidedBy: 'person' },
  { id: 'close', number: 7, decidedBy: 'code' },
];

const EXPECTED_TRANSITIONS = [
  ['intake', 'ok', 'filter'],
  ['filter', 'ok', 'classification'],
  ['filter', 'injection', 'end'],
  ['classification', 'ok', 'knowledge'],
  ['classification', 'complaint', 'person'],
  ['classification', 'out_of_scope', 'person'],
  ['classification', 'low_confidence', 'person'],
  ['knowledge', 'ok', 'crm'],
  ['knowledge', 'no_source', 'crm'],
  ['crm', 'ok', 'person'],
  ['person', 'approved', 'close'],
  ['person', 'corrected', 'close'],
  ['person', 'rejected', 'close'],
  ['close', 'done', 'end'],
];

describe('the circuit as data (ADR-0010 D1)', () => {
  it('has the seven stations in order, with their numbers and who decides', () => {
    expect(CIRCUIT.stations).toEqual(EXPECTED_STATIONS);
  });

  it('has exactly the transitions of the ADR, entry by entry', () => {
    expect(CIRCUIT.transitions.map((entry) => [entry.from, entry.outcome, entry.to])).toEqual(EXPECTED_TRANSITIONS);
  });

  it('gives each transition its destination', () => {
    for (const [from, outcome, to] of EXPECTED_TRANSITIONS) {
      expect(nextStation(CIRCUIT, from as never, outcome as never)).toBe(to);
    }
    expect(nextStation(CIRCUIT, 'close', 'done')).toBe(END);
  });

  it('throws on an outcome that is not its station\'s, instead of taking a route', () => {
    expect(() => nextStation(CIRCUIT, 'filter', 'complaint')).toThrow(/filter/);
    expect(() => nextStation(CIRCUIT, 'classification', 'approved')).toThrow(/classification/);
    expect(() => nextStation(CIRCUIT, 'intake', 'error')).toThrow(/intake/);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(CIRCUIT)).toBe(true);
    expect(Object.isFrozen(CIRCUIT.transitions)).toBe(true);
    expect(CIRCUIT.transitions.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(CIRCUIT.stations.every((station) => Object.isFrozen(station))).toBe(true);
  });

  it('finds a station by id and refuses one it does not have', () => {
    expect(stationOf(CIRCUIT, 'person').decidedBy).toBe('person');
    expect(() => stationOf({ stations: [], transitions: [] }, 'person')).toThrow(/person/);
  });
});
