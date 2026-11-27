import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Crew, figureKey } from '../src/components/Crew.tsx';
import { WALK_MAX_MS, WALK_MIN_MS, WALK_POINTS, closedOnRoute, leavingPoint, resample, stationsBetween } from '../src/crew-moves.ts';
import { crewFor, type CrewFigure } from '../src/crew.ts';
import { layoutFor, type Layout } from '../src/layout.ts';
import { projectRun, type RunView } from '../src/projection.ts';
import { sceneOf, type Box } from '../src/scene.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, prefixes } from './support.ts';

// ADR-0019: the crew comes in along the two lines at the left, or out of a door on its spot, and
// once the run closes on its route one figure slides down the last line out of the window. All of
// it from the run's seed: the same run and the same window move the crew the same way.

const info = boardInfo();
const SIZES = [
  [1536, 864],
  [720, 900],
  [2560, 1080],
] as const;
const RUN_IDS = [1, 2, 3, 4, 12, 57, 300] as const;

function crewOf(runId: number | null, view: RunView, width = 1536, height = 864) {
  const layout = layoutFor(width, height, info.stations);
  const scene = sceneOf(view, layout, info);
  return { layout, scene, crew: crewFor(runId, view, scene, layout) };
}

const shifted = (box: Box, by: { x: number; y: number }): Box => ({ ...box, x: box.x + by.x, y: box.y + by.y });
const outside = (box: Box, layout: Layout) => box.x + box.w / 2 <= 0 || box.x - box.w / 2 >= layout.width || box.y + box.h / 2 <= 0 || box.y - box.h / 2 >= layout.height;

describe('ADR-0019 · every figure arrives', () => {
  it.each(SIZES)('at %s×%s: a walk starts out of the window and ends on the spot; a door does not walk', (width, height) => {
    for (const name of GOLDEN_CASES) {
      for (const prefix of prefixes(goldenEvents(name))) {
        const view = projectRun(info, prefix);
        for (const runId of RUN_IDS) {
          const { layout, crew } = crewOf(runId, view, width, height);
          for (const figure of crew.filter((each) => each.move.kind !== 'leave')) {
            const { move } = figure;
            const where = `${name}, ${prefix.length} eventos, corrida ${runId}, ${figure.key}`;
            if (move.kind === 'door') {
              expect({ where, walk: move.walk.length, pose: figure.pose.seat === undefined }).toEqual({ where, walk: 0, pose: true });
              continue;
            }
            expect(move.walk, where).toHaveLength(WALK_POINTS);
            expect(move.walk.at(-1), where).toEqual({ x: 0, y: 0 });
            expect(outside(shifted(figure.box, move.walk[0] ?? { x: 0, y: 0 }), layout), where).toBe(true);
            expect(move.walkMs, where).toBeGreaterThanOrEqual(WALK_MIN_MS);
            expect(move.walkMs, where).toBeLessThanOrEqual(WALK_MAX_MS);
          }
        }
      }
    }
  });

  it('the three ways all happen across runs (control), and not all figures arrive at once', () => {
    const view = projectRun(info, goldenEvents('normal').slice(0, 3));
    const moves = RUN_IDS.flatMap((runId) => crewOf(runId, view).crew.map((figure) => figure.move));

    expect(new Set(moves.map((move) => move.kind))).toEqual(new Set(['entry', 'exit', 'door']));
    expect(new Set(moves.map((move) => move.atMs)).size).toBeGreaterThan(1);
  });

  it('a crew mixes its ways and its times: no whole crew out of doors at once, as the first run of the GIF was', () => {
    const view = projectRun(info, goldenEvents('normal').slice(0, 3));
    const crews = Array.from({ length: 60 }, (_, index) => crewOf(index + 1, view).crew).filter((crew) => crew.length >= 2);
    const mixed = crews.filter((crew) => new Set(crew.map((figure) => figure.move.kind)).size > 1 && new Set(crew.map((figure) => figure.move.atMs)).size > 1);

    expect(crews.length).toBeGreaterThan(50);
    expect(mixed.length / crews.length).toBeGreaterThanOrEqual(0.8);
    expect(new Set(crewOf(1, view, 1280, 720).crew.map((figure) => figure.move.kind)).size).toBeGreaterThan(1);
  });

  it('is the same every time for the same run, and another run moves it another way', () => {
    const view = projectRun(info, goldenEvents('normal'));
    const moves = (runId: number) => JSON.stringify(crewOf(runId, view).crew.map((figure) => figure.move));

    expect(moves(12)).toBe(moves(12));
    expect(new Set(RUN_IDS.map(moves)).size).toBeGreaterThan(1);
  });
});

