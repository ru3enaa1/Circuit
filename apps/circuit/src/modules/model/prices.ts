import type { Usage } from '../circuit/index.ts';

/**
 * What one model's tokens cost (ADR-0015 K10, «sin fuente, no hay número»). Source: Anthropic's
 * pricing page, https://platform.claude.com/docs/en/about-claude/pricing, read on 2026-11-27; the
 * page carries no date of its own. Prices are in US cents per million tokens, so every sum stays
 * a whole number: a dollar per million tokens is a micro-dollar per token.
 */
export interface ModelPrice {
  readonly inputCentsPerMTok: number;
  readonly cacheWrite5mCentsPerMTok: number;
  readonly cacheWrite1hCentsPerMTok: number;
  readonly cacheReadCentsPerMTok: number;
  readonly outputCentsPerMTok: number;
}

export const PRICES_READ_ON = '2026-11-27';
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

/** Only the models circuit asks for. A model not listed here has no cost: null, never a guess. */
export const PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  // «Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok»
  'claude-opus-5-5': Object.freeze({
    inputCentsPerMTok: 400,
    cacheWrite5mCentsPerMTok: 500,
    cacheWrite1hCentsPerMTok: 800,
    cacheReadCentsPerMTok: 20,
    outputCentsPerMTok: 2000,
  }),
});

/** The token counts of one API answer, as the adapter reads them. */
export interface TokenCounts {
  readonly input: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
  readonly output: number;
}

const CENTS_PER_DOLLAR = 100;

/**
 * The usage the core stores: every input token counted once, whatever its cache state, and the
 * cost in micro-dollars rounded up, so a sum of events never says less than was spent.
 */
export function usageOf(model: string, tokens: TokenCounts): Usage {
  const tokensIn = tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;
  const price = PRICES[model];
  if (price === undefined) return { tokensIn, tokensOut: tokens.output, costMicroUsd: null };
  const cents =
    tokens.input * price.inputCentsPerMTok +
    tokens.cacheWrite5m * price.cacheWrite5mCentsPerMTok +
    tokens.cacheWrite1h * price.cacheWrite1hCentsPerMTok +
    tokens.cacheRead * price.cacheReadCentsPerMTok +
    tokens.output * price.outputCentsPerMTok;
  return { tokensIn, tokensOut: tokens.output, costMicroUsd: Math.ceil(cents / CENTS_PER_DOLLAR) };
}
