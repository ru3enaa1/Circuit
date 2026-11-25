import pg from 'pg';

// ADR-0006 D15: one line per event, built here from fixed fields. Nothing in a line comes
// from a header, a body, a key, a URL or an error message, so nothing personal can reach it.

/** Every value is a number, a fixed word, a route pattern or a code: never request data. */
export type LogLine = Readonly<Record<string, string | number | null>>;
export type LogSink = (line: LogLine) => void;

export const stdoutLog: LogSink = (line) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;
/** Node's system error codes, such as ECONNREFUSED: a word, never data. */
const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{1,40}$/;

/**
 * What an error may leave in the log: its SQLSTATE when the database raised it, or the
 * system code when the connection failed. Its message and detail can carry the values of the
 * statement (an email, a name), and a pg error carries the connection settings, password
 * included (CLAUDE.md §8), so the error object itself is never logged.
 */
export function errorCodes(error: unknown): { readonly sqlstate: string | null; readonly code: string | null } {
  if (error instanceof pg.DatabaseError) {
    return { sqlstate: error.code !== undefined && SQLSTATE_SHAPE.test(error.code) ? error.code : null, code: null };
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return { sqlstate: null, code: typeof code === 'string' && SYSTEM_ERROR_CODE.test(code) ? code : null };
}
