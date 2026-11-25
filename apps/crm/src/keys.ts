import { createHash, randomBytes } from 'node:crypto';

// What a key is to the CRM, in one place that neither the server nor the database layer owns
// (ADR-0008 D18, H4 of the audit of ADR-0007): its shape, how one is born, its hash, the
// credentials a request presents and the author a key signs with. It imports only node:crypto,
// so server/, routes/, db/ and the issuer (database/keys.ts) can all use it.

/**
 * ADR-0008 D1: 256 bits, twice the 128 of ADR-0005 H12. With that much randomness an unsalted
 * SHA-256 is enough (D3): there is no dictionary to try a stolen hash against.
 */
const API_KEY_SECRET_BYTES = 32;

/** The prefix lets the secrets guard recognise a leaked key (D15); `crm_` is taken by the roles. */
const API_KEY_PREFIX = 'crmk_';

/**
 * D1: the prefix and the base64url of 32 bytes, without padding (RFC 4648 §5). 32 bytes are 43
 * characters, and 43 characters carry 258 bits, so the last one has its two low bits at zero:
 * one of the 16 below. That makes this the encoding of 32 bytes and nothing else, so one key
 * has exactly one spelling. The server (D2) and the issuer use this constant; the secrets
 * guard repeats it in its rule (D15).
 */
export const API_KEY_SHAPE = /^crmk_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** D1: a new key, from the operating system's random source. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_SECRET_BYTES).toString('base64url')}`;
}

/**
 * D3: the only form a key is stored and looked up in (ADR-0005 D10): the SHA-256 of the whole
 * key, prefix included, in UTF-8. The server and the issuer both call this, so the two cannot
 * disagree on what is hashed.
 */
export function hashApiKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

export interface Credentials {
  readonly token: string;
  /** The account slug as the route spells it, still unvalidated: it is only compared. */
  readonly slug: string;
}

/**
 * ADR-0007 D5: who proposes a write is the key that signs it, as `key-<id>`, an opaque id that
 * fits AUDIT_AUTHOR_PATTERN. input.ts refuses this shape as an approver: a key never approves (D7).
 */
export const KEY_AUTHOR_PREFIX = 'key-';
