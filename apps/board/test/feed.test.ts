import { describe, expect, it } from 'vitest';

import type { RunEvent, RunSummary } from '../src/api.ts';
import { POLL_INTERVAL_MS, REVEAL_STEP_MS, createRunFeed, type FeedDeps } from '../src/use-run-events.ts';
import { boardInfo, goldenEvents } from './support.ts';

// ADR-0011 B1 and B2, docs/diseno.md §8: the feed asks for new events once a second and reveals
// them one at a time. Its timers are injected, so the test moves time by hand and sees each step.

interface FakeServer {
  runs: RunSummary[];
  events: Record<number, RunEvent[]>;
  fail: boolean;
  readonly asked: string[];
}

function summary(id: number, events: readonly RunEvent[]): RunSummary {
  const last = events.at(-1);
  return { id, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: last?.station ?? null, lastOutcome: last?.outcome ?? null, lastStatus: last?.status ?? null };
}

function harness(options: { readonly reducedMotion?: boolean } = {}) {
  const server: FakeServer = { runs: [], events: {}, fail: false, asked: [] };
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const deps: FeedDeps = {
    async fetchJson(url) {
      server.asked.push(url);
      if (server.fail) throw new Error('sin servidor');
      if (url === '/api/circuit') return boardInfo();
      if (url === '/api/tools') return { tools: [{ name: 'find_contact', label: 'Buscar contacto', access: 'read' }] };
      if (url === '/api/runs') return { runs: server.runs };
      const match = /^\/api\/runs\/(\d+)\/events\?after=(\d+)$/.exec(url);
      if (match === null) throw new Error(url);
      return { events: (server.events[Number(match[1])] ?? []).filter((event) => event.seq > Number(match[2])) };
    },
    setTimer(run, ms) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, run });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
    reducedMotion: () => options.reducedMotion ?? false,
  };
  const feed = createRunFeed(deps);
  /** Runs every timer due within `ms`, in order, letting the fetches settle between them. */
  async function advance(ms: number): Promise<void> {
    const until = now + ms;
    await settle();
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
      await settle();
    }
    now = until;
  }
  return { feed, server, advance, timers };
}

const settle = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

const shown = (feed: ReturnType<typeof createRunFeed>) => feed.getSnapshot().received.slice(0, feed.getSnapshot().revealed).map((event) => event.station);

