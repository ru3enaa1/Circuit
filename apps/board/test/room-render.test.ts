import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { QUOTE_MAX_LENGTH } from '../src/nodes.ts';
import { projectRun } from '../src/projection.ts';
import { actionsOf, type Route } from '../src/route.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, goldenPersonal, prefixes } from './support.ts';

// ADR-0013 E2–E4: a room is the same projection seen from closer. For every prefix of every
// golden case and every room, the station inside carries the projection's data-status; its
// nodes are whole and its ways out are the table's, with the one taken marked only when the
// projection took it. The markup is read by its attributes, as B3 reads the orbit.

const info = boardInfo();
const STATIONS = info.stations.map((station) => station.id);

function render(events: readonly RunEvent[], route: Route, overrides: Partial<BoardProps> = {}): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: events.at(-1)?.station ?? null, lastOutcome: events.at(-1)?.outcome ?? null, lastStatus: events.at(-1)?.status ?? null }];
  return renderToStaticMarkup(createElement(Board, { status: 'ready', info, tools: [], runs, runId: 12, events, width: 1536, height: 864, route, ...overrides }));
}

const statuses = (markup: string) => [...markup.matchAll(/data-station="([^"]+)" data-status="([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
const attribute = (markup: string, name: string) => [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((match) => match[1]);

describe.each(GOLDEN_CASES)('E2 · the rooms of the golden case %s', (name) => {
  const events = goldenEvents(name);

  it('the station inside each room carries, for every prefix, the status of projectRun', () => {
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      for (const station of view.stations) {
        const markup = render(prefix, { kind: 'station', station: station.id });
        expect(attribute(markup, 'data-room'), `${station.id}, ${prefix.length} eventos`).toEqual([station.id]);
        expect(statuses(markup), `${station.id}, ${prefix.length} eventos`).toEqual([`${station.id}=${station.status}`]);
      }
    }
  });

  it('each action room carries CRM’s status, for every prefix that has the action', () => {
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      const crm = view.stations.find((station) => station.id === 'crm');
      actionsOf(crm).forEach((_, index) => {
        const markup = render(prefix, { kind: 'action', station: 'crm', index: index + 1 });
        expect(attribute(markup, 'data-room-kind')).toEqual(['action']);
        expect(statuses(markup)).toEqual([`crm=${crm?.status}`]);
      });
    }
  });

  it('coming back to the circuit from any station paints the seven statuses of projectRun', () => {
    const expected = projectRun(info, events).stations.map((station) => `${station.id}=${station.status}`);
    for (const from of STATIONS) expect(statuses(render(events, { kind: 'circuit', from }))).toEqual(expected);
  });

  it('the ways out are the table’s, and only the projection’s are marked taken', () => {
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      for (const station of STATIONS) {
        const markup = render(prefix, { kind: 'station', station });
        const exits = [...markup.matchAll(/data-exit="([^"]+)" data-taken="([^"]+)"/g)].map((match) => `${match[1]}:${match[2]}`);
        const expected = view.edges.filter((edge) => edge.from === station).map((edge) => `${edge.to}:${edge.taken}`);
        expect(exits, `${station}, ${prefix.length} eventos`).toEqual(expected);
      }
    }
  });

  it('no room shows what the filter crossed out', () => {
    const routes: Route[] = [...STATIONS.map((station): Route => ({ kind: 'station', station })), ...[1, 2, 3].map((index): Route => ({ kind: 'action', station: 'crm', index }))];
    for (const route of routes) {
      const markup = render(events, route);
      for (const value of goldenPersonal(name)) expect(markup, `${JSON.stringify(route)}: ${value}`).not.toContain(value);
    }
  });
});

