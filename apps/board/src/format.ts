import type { RunEvent } from './api.ts';
import { RUN_TEXTS } from './texts.ts';

/**
 * Numbers and times as the board writes them (docs/diseno.md §4): Colombia's format, with a
 * decimal comma and a space between thousands. Pure: the time zone is fixed, so the same events
 * give the same text on any machine.
 */

/** The scenario's school is in Colombia; a fixed zone keeps the board the same on any machine. */
export const DISPLAY_TIME_ZONE = 'America/Bogota';
const MICRO_PER_DOLLAR = 1_000_000;
const MS_PER_SECOND = 1000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

export function formatInteger(value: number): string {
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatDecimal(value: number, digits: number): string {
  const [whole = '0', fraction] = Math.abs(value).toFixed(digits).split('.');
  const sign = value < 0 ? '-' : '';
  return `${sign}${formatInteger(Number(whole))}${fraction === undefined ? '' : `,${fraction}`}`;
}

/** Under a second in milliseconds («10 ms»); above, in seconds with one decimal («1,2 s»). */
export function formatDuration(ms: number): string {
  return ms < MS_PER_SECOND ? `${formatInteger(ms)} ms` : `${formatDecimal(ms / MS_PER_SECOND, 1)} s`;
}

export function formatCost(microUsd: number): string {
  return `US$${formatDecimal(microUsd / MICRO_PER_DOLLAR, 3)}`;
}

const CLOCK = new Intl.DateTimeFormat('es-CO', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** «09:00:00», in the display zone. */
export function formatClock(iso: string): string {
  const parts = CLOCK.formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}:${part('second')}`;
}

/** A due date of the CRM, `2026-12-01`, as «1 dic». Anything else is shown as it came. */
export function formatDueDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1];
  return match === null || month === undefined ? value : `${Number(match[3])} ${month}`;
}

/** Cuts a text to `max` characters, ending in «…», on a word when one is near. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Who spends nothing: their events carry zeros, not measures, so the board shows the time only. */
const UNMEASURED_WORKERS = new Set(['code', 'person']);

/**
 * «1,2 s · 840 tok · US$0,004». With the simulator, tokens and cost are null, and it says so
 * instead of inventing a number (§7): «10 ms · simulador».
 */
export function telemetryOf(event: RunEvent): string {
  const duration = formatDuration(event.durationMs);
  if (UNMEASURED_WORKERS.has(event.model)) return duration;
  const { tokensIn, tokensOut, costMicroUsd } = event;
  if (tokensIn === null || tokensOut === null || costMicroUsd === null) {
    return `${duration} · ${event.model === 'simulator' ? RUN_TEXTS.simulator.text : RUN_TEXTS.unmeasured.text}`;
  }
  return `${duration} · ${formatInteger(tokensIn + tokensOut)} ${RUN_TEXTS.tokens.text} · ${formatCost(costMicroUsd)}`;
}

export interface RunTotals {
  readonly durationMs: number;
  /** How many events a model worked: with none, there is nothing to add up and no line is shown. */
  readonly measured: number;
  /** Null when any model event had no measure: a partial sum would mislead. */
  readonly tokens: number | null;
  readonly costMicroUsd: number | null;
}

export function totalsOf(events: readonly RunEvent[]): RunTotals {
  const measured = events.filter((event) => !UNMEASURED_WORKERS.has(event.model));
  const missing = measured.some((event) => event.tokensIn === null || event.tokensOut === null || event.costMicroUsd === null);
  return {
    durationMs: events.reduce((sum, event) => sum + event.durationMs, 0),
    measured: measured.length,
    tokens: missing ? null : measured.reduce((sum, event) => sum + (event.tokensIn ?? 0) + (event.tokensOut ?? 0), 0),
    costMicroUsd: missing ? null : measured.reduce((sum, event) => sum + (event.costMicroUsd ?? 0), 0),
  };
}
