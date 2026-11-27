import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import gifenc from 'gifenc';
import pngjs from 'pngjs';

import { BOARD_DIST_DIR } from '../../src/main.ts';
import { readBoardFiles } from '../../src/server/board-files.ts';
import { chrome, startBoard } from './board-shots.ts';

// ADR-0017 (F6): `npm run board:gif` records the board revealing the normal golden case in real
// time and writes the README's GIF. board:shots runs on virtual time, which does not keep the
// animations in step with the reveal (CLAUDE.md §8), so this one drives Chrome over the DevTools
// protocol and keeps the frames Chrome paints, with their own timestamps. The run is the golden
// case in memory: no database, and the same run on any machine. A review tool, not a test.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const GIF_FILE = join(REPO_ROOT, 'docs', 'media', 'circuito.gif');
/** The frames of the GIF as PNG, in the folder board:shots uses, which git ignores. */
const FRAMES_DIR = join(REPO_ROOT, '.shots', 'gif');
/** 16:9, small enough for the README's first screen. */
export const GIF_WIDTH = 1280;
export const GIF_HEIGHT = 720;
/** The reveal of the normal case (an event every 700 ms) and a moment on the closed run. */
const RECORD_MS = 9000;
/** The last frame stays this long before the GIF starts again. */
const FINAL_HOLD_MS = 2500;
/** At most 20 frames a second: Chrome can paint 60, and the GIF would weigh three times as much. */
const MIN_FRAME_MS = 50;
/** GitHub shows GIFs up to 10 MB; half of that keeps the README quick to open (the plan's F6 pitfalls). */
export const GIF_MAX_BYTES = 5 * 1024 * 1024;
const CHROME_START_MS = 10_000;

interface Frame {
  readonly png: Buffer;
  /** Seconds, as Chrome stamps it. */
  readonly at: number;
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function devtoolsPage(profile: string): Promise<WebSocket> {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let waited = 0; !existsSync(portFile); waited += 100) {
    if (waited > CHROME_START_MS) throw new Error('Chrome no abrió su puerto de depuración.');
    await sleep(100);
  }
  const debugPort = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === 'page');
  if (page === undefined) throw new Error('Chrome no tiene una página abierta.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  return socket;
}

