import { createSimulator, parseSimulatorFile } from '../src/modules/model/index.ts';
import { contractScenario, scenarioCases } from './model-contract/cases.ts';
import { describeModelContract } from './model-contract/contract.ts';

// ADR-0015 F3.1: the simulator passes the same contract the Anthropic adapter and the replay of
// recorded runs will pass.

describeModelContract(
  'simulator',
  () => createSimulator(parseSimulatorFile(contractScenario().simulator)),
  scenarioCases(),
  () => contractScenario().documents,
);