describe('ADR-0019 · one figure slides down the last line once the run closes', () => {
  const closedRun = (runId: number) => crewOf(runId, projectRun(info, goldenEvents('normal')));

  it('only a run closed on its route sends one out, and before that nobody leaves', () => {
    for (const name of GOLDEN_CASES) {
      for (const prefix of prefixes(goldenEvents(name))) {
        const view = projectRun(info, prefix);
        for (const runId of RUN_IDS) {
          const leaving = crewOf(runId, view).crew.filter((figure) => figure.move.kind === 'leave');
          expect({ name, events: prefix.length, runId, leaving: leaving.length }).toEqual({ name, events: prefix.length, runId, leaving: closedOnRoute(view) ? 1 : 0 });
        }
      }
    }
    // Control: the normal case closes on its route; the injection stops at Filtro and does not.
    expect(closedOnRoute(projectRun(info, goldenEvents('normal')))).toBe(true);
    expect(closedOnRoute(projectRun(info, goldenEvents('injection')))).toBe(false);
  });

  it.each(RUN_IDS)('run %s: it walks from its spot to Cierre, then slides out of the window, leaning back', (runId) => {
    const { layout, crew } = closedRun(runId);
    const figure = crew.find((each) => each.move.kind === 'leave') as CrewFigure;
    const closing = layout.places[info.stations.at(-1)?.id ?? ''];
    const slide = figure.move.slide;
    if (closing === undefined || slide === null) throw new Error('Cierre o la salida');

    expect(figure.move.walk[0]).toEqual({ x: 0, y: 0 });
    // The walk ends under Cierre: the last offset takes the spot to Cierre's center line.
    const end = figure.move.walk.at(-1) ?? { x: 0, y: 0 };
    expect(Math.hypot(figure.box.x + end.x - closing.x, figure.box.y + end.y - closing.y)).toBeLessThan(closing.r + figure.box.h);
    expect(slide.atMs).toBe(figure.move.atMs + figure.move.walkMs);
    expect(outside(shifted(shifted(figure.box, end), slide.by), layout)).toBe(true);
    expect(Math.sign(slide.turn)).toBe(slide.by.x < 0 ? 1 : -1);
  });

  it('it mounts anew when it starts to leave, so its slide begins when the run closes', () => {
    const { crew } = closedRun(12);
    const figure = crew.find((each) => each.move.kind === 'leave') as CrewFigure;

    expect(figureKey(figure)).toBe(`${figure.key}@sale`);
  });
});

describe('ADR-0019 · the way, as points', () => {
  const layout = layoutFor(1536, 864, info.stations);
  const scene = sceneOf(projectRun(info, []), layout, info);

  it('goes along the tubes: from Entrada to CRM through the main way, and to Persona by the branch', () => {
    const ids = info.stations.map((station) => station.id);

    expect(stationsBetween(scene, ids[0] ?? '', [ids[4] ?? ''])).toEqual(ids.slice(0, 5));
    expect(stationsBetween(scene, ids[0] ?? '', [ids[5] ?? ''])).toEqual([ids[0], ids[1], ids[2], ids[5]]);
    expect(stationsBetween(scene, ids[0] ?? '', ['no-such-station'])).toBeNull();
  });

  it('evenly spaced, every other point lifted for a step, the last one exact', () => {
    const points = resample([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
    ]);

    expect(points).toHaveLength(WALK_POINTS);
    expect(points.map((point) => point.x)).toEqual(Array.from({ length: WALK_POINTS }, (_, index) => index * 10));
    expect(points.map((point) => point.y)).toEqual(Array.from({ length: WALK_POINTS }, (_, index) => (index % 2 === 1 ? -3 : 0)));
  });

  it('leaves the window where its line crosses the edge, past it by the margin', () => {
    expect(leavingPoint({ x: 100, y: 100 }, { x: -1000, y: 100 }, layout, 50)).toEqual({ x: -50, y: 100 });
    expect(leavingPoint({ x: 100, y: 100 }, { x: 100, y: 5000 }, layout, 20)).toEqual({ x: 100, y: 884 });
  });
});

describe('ADR-0019 · how a journey is drawn', () => {
  it('a walk carries its points as custom properties, a door its door, and the leaver its slide', () => {
    const { crew } = crewOf(12, projectRun(info, goldenEvents('normal')));
    const markup = renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures: crew })));

    expect((markup.match(/class="crew__walk /g) ?? []).length).toBe(crew.length);
    expect((markup.match(/class="crew__slide"/g) ?? []).length).toBe(1);
    expect(markup).toMatch(/--slide-turn:-?\d+deg/);
    const walking = crew.find((figure) => figure.move.walk.length > 0);
    if (walking !== undefined) expect(markup).toContain(`--w${WALK_POINTS - 1}x:0px`);
    for (const figure of crew) expect(markup.includes(`data-figure="${figureKey(figure)}"`)).toBe(true);
    const door = RUN_IDS.flatMap((runId) => crewOf(runId, projectRun(info, [])).crew).find((figure) => figure.move.kind === 'door');
    if (door === undefined) throw new Error('una puerta');
    expect(renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures: [door] })))).toContain('class="crew__door"');
  });
});
