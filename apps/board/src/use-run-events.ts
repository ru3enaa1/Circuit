import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  API,
  readCircuit,
  readCommandAnswer,
  readEvents,
  readRuns,
  readTools,
  type CircuitInfo,
  type CommandAnswer,
  type CrmTool,
  type RunEvent,
  type RunSummary,
} from './api.ts';

/**
 * Where the board's events come from (ADR-0011 B1, B2; docs/diseno.md §8), and the only file
 * with state or a timer. The feed asks the server for new events once a second, keeps them,
 * and reveals them one at a time, so the simulator's milliseconds become steps the eye can
 * follow. Each frame is the projection of a prefix of the stored events: the timer chooses how
 * many to show, never what a station looks like. It also sends the board's two commands (ADR-0012):
 * try a sample and decide. What they change reaches the board as stored events, like any other;
 * the feed only keeps whether a command is on its way or why the server refused it.
 */

/** ADR-0011, question 2: a poll a second with `?after`. */
export const POLL_INTERVAL_MS = 1000;
/** One stored event every 700 ms (§8). */
export const REVEAL_STEP_MS = 700;

export type FeedStatus = 'loading' | 'ready' | 'unreachable';

/** Why a command did not go through, as the board says it (texts.ts, COMMAND_TEXTS). */
export type CommandProblem = 'conflict' | 'invalid' | 'refused' | 'unreachable';

export type CommandKind = 'tryout' | 'decision';

export interface CommandState {
  readonly status: 'idle' | 'sending' | 'failed';
  /** Which command it was, so its state shows where it was sent from. */
  readonly kind: CommandKind | null;
  readonly problem: CommandProblem | null;
  /** The field the server named in a 400, never a value. */
  readonly field: string | null;
}

const IDLE: CommandState = Object.freeze({ status: 'idle', kind: null, problem: null, field: null });

function problemOf(answer: CommandAnswer): CommandProblem {
  if (answer.status === 409) return 'conflict';
  if (answer.status === 400) return 'invalid';
  return 'refused';
}

export interface FeedSnapshot {
  readonly status: FeedStatus;
  readonly info: CircuitInfo | null;
  readonly tools: readonly CrmTool[];
  readonly runs: readonly RunSummary[];
  readonly runId: number | null;
  /** True while the board follows the newest run; false once one was chosen from the list. */
  readonly following: boolean;
  readonly received: readonly RunEvent[];
  /** How many of `received` are shown. */
  readonly revealed: number;
  readonly command: CommandState;
}

export interface FeedDeps {
  fetchJson(url: string): Promise<unknown>;
  /** A POST with a JSON body; it throws only when nothing answered. */
  postJson(url: string, body: unknown): Promise<CommandAnswer>;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** prefers-reduced-motion: everything at once, no reveal (§14). */
  reducedMotion(): boolean;
}

export interface RunFeed {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FeedSnapshot;
  start(): void;
  stop(): void;
  /** Shows a run chosen from the list, whole and at once (§8). */
  select(runId: number): void;
  /** Starts a run with a sample and follows the newest run, which is that one (A12). */
  tryout(sampleId: string): Promise<void>;
  /** Sends the mentor's decision for the run (A6). */
  decide(runId: number, body: unknown): Promise<void>;
}

const INITIAL: FeedSnapshot = { status: 'loading', info: null, tools: [], runs: [], runId: null, following: true, received: [], revealed: 0, command: IDLE };

