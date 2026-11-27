import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CrmTool, RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { projectRun } from '../src/projection.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, goldenPersonal, prefixes } from './support.ts';

// ADR-0011 B3: the map is the events. Each station node in the markup carries data-station and
// data-status, and for each prefix of each golden case the seven statuses are the projection's.
// The markup is what React renders, read by its attributes, so a component that painted
// something of its own would show here.

const info = boardInfo();
const TOOLS: readonly CrmTool[] = [{ name: 'herramienta-falsa', label: 'Herramienta falsa', access: 'write' }];
const SIZES = [
  [1536, 864],
  [768, 864],
  [720, 900],
  [2560, 1080],
  [1280, 720],
] as const;

function render(events: readonly RunEvent[], overrides: Partial<BoardProps> = {}): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: events.at(-1)?.station ?? null, lastOutcome: events.at(-1)?.outcome ?? null, lastStatus: events.at(-1)?.status ?? null }];
  const props: BoardProps = { status: 'ready', info, tools: TOOLS, runs, runId: 12, events, width: 1536, height: 864, ...overrides };
  return renderToStaticMarkup(createElement(Board, props));
}

/** The station nodes of the markup, as `station=status`, in document order. */
function stationStatuses(markup: string): string[] {
  return [...markup.matchAll(/data-station="([^"]+)" data-status="([^"]+)"/g)].map((match) => `${match[1]}=${match[2]}`);
}

function projected(events: readonly RunEvent[]): string[] {
  return projectRun(info, events).stations.map((station) => `${station.id}=${station.status}`);
}

describe.each(GOLDEN_CASES)('B3 · the markup of the golden case %s', (name) => {
  const events = goldenEvents(name);

  it('paints, for every prefix, the seven statuses of projectRun', () => {
    for (const prefix of prefixes(events)) {
      const statuses = stationStatuses(render(prefix));
      expect(statuses).toHaveLength(7);
      expect(statuses, `${prefix.length} eventos`).toEqual(projected(prefix));
    }
  });

  it('paints the same statuses at every window size', () => {
    for (const [width, height] of SIZES) expect(stationStatuses(render(events, { width, height })), `${width}×${height}`).toEqual(projected(events));
  });

  it('never shows what the filter crossed out', () => {
    for (const prefix of prefixes(events)) {
      const markup = render(prefix);
      for (const value of goldenPersonal(name)) expect(markup, value).not.toContain(value);
    }
  });

  it('lights in the markup exactly the edges the projection took', () => {
    const markup = render(events);
    const taken = [...markup.matchAll(/data-edge="([^"]+)" data-taken="true"/g)].map((match) => match[1]?.replace('&gt;', '>'));
    const expected = projectRun(info, events).edges.filter((edge) => edge.taken).map((edge) => `${edge.from}>${edge.to}`);

    expect(taken).toEqual(expected);
  });
});

describe('B3 · what the stations say', () => {
  it('the normal case shows the request already crossed out, its number and its telemetry', () => {
    const markup = render(goldenEvents('normal'));

    expect(markup).toContain('Solicitud N.º 12');
    expect(markup).toContain('[teléfono]');
    expect(markup).toContain('10 ms · simulador');
    expect(markup).toContain('Radiografía de la operación');
    expect(markup).toContain('confianza 0,70');
    expect(markup).toContain('etapa: programa propuesto');
    expect(markup).toContain('1 correo aparte · 1 teléfono · 1 documento tachados');
  });

  it('a run waiting for the person says so, on the station and on the clock', () => {
    const markup = render(goldenEvents('complaint').slice(0, 3));

    expect(markup).toContain('espera a la persona');
    expect(markup).toContain('espera desde');
    expect(markup).toContain('queja, fuera de alcance o duda');
  });

  it('an injection says where it stopped', () => {
    const markup = render(goldenEvents('injection'));

    expect(markup).toContain('detenida · inyección');
    expect(markup).toContain('detenida en Filtro');
    expect(markup).toContain('inyección: ignora-instrucciones');
  });

  it('with no run, the circuit is idle and says so in the play tone', () => {
    const markup = render([], { runId: null, runs: [] });

    expect(stationStatuses(markup).every((entry) => entry.endsWith('=pending'))).toBe(true);
    expect(markup).toContain('Nada por aquí');
    expect(markup).toContain('Sin corridas todavía.');
  });

  it('before the table arrives, it says it is loading, or that the server is unreachable', () => {
    expect(render([], { info: null, status: 'loading' })).toContain('Cargando el circuito');
    expect(render([], { info: null, status: 'unreachable' })).toContain('No se pudo leer el circuito');
  });

  it('each station is reachable with Tab, in the order of the circuit, with its name and state', () => {
    const markup = render(goldenEvents('normal').slice(0, 3));
    const labels = [...markup.matchAll(/tabindex="0" aria-label="([^"]+)"/g)].map((match) => match[1]);

    expect(labels).toEqual(['Entrada, hecha', 'Filtro, hecha', 'Clasificación, hecha, confianza 0,70', 'Conocimiento, en curso', 'CRM, pendiente', 'Persona, pendiente', 'Cierre, pendiente']);
  });
});

describe('B8 · the CRM tools are the list received', () => {
  it('the injected tool appears in the markup, and no other', () => {
    const markup = render(goldenEvents('normal'));

    expect(markup).toContain('data-tool="herramienta-falsa"');
    expect(markup).toContain('Herramienta falsa · escribe');
    expect([...markup.matchAll(/data-tool="/g)]).toHaveLength(1);
  });
});
