import { isRecord } from '../../src/modules/circuit/index.ts';
import { DEFAULT_REPLIES, requestSha256, type SimulatedReplies } from '../../src/modules/model/index.ts';
import { fakeAnthropicWith, type FakeAnswer, type FakeTransport } from './fake-anthropic.ts';

/**
 * The fake transport answering as the simulator does (ADR-0015, F3.4): it reads the request the
 * adapter sent, finds its reply in simulator.json by the same SHA-256, and gives it the shape of
 * the Messages API (JSON text for stations 3 and 4, tool calls for station 5). So the model
 * contract runs the adapter end to end, with no network and no real run. Which station a call is
 * comes from the request's shape, as the adapter builds it: tools for 5, a system of blocks for 4.
 */

type Method = 'classify' | 'answer' | 'proposeCrm';

function methodOf(body: Record<string, unknown>): Method {
  if (Array.isArray(body['tools'])) return 'proposeCrm';
  return Array.isArray(body['system']) ? 'answer' : 'classify';
}

/** The request is the user turn, or its last text block when it comes after the CRM context. */
function requestOf(body: Record<string, unknown>): string {
  const messages = body['messages'] as { content: unknown }[];
  const content = messages[0]?.content;
  if (typeof content === 'string') return content;
  const blocks = Array.isArray(content) ? content : [];
  const last: unknown = blocks.at(-1);
  return isRecord(last) && typeof last['text'] === 'string' ? last['text'] : '';
}

function toolCallsOf(output: unknown): FakeAnswer {
  const actions = isRecord(output) && Array.isArray(output['actions']) ? output['actions'] : [];
  const toolUses = actions.map((action: unknown) => {
    const { type, ...input } = isRecord(action) ? action : {};
    return { name: String(type), input };
  });
  return toolUses.length === 0 ? { text: 'Nada que proponer.' } : { toolUses };
}

export function simulatedAnthropic(replies: readonly SimulatedReplies[]): FakeTransport {
  const byRequest = new Map(replies.map((entry) => [entry.requestSha256, entry]));
  return fakeAnthropicWith((body) => {
    const method = methodOf(body);
    const found = byRequest.get(requestSha256(requestOf(body)));
    const output = found?.[method] ?? DEFAULT_REPLIES[method];
    return method === 'proposeCrm' ? toolCallsOf(output) : { text: JSON.stringify(output) };
  });
}
