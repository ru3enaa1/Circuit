import { describe, expect, it } from 'vitest';

import type { RunEvent } from '../src/api.ts';
import { destinationOf, idleView, isFinished, projectRun } from '../src/projection.ts';
import { GOLDEN_CASES, LETTERS, boardInfo, goldenEvents, prefixes, type GoldenCase } from './support.ts';

// ADR-0011 B1: the projection of every prefix of every golden case, against a view written
// here, not read from anywhere. c completed, s stopped, f failed, w waiting, k skipped,
// p pending; for intake, filter, classification, knowledge, crm, person and close.

const info = boardInfo();

const EXPECTED: Readonly<Record<GoldenCase, readonly string[]>> = {
  normal: ['wpppppp', 'cwppppp', 'ccwpppp', 'cccwppp', 'ccccwpp', 'cccccwp', 'ccccccw', 'ccccccc'],
  complaint: ['wpppppp', 'cwppppp', 'ccwpppp', 'ccckkwp', 'ccckkcw', 'ccckkcc'],
  injection: ['wpppppp', 'cwppppp', 'cskkkkk'],
  'low-confidence': ['wpppppp', 'cwppppp', 'ccwpppp', 'ccckkwp', 'ccckkcw', 'ccckkcc'],
};

/** The edges each case lit at its end, written here. */
const TAKEN: Readonly<Record<GoldenCase, readonly string[]>> = {
  normal: ['intake>filter', 'filter>classification', 'classification>knowledge', 'knowledge>crm', 'crm>person', 'person>close', 'close>end'],
  complaint: ['intake>filter', 'filter>classification', 'classification>person', 'person>close', 'close>end'],
  injection: ['intake>filter', 'filter>end'],
  'low-confidence': ['intake>filter', 'filter>classification', 'classification>person', 'person>close', 'close>end'],
};

const letters = (events: readonly RunEvent[]) =>
  projectRun(info, events)
    .stations.map((station) => LETTERS[station.status])
    .join('');

describe.each(GOLDEN_CASES)('B1 · projectRun over the golden case %s', (name) => {
  const events = goldenEvents(name);

  it('gives the view written here for each prefix of its events.json', () => {
    expect(prefixes(events).map(letters)).toEqual(EXPECTED[name]);
  });

  it('lights exactly the edges the route took, at its end', () => {
    const view = projectRun(info, events);
    const taken = view.edges.filter((edge) => edge.taken).map((edge) => `${edge.from}>${edge.to}`);

    expect(taken).toEqual(TAKEN[name]);
    expect(view.finished).toBe(true);
    expect(view.waitingAt).toBeNull();
  });

  it('is pure: the same events give the same view, and the events are not touched', () => {
    const copy = JSON.stringify(events);

    expect(projectRun(info, events)).toEqual(projectRun(info, JSON.parse(copy) as RunEvent[]));
    expect(JSON.stringify(events)).toBe(copy);
  });

  it('gives the same view with the events out of order', () => {
    expect(projectRun(info, [...events].reverse())).toEqual(projectRun(info, events));
  });
});

describe('B1 · the parts of a view', () => {
  it('each station carries its event and its outcome, and the waiting one says where the run is', () => {
    const events = goldenEvents('normal').slice(0, 3);
    const view = projectRun(info, events);

    expect(view.waitingAt).toBe('knowledge');
    expect(view.finished).toBe(false);
    expect(view.stations[2]).toMatchObject({ id: 'classification', status: 'completed', outcome: 'ok', event: events[2] });
    expect(view.stations[3]).toMatchObject({ id: 'knowledge', status: 'waiting', outcome: null, event: null });
  });

  it('the edge into the waiting station is marked as such', () => {
    const view = projectRun(info, goldenEvents('complaint').slice(0, 3));
    const branch = view.edges.find((edge) => edge.from === 'classification' && edge.to === 'person');

    expect(branch).toMatchObject({ kind: 'branch', taken: true, toWaiting: true, outcomes: ['complaint', 'out_of_scope', 'low_confidence'] });
  });

  it('names each kind of edge from the table', () => {
    const kinds = Object.fromEntries(projectRun(info, []).edges.map((edge) => [`${edge.from}>${edge.to}`, edge.kind]));

    expect(kinds).toEqual({
      'intake>filter': 'main',
      'filter>classification': 'main',
      'filter>end': 'stop',
      'classification>knowledge': 'main',
      'classification>person': 'branch',
      'knowledge>crm': 'main',
      'crm>person': 'main',
      'person>close': 'main',
      'close>end': 'exit',
    });
  });

  it('a station that failed ends the run: the rest are skipped', () => {
    const [intake, filter, classification] = goldenEvents('normal');
    const failed = { ...classification, outcome: 'error', status: 'failed', detail: { reason: 'port_error' } } as RunEvent;
    const view = projectRun(info, [intake as RunEvent, filter as RunEvent, failed]);

    expect(view.stations.map((station) => LETTERS[station.status]).join('')).toBe('ccfkkkk');
    expect(view.finished).toBe(true);
  });

  it('an outcome the table does not list ends the run instead of inventing a route', () => {
    const [intake] = goldenEvents('normal');
    const odd = { ...intake, outcome: 'unknown' } as RunEvent;

    expect(isFinished(info, odd)).toBe(true);
    expect(destinationOf(info, 'intake', 'unknown')).toBeUndefined();
    expect(projectRun(info, [odd]).waitingAt).toBeNull();
  });

  it('isFinished: no event yet is not finished', () => {
    expect(isFinished(info, null)).toBe(false);
  });

  it('idleView: every station pending, nothing waiting, no edge taken', () => {
    const view = idleView(info);

    expect(view.stations.every((station) => station.status === 'pending')).toBe(true);
    expect(view.waitingAt).toBeNull();
    expect(view.edges.some((edge) => edge.taken)).toBe(false);
  });
});
