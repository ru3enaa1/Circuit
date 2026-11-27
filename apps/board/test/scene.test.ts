import { describe, expect, it } from 'vitest';

import { layoutFor } from '../src/layout.ts';
import { projectRun } from '../src/projection.ts';
import { overlaps, sceneOf, type Box } from '../src/scene.ts';
import { armDistance, armRadius, bubblePath, circlePath, neckPath, planArms } from '../src/shape.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents, prefixes } from './support.ts';

// The drawing of boceto B1 (docs/diseno.md §5–§7, ADR-0014 G8): the nodes sit in the widest gap
// between a station's tubes, and no text of the orbit covers a station, another text or the dock.

const info = boardInfo();
const SIZES = [
  [1536, 864],
  [768, 864],
  [720, 900],
  [2560, 1080],
] as const;
const TURN = 2 * Math.PI;

/** The angular distance between two directions, 0 to π. */
function apart(a: number, b: number): number {
  const d = Math.abs((((a - b) % TURN) + TURN) % TURN);
  return Math.min(d, TURN - d);
}

describe('the arms of a station', () => {
  it('go in the widest gap between its connections, with the middle slot kept for the telemetry', () => {
    // Tubes to the right and up: the widest gap is the lower left half.
    const plan = planArms([0, -Math.PI / 2], 2);

    expect(plan.arms).toHaveLength(2);
    for (const arm of plan.arms) {
      expect(apart(arm, 0)).toBeGreaterThan(0.4);
      expect(apart(arm, -Math.PI / 2)).toBeGreaterThan(0.4);
    }
    expect(apart(plan.lead, (3 * Math.PI) / 4)).toBeLessThan(1e-9);
    // With an odd count the telemetry takes the slot just past the middle, as B1 does.
    expect(planArms([0, -Math.PI / 2], 3).arms.every((arm) => apart(arm, planArms([0, -Math.PI / 2], 3).lead) > 0.4)).toBe(true);
  });

  it('with one connection, spread around the way opposite to it; with none, around the right', () => {
    const one = planArms([Math.PI], 2);
    expect(one.arms.every((arm) => apart(arm, Math.PI) > 2)).toBe(true);
    expect(planArms([], 0)).toEqual({ arms: [], lead: Math.PI });
  });

  it('a bubble is one shape: its circle, and a circle and a neck per node', () => {
    const center = { x: 0, y: 0 };
    const node = { x: armDistance(50, 50), y: 0 };
    const path = bubblePath(center, 50, [{ angle: 0, center: node, r: armRadius(50) }]);

    expect(path).toBe(circlePath(center, 50) + circlePath(node, armRadius(50)) + neckPath(center, 50, node, armRadius(50)));
    expect(path.match(/Z/g)).toHaveLength(3);
  });

  it('the neck starts on the station and ends on the node', () => {
    const neck = neckPath({ x: 0, y: 0 }, 50, { x: 90, y: 0 }, 13.5);
    const points = [...neck.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => Math.hypot(Number(match[1]), Number(match[2])));

    expect(points[0]).toBeCloseTo(50, 0);
  });
});

/** The bubble of each station and each node, as boxes. */
function solids(scene: ReturnType<typeof sceneOf>): Box[] {
  return scene.stations.flatMap((entry) => [
    { x: entry.place.x, y: entry.place.y, w: entry.place.r * 2, h: entry.place.r * 2 },
    ...entry.arms.map((arm) => ({ x: arm.center.x, y: arm.center.y, w: arm.r * 2, h: arm.r * 2 })),
  ]);
}