export function createRunFeed(deps: FeedDeps): RunFeed {
  let snapshot = INITIAL;
  let pollTimer: unknown = null;
  let revealTimer: unknown = null;
  let running = false;
  /** The next events that arrive for the shown run are revealed at once: it was chosen from the list. */
  let instantNext = false;
  const listeners = new Set<() => void>();

  const update = (change: Partial<FeedSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };

  const scheduleReveal = () => {
    if (revealTimer !== null || snapshot.revealed >= snapshot.received.length) return;
    revealTimer = deps.setTimer(() => {
      revealTimer = null;
      if (!running) return;
      update({ revealed: Math.min(snapshot.received.length, snapshot.revealed + 1) });
      scheduleReveal();
    }, REVEAL_STEP_MS);
  };

  const showRun = (runId: number, following: boolean) => {
    if (revealTimer !== null) deps.clearTimer(revealTimer);
    revealTimer = null;
    update({ runId, following, received: [], revealed: 0 });
  };

  const receive = (runId: number, events: readonly RunEvent[]) => {
    if (snapshot.runId !== runId) return;
    const known = new Set(snapshot.received.map((event) => event.seq));
    const fresh = events.filter((event) => !known.has(event.seq));
    const received = [...snapshot.received, ...fresh].sort((a, b) => a.seq - b.seq);
    const instant = instantNext || deps.reducedMotion();
    instantNext = false;
    update({ received, revealed: instant ? received.length : snapshot.revealed });
    scheduleReveal();
  };

  const loadTable = async () => {
    if (snapshot.info !== null) return;
    const [info, tools] = await Promise.all([deps.fetchJson(API.circuit), deps.fetchJson(API.tools)]);
    update({ info: readCircuit(info), tools: readTools(tools) });
  };

  const poll = async () => {
    await loadTable();
    const runs = readRuns(await deps.fetchJson(API.runs));
    const newest = runs[0]?.id ?? null;
    update({ runs, status: 'ready' });
    if (snapshot.following && newest !== null && newest !== snapshot.runId) showRun(newest, true);
    const runId = snapshot.runId;
    if (runId === null) return;
    const after = snapshot.received.at(-1)?.seq ?? 0;
    receive(runId, readEvents(await deps.fetchJson(API.events(runId, after))));
  };

  const tick = () => {
    pollTimer = null;
    poll()
      .catch(() => {
        // The server may be restarting: the board says so and keeps what it already had.
        update({ status: 'unreachable' });
      })
      .finally(() => {
        if (running) pollTimer = deps.setTimer(tick, POLL_INTERVAL_MS);
      });
  };

  /** Asks at once instead of at the next second, so what a command stored shows sooner. */
  const pollNow = () => {
    if (running && pollTimer !== null) {
      deps.clearTimer(pollTimer);
      tick();
    }
  };

  /** One command at a time: a second click while one is on its way does nothing. */
  const send = async (kind: CommandKind, url: string, body: unknown, done: () => void) => {
    if (snapshot.command.status === 'sending') return;
    update({ command: { status: 'sending', kind, problem: null, field: null } });
    let answer: CommandAnswer;
    try {
      answer = await deps.postJson(url, body);
    } catch {
      update({ command: { status: 'failed', kind, problem: 'unreachable', field: null } });
      return;
    }
    if (answer.status < 200 || answer.status > 299) {
      update({ command: { status: 'failed', kind, problem: problemOf(answer), field: answer.field } });
      return;
    }
    update({ command: IDLE });
    done();
    pollNow();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start() {
      if (running) return;
      running = true;
      tick();
    },
    stop() {
      running = false;
      for (const timer of [pollTimer, revealTimer]) if (timer !== null) deps.clearTimer(timer);
      pollTimer = null;
      revealTimer = null;
    },
    select(runId) {
      instantNext = true;
      showRun(runId, runId === snapshot.runs[0]?.id);
      pollNow();
    },
    tryout: (sampleId) => send('tryout', API.tryout, { sample: sampleId }, () => update({ following: true })),
    decide: (runId, body) => send('decision', API.decision(runId), body, () => undefined),
  };
}

/** The browser's side of the feed: fetch from the same origin, the window's timers and the motion setting. */
export function browserFeedDeps(): FeedDeps {
  return {
    async fetchJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as unknown;
    },
    async postJson(url, body) {
      // Same origin: the browser sends the board's Origin, which the server checks (A6).
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      let value: unknown = null;
      try {
        value = await response.json();
      } catch {
        // An answer with no JSON body still has its status.
      }
      return readCommandAnswer(response.status, value);
    },
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** The feed for one page: started on mount, stopped on unmount. */
export function useRunFeed(): FeedSnapshot & Pick<RunFeed, 'select' | 'tryout' | 'decide'> {
  const [feed] = useState(() => createRunFeed(browserFeedDeps()));
  useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  return { ...snapshot, select: feed.select, tryout: feed.tryout, decide: feed.decide };
}
