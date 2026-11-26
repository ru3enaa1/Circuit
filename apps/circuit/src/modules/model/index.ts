// The model module's public face (ADR-0003 M1): the simulator today, the Anthropic adapter in F3.
export { createSimulator, DEFAULT_REPLIES, InvalidSimulatorFile, parseSimulatorFile, requestSha256, SIMULATOR_NAME } from './simulator.ts';
export type { SimulatedReplies } from './simulator.ts';
