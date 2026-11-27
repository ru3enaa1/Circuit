import type { Layout, Point } from './layout.ts';
import type { RunView } from './projection.ts';
import type { Scene } from './scene.ts';
import { drawOf, seedOf } from './seed.ts';

/**
 * How each figure of the crew comes in and how one goes out (ADR-0019, docs/diseno.md §11). A figure
 * that mounts arrives: it walks in along one of the two lines at the left (where the requests come in,
 * or where they leave) and then along the tubes to its spot, or a door opens on its spot and it steps
 * out. When the run closes on its route, one figure walks to Cierre and slides down the last line out
 * of the window. Pure: the way is a list of points, the same for the same run and the same window,
 * and motion.css walks it once when the figure mounts. Nothing here says a state: the crew is
 * decoration, and the circuit is still drawn only from the stored events.
 */

export type MoveKind = 'entry' | 'exit' | 'door' | 'leave';

export interface Slide {
  /** From the feet at Cierre to past the edge of the window, along the last line. */
  readonly by: Point;
  /** The feet at Cierre, where the figure leans back as it slides. */
  readonly origin: Point;
  /** The lean, in degrees: back against the way it slides. */
  readonly turn: number;
  readonly atMs: number;
}

export interface CrewMove {
  readonly kind: MoveKind;
  /** WALK_POINTS offsets from the figure's place, evenly spaced along the way: empty at a door. */
  readonly walk: readonly Point[];
  readonly walkMs: number;
  /** When it starts, after the figure mounts. */
  readonly atMs: number;
  readonly slide: Slide | null;
}

/** What a move needs to know of a figure: where on the tubes it stands, and how it is drawn there. */
export interface Placed {
  readonly key: string;
  /** The point of the tube's center line it stands over. */
  readonly at: Point;
  /** The two stations of its tube. */
  readonly on: readonly [string, string];
  /** Its feet, in the window. */
  readonly feet: Point;
  /** How tall it is in the window, in px: how far past the edge it starts. */
  readonly height: number;
  /** A sitting pose has no feet to step out of a door with. */
  readonly sitting: boolean;
  /** Its pose's place in B7's list: the figures of a crew take turns of way and time by it. */
  readonly order: number;
}

/** The points of a walk: motion.css has one keyframe each, evenly spaced (6.25 % apart). */
export const WALK_POINTS = 17;
/** A walk's speed, in px per ms: about a window's width in four seconds at 1536 px. */
const WALK_SPEED = 0.42;
export const WALK_MIN_MS = 900;
export const WALK_MAX_MS = 4800;
/** Every other point lifts the figure a little: its steps. */
const STEP_LIFT = 3;
/** Figures arrive at one of these times after they mount, by their seed, so not all at once. */
const ARRIVAL_SLOTS_MS = [150, 550, 950, 1350] as const;
/** The figure that leaves waits this long after Cierre completes, so the close reads first. */
const LEAVE_AFTER_MS = 500;
/** The lean back of a figure on the slide, in degrees. */
const SLIDE_LEAN = 28;
/** The ways in, taken in turn by the figures of a crew. */
const WAYS = ['door', 'entry', 'exit'] as const;

/** To a tenth of a px, with no negative zero: it would be written «-0px». */
const round = (value: number) => Math.round(value * 10) / 10 + 0;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** A line's way out of the window: where it crosses the window grown by `margin` on every side. */
export function leavingPoint(from: Point, far: Point, layout: Layout, margin: number): Point {
  const dx = far.x - from.x;
  const dy = far.y - from.y;
  const limits = [dx > 0 ? (layout.width + margin - from.x) / dx : dx < 0 ? (-margin - from.x) / dx : Infinity, dy > 0 ? (layout.height + margin - from.y) / dy : dy < 0 ? (-margin - from.y) / dy : Infinity];
  const t = Math.min(1, Math.max(0, Math.min(...limits)));
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** The stations, linked by the tubes a figure may walk: the main way and the branch, both ways. */
function graphOf(scene: Scene): ReadonlyMap<string, readonly string[]> {
  const links = new Map<string, string[]>();
  const link = (a: string, b: string) => links.set(a, [...(links.get(a) ?? []), b]);
  for (const entry of scene.edges) {
    if (entry.edge.kind !== 'main' && entry.edge.kind !== 'branch') continue;
    link(entry.edge.from, entry.edge.to);
    link(entry.edge.to, entry.edge.from);
  }
  return links;
}

/** The fewest stations from `start` to any of `goals`, both included; null if none is reached. */
export function stationsBetween(scene: Scene, start: string, goals: readonly string[]): string[] | null {
  const links = graphOf(scene);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index] as string;
    if (goals.includes(current)) {
      const way: string[] = [];
      for (let step: string | null = current; step !== null; step = previous.get(step) ?? null) way.unshift(step);
      return way;
    }
    for (const next of links.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return null;
}

/** WALK_POINTS points evenly spaced along a broken line, every other one lifted for a step. */
export function resample(points: readonly Point[]): Point[] {
  const lengths = points.slice(1).map((point, index) => distance(points[index] as Point, point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return Array.from({ length: WALK_POINTS }, (_, index) => {
    let left = (total * index) / (WALK_POINTS - 1);
    let segment = 0;
    while (segment < lengths.length - 1 && left > (lengths[segment] ?? 0)) left -= lengths[segment++] ?? 0;
    const from = points[segment] as Point;
    const to = points[segment + 1] ?? from;
    const share = (lengths[segment] ?? 0) === 0 ? 0 : left / (lengths[segment] ?? 1);
    const lift = index % 2 === 1 ? STEP_LIFT : 0;
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share - lift };
  });
}

const lengthOf = (points: readonly Point[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index] as Point, point), 0);
const walkMsOf = (points: readonly Point[]) => Math.round(Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, lengthOf(points) / WALK_SPEED)));
/** The walk as offsets from where the figure stands: the last one is (0, 0) on arrival. */
const offsets = (points: readonly Point[], at: Point) => resample(points).map((point) => ({ x: round(point.x - at.x), y: round(point.y - at.y) }));

