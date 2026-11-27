/**
 * The fake transport of the Anthropic adapter (ADR-0015 A1): a `fetch` that never opens the
 * network, answers with the shape of the Messages API and keeps every request it got. Nothing it
 * answers is a real run, and nothing it answers is stored as one.
 */

export const FAKE_API_KEY = 'clave-de-prueba-que-no-sirve';

export interface SentRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

export interface FakeAnswer {
  readonly status?: number;
  readonly text?: string;
  readonly model?: string;
  readonly stopReason?: string;
  readonly usage?: Record<string, unknown>;
  /** Tool calls after the text, as station 5's answer brings them. */
  readonly toolUses?: readonly { readonly name: string; readonly input: unknown }[];
  /** A raw body, for an error answer. */
  readonly body?: unknown;
}

export const FAKE_USAGE = Object.freeze({
  input_tokens: 100,
  output_tokens: 40,
  cache_creation_input_tokens: 20,
  cache_read_input_tokens: 30,
  cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 0 },
});

function messageOf(answer: FakeAnswer): unknown {
  return {
    id: 'msg_prueba',
    type: 'message',
    role: 'assistant',
    model: answer.model ?? 'claude-opus-5-5',
    content: [
      ...(answer.text === undefined && answer.toolUses !== undefined ? [] : [{ type: 'text', text: answer.text ?? '{}' }]),
      ...(answer.toolUses ?? []).map((call, index) => ({ type: 'tool_use', id: `toolu_prueba_${index}`, name: call.name, input: call.input })),
    ],
    stop_reason: answer.stopReason ?? (answer.toolUses === undefined ? 'end_turn' : 'tool_use'),
    stop_sequence: null,
    usage: answer.usage ?? FAKE_USAGE,
  };
}

export interface FakeTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly sent: SentRequest[];
}

/** Answers each call with the next answer of the list (the last one repeats), or throws when `answers` says so. */
export function fakeAnthropic(answers: readonly (FakeAnswer | 'network-down')[]): FakeTransport {
  return fakeAnthropicWith((_body, index) => answers[Math.min(index, answers.length - 1)]);
}

/** Answers each call with what `answerFor` makes of its body; the index counts the calls from 0. */
export function fakeAnthropicWith(answerFor: (body: Record<string, unknown>, index: number) => FakeAnswer | 'network-down' | undefined): FakeTransport {
  const sent: SentRequest[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    sent.push({ url, headers, body });
    const answer = answerFor(body, sent.length - 1);
    if (answer === undefined || answer === 'network-down') throw new TypeError('fetch failed');
    const status = answer.status ?? 200;
    const reply = status === 200 ? messageOf(answer) : (answer.body ?? { type: 'error', error: { type: 'api_error', message: 'falla de prueba' } });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}
