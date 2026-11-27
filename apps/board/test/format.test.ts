import { describe, expect, it } from 'vitest';

import type { RunEvent } from '../src/api.ts';
import { formatClock, formatCost, formatDecimal, formatDueDate, formatDuration, formatInteger, shorten, telemetryOf, totalsOf } from '../src/format.ts';
import { goldenEvents } from './support.ts';

// docs/diseno.md §4 and §7: Colombia's number format, and telemetry that never invents a number.

const modelEvent = (overrides: Partial<RunEvent>): RunEvent => ({ ...(goldenEvents('normal')[2] as RunEvent), ...overrides });

describe('numbers in Colombia’s format', () => {
  it.each([
    [0, '0'],
    [840, '840'],
    [1260, '1 260'],
    [1234567, '1 234 567'],
    [-1260, '-1 260'],
  ])('formatInteger(%s) is «%s»', (value, text) => {
    expect(formatInteger(value)).toBe(text);
  });

  it.each([
    [0.82, 2, '0,82'],
    [0.7, 2, '0,70'],
    [1260.5, 1, '1 260,5'],
    [-0.25, 2, '-0,25'],
    [3, 0, '3'],
  ])('formatDecimal(%s, %s) is «%s»', (value, digits, text) => {
    expect(formatDecimal(value, digits)).toBe(text);
  });

  it('durations under a second in ms, above in seconds with a comma', () => {
    expect([formatDuration(10), formatDuration(999), formatDuration(1200), formatDuration(39_400)]).toEqual(['10 ms', '999 ms', '1,2 s', '39,4 s']);
  });

  it('cost in dollars from micro-dollars', () => {
    expect([formatCost(4000), formatCost(0), formatCost(1_250_000)]).toEqual(['US$0,004', 'US$0,000', 'US$1,250']);
  });

  it('the clock in the display zone, the same on any machine', () => {
    expect(formatClock('2026-11-26T09:00:00.130Z')).toBe('04:00:00');
    expect(formatClock('2026-11-26T23:59:59.000Z')).toBe('18:59:59');
  });

  it('due dates as «1 dic», anything else as it came', () => {
    expect([formatDueDate('2026-12-01'), formatDueDate('2027-01-15'), formatDueDate('mañana'), formatDueDate('2026-13-01')]).toEqual(['1 dic', '15 ene', 'mañana', '2026-13-01']);
  });

  it('shortens on a word, with «…», and leaves a short text alone', () => {
    expect(shorten('corto', 10)).toBe('corto');
    expect(shorten('Agendar la conversación sobre Radiografía', 28)).toBe('Agendar la conversación…');
    expect(shorten('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…');
  });
});

describe('telemetry (§7)', () => {
  it('a code station shows its time only', () => {
    expect(telemetryOf(goldenEvents('normal')[0] as RunEvent)).toBe('10 ms');
  });

  it('the simulator says so instead of inventing tokens or cost', () => {
    expect(telemetryOf(goldenEvents('normal')[2] as RunEvent)).toBe('10 ms · simulador');
  });

  it('another model without a measure says it has none', () => {
    expect(telemetryOf(modelEvent({ model: 'otro-modelo' }))).toBe('10 ms · sin medida');
  });

  it('a measured model shows time, tokens and cost', () => {
    expect(telemetryOf(modelEvent({ model: 'claude', durationMs: 1200, tokensIn: 600, tokensOut: 240, costMicroUsd: 4000 }))).toBe('1,2 s · 840 tok · US$0,004');
  });

  it('totals: nothing to add when a model event has no measure, and nothing measured with code only', () => {
    const normal = totalsOf(goldenEvents('normal'));
    const injection = totalsOf(goldenEvents('injection'));

    expect(normal).toEqual({ durationMs: 70, measured: 3, tokens: null, costMicroUsd: null });
    expect(injection).toEqual({ durationMs: 20, measured: 0, tokens: 0, costMicroUsd: 0 });
  });

  it('totals of measured events add up', () => {
    const events = [modelEvent({ model: 'claude', tokensIn: 100, tokensOut: 20, costMicroUsd: 500 }), modelEvent({ model: 'claude', seq: 4, tokensIn: 50, tokensOut: 10, costMicroUsd: 300 })];

    expect(totalsOf(events)).toEqual({ durationMs: 20, measured: 2, tokens: 180, costMicroUsd: 800 });
  });
});
