import { z } from 'zod';

import { EMAIL_MAX_LENGTH, SLUG_PATTERN } from '../db/schema.ts';
import { ApiError } from '../server/errors.ts';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../server/limits.ts';

// ADR-0006 D14: every input goes through zod, after the key and the account. The limits are
// the database's own (schema.ts), so what passes here also passes the constraints. Every
// object is strict: an unknown field is refused, not ignored.

/** A bigint identity id, as text in a route or a query: no sign, no leading zero. */
const ID_PATTERN = /^[1-9][0-9]{0,15}$/;
/** The floor contacts_email_shape enforces; \s is a superset of POSIX [:space:]. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;
/**
 * PostgreSQL refuses U+0000 in text with SQLSTATE 22021, and neither \s nor trim() covers it:
 * a NUL that passed here came back as a 500 (ADR-0006 A6).
 */
const NUL = '\u0000';
const withoutNul = (value: string): boolean => !value.includes(NUL);

// Sixteen digits can pass 2^53; such an id would be rounded into another one, so it is refused.
const id = z.string().regex(ID_PATTERN).transform(Number).refine(Number.isSafeInteger);
const slug = z.string().regex(new RegExp(SLUG_PATTERN));
const limit = z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number).pipe(z.number().max(MAX_PAGE_SIZE));
// Stored lowercase (contacts_email_lowercase), so a search is lowercased before it compares.
const email = z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).regex(EMAIL_SHAPE).refine(withoutNul);

export const accountParams = z.strictObject({ slug });
export const contactParams = z.strictObject({ slug, contactId: id });
export const companyParams = z.strictObject({ slug, companyId: id });
export const noQuery = z.strictObject({});
export const pageQuery = z.strictObject({ limit: limit.optional(), before: id.optional() });
export const searchBody = z.strictObject({ email });

/** Where an input came from, named in the error when no single field is to blame. */
export type Section = 'ruta' | 'consulta' | 'cuerpo';

/**
 * The parsed value, or 400 entrada_invalida naming the field. The name is one of the schema's
 * own keys, or the section: an unknown field is reported as the section, so nothing the
 * request chose (a key name, a value) is ever written back.
 */
export function parseInput<S extends z.ZodObject>(schema: S, value: unknown, section: Section): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0]?.path[0];
  const known = Object.keys(schema.shape);
  throw new ApiError('entrada_invalida', typeof first === 'string' && known.includes(first) ? first : section);
}

export function pageOf(query: z.output<typeof pageQuery>): { readonly limit: number; readonly before: number | undefined } {
  return { limit: query.limit ?? DEFAULT_PAGE_SIZE, before: query.before };
}

/** application/json, with or without the UTF-8 charset; anything else is not a body we read. */
const JSON_TYPE = /^application\/json\s*(?:;\s*charset=utf-8\s*)?$/i;

/**
 * The body as JSON. The server keeps every body as text (server.ts), so the key and the
 * account are checked before anything the request sent is parsed.
 */
export function jsonBody(contentType: string | undefined, body: unknown): unknown {
  if (contentType === undefined || !JSON_TYPE.test(contentType) || typeof body !== 'string') {
    throw new ApiError('entrada_invalida', 'cuerpo');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // The parser's message quotes the body; the answer names the section and nothing else.
    throw new ApiError('entrada_invalida', 'cuerpo');
  }
}
