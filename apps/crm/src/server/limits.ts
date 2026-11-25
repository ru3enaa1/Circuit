// The limits of ADR-0006 (Restricciones, ASUNCIÓN), accepted by the owner on 2026-11-24.
// Everything runs on one machine for one agent, so they bound mistakes, not traffic.

/**
 * A search body is one address of at most 254 characters. 16 KiB also leaves room for the
 * writes of F1.3 (a note holds up to 4000 characters) and refuses anything larger unread.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/** One agent at a time asks the CRM; five connections cover its station plus a person's board. */
export const POOL_SIZE = 5;

/** No read of a demo-sized CRM takes seconds: one that does is a bug, and it is cut off. */
export const STATEMENT_TIMEOUT_MS = 5_000;
/** A transaction left open by a crashed request would hold its connection; the server ends it. */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000;
export const CONNECT_TIMEOUT_MS = 5_000;

/** Lists come newest first, by id, and `before` asks for the next page (ADR-0006 D14). */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * The format of a key arrives in F1.4 (H12). Until then any RFC 6750 token up to this length
 * is hashed and looked up; a longer one is refused without touching the database.
 */
export const MAX_KEY_LENGTH = 512;
