import { describe, expect, it } from 'vitest';

import { CENTER_SCALE, STATION_ANGLES, layoutFor, radiusFor, ringArc, ringPoint } from '../src/layout.ts';
import { boardInfo } from './support.ts';

// docs/diseno.md §6 and §9: the orbit is recomposed for each window, never scaled.

const stations = boardInfo().stations;
const SIZES = [
  [1280, 720],
  [1536, 864],
  [768, 864],
  [720, 900],
  [2560, 1080],
  [2560, 1440],
] as const;

describe('the orbit at each size', () => {
  it('R = clamp(50 × min(w/1536, h/864), 33, 80)', () => {
    expect(radiusFor(1536, 864)).toBe(50);
    expect(radiusFor(1280, 720)).toBeCloseTo(41.67, 1);
    expect(radiusFor(720, 900)).toBe(33);
    expect(radiusFor(2560, 1440)).toBeCloseTo(80, 5);
    expect(radiusFor(5120, 2880)).toBe(80);
  });

  it.each(SIZES)('at %s×%s every bubble is inside the window, and Persona at the center, larger', (width, height) => {
    const layout = layoutFor(width, height, stations);
    const places = Object.entries(layout.places);

    expect(places).toHaveLength(7);
    for (const [id, place] of places) {
      expect(place.x - place.r, id).toBeGreaterThan(0);
      expect(place.x + place.r, id).toBeLessThan(width);
      expect(place.y - place.r, id).toBeGreaterThan(0);
      expect(place.y + place.r, id).toBeLessThan(height - layout.bottom);
    }
    expect(layout.places['person']).toMatchObject({ x: layout.center.x, y: layout.center.y, r: layout.radius * CENTER_SCALE, side: 'center' });
  });

  it('the stations go around in the order of the route, at the angles of §6', () => {
    const layout = layoutFor(1536, 864, stations);

    expect(Object.fromEntries(Object.entries(layout.places).filter(([, place]) => place.angle !== null).map(([id, place]) => [id, place.angle]))).toEqual(STATION_ANGLES);
    expect(layout.places['intake']?.side).toBe('left');
    expect(layout.places['knowledge']?.side).toBe('right');
  });

  it('an ultrawide window does not stretch the ellipse past 2.2 times its height', () => {
    const layout = layoutFor(2560, 1080, stations);

    expect(layout.rx).toBeLessThanOrEqual(layout.ry * 2.2 + 1e-9);
    expect(layout.narrow).toBe(false);
    expect(layout.wide).toBe(true);
    expect(layoutFor(1536, 864, stations).wide).toBe(false);
  });

  it('half a screen is narrow, with a tall ellipse; 1280×720 shows the duration only', () => {
    const half = layoutFor(768, 864, stations);

    expect(half.narrow).toBe(true);
    expect(half.ry).toBeGreaterThan(half.rx);
    expect(layoutFor(1280, 720, stations).shortTelemetry).toBe(true);
    expect(layoutFor(1536, 864, stations).shortTelemetry).toBe(false);
  });

  it('a station the design has no angle for still gets a place', () => {
    const layout = layoutFor(1536, 864, [...stations, { id: 'nueva', number: 8, decidedBy: 'code' }]);

    expect(layout.places['nueva']?.angle).toBe(90 + 7 * 12);
  });
});

describe('the paths', () => {
  const layout = layoutFor(1536, 864, stations);

  it('ring arcs: none for nothing, small and large arcs, and the threshold mark', () => {
    expect(ringArc({ x: 0, y: 0 }, 10, 0)).toBeNull();
    expect(ringArc({ x: 0, y: 0 }, 10, 0.25)).toBe('M 0 -10 A 10 10 0 0 1 10 0');
    expect(ringArc({ x: 0, y: 0 }, 10, 0.75)).toMatch(/ 0 1 1 /);
    expect(ringArc({ x: 0, y: 0 }, 10, 1)).not.toBeNull();
    const mark = ringPoint({ x: 0, y: 0 }, 10, 0.5);
    expect([Math.round(mark.x), Math.round(mark.y)]).toEqual([0, 10]);
  });
});
