import { writeFileSync } from 'node:fs';

import { eventsPath, GOLDEN_CASES, runCase, serialize } from './harness.ts';

// `npm run golden:update` (ADR-0010 D15): the only code that writes events.json. Run it after
// a change that is meant to change the events, and read the diff before committing it.
for (const name of GOLDEN_CASES) {
  writeFileSync(eventsPath(name), serialize(await runCase(name)));
  console.log(`${name}: events.json reescrito.`);
}
