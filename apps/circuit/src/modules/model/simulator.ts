import { createHash } from 'node:crypto';

import { isRecord, type CrmContext, type ModelPort, type ModelReply, type SourceDocument, type Usage } from '../circuit/index.ts';

/**
 * The simulated model (ADR-0010 D12, ADR-0001 D3): it answers stations 3, 4 and 5 from the
 * scenario's simulator.json, looked up by the SHA-256 of the request as the model receives it,
 * delimited and redacted. It reads no clock and no randomness, so the same request gives the
 * same reply every time (CLAUDE.md §1, reproducible).
 */

export const SIMULATOR_NAME = 'simulator';

/** No source for a token count or a cost, so there is no number (question 5, «sin fuente, no hay número»). */
const NO_USAGE: Usage = Object.freeze({ tokensIn: null, tokensOut: null, costMicroUsd: null });

/** An unknown request is out of scope with no confidence, so a person sees it (question 4). */
export const DEFAULT_REPLIES = Object.freeze({
  classify: Object.freeze({ intent: 'out_of_scope', topic: null, urgency: 'low', confidence: 0 }),
  answer: Object.freeze({}),
  proposeCrm: Object.freeze({ actions: Object.freeze([]) }),
});

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CASE_NAME = /^[a-z0-9-]{1,40}$/;
const REPLY_KEYS = ['classify', 'answer', 'proposeCrm'] as const;

export interface SimulatedReplies {
  readonly case: string;
  readonly requestSha256: string;
  readonly classify?: unknown;
  readonly answer?: unknown;
  readonly proposeCrm?: unknown;
}

export class InvalidSimulatorFile extends Error {
  constructor(where: string) {
    super(`simulator.json no tiene la forma esperada en «${where}».`);
    this.name = 'InvalidSimulatorFile';
  }
}

/**
 * The replies of simulator.json, checked. Only their shape: what each reply says is the core's
 * to validate (D2), as it would be with a real model.
 */
export function parseSimulatorFile(value: unknown): readonly SimulatedReplies[] {
  if (!isRecord(value) || !Array.isArray(value['replies']) || Object.keys(value).length !== 1) throw new InvalidSimulatorFile('replies');
  const seen = new Set<string>();
  return value['replies'].map((entry: unknown, index) => {
    const where = `replies[${index}]`;
    if (!isRecord(entry)) throw new InvalidSimulatorFile(where);
    const { case: name, requestSha256 } = entry;
    if (typeof name !== 'string' || !CASE_NAME.test(name)) throw new InvalidSimulatorFile(`${where}.case`);
    if (typeof requestSha256 !== 'string' || !SHA256_HEX.test(requestSha256) || seen.has(requestSha256)) {
      throw new InvalidSimulatorFile(`${where}.requestSha256`);
    }
    const unknownKey = Object.keys(entry).find((key) => key !== 'case' && key !== 'requestSha256' && !(REPLY_KEYS as readonly string[]).includes(key));
    if (unknownKey !== undefined) throw new InvalidSimulatorFile(where);
    seen.add(requestSha256);
    return entry as unknown as SimulatedReplies;
  });
}

export function requestSha256(request: string): string {
  return createHash('sha256').update(request, 'utf8').digest('hex');
}

/** A copy through JSON, so no caller can change the replies another run will get. */
const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

export function createSimulator(replies: readonly SimulatedReplies[]): ModelPort {
  const byRequest = new Map(replies.map((entry) => [entry.requestSha256, entry]));
  const reply = (request: string, key: (typeof REPLY_KEYS)[number]): ModelReply => {
    const found = byRequest.get(requestSha256(request));
    const output = found !== undefined && found[key] !== undefined ? found[key] : DEFAULT_REPLIES[key];
    return { output: copy(output), usage: NO_USAGE };
  };
  return {
    name: SIMULATOR_NAME,
    classify: async (request: string) => reply(request, 'classify'),
    answer: async (request: string, _documents: readonly SourceDocument[]) => reply(request, 'answer'),
    proposeCrm: async (request: string, _context: CrmContext) => reply(request, 'proposeCrm'),
  };
}
