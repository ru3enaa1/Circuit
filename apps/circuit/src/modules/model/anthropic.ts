import Anthropic from '@anthropic-ai/sdk';

import type { ModelPort, ModelReply } from '../circuit/index.ts';
import { actionsOf, contextBlock, crmSystem, crmTools } from './crm-tools.ts';
import { usageOf } from './prices.ts';
import { ANSWER_INSTRUCTIONS, answerSchema, classifySchema, classifySystem, documentsBlock, type Topic } from './prompts.ts';

/**
 * The Anthropic adapter (ADR-0015): the same port as the simulator, one call per station, no loop
 * (ADR-0001 D1). It returns what the model wrote as `unknown`; the core validates it (ADR-0010 D2).
 * Off by default, and with ADR-0015 A1 it only ever talks to the fake transport of the tests.
 */

/** The current Opus model (2026-11-27). Changing it changes the cost, so it is the owner's call. */
export const ANTHROPIC_MODEL = 'claude-opus-5-5';
/** A classification is four short fields; this leaves room for the thinking Opus 5.5 always does. */
const CLASSIFY_MAX_TOKENS = 4000;
/**
 * An answer of up to 2000 characters and a quote of up to 500 (knowledge.ts) are about a thousand
 * tokens; the rest is room for the thinking, so a long answer is not cut into JSON the core refuses.
 */
const ANSWER_MAX_TOKENS = 8000;
/** Up to five actions (actions.ts), one a note of up to 4000 characters, and the thinking. */
const CRM_MAX_TOKENS = 8000;
/** One request should not keep a station waiting longer than this. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** The SDK's own default: it retries 408, 409, 429, 5xx and dropped connections, with no side effects. */
const DEFAULT_MAX_RETRIES = 2;

export interface AnthropicOptions {
  readonly apiKey: string;
  /** Required, so no test can reach the network by leaving it out (K8). */
  readonly fetch: typeof globalThis.fetch;
  /** The scenario's programs, the only topics a classification may name. */
  readonly topics: readonly Topic[];
  /** The stage keys of the agent's CRM account, the only stages move_stage may name. */
  readonly stages: readonly string[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

/** The API could not be reached or answered with an error. Only the HTTP status is kept (K11). */
export class ModelUnavailable extends Error {
  override readonly name = 'ModelUnavailable';
  readonly status: number | null;

  constructor(status: number | null) {
    super(status === null ? 'El modelo no respondió.' : `El modelo respondió ${status}.`);
    this.status = status;
  }
}

/** The API declined the request (stop_reason «refusal»). No fallback model: the map shows it (ADR-0015). */
export class ModelRefused extends Error {
  override readonly name = 'ModelRefused';

  constructor() {
    super('El modelo rechazó la solicitud.');
  }
}

/** The text of the answer as JSON, or the text itself when it is not JSON: the core then fails the station. */
function jsonOf(message: Anthropic.Message): unknown {
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Station 5's proposal: the tool calls, gathered. An answer cut by max_tokens may hold a call cut
 * in half, so it gives nothing the core accepts, and the station fails instead of proposing less.
 */
function proposalOf(message: Anthropic.Message): unknown {
  return message.stop_reason === 'max_tokens' ? null : { actions: actionsOf(message) };
}

function replyOf(message: Anthropic.Message, read: (message: Anthropic.Message) => unknown): ModelReply {
  if (message.stop_reason === 'refusal') throw new ModelRefused();
  const { usage } = message;
  const split = usage.cache_creation;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const tokens = {
    input: usage.input_tokens,
    // Without the split, every cache write is counted at the five-minute price, the one circuit uses.
    cacheWrite5m: split === null ? cacheWrite : split.ephemeral_5m_input_tokens,
    cacheWrite1h: split === null ? 0 : split.ephemeral_1h_input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  return { output: read(message), usage: usageOf(message.model, tokens) };
}

/** Any failure of the SDK, without its message: it can carry the answer's body or headers (K11). */
async function called(work: () => Promise<Anthropic.Message>): Promise<Anthropic.Message> {
  try {
    return await work();
  } catch (error) {
    throw new ModelUnavailable(error instanceof Anthropic.APIError && typeof error.status === 'number' ? error.status : null);
  }
}

export function createAnthropicModel(options: AnthropicOptions): ModelPort {
  if (typeof options.fetch !== 'function') throw new Error('El adaptador del modelo necesita el fetch que usará.');
  const client = new Anthropic({
    apiKey: options.apiKey,
    fetch: options.fetch,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
  });
  const system = classifySystem(options.topics);
  const schema = classifySchema(options.topics);
  // Built once: a stage out of shape stops the adapter from being made, before any request.
  const tools = crmTools(options.stages);
  const crmInstructions = crmSystem(options.stages);
  return {
    name: ANTHROPIC_MODEL,
    async classify(request) {
      const message = await called(() =>
        client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: CLASSIFY_MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: request }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        }),
      );
      return replyOf(message, jsonOf);
    },
    async answer(request, documents) {
      // Built before the call, so a document that breaks the delimiters never reaches the network.
      const sources = documentsBlock(documents);
      const message = await called(() =>
        client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: ANSWER_MAX_TOKENS,
          // Instructions, then the documents: the same bytes for every request of a scenario, so
          // the breakpoint after the documents caches both (the request comes after it).
          system: [
            { type: 'text', text: ANSWER_INSTRUCTIONS },
            { type: 'text', text: sources, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: request }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: answerSchema(documents) } },
        }),
      );
      return replyOf(message, jsonOf);
    },
    async proposeCrm(request, context) {
      const message = await called(() =>
        client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: CRM_MAX_TOKENS,
          // Tools and instructions are fixed for a scenario; the breakpoint after them caches both.
          tools,
          system: [{ type: 'text', text: crmInstructions, cache_control: { type: 'ephemeral' } }],
          // Opus 5.5 refuses a forced tool choice; «auto» with the instructions, and no call is a valid «nothing to do».
          tool_choice: { type: 'auto' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: contextBlock(context) },
                { type: 'text', text: request },
              ],
            },
          ],
          output_config: { effort: 'medium' },
        }),
      );
      return replyOf(message, proposalOf);
    },
  };
}
