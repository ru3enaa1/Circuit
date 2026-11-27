import { readFileSync } from 'node:fs';

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { Crew, figureKey } from '../src/components/Crew.tsx';
import { StationBall } from '../src/components/StationBall.tsx';
import { crewFor } from '../src/crew.ts';
import { layoutFor } from '../src/layout.ts';
import { projectRun, type StationView } from '../src/projection.ts';
import { sceneOf } from '../src/scene.ts';
import { REVEAL_STEP_MS } from '../src/use-run-events.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, prefixes } from './support.ts';

// ADR-0018: one reveal is one move of the request, in three beats (leave, travel, arrive), so the
// board reads as a flow and not as a change of slides. All of it still comes from stored events:
// a pulse exists only on the route a revealed event made dashed, and the beats are CSS.

const info = boardInfo();
const MOTION = readFileSync(new URL('../src/motion.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ROOT = new Map([...MOTION.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()]));
/** The pulse may still fade over the tube's last stretch when the station lights up. */
const PULSE_FADE_MS = 40;

function render(events: readonly RunEvent[]): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: null, lastOutcome: null, lastStatus: null }];
  const props: BoardProps = { status: 'ready', info, tools: [], runs, runId: 12, events, width: 1536, height: 864 };
  return renderToStaticMarkup(createElement(Board, props));
}

/** Each taken edge group of the markup: its dashed route and its pulses. */
function edges(markup: string): { edge: string; now: number; pulses: string[] }[] {
  return [...markup.matchAll(/<g class="edge[^"]*" data-edge="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)].map(([, edge = '', body = '']) => ({
    edge,
    now: (body.match(/class="edge__route is-now"/g) ?? []).length,
    pulses: body.match(/<path class="edge__pulse"[^>]*>/g) ?? [],
  }));
}

/** [duration, delay] in ms of the one `animation` or `transition` of the rule with exactly this selector. */
function timing(selector: string, property: 'animation' | 'transition' = 'animation'): [number, number] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(MOTION)?.[1] ?? '';
  const value = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body)?.[1] ?? '';
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => ROOT.get(name) ?? whole);
  const [duration = Number.NaN, delay = 0] = [...resolved.matchAll(/(\d+(?:\.\d+)?)ms\b/g)].map(([, ms = '0']) => Number(ms));
  return [duration, delay];
}

describe('ADR-0018 · the request travels: a pulse on the route a revealed event made dashed', () => {
  it.each(GOLDEN_CASES)('the golden case %s: one pulse on each dashed route, and none elsewhere', (name) => {
    for (const events of prefixes(goldenEvents(name))) {
      for (const { edge, now, pulses } of edges(render(events))) {
        const step = `${name}, ${events.length} events, ${edge}`;
        expect({ step, pulses: pulses.length }).toEqual({ step, pulses: now });
        for (const pulse of pulses) expect({ step, measured: pulse.includes('pathLength="1"') }).toEqual({ step, measured: true });
      }
    }
  });

  it('the check sees a pulse (control): the normal case sends one at each move between stations', () => {
    const events = goldenEvents('normal');
    const moving = prefixes(events).filter((prefix) => edges(render(prefix)).some((edge) => edge.pulses.length > 0));

    expect(moving.length).toBeGreaterThanOrEqual(4);
  });
});

