// The model module's public face (ADR-0003 M1): the simulator and the Anthropic adapter (ADR-0015).
export { createSimulator, DEFAULT_REPLIES, InvalidSimulatorFile, parseSimulatorFile, requestSha256, SIMULATOR_NAME } from './simulator.ts';
export type { SimulatedReplies } from './simulator.ts';
export { ANTHROPIC_MODEL, createAnthropicModel, ModelRefused, ModelUnavailable } from './anthropic.ts';
export type { AnthropicOptions } from './anthropic.ts';
export { UnsafeDocument } from './prompts.ts';
export type { Topic } from './prompts.ts';
export { PRICES, PRICES_READ_ON, PRICES_SOURCE, usageOf } from './prices.ts';
export type { ModelPrice, TokenCounts } from './prices.ts';
