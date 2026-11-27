import { DrizzleQueryError } from 'drizzle-orm';
import pg from 'pg';

// The circuit server's log (the CRM's rule, ADR-0006 D15): one JSON line per event, built here
// from fixed fields. Nothing in a line comes from a header, a URL or an error message.

export type LogLine = Readonly<Record<string, string | number | null>>;
export type LogSink = (line: LogLine) => void;

export const stdoutLog: LogSink = (line) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;
const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{1,40}$/;

/**
 * The codes an error may leave in the log, never its message: drizzle's message holds the SQL
 * and its parameters, and a pg error carries the connection settings, password included
 * (CLAUDE.md §8). apps/circuit cannot import the CRM's log.ts (ADR-0003 M3), so this repeats it.
 */
export function errorCodes(error: unknown): { readonly sqlstate: string | null; readonly code: string | null } {
  const source = error instanceof DrizzleQueryError ? error.cause : error;
  if (source instanceof pg.DatabaseError) {
    return { sqlstate: source.code !== undefined && SQLSTATE_SHAPE.test(source.code) ? source.code : null, code: null };
  }
  const code = typeof source === 'object' && source !== null && 'code' in source ? source.code : undefined;
  return { sqlstate: null, code: typeof code === 'string' && SYSTEM_ERROR_CODE.test(code) ? code : null };
}

/** The only request line, from fixed fields. `route` is the pattern, never the URL. */
export function requestLine(method: string, route: string | null, status: number, ms: number): LogLine {
  return { event: 'request', method, route, status, ms: Math.round(ms) };
}
