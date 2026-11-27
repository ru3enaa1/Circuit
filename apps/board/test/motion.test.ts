import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { REVEAL_STEP_MS } from '../src/use-run-events.ts';
import { GOLDEN_CASES, boardInfo, goldenEvents } from './support.ts';

// ADR-0016 (R11): the board moves only where a stored event changed it. Each frame of the reveal is
// the markup of a prefix of the stored events; what a revealed event mounts enters with a CSS
// animation of motion.css, so nothing appears at once. The motion stays CSS: no state, no timer.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MOTION_FILE = 'motion.css';
const info = boardInfo();

function render(events: readonly RunEvent[]): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: events.at(-1)?.station ?? null, lastOutcome: events.at(-1)?.outcome ?? null, lastStatus: events.at(-1)?.status ?? null }];
  const props: BoardProps = { status: 'ready', info, tools: [], runs, runId: 12, events, width: 1536, height: 864 };
  return renderToStaticMarkup(createElement(Board, props));
}

function css(name: string): string {
  const path = join(SRC, name);
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') : '';
}

const cssFiles = () => readdirSync(SRC).filter((name) => name.endsWith('.css'));

/** A modifier says how an element looks, not which element it is: is-taken, station--completed. */
const isModifier = (token: string) => token.includes('--') || /^(is|has)-/.test(token);

interface Element {
  readonly key: string;
  /** Every class it carries, modifiers included: a rule matches on all of them. */
  readonly classes: readonly string[];
  readonly parent: Element | null;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

/** The markup's elements with a class, each with its nearest parent with a class. React's static markup is well formed. */
function elements(markup: string): Element[] {
  const found: Element[] = [];
  const stack: (Element | null)[] = [];
  const nearest = () => [...stack].reverse().find((entry) => entry !== null) ?? null;
  for (const match of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, tag = '', attributes = '', selfClosing] = match;
    if (closing === '/') {
      stack.pop();
      continue;
    }
    const classes = (/\bclass="([^"]*)"/.exec(attributes)?.[1] ?? '').split(/\s+/).filter((token) => token !== '');
    const base = classes.filter((token) => !isModifier(token)).sort();
    const pose = /\bdata-pose="([^"]*)"/.exec(attributes)?.[1];
    const element = base.length === 0 ? null : { key: `${tag}.${base.join('.')}${pose === undefined ? '' : `#${pose}`}`, classes, parent: nearest() };
    if (element !== null) found.push(element);
    if (selfClosing !== '/' && !VOID.has(tag.toLowerCase())) stack.push(element);
  }
  return found;
}

/** What motion.css animates: the classes of the last compound of each selector of a rule with an animation. */
function animatedRules(text: string): string[][] {
  const animated: string[][] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors = '', body = ''] = match;
    if (!/(^|;|\s)animation(-name)?\s*:\s*(?!none)/.test(body)) continue;
    for (const selector of selectors.split(',')) {
      const last = selector.trim().split(/[\s>+~]+/).at(-1) ?? '';
      const compound = [...last.matchAll(/\.([\w-]+)/g)].map((token) => token[1] ?? '');
      if (compound.length > 0) animated.push(compound);
    }
  }
  return animated;
}

/** What a frame mounts that the frame before did not have, and is not entered by a new animated element. */
function appearingAtOnce(before: string, after: string, animated: readonly (readonly string[])[]): string[] {
  const count = (list: readonly Element[]) => list.reduce((map, element) => map.set(element.key, (map.get(element.key) ?? 0) + 1), new Map<string, number>());
  const previous = count(elements(before));
  const next = elements(after);
  const now = count(next);
  const isNew = (element: Element) => (now.get(element.key) ?? 0) > (previous.get(element.key) ?? 0);
  const enters = (element: Element | null): boolean => element !== null && ((isNew(element) && animated.some((rule) => rule.every((name) => element.classes.includes(name)))) || enters(element.parent));
  return [...new Set(next.filter((element) => isNew(element) && !enters(element)).map((element) => element.key))];
}