interface Line {
  readonly station: string;
  readonly from: Point;
  readonly far: Point;
}

function linesOf(scene: Scene): { readonly entry: Line | null; readonly exit: Line | null } {
  const first = scene.stations[0];
  const exit = scene.edges.find((entry) => entry.edge.kind === 'exit');
  return {
    entry: first === undefined || scene.entry === null ? null : { station: first.station.id, from: scene.entry.from, far: scene.entry.to },
    exit: exit === undefined ? null : { station: exit.edge.from, from: exit.from, far: exit.to },
  };
}

/** The way from past the edge of the window, along a line and the tubes, to the figure's spot. */
function arrivalWay(line: Line, figure: Placed, scene: Scene, layout: Layout): Point[] | null {
  const stations = stationsBetween(scene, line.station, figure.on);
  if (stations === null) return null;
  const places = stations.flatMap((id) => layout.places[id] ?? []);
  return [leavingPoint(line.from, line.far, layout, figure.height), ...places, figure.at];
}

/**
 * Independent draws per figure sent a whole crew out of doors at the same moment in some runs (the
 * GIF's first run among them). Turns by pose mix every crew from a place the run's seed picks, and a
 * figure keeps its way and its time while it stands on its spot, since its pose does not change there.
 */
function arrivalOf(figure: Placed, runId: number | null, scene: Scene, layout: Layout): CrewMove {
  const run = runId ?? 'idle';
  const atMs = ARRIVAL_SLOTS_MS[(seedOf(`circuit-crew-times-${run}`) + figure.order) % ARRIVAL_SLOTS_MS.length] ?? 0;
  const chosen = WAYS[(Math.floor(drawOf(`circuit-crew-ways-${run}`) * WAYS.length) + figure.order) % WAYS.length] ?? 'entry';
  const lines = linesOf(scene);
  const line = chosen === 'exit' ? lines.exit : lines.entry;
  // A sitting pose has no feet to step out of a door with: it comes in along the first line.
  const way = (chosen === 'door' && !figure.sitting) || line === null ? null : arrivalWay(line, figure, scene, layout);
  if (way === null) return { kind: 'door', walk: [], walkMs: 0, atMs, slide: null };
  return { kind: line === lines.entry ? 'entry' : 'exit', walk: offsets(way, figure.at), walkMs: walkMsOf(way), atMs, slide: null };
}

/** The figure walks to Cierre, under its bubble, and slides down the last line out of the window. */
function leaveOf(figure: Placed, scene: Scene, layout: Layout): CrewMove | null {
  const { exit } = linesOf(scene);
  if (exit === null) return null;
  const stations = stationsBetween(scene, exit.station, figure.on);
  if (stations === null) return null;
  const way = [figure.at, ...[...stations].reverse().flatMap((id) => layout.places[id] ?? [])];
  const walkMs = walkMsOf(way);
  const lift = { x: figure.feet.x - figure.at.x, y: figure.feet.y - figure.at.y };
  const out = leavingPoint(exit.from, exit.far, layout, figure.height * 2);
  const by = { x: round(out.x - exit.from.x), y: round(out.y - exit.from.y) };
  const origin = { x: round(exit.from.x + lift.x), y: round(exit.from.y + lift.y) };
  const slide = { by, origin, turn: by.x < 0 ? SLIDE_LEAN : -SLIDE_LEAN, atMs: LEAVE_AFTER_MS + walkMs };
  return { kind: 'leave', walk: offsets(way, figure.at), walkMs, atMs: LEAVE_AFTER_MS, slide };
}

/** A run that ended on its route: every station completed or skipped, Cierre among the completed. */
export function closedOnRoute(view: RunView): boolean {
  return view.finished && view.stations.every((station) => station.status === 'completed' || station.status === 'skipped');
}

/** Each figure's move: an arrival, or, for the one the seed picks once the run closed, the slide out. */
export function movesFor(figures: readonly Placed[], runId: number | null, view: RunView, scene: Scene, layout: Layout): CrewMove[] {
  const leaver = closedOnRoute(view) && figures.length > 0 ? Math.floor(drawOf(`circuit-crew-leave-${runId ?? 'idle'}`) * figures.length) : -1;
  return figures.map((figure, index) => (index === leaver ? leaveOf(figure, scene, layout) : null) ?? arrivalOf(figure, runId, scene, layout));
}
