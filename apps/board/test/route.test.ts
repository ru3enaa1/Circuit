import { describe, expect, it } from 'vitest';

import { projectRun } from '../src/projection.ts';
import { CIRCUIT_ROUTE, parentOf, parseRoute, resolveRoute, routeHash, type Route } from '../src/route.ts';
import { boardInfo, goldenEvents } from './support.ts';

// ADR-0013 E1 and E4: what is looked at lives in the address's fragment, which is the user's
// input. It is read only by its shape and then against the projected view; anything else is the
// circuit. One level up is always the parent: from an action to CRM, from a room to the circuit.

const info = boardInfo();

describe('E1 · parseRoute and routeHash', () => {
  const ROUTES: readonly Route[] = [
    CIRCUIT_ROUTE,
    { kind: 'circuit', from: 'classification' },
    { kind: 'station', station: 'knowledge' },
    { kind: 'action', station: 'crm', index: 3 },
    { kind: 'action', station: 'crm', index: 42 },
  ];

  it.each(ROUTES)('reads back what it writes: %o', (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('writes the addresses of the brief', () => {
    expect(routeHash({ kind: 'station', station: 'crm' })).toBe('#/estacion/crm');
    expect(routeHash({ kind: 'action', station: 'crm', index: 2 })).toBe('#/estacion/crm/accion/2');
    expect(routeHash({ kind: 'circuit', from: 'crm' })).toBe('#/desde/crm');
    expect(routeHash(CIRCUIT_ROUTE)).toBe('#/');
  });

  it.each([
    '',
    '#',
    '#/',
    '#/estacion',
    '#/estacion/',
    '#/estacion/CRM',
    '#/estacion/crm/',
    '#/estacion/../package.json',
    '#/estacion/crm%2F..',
    '#/estacion/<script>',
    '#/estacion/crm/accion/0',
    '#/estacion/crm/accion/01',
    '#/estacion/crm/accion/100',
    '#/estacion/crm/accion/9007199254740993',
    '#/estacion/crm/accion/-1',
    '#/estacion/crm/accion/1.5',
    '#/desde/',
    '#/desde/crm/extra',
    'javascript:alert(1)',
    '#/estacion/una_estacion_con_un_nombre_de_mas_de_32',
    ' #/estacion/crm',
  ])('anything else is the circuit: %j', (hash) => {
    expect(parseRoute(hash)).toEqual(CIRCUIT_ROUTE);
  });
});

describe('E4 · one level up', () => {
  it('from an action to its station, from a station to the circuit, and nothing above the circuit', () => {
    expect(parentOf({ kind: 'action', station: 'crm', index: 2 })).toEqual({ kind: 'station', station: 'crm' });
    expect(parentOf({ kind: 'station', station: 'crm' })).toEqual({ kind: 'circuit', from: 'crm' });
    expect(parentOf({ kind: 'circuit', from: 'crm' })).toBeNull();
    expect(parentOf(CIRCUIT_ROUTE)).toBeNull();
  });
});

describe('E1 · resolveRoute against the view', () => {
  const finished = projectRun(info, goldenEvents('normal'));

  it('keeps a room the table has, and an action the CRM event carries', () => {
    expect(resolveRoute({ kind: 'station', station: 'close' }, finished)).toEqual({ kind: 'station', station: 'close' });
    expect(resolveRoute({ kind: 'action', station: 'crm', index: 3 }, finished)).toEqual({ kind: 'action', station: 'crm', index: 3 });
    expect(resolveRoute({ kind: 'circuit', from: 'crm' }, finished)).toEqual({ kind: 'circuit', from: 'crm' });
  });

  it('a station the table lacks leads to the circuit', () => {
    expect(resolveRoute({ kind: 'station', station: 'nowhere' }, finished)).toEqual(CIRCUIT_ROUTE);
    expect(resolveRoute({ kind: 'action', station: 'nowhere', index: 1 }, finished)).toEqual(CIRCUIT_ROUTE);
    expect(resolveRoute({ kind: 'circuit', from: 'nowhere' }, finished)).toEqual(CIRCUIT_ROUTE);
  });

  it('an action the event does not carry leads to its station’s room', () => {
    expect(resolveRoute({ kind: 'action', station: 'crm', index: 4 }, finished)).toEqual({ kind: 'station', station: 'crm' });
    // Only CRM opens actions: Persona's event also lists them, but they are CRM's proposal.
    expect(resolveRoute({ kind: 'action', station: 'person', index: 1 }, finished)).toEqual({ kind: 'station', station: 'person' });
  });

  it('before CRM’s event is revealed, its actions do not open yet', () => {
    const early = projectRun(info, goldenEvents('normal').slice(0, 4));

    expect(resolveRoute({ kind: 'action', station: 'crm', index: 1 }, early)).toEqual({ kind: 'station', station: 'crm' });
  });
});