describe.each(GOLDEN_CASES)('G8 · the scene of the golden case %s', (name) => {
  const events = goldenEvents(name);

  it.each(SIZES)('at %s×%s, for every prefix, every text stays in the window, above the dock, off the stations and off each other', (width, height) => {
    const layout = layoutFor(width, height, info.stations);
    for (const prefix of prefixes(events)) {
      const scene = sceneOf(projectRun(info, prefix), layout, info);
      const texts = scene.stations.flatMap((entry) => [...entry.labels.filter((label) => label.label !== ''), ...(entry.telemetry === null ? [] : [entry.telemetry])]);
      const where = `${prefix.length} eventos`;
      for (const text of texts) {
        expect(text.x - text.w / 2, where).toBeGreaterThanOrEqual(0);
        expect(text.x + text.w / 2, where).toBeLessThanOrEqual(width);
        expect(text.y + text.h / 2, where).toBeLessThanOrEqual(height - layout.bottom);
        for (const solid of solids(scene)) expect(overlaps(text, solid, 0), `${where}: ${JSON.stringify(text)}`).toBe(false);
      }
      texts.forEach((text, index) => {
        for (const other of texts.slice(index + 1)) expect(overlaps(text, other, 0), `${where}: ${JSON.stringify([text, other])}`).toBe(false);
      });
    }
  });

  it('is the same every time for the same events', () => {
    const layout = layoutFor(1536, 864, info.stations);
    const view = projectRun(info, events);

    expect(JSON.stringify(sceneOf(view, layout, info))).toBe(JSON.stringify(sceneOf(view, layout, info)));
  });
});

const CROWDED_SIZES = [[1280, 720], [1366, 768], [1920, 1080], [1280, 1024], [2560, 1440], ...SIZES] as const;

describe('G8 · a crowded station', () => {
  // The sizes of §3, from 1280×720 up, and the half screens. Six proposed actions put six names around CRM, more than its gap holds at their natural place:
  // the texts must be moved apart, not left on top of each other.
  const events = goldenEvents('normal');
  const crowded = events.map((event) =>
    event.station === 'crm' ? { ...event, detail: { ...event.detail, actions: ['add_note', 'create_task', 'move_stage', 'create_contact', 'update_contact', 'add_note'].map((type) => ({ type, title: 'Llamar', stage: 'programa-propuesto', dueOn: '2026-12-01' })) } } : event,
  );

  it.each(CROWDED_SIZES)('at %s×%s no two texts touch and none covers a station', (width, height) => {
    const layout = layoutFor(width, height, info.stations);
    const scene = sceneOf(projectRun(info, crowded), layout, info);
    const texts = scene.stations.flatMap((entry) => [...entry.labels, ...(entry.telemetry === null ? [] : [entry.telemetry])]);

    expect(scene.stations.find((entry) => entry.station.id === 'crm')?.labels).toHaveLength(6);
    texts.forEach((text, index) => {
      for (const other of texts.slice(index + 1)) expect(overlaps(text, other, 0), JSON.stringify([text, other])).toBe(false);
      for (const solid of solids(scene)) expect(overlaps(text, solid, 0), JSON.stringify(text)).toBe(false);
    });
  });
});

describe('G8 · the tubes and the nodes', () => {
  it('no node sits on a tube: each arm is away from every way out of its station', () => {
    for (const [width, height] of SIZES) {
      const layout = layoutFor(width, height, info.stations);
      const scene = sceneOf(projectRun(info, goldenEvents('normal')), layout, info);
      for (const entry of scene.stations) {
        const ways = scene.edges.flatMap((edge) => {
          if (edge.edge.from === entry.station.id) return [Math.atan2(edge.to.y - edge.from.y, edge.to.x - edge.from.x)];
          if (edge.edge.to === entry.station.id && edge.edge.kind !== 'exit' && edge.edge.kind !== 'stop') return [Math.atan2(edge.from.y - edge.to.y, edge.from.x - edge.to.x)];
          return [];
        });
        for (const arm of entry.arms) for (const way of ways) expect(apart(arm.angle, way), `${width}×${height} ${entry.station.id}`).toBeGreaterThan(0.3);
      }
    }
  });

  it('the branch carries its label, and the stop its own while the run did not stop', () => {
    const layout = layoutFor(1536, 864, info.stations);
    const scene = sceneOf(projectRun(info, goldenEvents('normal')), layout, info);

    expect(scene.edges.find((edge) => edge.edge.kind === 'branch')?.label).not.toBeNull();
    expect(scene.edges.find((edge) => edge.edge.kind === 'stop')?.stop).not.toBeNull();
    expect(scene.entry).not.toBeNull();
  });
});
