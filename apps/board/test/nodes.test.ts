import { describe, expect, it } from 'vitest';

import type { RunEvent } from '../src/api.ts';
import { actionText, outcomeTag, personalSummary, redactedText, runClock, runStateText, secondaryNodes, statusText } from '../src/nodes.ts';
import { projectRun, type StationView } from '../src/projection.ts';
import { boardInfo, goldenEvents } from './support.ts';

// docs/diseno.md §5 and §7: each node's text comes from its event; without the data, no node.

const info = boardInfo();
const nameOf = (id: string) => id;

function station(events: readonly RunEvent[], id: string): StationView {
  const found = projectRun(info, events).stations.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

const texts = (view: StationView) => secondaryNodes(view, info).map((node) => node.text);

describe('the nodes of each station, from the golden case normal', () => {
  const events = goldenEvents('normal');

  it.each([
    ['intake', ['347 caracteres']],
    ['filter', ['delimitado', 'sin inyección', '1 correo aparte · 1 teléfono · 1 documento tachados']],
    ['classification', ['solicitud', 'Radiografía de la operación', 'urgencia media', 'confianza 0,70']],
    ['crm', ['nota', 'etapa: programa propuesto', 'tarea: Agendar la conversación… · 1 dic']],
    ['person', ['aprobar', 'corregir', 'rechazar']],
    ['close', ['nota · aplicada', 'etapa · aplicada', 'tarea · aplicada', 'bitácora']],
  ])('%s says %j', (id, expected) => {
    expect(texts(station(events, id))).toEqual(expected);
  });

  it('knowledge shows the title and the quote, cut to 90 characters', () => {
    const [title, quote] = texts(station(events, 'knowledge'));

    expect(title).toBe('Radiografía de la operación');
    expect(quote?.startsWith('«El programa empieza por dibujar')).toBe(true);
    expect(quote?.endsWith('…»')).toBe(true);
    expect((quote?.length ?? 0) - 2).toBeLessThanOrEqual(90);
  });

  it('Persona fills the decision taken', () => {
    expect(secondaryNodes(station(events, 'person'), info).filter((node) => node.filled).map((node) => node.text)).toEqual(['aprobar']);
  });

  it('a station with no event yet has no nodes, but Persona waiting shows its three ways out, none filled', () => {
    const waiting = station(events.slice(0, 5), 'person');

    expect(texts(station(events.slice(0, 2), 'knowledge'))).toEqual([]);
    expect(secondaryNodes(waiting, info).map((node) => [node.text, node.filled])).toEqual([
      ['aprobar', false],
      ['corregir', false],
      ['rechazar', false],
    ]);
  });
});

describe('the other cases', () => {
  it('an injection names its pattern', () => {
    expect(texts(station(goldenEvents('injection'), 'filter'))).toEqual(['delimitado', 'inyección: ignora-instrucciones']);
  });

  it('a rejected proposal closes with no actions', () => {
    expect(texts(station(goldenEvents('low-confidence'), 'close'))).toEqual(['sin acciones', 'bitácora']);
  });

  it('a failed station has no nodes, and says why it failed', () => {
    const [intake, filter, classification] = goldenEvents('normal');
    const failed = { ...classification, outcome: 'error', status: 'failed', detail: { reason: 'port_error' } } as RunEvent;
    const view = station([intake as RunEvent, filter as RunEvent, failed], 'classification');

    expect(texts(view)).toEqual([]);
    expect(statusText(view)).toBe('falló · sin respuesta');
  });

  it('a knowledge station without a source says so', () => {
    const events = goldenEvents('normal').slice(0, 4);
    const noSource = { ...events[3], outcome: 'no_source', detail: {} } as RunEvent;
    const view = station([...events.slice(0, 3), noSource], 'knowledge');

    expect(texts(view)).toEqual(['sin fuente']);
    expect(outcomeTag(view)).toBe('sin fuente');
  });
});

describe('the small texts', () => {
  it('personalSummary counts, and never shows what was crossed out', () => {
    expect(personalSummary({ hasEmail: false, phones: 2, documents: 0 })).toBe('2 teléfonos tachados');
    expect(personalSummary({ hasEmail: false, phones: 0, documents: 3 })).toBe('3 documentos tachados');
    expect(personalSummary({})).toBe('sin datos personales');
  });

  it('actionText for each type of action, and nothing for something that is not one', () => {
    expect(actionText({ type: 'create_contact', fullName: 'X' })).toBe('contacto nuevo');
    expect(actionText({ type: 'create_task', title: 'Llamar' })).toBe('tarea: Llamar');
    expect(actionText({ type: 'otra' })).toBe('otra');
    expect([actionText(null), actionText('nota'), actionText({ body: 'x' })]).toEqual([null, null, null]);
  });

  it('statusText and outcomeTag for each state', () => {
    const complaint = goldenEvents('complaint');

    expect(statusText(station(complaint.slice(0, 3), 'person'))).toBe('espera a la persona');
    expect(statusText(station(complaint.slice(0, 2), 'classification'))).toBe('en curso');
    expect(statusText(station(complaint, 'knowledge'))).toBe('saltada');
    expect(statusText(station(complaint, 'close'))).toBeNull();
    expect(outcomeTag(station(complaint, 'classification'))).toBe('queja');
    expect(outcomeTag(station(complaint, 'intake'))).toBeNull();
  });

  it('redactedText is the filter’s stored text, and nothing before it arrives', () => {
    expect(redactedText(goldenEvents('normal'))).toContain('[documento]');
    expect(redactedText(goldenEvents('normal').slice(0, 1))).toBeNull();
  });

  it('runClock is stored time, and says since when it waits for the person', () => {
    const complaint = goldenEvents('complaint');

    expect(runClock([], false)).toBeNull();
    expect(runClock(complaint, false)).toEqual({ elapsedMs: 90, waitingSince: null });
    expect(runClock(complaint.slice(0, 3), true)).toEqual({ elapsedMs: 50, waitingSince: '04:00:00' });
  });

  it('runStateText for a run that goes on, waits, ends, stops or fails', () => {
    const normal = goldenEvents('normal');
    const state = (events: readonly RunEvent[]) => runStateText(projectRun(info, events), events.at(-1) ?? null, nameOf);
    const failed = [...normal.slice(0, 2), { ...normal[2], outcome: 'error', status: 'failed' } as RunEvent];

    expect(state(normal.slice(0, 3))).toBe('en curso · knowledge');
    expect(state(normal.slice(0, 5))).toBe('espera a la persona');
    expect(state(normal)).toBe('terminada');
    expect(state(goldenEvents('injection'))).toBe('detenida en Filtro');
    expect(state(failed)).toBe('falló · classification');
  });
});
