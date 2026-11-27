import { useEffect, useState, useSyncExternalStore } from 'react';

import { API, readCircuit, readEvents, readRuns, readTools, type CircuitInfo, type CrmTool, type RunEvent, type RunSummary } from './api.ts';

/**
 * Where the board's events come from (ADR-0011 B1, B2; docs/diseno.md §8), and the only file
 * with state or a timer. The feed asks the server for new events once a second, keeps them,
 * and reveals them one at a time, so the simulator's milliseconds become steps the eye can
 * follow. Each frame is the projection of a prefix of the stored events: the timer chooses how
 * many to show, never what a station looks like.
 */

/** ADR-0011, question 2: a poll a second with `?after`. */
export const POLL_INTERVAL_MS = 1000;
/** One stored event every 700 ms (§8). */
export const REVEAL_STEP_MS = 700;

export type FeedStatus = 'loading' | 'ready' | 'unreachable';

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
}

export interface FeedDeps {
  fetchJson(url: string): Promise<unknown>;
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
}

const INITIAL: FeedSnapshot = { status: 'loading', info: null, tools: [], runs: [], runId: null, following: true, received: [], revealed: 0 };

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
      if (running && pollTimer !== null) {
        deps.clearTimer(pollTimer);
        tick();
      }
    },
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
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** The feed for one page: started on mount, stopped on unmount. */
export function useRunFeed(): FeedSnapshot & { readonly select: (runId: number) => void } {
  const [feed] = useState(() => createRunFeed(browserFeedDeps()));
  useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);
  const snapshot = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  return { ...snapshot, select: feed.select };
}
