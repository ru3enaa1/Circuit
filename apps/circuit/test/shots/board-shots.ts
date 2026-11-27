import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CIRCUIT, LOW_CONFIDENCE_BELOW } from '../../src/modules/circuit/index.ts';
import { CRM_TOOLS } from '../../src/modules/crm-client/index.ts';
import { SIMULATOR_NAME } from '../../src/modules/model/index.ts';
import { loadScenario } from '../../src/modules/scenario/index.ts';
import { BOARD_DIST_DIR } from '../../src/main.ts';
import { circuitPayload } from '../../src/server/api.ts';
import { readBoardFiles } from '../../src/server/board-files.ts';
import { buildServer } from '../../src/server/server.ts';
import { GOLDEN_SCENARIO, SCENARIOS_DIR, runCase, type GoldenCase } from '../golden/harness.ts';
import { MemoryStore } from '../support/fakes.ts';
import { MemoryRunReader } from '../support/server.ts';

// ADR-0011 B10: `npm run board:shots` takes the board at the four sizes of docs/diseno.md §9
// with Chrome without a window, into a folder git ignores, for the owner to review. The runs
// are the golden cases in memory: no database, the same pictures on any machine. It is a
// review tool, not a test: nothing here decides whether the composition is right.

// Asynchronous: this same process is the server Chrome reads from, so it must not block.
const run = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SHOTS_DIR = join(REPO_ROOT, '.shots');
const SIZES = [
  [1536, 864],
  [768, 864],
  [720, 900],
  [2560, 1080],
] as const;
/** The reveal shows 7 events at 700 ms; Chrome's virtual time runs them without waiting. */
const VIRTUAL_TIME_MS = 15_000;
/** A capture that takes longer is stuck; it fails instead of hanging the command. */
const CAPTURE_TIMEOUT_MS = 60_000;
const CHROME_CANDIDATES = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** The last case is the run the board shows: the newest. A partial one shows a waiting station. */
const SETS: Readonly<Record<string, { readonly cases: readonly GoldenCase[]; readonly keep?: number }>> = {
  normal: { cases: ['complaint', 'injection', 'low-confidence', 'normal'] },
  espera: { cases: ['normal', 'complaint'], keep: 3 },
  inyeccion: { cases: ['normal', 'injection'] },
};

function chrome(): string {
  const found = CHROME_CANDIDATES.find((path) => path !== undefined && existsSync(path));
  if (found === undefined) throw new Error('No se encontró Chrome: pon su ruta en CHROME_PATH.');
  return found;
}

async function storeOf(cases: readonly GoldenCase[], keep: number | undefined): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const name of cases) await runCase(name, store);
  if (keep !== undefined) {
    const lastRun = store.runs.length;
    const others = store.stored.filter((event) => event.runId !== lastRun);
    const kept = store.stored.filter((event) => event.runId === lastRun).slice(0, keep);
    store.stored.splice(0, store.stored.length, ...others, ...kept);
  }
  return store;
}

async function shoot(set: string, browser: string, profile: string): Promise<void> {
  const spec = SETS[set];
  if (spec === undefined) throw new Error(`No hay un juego «${set}». Hay: ${Object.keys(SETS).join(', ')}.`);
  const scenario = loadScenario(SCENARIOS_DIR, GOLDEN_SCENARIO);
  const circuit = circuitPayload({ definition: CIRCUIT, scenario: scenario.id, model: SIMULATOR_NAME, lowConfidenceBelow: LOW_CONFIDENCE_BELOW, documents: scenario.documents });
  let port = 0;
  const app = buildServer({
    reader: new MemoryRunReader(await storeOf(spec.cases, spec.keep)),
    circuit,
    tools: CRM_TOOLS,
    board: readBoardFiles(BOARD_DIST_DIR),
    port: () => port,
    log: () => undefined,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = (app.server.address() as AddressInfo).port;
  try {
    for (const [width, height] of SIZES) {
      const file = join(SHOTS_DIR, `${set}-${width}x${height}.png`);
      // A profile of its own: without it, Chrome hands the order to a Chrome already open and waits.
      const args = ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--hide-scrollbars', `--window-size=${width},${height}`, `--virtual-time-budget=${VIRTUAL_TIME_MS}`, `--screenshot=${file}`, `http://127.0.0.1:${port}/`];
      await run(browser, args, { timeout: CAPTURE_TIMEOUT_MS });
      process.stdout.write(`${file}\n`);
    }
  } finally {
    await app.close();
  }
}

if (import.meta.main) {
  if (readBoardFiles(BOARD_DIST_DIR).size === 0) throw new Error('El tablero no está compilado: corre npm run board:build.');
  mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = chrome();
  const profile = mkdtempSync(join(tmpdir(), 'circuit-shots-'));
  const sets = process.argv.slice(2);
  try {
    for (const set of sets.length === 0 ? Object.keys(SETS) : sets) await shoot(set, browser, profile);
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
