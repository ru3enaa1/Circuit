import { describe, expect, it } from 'vitest';

import { QUOTE_MIN_LENGTH, checkCitation, startRun } from '../src/modules/circuit/index.ts';
import { DOCUMENTS, NORMAL_REPLIES, NORMAL_TEXT, engineDeps, scriptedModel } from './support/fakes.ts';

// ADR-0010 D13: without a source there is no answer (CLAUDE.md §1).
const ANSWER = 'Una respuesta que no debe guardarse si no tiene fuente.';
const QUOTE = 'dibujar cómo funciona hoy la empresa, proceso por proceso';

describe('station 4 answers only with a source (ADR-0010 D13)', () => {
  it('accepts a quote that appears in the document, with the spaces collapsed on both sides', () => {
    const quote = 'cómo funciona hoy la empresa,\n proceso   por proceso, y dónde';

    expect(checkCitation({ answer: ANSWER, documentId: 'radiografia', quote }, DOCUMENTS)).toEqual({
      ok: true,
      answer: ANSWER,
      documentId: 'radiografia',
      quote: 'cómo funciona hoy la empresa, proceso por proceso, y dónde',
    });
  });

  it.each([
    ['no citation at all', { answer: ANSWER }, 'missing_citation'],
    ['a quote that is not text', { answer: ANSWER, documentId: 'radiografia', quote: 7 }, 'missing_citation'],
    ['a quote too short to prove anything', { answer: ANSWER, documentId: 'radiografia', quote: 'la empresa' }, 'missing_citation'],
    ['a document that does not exist', { answer: ANSWER, documentId: 'otro', quote: QUOTE }, 'unknown_document'],
    ['a quote that does not appear', { answer: ANSWER, documentId: 'radiografia', quote: 'dibujar cómo funcionará mañana la empresa' }, 'quote_not_found'],
    ['a quote with one letter changed', { answer: ANSWER, documentId: 'radiografia', quote: 'dibujar cómo funciona hoy la empresa, proceso por procesos' }, 'quote_not_found'],
  ])('gives no_source for %s', (_name, output, reason) => {
    expect(checkCitation(output, DOCUMENTS)).toEqual({ ok: false, reason });
  });

  it('measures the shortest quote in characters after collapsing', () => {
    expect(QUOTE_MIN_LENGTH).toBe(20);
  });

  it('drops the answer from the event when there is no source, and says why', async () => {
    const model = scriptedModel({ ...NORMAL_REPLIES, answer: { answer: ANSWER, documentId: 'radiografia', quote: 'no aparece en ningún lado del documento' } });

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    const knowledge = run.events[3];
    expect(knowledge).toMatchObject({ station: 'knowledge', outcome: 'no_source', status: 'completed' });
    expect(knowledge?.detail).toEqual({ reason: 'quote_not_found' });
    expect(JSON.stringify(run.events)).not.toContain(ANSWER);
    // Without a source there is no answer, but the request still reaches the CRM proposal.
    expect(run.events[4]?.station).toBe('crm');
  });

  it('keeps the answer, the document and the quote when the source holds', async () => {
    const run = await startRun(engineDeps(), NORMAL_TEXT);

    expect(run.events[3]?.detail).toEqual({
      documentId: 'radiografia',
      quote: QUOTE,
      answer: (NORMAL_REPLIES.answer as { answer: string }).answer,
    });
  });

  it('fails the station on a reply whose answer is not a text: that is a broken reply, not a missing source', async () => {
    const model = scriptedModel({ ...NORMAL_REPLIES, answer: { answer: 3, documentId: 'radiografia', quote: QUOTE } });

    const run = await startRun(engineDeps({ model }), NORMAL_TEXT);

    expect(run.events.at(-1)).toMatchObject({ station: 'knowledge', status: 'failed', detail: { field: 'answer' } });
  });
});
