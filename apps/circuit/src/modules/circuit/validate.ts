/**
 * Hand-written checks for what crosses into the core: model output (ADR-0010 D2) and the
 * mentor's corrections. The core imports no package (ADR-0003 M2), so there is no zod here.
 * Every check throws InvalidInput with the name of the field, never its value: a value can
 * carry personal data or an injection attempt, and an error message ends up in logs.
 */

export class InvalidInput extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Entrada inválida en «${field}».`);
    this.name = 'InvalidInput';
    this.field = field;
  }
}

/** PostgreSQL refuses U+0000 in text, and a lone surrogate is stored as U+FFFD (CLAUDE.md §8). */
const NUL = '\u0000';

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new InvalidInput(field);
  return value;
}

/** A trimmed text of 1 to `max` characters that the database keeps as it was sent. */
export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new InvalidInput(field);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) throw new InvalidInput(field);
  if (trimmed.includes(NUL) || !trimmed.isWellFormed()) throw new InvalidInput(field);
  return trimmed;
}

export function requireOneOf<const T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidInput(field);
  }
  return value as T;
}

/** A finite number from 0 to 1, both included. NaN and the infinities are not numbers here. */
export function requireUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidInput(field);
  }
  return value;
}

export function requirePattern(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new InvalidInput(field);
  return value;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_IN_YEAR = 12;
/** February's days, by whether the year is a leap year. */
const FEBRUARY = 2;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * A calendar date as YYYY-MM-DD. The year 0000 is refused because PostgreSQL's date has no
 * year zero (CLAUDE.md §8, the same rule as the CRM's dueOn).
 */
export function requireIsoDate(value: unknown, field: string): string {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (match === null) throw new InvalidInput(field);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year === 0 || month < 1 || month > MONTHS_IN_YEAR) throw new InvalidInput(field);
  const days = month === FEBRUARY && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day < 1 || day > days) throw new InvalidInput(field);
  return value as string;
}
