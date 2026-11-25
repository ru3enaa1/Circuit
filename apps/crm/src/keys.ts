// What a key is to the CRM, in one place that neither the server nor the database layer owns
// (ADR-0008 D18, H4 of the audit of ADR-0007): the credentials a request presents and the
// author a key signs with. It imports nothing, so server/, routes/ and db/ can all use it.

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
