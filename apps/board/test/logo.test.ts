import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Logo } from '../src/components/Logo.tsx';
import { STATION_ANGLES } from '../src/layout.ts';
import { LOGO_HOLE, LOGO_NECK_WIDTH, logoShapes } from '../src/logo.ts';
import { MARK_HALF, at, markDots, markNeck } from '../src/mark.ts';

// ADR-0014 G1 and G2: the logo is §12 of docs/diseno.md, measured, and it places its balls with
// the same function as the portal's miniature.

const YELLOW = '#FFD23F';
const PINK = '#FF5FA2';
const shapes = logoShapes('dark');
const dot = (id: string) => shapes.dots.find((entry) => entry.id === id)!;
const close = (a: number, b: number) => Math.abs(a - b) <= 0.06;

describe('G1 · the logo 4a', () => {
  it('puts Persona at the center, hollow, and six balls of 7,6 on a circle of 39', () => {
    expect(dot('person')).toMatchObject({ x: 0, y: 0, r: 11.5, hollow: true });
    expect(LOGO_HOLE).toBe(6);
    const around = shapes.dots.filter((entry) => !entry.center);
    expect(around.map((entry) => entry.id)).toEqual(['intake', 'filter', 'classification', 'knowledge', 'crm', 'close']);
    for (const entry of around) {
      expect(entry.r).toBe(7.6);
      expect(close(Math.hypot(entry.x, entry.y), 39), entry.id).toBe(true);
    }
  });

  it('keeps the angles of §6, except Filtro at 250°', () => {
    for (const entry of shapes.dots.filter((candidate) => !candidate.center)) {
      const expected = entry.id === 'filter' ? 250 : STATION_ANGLES[entry.id]!;
      const point = at(expected, 39);
      expect(close(entry.x, point.x) && close(entry.y, point.y), entry.id).toBe(true);
    }
  });

  it('draws the necks of §12 with the branch in yellow and the arrival at Persona in pink', () => {
    const colors = Object.fromEntries(shapes.necks.map((neck) => [neck.key, neck.color]));
    expect(colors).toEqual({
      'intake>filter': shapes.mark,
      'filter>classification': shapes.mark,
      'classification>knowledge': shapes.mark,
      'knowledge>crm': shapes.mark,
      'person>close': shapes.mark,
      'classification>person': YELLOW,
      'crm>person': PINK,
    });
    expect(LOGO_NECK_WIDTH).toBe(2.4);
  });

  it('leaves Persona empty inside: no neck starts or ends in its hole', () => {
    for (const neck of shapes.necks) {
      for (const [x, y] of [[neck.x1, neck.y1], [neck.x2, neck.y2]] as const) {
        expect(Math.hypot(x, y), neck.key).toBeGreaterThan(LOGO_HOLE);
      }
    }
  });

  it('stays inside its box', () => {
    for (const entry of shapes.dots) {
      expect(Math.max(Math.abs(entry.x), Math.abs(entry.y)) + entry.r).toBeLessThan(MARK_HALF);
    }
  });

  it('is bone on black and black on bone', () => {
    expect(logoShapes('dark')).toMatchObject({ mark: '#F3F1EC', background: '#0A0A0B' });
    expect(logoShapes('light')).toMatchObject({ mark: '#0A0A0B', background: '#F3F1EC' });
  });

  it('is a pure component: hidden from screen readers, the same markup each time, no class but its own', () => {
    const markup = renderToStaticMarkup(createElement(Logo, { size: 32 }));
    expect(markup).toBe(renderToStaticMarkup(createElement(Logo, { size: 32 })));
    expect(markup).toMatch(/^<svg class="logo" width="32" height="32" viewBox="-50 -50 100 100" aria-hidden="true">/);
    expect(markup.match(/class="/g)).toHaveLength(1);
    expect(markup.match(/<circle /g)).toHaveLength(7);
    expect(markup.match(/<line /g)).toHaveLength(7);
    expect(markup).not.toContain('<rect');
    expect(renderToStaticMarkup(createElement(Logo, { size: 16, background: true }))).toContain('<rect');
  });
});

describe('G2 · the logo and the portal are one figure', () => {
  it('markDots puts the center at 0 and the others at their angle, with the sizes given', () => {
    const dots = markDots([{ id: 'crm', center: false }, { id: 'person', center: true }], { orbit: 32, station: 6, center: 9 });
    const point = at(STATION_ANGLES['crm']!, 32);
    expect(dots[0]).toMatchObject({ id: 'crm', r: 6 });
    expect(close(dots[0]!.x, point.x) && close(dots[0]!.y, point.y)).toBe(true);
    expect(dots[1]).toEqual({ id: 'person', center: true, x: 0, y: 0, r: 9 });
  });

  it('the portal and the logo place their balls with markDots, and neither computes a place of its own', () => {
    for (const file of ['components/Portal.tsx', 'logo.ts']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('markDots(');
      expect(source, file).not.toMatch(/Math\.(cos|sin|PI)/);
    }
  });

  it('a station the design has no angle for goes to the bottom', () => {
    expect(markDots([{ id: 'new', center: false }], { orbit: 32, station: 6, center: 9 })[0]).toMatchObject({ x: 0, y: 32 });
  });

  it('markNeck runs from edge to edge, and leaves two balls in one place alone', () => {
    const from = { id: 'a', center: true, x: 0, y: 0, r: 10 };
    expect(markNeck(from, { id: 'b', center: false, x: 30, y: 0, r: 5 })).toEqual({ x1: 10, y1: 0, x2: 25, y2: 0 });
    expect(markNeck(from, { ...from, id: 'b' })).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});