describe('ADR-0018 · the three beats, read from motion.css', () => {
  const [pulse, pulseAt] = timing('.edge__pulse');
  const [arrive, arriveAt] = timing('.station--waiting .station__fill');

  it('reads the times (control)', () => {
    expect([pulse, pulseAt, arrive, arriveAt].every(Number.isFinite)).toBe(true);
    expect(timing('.no-such-rule')[0]).toBeNaN();
  });

  it('the pulse leaves while the completed station blooms and the route behind it turns solid', () => {
    const [bloom] = timing('.station__fill');
    const [draw] = timing('.edge__route');

    expect(pulseAt).toBeGreaterThan(0);
    expect(pulseAt).toBeLessThan(Math.max(bloom, draw));
  });

  it('the station that waits lights up when the pulse is in, and the ring lands with it', () => {
    expect(arriveAt).toBeGreaterThanOrEqual(pulseAt + pulse - PULSE_FADE_MS);
    expect(timing('.station__selected')[1]).toBe(arriveAt);
    expect(timing('.station__wait-ring')[1]).toBe(arriveAt);
  });

  it('its icon and name turn dark only once it is lit: never dark on the dark ground', () => {
    expect(timing('.station--waiting .station__inside', 'transition')[1]).toBeGreaterThanOrEqual(arriveAt);
    expect(timing('.station--person.station--waiting .station__outline', 'transition')[1]).toBeGreaterThanOrEqual(arriveAt);
  });

  it('the crew enters by turns, each figure with its hop, all inside the step', () => {
    const turns = ['.crew__figure', '.crew__figure:nth-child(2)', '.crew__figure:nth-child(3)', '.crew__figure:nth-child(4)'];
    const fades = turns.map((selector) => timing(selector));
    // The first figure's hop is the plain .crew__body rule; the others are under their nth-child.
    const hops = turns.map((selector, index) => timing(index === 0 ? '.crew__body' : `${selector} .crew__body`));

    expect(fades.map(([, delay]) => delay)).toEqual([...fades.map(([, delay]) => delay)].sort((a, b) => a - b));
    expect(new Set(fades.map(([, delay]) => delay)).size).toBe(turns.length);
    expect(hops.map(([, delay]) => delay)).toEqual(fades.map(([, delay]) => delay));
    for (const [duration, delay] of [...fades, ...hops]) expect(duration + delay).toBeLessThanOrEqual(REVEAL_STEP_MS);
  });
});

/** The host elements of a tree of React elements, without rendering a component. */
function hosts(node: ReactNode): ReactElement<{ className?: string; children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) return [];
  return [...(typeof node.type === 'string' ? [node] : []), ...hosts(node.props.children)];
}

describe('ADR-0018 · what mounts anew, so it enters again', () => {
  const station = (status: StationView['status']): StationView => ({ id: 'filter', number: 2, decidedBy: 'code', status, outcome: null, event: null });
  const fillOf = (status: StationView['status']) =>
    hosts(StationBall({ station: station(status), r: 40, base: 40, armAngles: [0, 1], threshold: 0.6 })).find((element) => element.props.className === 'station__fill');

  it('a station that completes mounts its fill anew: the fill is keyed by the state', () => {
    expect(fillOf('waiting')?.key).toBe('waiting');
    expect(fillOf('completed')?.key).toBe('completed');
  });

  it('a figure that moves to another spot is another figure: it enters again where it lands', () => {
    const events = goldenEvents('normal');
    const layout = layoutFor(1280, 720, info.stations);
    const crewAt = (length: number) => {
      const view = projectRun(info, events.slice(0, length));
      return crewFor(1, view, sceneOf(view, layout, info), layout);
    };
    const moved = prefixes(events)
      .slice(1)
      .flatMap((_, index) => crewAt(index + 1).filter((figure) => crewAt(index).some((before) => before.pose.id === figure.pose.id && figureKey(before) !== figureKey(figure))));

    // Control: the scene does move a figure with the same pose in the normal case (lupa, when Cierre waits).
    expect(moved.length).toBeGreaterThan(0);
    const figures = crewAt(events.length);
    const group = Crew({ figures }) as ReactElement<{ children: ReactElement[] }> | null;
    expect(group?.props.children.map((element) => element.key)).toEqual(figures.map(figureKey));
  });

  it('every figure carries the body that takes the hop', () => {
    const figures = crewFor(1, projectRun(info, []), sceneOf(projectRun(info, []), layoutFor(1280, 720, info.stations), info), layoutFor(1280, 720, info.stations));
    const markup = renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures })));

    expect(figures.length).toBeGreaterThan(0);
    expect((markup.match(/class="crew__body"/g) ?? []).length).toBe(figures.length);
  });
});