describe('E3 · what a room says', () => {
  const normal = goldenEvents('normal');
  const quote = String(normal.find((event) => event.station === 'knowledge')?.detail['quote']);

  it('Conocimiento shows its quote whole, which the orbit cuts', () => {
    expect(quote.length).toBeGreaterThan(QUOTE_MAX_LENGTH);
    expect(render(normal, { kind: 'circuit', from: null })).not.toContain(quote);
    expect(render(normal, { kind: 'station', station: 'knowledge' })).toContain(`«${quote}»`);
  });

  it('Clasificación says which way it went: the normal route in the normal case, the branch in the complaint', () => {
    const normalRoom = render(normal, { kind: 'station', station: 'classification' });
    const complaintRoom = render(goldenEvents('complaint'), { kind: 'station', station: 'classification' });

    expect(normalRoom).toContain('data-exit="knowledge" data-taken="true"');
    expect(normalRoom).toContain('data-exit="person" data-taken="false"');
    expect(normalRoom).toContain('ruta normal');
    expect(complaintRoom).toContain('data-exit="person" data-taken="true"');
    expect(complaintRoom).toContain('queja, fuera de alcance o duda');
  });

  it('Entrada shows the request already crossed out', () => {
    const markup = render(normal, { kind: 'station', station: 'intake' });

    expect(markup).toContain('Texto recibido, ya tachado');
    expect(markup).toContain('[teléfono]');
    expect(markup).toContain('347 caracteres');
  });

  it('CRM lists its actions whole, each one a door into its own room', () => {
    const markup = render(normal, { kind: 'station', station: 'crm' });

    expect(attribute(markup, 'href').filter((href) => href?.includes('/accion/'))).toEqual(['#/estacion/crm/accion/1', '#/estacion/crm/accion/2', '#/estacion/crm/accion/3']);
    expect(markup).toContain('tarea: Agendar la conversación sobre Radiografía de la operación · 1 dic');
  });

  it('a proposed action says it waits for approval, and once closed, that it was applied', () => {
    const waiting = render(normal.slice(0, 5), { kind: 'action', station: 'crm', index: 3 });
    const closed = render(normal, { kind: 'action', station: 'crm', index: 3 });

    for (const markup of [waiting, closed]) {
      expect(markup).toContain('Tarea');
      expect(markup).toContain('Agendar la conversación sobre Radiografía de la operación');
      expect(markup).toContain('vence 1 dic');
      expect(markup).toContain('Acción 3 de 3');
    }
    expect(waiting).toMatch(/data-action-state="true">espera aprobación</);
    expect(closed).toMatch(/data-action-state="true">aplicada</);
  });

  it('Persona shows the proposal it decides on, and its three ways out', () => {
    const markup = render(normal.slice(0, 5), { kind: 'station', station: 'person' });

    expect(markup).toContain('data-proposal');
    expect(markup).toContain('<h3>Decisión</h3>');
    expect(markup).not.toContain('Lo que guardó');
    expect(markup).toContain('etapa: programa propuesto');
    for (const way of ['aprobar', 'corregir', 'rechazar']) expect(markup).toContain(way);
    expect(markup).toContain('espera a la persona');
  });

  it('a room the run has not reached says so, and draws no instrument', () => {
    const markup = render(normal.slice(0, 2), { kind: 'station', station: 'crm' });

    expect(markup).toContain('Todavía sin datos');
    expect(markup).not.toContain('room__telemetry');
  });

  it('an address for an action the event lacks opens CRM’s room, and an unknown station the circuit', () => {
    expect(attribute(render(normal, { kind: 'action', station: 'crm', index: 9 }), 'data-room-kind')).toEqual(['station']);
    expect(attribute(render(normal, { kind: 'station', station: 'nowhere' }), 'data-route')).toEqual(['circuit']);
  });
});

describe('E4 · the way back', () => {
  const normal = goldenEvents('normal');

  it('from a station, the portal and the breadcrumb lead to the circuit, from that station', () => {
    const markup = render(normal, { kind: 'station', station: 'classification' });

    expect(attribute(markup, 'data-portal')).toEqual(['#/desde/classification']);
    expect(markup).toContain('aria-label="Volver a Circuito"');
    expect(markup).toMatch(/<a href="#\/desde\/classification">Circuito<\/a>/);
    expect(markup).toContain('<span aria-current="page">Clasificación</span>');
  });

  it('from an action, they lead one level up, to CRM', () => {
    const markup = render(normal, { kind: 'action', station: 'crm', index: 2 });

    expect(attribute(markup, 'data-portal')).toEqual(['#/estacion/crm']);
    expect(markup).toContain('aria-label="Volver a CRM"');
    expect(markup).toMatch(/<a href="#\/estacion\/crm">CRM<\/a>/);
    expect(markup).toContain('<span aria-current="page">Etapa</span>');
  });

  it('the portal draws the circuit in miniature with the room’s station in yellow', () => {
    const markup = render(normal, { kind: 'station', station: 'knowledge' });
    const here = [...markup.matchAll(/class="mini__station[^"]*is-here" data-mini="([^"]+)"/g)].map((match) => match[1]);

    expect(attribute(markup, 'data-mini')).toHaveLength(STATIONS.length);
    expect(here).toEqual(['knowledge']);
  });

  it('coming back, the circuit grows out of the station left; without a station, it does not move', () => {
    expect(render(normal, { kind: 'circuit', from: 'crm' })).toMatch(/class="orbit is-returning( is-closed)?"/);
    expect(render(normal, { kind: 'circuit', from: null })).toMatch(/class="orbit( is-closed)?"/);
  });

  it('in a room the dock marks the room’s station as the one selected', () => {
    const markup = render(normal, { kind: 'station', station: 'filter' });

    expect(markup).toMatch(/class="pill pill--completed is-selected is-marked" data-dock-station="filter"/);
    // The run is on Cierre, but only the open room carries the outline and the yellow bar.
    expect([...markup.matchAll(/is-marked/g)]).toHaveLength(1);
    expect(markup).toContain('class="dock has-selection"');
  });
});