describe('the feed of the board', () => {
  it('starts loading, reads the table and the tools, and follows the newest run', async () => {
    const { feed, server, advance } = harness();
    const normal = goldenEvents('normal');
    server.runs = [summary(1, normal)];
    server.events[1] = [...normal];

    expect(feed.getSnapshot().status).toBe('loading');
    feed.start();
    await advance(0);

    expect(feed.getSnapshot()).toMatchObject({ status: 'ready', runId: 1, following: true, revealed: 0 });
    expect(feed.getSnapshot().info?.lowConfidenceBelow).toBe(0.7);
    expect(feed.getSnapshot().tools).toHaveLength(1);
    expect(feed.getSnapshot().received).toHaveLength(7);
    feed.stop();
  });

  it(`reveals the stored events one at a time, every ${REVEAL_STEP_MS} ms`, async () => {
    const { feed, server, advance } = harness();
    const normal = goldenEvents('normal');
    server.runs = [summary(1, normal)];
    server.events[1] = [...normal];
    feed.start();
    await advance(0);

    const frames: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      frames.push(feed.getSnapshot().revealed);
      await advance(REVEAL_STEP_MS);
    }
    expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shown(feed)).toEqual(normal.map((event) => event.station));
    feed.stop();
  });

  it('asks only for what is new, with after = the last seq it has', async () => {
    const { feed, server, advance } = harness();
    const complaint = goldenEvents('complaint');
    server.runs = [summary(1, complaint.slice(0, 3))];
    server.events[1] = complaint.slice(0, 3);
    feed.start();
    await advance(0);
    server.events[1] = [...complaint];
    server.runs = [summary(1, complaint)];
    await advance(POLL_INTERVAL_MS);

    expect(server.asked.filter((url) => url.includes('/events'))).toEqual(['/api/runs/1/events?after=0', '/api/runs/1/events?after=3']);
    expect(feed.getSnapshot().received.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    feed.stop();
  });

  it('switches to a newer run while it follows, and starts its reveal from zero', async () => {
    const { feed, server, advance } = harness();
    server.runs = [summary(1, goldenEvents('normal'))];
    server.events[1] = [...goldenEvents('normal')];
    feed.start();
    await advance(REVEAL_STEP_MS * 10);
    server.runs = [summary(2, goldenEvents('injection')), ...server.runs];
    server.events[2] = [...goldenEvents('injection')];
    await advance(POLL_INTERVAL_MS);

    expect(feed.getSnapshot()).toMatchObject({ runId: 2, following: true });
    expect(feed.getSnapshot().revealed).toBeLessThan(2);
    feed.stop();
  });

  it('a run chosen from the list shows whole and at once, and is no longer followed away', async () => {
    const { feed, server, advance } = harness();
    server.runs = [summary(2, goldenEvents('injection')), summary(1, goldenEvents('normal'))];
    server.events[1] = [...goldenEvents('normal')];
    server.events[2] = [...goldenEvents('injection')];
    feed.start();
    await advance(0);
    feed.select(1);
    await advance(0);

    expect(feed.getSnapshot()).toMatchObject({ runId: 1, following: false, revealed: 7 });
    server.runs = [summary(3, []), ...server.runs];
    await advance(POLL_INTERVAL_MS);
    expect(feed.getSnapshot().runId).toBe(1);
    feed.stop();
  });

  it('with reduced motion, everything at once', async () => {
    const { feed, server, advance } = harness({ reducedMotion: true });
    server.runs = [summary(1, goldenEvents('normal'))];
    server.events[1] = [...goldenEvents('normal')];
    feed.start();
    await advance(0);

    expect(feed.getSnapshot().revealed).toBe(7);
    feed.stop();
  });

  it('an unreachable server is said, what it had is kept, and it tries again a second later', async () => {
    const { feed, server, advance } = harness();
    server.runs = [summary(1, goldenEvents('injection'))];
    server.events[1] = [...goldenEvents('injection')];
    feed.start();
    await advance(0);
    server.fail = true;
    await advance(POLL_INTERVAL_MS);

    expect(feed.getSnapshot()).toMatchObject({ status: 'unreachable', runId: 1 });
    expect(feed.getSnapshot().received).toHaveLength(2);
    server.fail = false;
    await advance(POLL_INTERVAL_MS);
    expect(feed.getSnapshot().status).toBe('ready');
    feed.stop();
  });

  it('with no runs, nothing is shown and it keeps asking', async () => {
    const { feed, server, advance } = harness();
    feed.start();
    await advance(POLL_INTERVAL_MS * 2);

    expect(feed.getSnapshot()).toMatchObject({ status: 'ready', runId: null, received: [] });
    expect(server.asked.filter((url) => url === '/api/runs')).toHaveLength(3);
    feed.stop();
  });

  it('stop clears its timers, and a stopped feed asks nothing more; start twice is one feed', async () => {
    const { feed, server, advance, timers } = harness();
    server.runs = [summary(1, goldenEvents('normal'))];
    server.events[1] = [...goldenEvents('normal')];
    feed.start();
    feed.start();
    await advance(REVEAL_STEP_MS);
    feed.stop();
    const asked = server.asked.length;
    await advance(POLL_INTERVAL_MS * 5);

    expect(timers.size).toBe(0);
    expect(server.asked.length).toBe(asked);
  });

  it('notifies its listeners on each change, until they leave', async () => {
    const { feed, server, advance } = harness();
    server.runs = [];
    let calls = 0;
    const leave = feed.subscribe(() => {
      calls += 1;
    });
    feed.start();
    await advance(0);
    const seen = calls;
    leave();
    await advance(POLL_INTERVAL_MS);

    expect(seen).toBeGreaterThan(0);
    expect(calls).toBe(seen);
    feed.stop();
  });
});
