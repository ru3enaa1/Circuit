import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOARD_DIST_DIR } from '../../src/main.ts';
import { readBoardFiles } from '../../src/server/board-files.ts';
import type { GoldenCase } from '../golden/harness.ts';
import { GIF_HEIGHT, GIF_WIDTH, devtoolsPage } from './board-gif.ts';
import { chrome, startBoard } from './board-shots.ts';

// F6, in place of the 90 s video (the owner, 2026-11-27): `npm run board:storyboard` takes the
// frames of the video's script as stills, written to docs/media/recorrido/ and described one by
// one in docs/recorrido.md. Like board:gif, it drives Chrome over the DevTools protocol in real
// time, because virtual time leaves the animations half drawn (CLAUDE.md §8). Each frame is a
// golden case in memory, cut after `keep` events: a run waiting at Persona is the normal case
// with its first five. A review tool, not a test: storyboard.test.ts only holds the files.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const STORYBOARD_DIR = join(REPO_ROOT, 'docs', 'media', 'recorrido');
/** The board's reveal step (an event every 700 ms) and the crew's journeys after it. */
const STEP_MS = 700;
const SETTLE_MS = 3500;
const CHROME_EXIT_MS = 10_000;

export interface StoryFrame {
  /** The file's name, without `.png`; its number keeps the order of the script. */
  readonly name: string;
  readonly cases: readonly GoldenCase[];
  readonly keep?: number;
  readonly hash?: string;
  /** Opens «Probar una solicitud», a native disclosure a click would open. */
  readonly openTryout?: boolean;
}

export const STORY_FRAMES: readonly StoryFrame[] = [
  { name: '01-probar', cases: [], openTryout: true },
  { name: '02-entrada', cases: ['normal'], keep: 1 },
  { name: '03-filtro', cases: ['normal'], keep: 2, hash: '#/estacion/filter' },
  { name: '04-clasificacion', cases: ['normal'], keep: 3 },
  { name: '05-conocimiento', cases: ['normal'], keep: 4, hash: '#/estacion/knowledge' },
  { name: '06-crm', cases: ['normal'], keep: 5, hash: '#/estacion/crm/accion/1' },
  { name: '07-persona', cases: ['normal'], keep: 5, hash: '#/estacion/person' },
  { name: '08-cierre', cases: ['normal'] },
  { name: '09-inyeccion', cases: ['normal', 'injection'] },
  { name: '10-queja', cases: ['normal', 'complaint'], keep: 3 },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Send = (method: string, params?: Record<string, unknown>) => Promise<{ data?: string }>;

function client(socket: WebSocket): { readonly send: Send; readonly loaded: () => Promise<void> } {
  let id = 0;
  const pending = new Map<number, (result: { data?: string }) => void>();
  let onLoad: () => void = () => undefined;
  socket.addEventListener('message', (message) => {
    const data = JSON.parse(String(message.data)) as { id?: number; result?: { data?: string }; method?: string };
    if (data.id !== undefined) pending.get(data.id)?.(data.result ?? {});
    if (data.method === 'Page.loadEventFired') onLoad();
  });
  const send: Send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, loaded: () => new Promise((resolve) => (onLoad = resolve)) };
}

/** How many events the board reveals for a frame: the cut, or every event of the last case. */
function revealed(frame: StoryFrame): number {
  return frame.keep ?? 7;
}

async function take(send: Send, loaded: () => Promise<void>, frame: StoryFrame): Promise<Buffer> {
  const board = await startBoard(frame.cases, frame.keep);
  try {
    const load = loaded();
    await send('Page.navigate', { url: `http://127.0.0.1:${board.port}/${frame.hash ?? ''}` });
    await load;
    await sleep(revealed(frame) * STEP_MS + SETTLE_MS);
    if (frame.openTryout === true) {
      await send('Runtime.evaluate', { expression: "document.querySelector('[data-tryout] details').open = true" });
      await sleep(STEP_MS);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.data === undefined) throw new Error(`Chrome no capturó el cuadro ${frame.name}.`);
    return Buffer.from(shot.data, 'base64');
  } finally {
    await board.close();
  }
}

if (import.meta.main) {
  if (readBoardFiles(BOARD_DIST_DIR).size === 0) throw new Error('El tablero no está compilado: corre npm run board:build.');
  const only = process.argv.slice(2);
  const profile = mkdtempSync(join(tmpdir(), 'circuit-storyboard-'));
  const browser = spawn(chrome(), ['--headless=new', '--disable-gpu', '--disable-lcd-text', `--user-data-dir=${profile}`, '--hide-scrollbars', `--window-size=${GIF_WIDTH},${GIF_HEIGHT}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  try {
    const socket = await devtoolsPage(profile);
    const { send, loaded } = client(socket);
    await send('Emulation.setDeviceMetricsOverride', { width: GIF_WIDTH, height: GIF_HEIGHT, deviceScaleFactor: 1, mobile: false });
    await send('Page.enable');
    mkdirSync(STORYBOARD_DIR, { recursive: true });
    for (const frame of STORY_FRAMES.filter((each) => only.length === 0 || only.includes(each.name))) {
      const file = join(STORYBOARD_DIR, `${frame.name}.png`);
      writeFileSync(file, await take(send, loaded, frame));
      process.stdout.write(`${file}\n`);
    }
    socket.close();
  } finally {
    // Chrome holds its profile until it exits: wait for that, not for a guess.
    const exited = browser.exitCode !== null || browser.signalCode !== null ? Promise.resolve() : once(browser, 'exit');
    browser.kill();
    await Promise.race([exited, sleep(CHROME_EXIT_MS)]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}
