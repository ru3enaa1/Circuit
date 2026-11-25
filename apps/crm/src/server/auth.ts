import type { FastifyRequest } from 'fastify';

import type { Credentials } from '../db/read-scope.ts';
import { ApiError } from './errors.ts';
import { MAX_KEY_LENGTH } from './limits.ts';

// ADR-0006 D8: the only way to authenticate is `Authorization: Bearer <key>` (RFC 6750 §2.1).
// No cookie, no query parameter and no other header is read (D16). This module only reads
// the header; the key is checked against the database by read-scope.ts, by its SHA-256.

/** RFC 7235 §2.1: the scheme is case-insensitive, and one or more spaces follow it. */
const BEARER = /^bearer(?: +(.*))?$/i;
/** RFC 6750 §2.1, b64token: what a bearer token may contain. */
const TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

/** missing: no key at all (401 sin_llave). malformed: a key that cannot exist (401 llave_invalida). */
export type PresentedKey = { readonly token: string } | 'missing' | 'malformed';

export function presentedKey(header: string | undefined): PresentedKey {
  const match = header === undefined ? null : BEARER.exec(header);
  const token = match?.[1];
  if (token === undefined || token === '') return 'missing';
  if (token.length > MAX_KEY_LENGTH || !TOKEN.test(token)) return 'malformed';
  return { token };
}

/**
 * The key and the account of a request under /accounts/:slug, or the 401 that answers it.
 * Shared by the routes that read and the ones that write, so both check the key the same way.
 */
export function credentialsOf(request: FastifyRequest): Credentials {
  const presented = presentedKey(request.headers.authorization);
  if (presented === 'missing') throw new ApiError('sin_llave');
  if (presented === 'malformed') throw new ApiError('llave_invalida');
  const params = request.params as Readonly<Record<string, unknown>>;
  // The slug as the route spells it: only compared with the key's (D9), and validated after.
  return { token: presented.token, slug: typeof params['slug'] === 'string' ? params['slug'] : '' };
}
