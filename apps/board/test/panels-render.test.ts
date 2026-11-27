import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { crewFor } from '../src/crew.ts';
import { formatDecimal, formatDuration } from '../src/format.ts';
import { layoutFor } from '../src/layout.ts';
import { actionText, runClock } from '../src/nodes.ts';
import { projectRun } from '../src/projection.ts';
import { overlaps, sceneOf } from '../src/scene.ts';
import { leftFacts, panelSlots, rightFacts } from '../src/side-panels.ts';
import { TUBE_SCALE } from '../src/shape.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, goldenPersonal, prefixes } from './support.ts';

// ADR-0014 G5 (docs/diseno.md §9): the side panels exist only past 2.05 : 1, every figure they
// show is the projection's, and they cover no station, no text and no tube.

const info = boardInfo();
const WIDE = [
  [2560, 1080],
  [3440, 1440],
] as const;
const NOT_WIDE = [
  [1536, 864],
  [1280, 720],
  [768, 864],
  [720, 900],
  [2560, 1440],
] as const;

function render(events: readonly RunEvent[], width: number, height: number): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: events.at(-1)?.station ?? null, lastOutcome: events.at(-1)?.outcome ?? null, lastStatus: events.at(-1)?.status ?? null }];
  const props: BoardProps = { status: 'ready', info, tools: [], runs, runId: 12, events, width, height };
  return renderToStaticMarkup(createElement(Board, props));
}

/** A box and a straight line of some width: does the line pass through the box? */
function crossesLine(box: { x: number; y: number; w: number; h: number }, from: { x: number; y: number }, to: { x: number; y: number }, half: number): boolean {
  for (let index = 0; index <= 200; index++) {
    const x = from.x + ((to.x - from.x) * index) / 200;
    const y = from.y + ((to.y - from.y) * index) / 200;
    if (Math.abs(x - box.x) < box.w / 2 + half && Math.abs(y - box.y) < box.h / 2 + half) return true;
  }
  return false;
}

describe('G5 · the side panels', () => {
  it.each(NOT_WIDE)('do not exist at %s×%s', (width, height) => {
    expect(render(goldenEvents('normal'), width, height)).not.toContain('data-side-panel');
  });

  it.each(WIDE)('at %s×%s show the projection’s quote, actions, confidence and time, and the same time as the clock', (width, height) => {
    const events = goldenEvents('normal');
    const markup = render(events, width, height);
    const view = projectRun(info, events);
    const knowledge = view.stations.find((station) => station.id === 'knowledge')?.event;
    const crm = view.stations.find((station) => station.id === 'crm')?.event;
    const confidence = view.stations.find((station) => station.id === 'classification')?.event?.detail['confidence'];
    const elapsed = formatDuration(runClock(events, false)?.elapsedMs ?? -1);

    expect(markup).toContain('data-side-panel="left"');
    expect(markup).toContain('data-side-panel="right"');
    expect(markup).toContain(`«${String(knowledge?.detail['quote'])}»`);
    for (const action of (crm?.detail['actions'] ?? []) as never[]) expect(markup).toContain(`<li>${actionText(action, true) ?? '—'}</li>`);
    expect(markup).toMatch(new RegExp(`data-panel-confidence="true">${formatDecimal(Number(confidence), 2)}<`));
    expect(markup).toMatch(new RegExp(`data-panel-duration="true">${elapsed} · simulador<`));
    expect(markup).toMatch(new RegExp(`data-clock="true">${elapsed.split(' ')[0]}<`));
  });

  it('a panel with no data is not drawn: before Conocimiento there is no left panel', () => {
    const markup = render(goldenEvents('normal').slice(0, 2), 2560, 1080);

    expect(markup).not.toContain('data-side-panel="left"');
    expect(markup).toContain('data-side-panel="right"');
    expect(leftFacts(projectRun(info, []), info)).toBeNull();
    expect(rightFacts(projectRun(info, []), info, [])).toBeNull();
  });
});

describe.each(GOLDEN_CASES)('G5 · the panels of the golden case %s', (name) => {
  const events = goldenEvents(name);

  it.each(WIDE)('at %s×%s, for every prefix, cover no station, node, text or tube, and the crew keeps off them', (width, height) => {
    const layout = layoutFor(width, height, info.stations);
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      const scene = sceneOf(view, layout, info);
      const panels = panelSlots(layout, scene);
      const where = `${prefix.length} eventos`;

      expect(panels.map((panel) => panel.side), where).toEqual(['left', 'right']);
      for (const panel of panels) {
        for (const obstacle of scene.obstacles) expect(overlaps(panel, obstacle, 0), `${where}: ${panel.side}`).toBe(false);
        for (const edge of scene.edges) {
          const half = edge.edge.kind === 'main' || edge.edge.kind === 'branch' ? (layout.radius * TUBE_SCALE) / 2 : 1;
          expect(crossesLine(panel, edge.from, edge.to, half), `${where}: ${panel.side} ${edge.edge.from}>${edge.edge.to}`).toBe(false);
        }
        expect(panel.y + panel.h / 2, where).toBeLessThanOrEqual(height - layout.bottom);
        for (const figure of crewFor(12, view, scene, layout, panels)) expect(overlaps(figure.box, panel, 0), `${where}: ${figure.pose.id}`).toBe(false);
      }
    }
  });

  it('never show what the filter crossed out', () => {
    for (const prefix of prefixes(events)) {
      const markup = render(prefix, 2560, 1080);
      for (const value of goldenPersonal(name)) expect(markup, value).not.toContain(value);
    }
  });
});
