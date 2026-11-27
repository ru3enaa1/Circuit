import { createAnthropicModel, parseSimulatorFile } from '../src/modules/model/index.ts';
import { loadTryouts } from '../src/modules/scenario/index.ts';
import { GOLDEN_SCENARIO, SCENARIOS_DIR } from './golden/harness.ts';
import { contractScenario, scenarioCases } from './model-contract/cases.ts';
import { describeModelContract } from './model-contract/contract.ts';
import { FAKE_API_KEY } from './support/fake-anthropic.ts';
import { simulatedAnthropic } from './support/simulated-anthropic.ts';

// ADR-0015 F3.4 and the end of F3: the Anthropic adapter passes the same contract as the simulator,
// over a fake transport that answers what the simulator would (A1). Nothing here is a real run.

describeModelContract(
  'Anthropic adapter over the fake transport',
  () => {
    const scenario = contractScenario();
    return createAnthropicModel({
      apiKey: FAKE_API_KEY,
      fetch: simulatedAnthropic(parseSimulatorFile(scenario.simulator)).fetch,
      topics: scenario.documents.map(({ id, title }) => ({ id, title })),
      stages: loadTryouts(SCENARIOS_DIR, GOLDEN_SCENARIO).stages,
      maxRetries: 0,
    });
  },
  scenarioCases(),
  () => contractScenario().documents,
);