/** Records the frames Chrome paints from the board's address for RECORD_MS. */
async function record(socket: WebSocket, url: string): Promise<Frame[]> {
  let id = 0;
  const pending = new Map<number, (result: unknown) => void>();
  const frames: Frame[] = [];
  let loaded: () => void = () => undefined;
  const load = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const send: Send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  socket.addEventListener('message', (message) => {
    const data = JSON.parse(String(message.data)) as { id?: number; result?: unknown; method?: string; params?: { data: string; sessionId: number; metadata: { timestamp: number } } };
    if (data.id !== undefined) pending.get(data.id)?.(data.result);
    if (data.method === 'Page.loadEventFired') loaded();
    if (data.method === 'Page.screencastFrame' && data.params !== undefined) {
      frames.push({ png: Buffer.from(data.params.data, 'base64'), at: data.params.metadata.timestamp });
      void send('Page.screencastFrameAck', { sessionId: data.params.sessionId });
    }
  });
  await send('Emulation.setDeviceMetricsOverride', { width: GIF_WIDTH, height: GIF_HEIGHT, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  // The recording starts once the board loaded: before that Chrome paints its blank page.
  await send('Page.navigate', { url });
  await load;
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(RECORD_MS);
  await send('Page.stopScreencast');
  return frames;
}

/** Keeps a frame only MIN_FRAME_MS after the last one kept, and gives each its time on screen. */
function paced(frames: readonly Frame[]): { readonly frame: Frame; readonly delay: number }[] {
  // A frame that comes sooner replaces the one kept, at its time: the GIF shows the newest picture.
  const kept = frames.reduce<Frame[]>((list, frame) => {
    const last = list.at(-1);
    if (last === undefined || (frame.at - last.at) * 1000 >= MIN_FRAME_MS) list.push(frame);
    else list[list.length - 1] = { png: frame.png, at: last.at };
    return list;
  }, []);
  return kept.map((frame, index) => ({ frame, delay: index + 1 < kept.length ? Math.round(((kept[index + 1]?.at ?? frame.at) - frame.at) * 1000) : FINAL_HOLD_MS }));
}

/**
 * A frame keeps only what changed (ADR-0019): a pixel with the same color as in the frame before is
 * the transparent index, and every frame stays under the next one (dispose 1). The crew's journeys
 * made the GIF pass its 5 MB when each frame was written whole; long runs of one index compress to
 * almost nothing, and the picture is the same.
 */
export function onlyChanges(indexed: Uint8Array, before: Uint8Array | null, transparent: number): Uint8Array {
  if (before === null) return indexed;
  return indexed.map((index, at) => (index === before[at] ? transparent : index));
}

/** The palette's last place, kept free of colors for the pixels that did not change. */
const UNCHANGED = 255;
/** «Do not dispose»: the next frame is drawn over this one. */
const KEEP_UNDER = 1;

/** One palette for every frame, from the last one, which holds every color of the run, so nothing flickers. */
function encode(frames: readonly Frame[]): Uint8Array {
  const steps = paced(frames);
  const last = steps.at(-1);
  if (last === undefined) throw new Error('Chrome no pintó ningún cuadro.');
  // 255 colors and the unchanged place: a color no pixel takes, since applyPalette never picks it.
  const palette = [...gifenc.quantize(pngjs.PNG.sync.read(last.frame.png).data, UNCHANGED), [0, 0, 0]];
  const gif = gifenc.GIFEncoder();
  // Each frame kept, also as a PNG with its time on screen, for the review the GIF cannot give here.
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  steps.forEach(({ frame, delay }, index) => writeFileSync(join(FRAMES_DIR, `${String(index).padStart(3, '0')}-${delay}ms.png`), frame.png));
  let before: Uint8Array | null = null;
  for (const { frame, delay } of steps) {
    const image = pngjs.PNG.sync.read(frame.png);
    const indexed = gifenc.applyPalette(image.data, palette.slice(0, UNCHANGED));
    gif.writeFrame(onlyChanges(indexed, before, UNCHANGED), image.width, image.height, { palette, delay, repeat: 0, transparent: before !== null, transparentIndex: UNCHANGED, dispose: KEEP_UNDER });
    before = indexed;
  }
  gif.finish();
  return gif.bytes();
}

if (import.meta.main) {
  if (readBoardFiles(BOARD_DIST_DIR).size === 0) throw new Error('El tablero no está compilado: corre npm run board:build.');
  const profile = mkdtempSync(join(tmpdir(), 'circuit-gif-'));
  const board = await startBoard(['normal']);
  // --disable-lcd-text: subpixel text paints blue and pink fringes that the GIF keeps as colors.
  const browser = spawn(chrome(), ['--headless=new', '--disable-gpu', '--disable-lcd-text', `--user-data-dir=${profile}`, '--hide-scrollbars', `--window-size=${GIF_WIDTH},${GIF_HEIGHT}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  try {
    const socket = await devtoolsPage(profile);
    const frames = await record(socket, `http://127.0.0.1:${board.port}/`);
    socket.close();
    const bytes = encode(frames);
    if (bytes.length > GIF_MAX_BYTES) throw new Error(`El GIF pesa ${bytes.length} bytes, más que ${GIF_MAX_BYTES}.`);
    mkdirSync(dirname(GIF_FILE), { recursive: true });
    writeFileSync(GIF_FILE, bytes);
    process.stdout.write(`${GIF_FILE} · ${frames.length} cuadros pintados · ${bytes.length} bytes\n`);
  } finally {
    // Chrome holds its profile until it exits: wait for that, not for a guess.
    const exited = browser.exitCode !== null || browser.signalCode !== null ? Promise.resolve() : once(browser, 'exit');
    browser.kill();
    await Promise.race([exited, sleep(CHROME_START_MS)]);
    await board.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}
