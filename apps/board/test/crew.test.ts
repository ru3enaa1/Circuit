import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Crew } from '../src/components/Crew.tsx';
import { crewFor, generator, seedOf, seriousOnly } from '../src/crew.ts';
import { POSES } from '../src/crew-poses.ts';
import { layoutFor } from '../src/layout.ts';
import { projectRun, type RunView } from '../src/projection.ts';
import { overlaps, sceneOf } from '../src/scene.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, prefixes } from './support.ts';

// ADR-0014 G4 (docs/diseno.md §11): the crew is decoration. The same run puts it the same way;
// no figure covers a station, a node, a text or the dock; in a stop, a failure or while the
// person decides, only serious poses; a pink prop never stands by a pink station.

const info = boardInfo();
const SIZES = [
  [1536, 864],
  [768, 864],
  [720, 900],
  [2560, 1080],
] as const;
const RUN_IDS = [1, 2, 3, 4, 12, 57, 300] as const;

function crewOf(runId: number | null, view: RunView, width: number, height: number) {
  const layout = layoutFor(width, height, info.stations);
  const scene = sceneOf(view, layout, info);
  return { layout, scene, crew: crewFor(runId, view, scene, layout) };
}

const isPink = (status: string, decidedBy: string) => status === 'stopped' || status === 'failed' || (status === 'waiting' && decidedBy === 'person');

describe('the seed', () => {
  it('is FNV-1a of 32 bits, and the generator gives the same draws for the same seed', () => {
    expect(seedOf('a')).toBe(0xe40c292c);
    expect(seedOf('')).toBe(0x811c9dc5);
    const first = generator(7);
    const second = generator(7);
    const draws = Array.from({ length: 5 }, () => first());

    expect(Array.from({ length: 5 }, () => second())).toEqual(draws);
    expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true);
  });
});

describe.each(GOLDEN_CASES)('G4 · the crew of the golden case %s', (name) => {
  const events = goldenEvents(name);

  it.each(SIZES)('at %s×%s, for every prefix and run, covers nothing and stays in the window', (width, height) => {
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      for (const runId of RUN_IDS) {
        const { layout, scene, crew } = crewOf(runId, view, width, height);
        const where = `${prefix.length} eventos, corrida ${runId}`;

        expect(crew.length, where).toBeLessThanOrEqual(4);
        for (const figure of crew) {
          for (const obstacle of scene.obstacles) expect(overlaps(figure.box, obstacle, 0), `${where}: ${figure.pose.id}`).toBe(false);
          expect(figure.box.y + figure.box.h / 2, where).toBeLessThanOrEqual(height - layout.bottom);
          expect(figure.box.y - figure.box.h / 2, where).toBeGreaterThanOrEqual(0);
          expect(figure.box.x - figure.box.w / 2, where).toBeGreaterThanOrEqual(0);
          expect(figure.box.x + figure.box.w / 2, where).toBeLessThanOrEqual(width);
        }
        crew.forEach((figure, index) => {
          for (const other of crew.slice(index + 1)) expect(overlaps(figure.box, other.box, 0), where).toBe(false);
        });
      }
    }
  });

  it('on a full window there are between two and four', () => {
    for (const [width, height] of [
      [1536, 864],
      [2560, 1080],
    ] as const) {
      for (const runId of RUN_IDS) expect(crewOf(runId, projectRun(info, events), width, height).crew.length, `${width}×${height} corrida ${runId}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('only serious poses in a stop, a failure or while the person decides; a pink prop never by a pink station', () => {
    for (const prefix of prefixes(events)) {
      const view = projectRun(info, prefix);
      for (const runId of RUN_IDS) {
        const { crew, layout } = crewOf(runId, view, 1536, 864);
        if (seriousOnly(view)) for (const figure of crew) expect(figure.pose.tone, `${prefix.length} eventos`).toBe('serio');
        const pink = view.stations.filter((station) => isPink(station.status, station.decidedBy));
        for (const figure of crew) {
          if (figure.pinkAsYellow) continue;
          for (const station of pink) {
            const place = layout.places[station.id];
            expect(figure.on, `${figure.pose.id} junto a ${station.id}`).not.toContain(station.id);
            if (place !== undefined) expect(Math.hypot(place.x - figure.box.x, place.y - figure.box.y)).toBeGreaterThanOrEqual(place.r * 3);
          }
        }
      }
    }
  });

  it('is the same every time for the same run', () => {
    const view = projectRun(info, events);

    expect(JSON.stringify(crewOf(12, view, 1536, 864).crew)).toBe(JSON.stringify(crewOf(12, view, 1536, 864).crew));
  });
});

describe('G4 · the crew as a whole', () => {
  it('different runs bring different crews, and with no run the crew still stands', () => {
    const view = projectRun(info, goldenEvents('normal'));
    const crews = new Set(RUN_IDS.map((runId) => crewOf(runId, view, 1536, 864).crew.map((figure) => `${figure.pose.id}@${Math.round(figure.x)}`).join(',')));

    expect(crews.size).toBeGreaterThan(1);
    expect(crewOf(null, projectRun(info, []), 1536, 864).crew.length).toBeGreaterThanOrEqual(2);
  });

  it('the twelve poses of B7: six of play, six serious, with distinct ids', () => {
    expect(POSES).toHaveLength(12);
    expect(POSES.filter((pose) => pose.tone === 'juego')).toHaveLength(6);
    expect(new Set(POSES.map((pose) => pose.id)).size).toBe(12);
  });

  it('is drawn hidden from assistive technology, one group per figure, with the pink turned yellow when asked', () => {
    const { crew } = crewOf(12, projectRun(info, goldenEvents('normal')), 1536, 864);
    const markup = renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures: crew })));

    expect(markup).toContain('<g class="crew" aria-hidden="true">');
    expect([...markup.matchAll(/data-pose="/g)]).toHaveLength(crew.length);
    const pinkPose = POSES.find((pose) => pose.id === 'saluda');
    if (pinkPose === undefined) throw new Error('pose');
    const figure = { pose: pinkPose, x: 0, y: 0, scale: 1, box: { x: 0, y: 0, w: 1, h: 1 }, on: ['a', 'b'] as const, pinkAsYellow: true };
    const yellow = renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures: [figure] })));
    expect(yellow).not.toContain('var(--pink)');
    expect(renderToStaticMarkup(createElement('svg', null, createElement(Crew, { figures: [{ ...figure, pinkAsYellow: false }] })))).toContain('var(--pink)');
    expect(renderToStaticMarkup(createElement(Crew, { figures: [] }))).toBe('');
  });
});
