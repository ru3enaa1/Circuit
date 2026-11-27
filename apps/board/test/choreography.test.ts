import { readFileSync } from 'node:fs';

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { Crew, figureKey } from '../src/components/Crew.tsx';
import { StationBall } from '../src/components/StationBall.tsx';
import { braidPath } from '../src/shape.ts';
import { crewFor } from '../src/crew.ts';
import { layoutFor } from '../src/layout.ts';
import { projectRun, type StationView } from '../src/projection.ts';
import { sceneOf } from '../src/scene.ts';
import { REVEAL_STEP_MS } from '../src/use-run-events.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, prefixes } from './support.ts';

// ADR-0018: one reveal is one move of the request, in three beats (leave, travel, arrive), so the
// board reads as a flow and not as a change of slides. All of it still comes from stored events:
// a braid (ADR-0019, which made the pulse two strands) exists only on the route a revealed event
// made dashed, and the beats are CSS.

const info = boardInfo();
const MOTION = readFileSync(new URL('../src/motion.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ROOT = new Map([...MOTION.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()]));
/** The braid may still grow over the tube's last stretch, under the bubble, when the station lights up. */
const PULSE_FADE_MS = 40;

function render(events: readonly RunEvent[]): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: null, lastOutcome: null, lastStatus: null }];
  const props: BoardProps = { status: 'ready', info, tools: [], runs, runId: 12, events, width: 1536, height: 864 };
  return renderToStaticMarkup(createElement(Board, props));
}

/** Each taken edge group of the markup: its dashed route, its braids and their strands. */
function edges(markup: string): { edge: string; now: number; person: number; pulses: string[]; braids: string[] }[] {
  return [...markup.matchAll(/<g class="edge[^"]*" data-edge="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)].map(([, edge = '', body = '']) => ({
    edge,
    now: (body.match(/class="edge__route is-now[^"]*"/g) ?? []).length,
    person: (body.match(/class="edge__route is-now is-person"/g) ?? []).length,
    pulses: body.match(/<path class="edge__strand[^"]*"[^>]*>/g) ?? [],
    braids: body.match(/<g class="edge__braid[^"]*"/g) ?? [],
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

describe('ADR-0019 · the request travels: a braid on the route a revealed event made dashed', () => {
  it.each(GOLDEN_CASES)('the golden case %s: one braid of two strands on each dashed route, and none elsewhere', (name) => {
    for (const events of prefixes(goldenEvents(name))) {
      for (const { edge, now, person, pulses, braids } of edges(render(events))) {
        const step = `${name}, ${events.length} events, ${edge}`;
        expect({ step, braids: braids.length, strands: pulses.length }).toEqual({ step, braids: now, strands: 2 * now });
        for (const pulse of pulses) expect({ step, measured: pulse.includes('pathLength="1"') }).toEqual({ step, measured: true });
        // A braid, not one thick strand: the two waves leave the tube's center line to opposite sides.
        const shapes = new Set(pulses.map((pulse) => /\sd="([^"]*)"/.exec(pulse)?.[1]));
        expect({ step, shapes: shapes.size }).toEqual({ step, shapes: pulses.length });
        // The braid settles in the color the route takes: pink toward Persona waiting for the person.
        expect({ step, pink: braids.filter((braid) => braid.includes('is-person')).length }).toEqual({ step, pink: person });
      }
    }
  });

  it('the check sees a braid (control): the normal case sends one at each move, and the complaint one goes pink', () => {
    const moving = prefixes(goldenEvents('normal')).filter((prefix) => edges(render(prefix)).some((edge) => edge.braids.length > 0));
    const pink = prefixes(goldenEvents('complaint')).filter((prefix) => edges(render(prefix)).some((edge) => edge.person > 0));

    expect(moving.length).toBeGreaterThanOrEqual(4);
    expect(pink.length).toBeGreaterThan(0);
  });

  it('a strand is a wave around the tube: two of opposite side cross on its center line', () => {
    const a = braidPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 4, 20, 1);
    const b = braidPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 4, 20, -1);

    expect(a).toBe('M0 0Q5 8 10 0T20 0T30 0T40 0T50 0T60 0T70 0T80 0T90 0T100 0');
    expect(b).toBe('M0 0Q5 -8 10 0T20 0T30 0T40 0T50 0T60 0T70 0T80 0T90 0T100 0');
    // Along a slanted tube the wave leaves it square: its first control point is on the normal.
    expect(braidPath({ x: 0, y: 0 }, { x: 0, y: 100 }, 4, 20, 1).startsWith('M0 0Q-8 5 0 10')).toBe(true);
  });
});

describe('ADR-0018 · the three beats, read from motion.css', () => {
  const [pulse, pulseAt] = timing('.edge__strand--a');
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

  it('both strands grow together, and the station that waits lights up when the braid is in, the ring with it', () => {
    expect(timing('.edge__strand--b')).toEqual([pulse, pulseAt]);
    expect(arriveAt).toBeGreaterThanOrEqual(pulseAt + pulse - PULSE_FADE_MS);
    // The route in the state's one color takes over from the braid when it connects.
    expect(timing('.edge__route.is-now')[1]).toBe(arriveAt);
    expect(timing('.station__selected')[1]).toBe(arriveAt);
    expect(timing('.station__wait-ring')[1]).toBe(arriveAt);
  });

  it('its icon and name turn dark only once it is lit: never dark on the dark ground', () => {
    expect(timing('.station--waiting .station__inside', 'transition')[1]).toBeGreaterThanOrEqual(arriveAt);
    expect(timing('.station--person.station--waiting .station__outline', 'transition')[1]).toBeGreaterThanOrEqual(arriveAt);
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
