import type { SourceDocument } from './ports.ts';
import { requireRecord, requireText } from './validate.ts';

/**
 * Station 4 answers only with a source (ADR-0010 D13, CLAUDE.md §1): the reply names a
 * document of the scenario and quotes it word for word. Code checks the quote, not the model.
 */

export const ANSWER_MAX_LENGTH = 2000;
/**
 * Shorter than this, a "quote" proves nothing: two or three common words appear in almost any
 * document. Twenty characters is about four Spanish words.
 */
export const QUOTE_MIN_LENGTH = 20;
export const QUOTE_MAX_LENGTH = 500;

export const NO_SOURCE_REASONS = ['missing_citation', 'unknown_document', 'quote_not_found'] as const;
export type NoSourceReason = (typeof NO_SOURCE_REASONS)[number];

export type CitationCheck =
  | { readonly ok: true; readonly answer: string; readonly documentId: string; readonly quote: string }
  | { readonly ok: false; readonly reason: NoSourceReason };

const ANY_SPACE = /\s+/g;
const collapse = (text: string): string => text.replace(ANY_SPACE, ' ').trim();

/**
 * The answer with its citation, or the reason there is none. A reply that is not an object,
 * or whose answer is not a text, throws InvalidInput: that is a broken reply, not a missing
 * source, and the station fails.
 */
export function checkCitation(output: unknown, documents: readonly SourceDocument[]): CitationCheck {
  const reply = requireRecord(output, 'knowledge');
  const { documentId, quote } = reply;
  if (typeof documentId !== 'string' || typeof quote !== 'string') return { ok: false, reason: 'missing_citation' };
  const collapsedQuote = collapse(quote);
  if (collapsedQuote.length < QUOTE_MIN_LENGTH || collapsedQuote.length > QUOTE_MAX_LENGTH) {
    return { ok: false, reason: 'missing_citation' };
  }
  const document = documents.find((candidate) => candidate.id === documentId);
  if (document === undefined) return { ok: false, reason: 'unknown_document' };
  if (!collapse(document.text).includes(collapsedQuote)) return { ok: false, reason: 'quote_not_found' };
  const answer = requireText(reply['answer'], 'answer', ANSWER_MAX_LENGTH);
  return { ok: true, answer, documentId, quote: collapsedQuote };
}