describe('ADR-0016 · what a revealed event mounts enters with motion', () => {
  const animated = animatedRules(css(MOTION_FILE));

  it.each(GOLDEN_CASES)('the golden case %s: nothing appears at once from one frame to the next', (name) => {
    const events = goldenEvents(name);
    for (let length = 0; length < events.length; length += 1) {
      const step = `${name}, event ${length + 1}`;
      expect({ step, atOnce: appearingAtOnce(render(events.slice(0, length)), render(events.slice(0, length + 1)), animated) }).toEqual({ step, atOnce: [] });
    }
  });

  it('the check sees what appears (control): with no animation, the normal case mounts elements at once', () => {
    const events = goldenEvents('normal');

    expect(appearingAtOnce(render(events.slice(0, 2)), render(events.slice(0, 3)), [])).toEqual(expect.arrayContaining(['path.station__fill']));
  });

  it('an element that was already there, or a rule for another modifier, does not enter it (control)', () => {
    const before = '<svg class="orbit"><g class="station"></g></svg>';
    const after = '<svg class="orbit"><g class="station"></g><path class="edge__route"></path></svg>';

    expect(appearingAtOnce(before, after, [['orbit']])).toEqual(['path.edge__route']);
    expect(appearingAtOnce(before, after, [['edge__route', 'is-now']])).toEqual(['path.edge__route']);
    expect(appearingAtOnce(before, after, [['edge__route']])).toEqual([]);
  });

  it('the yellow route draws from its station: the solid one is measured in one, the one toward a waiting station is not', () => {
    const events = goldenEvents('normal');
    const routes = [...render(events.slice(0, 3)).matchAll(/<path class="edge__route( is-now)?"[^>]*>/g)].map((match) => match[0]);

    expect(routes.some((route) => route.includes('is-now') && !route.includes('pathLength'))).toBe(true);
    expect(routes.some((route) => !route.includes('is-now') && route.includes('pathLength="1"'))).toBe(true);
  });
});

/** Every time of a declaration, as ms, with the :root custom properties resolved. */
function times(declaration: string, root: ReadonlyMap<string, string>): number[][] {
  const resolved = declaration.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => root.get(name) ?? whole);
  // A comma inside parentheses belongs to a timing function, cubic-bezier(0.4, 0, 1, 1), not to the list.
  return resolved.split(/,(?![^(]*\))/).map((part) => [...part.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(([, value = '0', unit]) => Number(value) * (unit === 's' ? 1000 : 1)));
}

describe('ADR-0016 · how long the board moves (docs/diseno.md §14)', () => {
  const root = new Map([...cssFiles().map(css).join('').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()]));
  const declarations = cssFiles().flatMap((name) =>
    [...css(name).matchAll(/(?:^|[;{\s])(animation|transition)\s*:\s*([^;}]+)/g)].filter(([, , value = '']) => !/^none\b/.test(value.trim())).map(([, property, value = '']) => ({ name, property, value: value.trim() })),
  );

  it('reads the declarations (control)', () => {
    expect(declarations.filter((entry) => entry.name === MOTION_FILE).length).toBeGreaterThan(5);
    expect(root.get('--ease')).toBe('240ms ease');
  });

  it('every animation and transition lasts from 160 to 320 ms', () => {
    for (const { name, value } of declarations) {
      for (const [duration] of times(value, root)) expect({ name, value, ok: duration !== undefined && duration >= 160 && duration <= 320 }).toEqual({ name, value, ok: true });
    }
  });

  it('every one ends before the next event is revealed', () => {
    for (const { name, value } of declarations) {
      for (const [duration = 0, delay = 0] of times(value, root)) expect({ name, value, end: duration + delay <= REVEAL_STEP_MS }).toEqual({ name, value, end: true });
    }
  });

  it('the page loads every style sheet of the board', () => {
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');

    expect(cssFiles()).toContain(MOTION_FILE);
    for (const name of cssFiles()) expect({ name, imported: main.includes(`import './${name}';`) }).toEqual({ name, imported: true });
  });
});
