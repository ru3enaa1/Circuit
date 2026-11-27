import type { Layout, Point } from './layout.ts';
import { POSES, POSE_BOX, type Accent, type Pose } from './crew-poses.ts';
import type { RunView, StationView } from './projection.ts';
import { overlaps, type Box, type Scene } from './scene.ts';
import { TUBE_SCALE } from './shape.ts';

/**
 * The crew (docs/diseno.md §11, ADR-0014 G4): two to four stick figures standing on the tubes.
 * Decoration only: they never show a state, and never cover a station, a node, a text, the
 * header or the dock. Which poses and where come from a seed tied to the run's id, so the same
 * run always puts them the same way (CLAUDE.md, «Reproducible»). Pure: no clock, no randomness.
 */

export interface CrewFigure {
  readonly pose: Pose;
  /** Where the pose's box goes: its top left, in px, and its scale. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The box it covers, for the checks. */
  readonly box: Box;
  /** The two stations of the tube it stands on. */
  readonly on: readonly [string, string];
  /** A pink prop drawn yellow, when the figure stands by a pink station (§11). */
  readonly pinkAsYellow: boolean;
}

/** A figure is as tall as the circuit's R: smaller than any station (§11). */
const HEIGHT_SCALE = 1;
/** From the top of the head to the feet, in the pose's box. */
const POSE_HEIGHT = 105;
/** The cover starts this far above the head's center: the head's radius and a hat. */
const COVER_TOP = 12;
/** Tubes steeper than this make no floor to stand on. */
const MAX_SLOPE = (40 * Math.PI) / 180;
/** Where along a tube a figure may stand, as a share of its length. */
const SPOTS = [0.3, 0.4, 0.5, 0.6, 0.7] as const;
const MIN_FIGURES = 2;
const MAX_FIGURES = 4;
/** Kept free around a figure, in px. */
const CLEARANCE = 4;
/** The corners the header and the clock take (§6), in px at any size; the dock takes the bottom band. */
const HEADER_HEIGHT = 200;
const HEADER_WIDTH = 410;
const CLOCK_WIDTH = 230;
const CLOCK_HEIGHT = 170;
const TOOLS_WIDTH = 230;
const TOOLS_HEIGHT = 130;
const NARROW_HEADER_HEIGHT = 160;
/** A figure this close to a pink station takes a yellow prop instead of a pink one (§11). */
const PINK_REACH_SCALE = 3;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32 bits: the run's seed, the same on every machine (ADR-0014). */
export function seedOf(text: string): number {
  let hash = FNV_OFFSET;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: a small fixed generator, so a seed always gives the same draws. */
export function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

/** In a stop, a failure or while the person decides, only serious poses (§11). */
export function seriousOnly(view: RunView): boolean {
  const waiting = view.stations.find((station) => station.id === view.waitingAt);
  return waiting?.decidedBy === 'person' || view.stations.some((station) => station.status === 'stopped' || station.status === 'failed');
}

function isPinkStation(station: StationView): boolean {
  return station.status === 'stopped' || station.status === 'failed' || (station.status === 'waiting' && station.decidedBy === 'person');
}

interface Spot {
  readonly foot: Point;
  readonly center: Point;
  readonly ends: readonly [string, string];
}

/** The points of the tubes a figure can stand on: not too steep, at fixed shares of their length. */
function spotsOf(scene: Scene, layout: Layout): Spot[] {
  const half = (layout.radius * TUBE_SCALE) / 2;
  return scene.edges.flatMap((entry) => {
    if (entry.edge.kind !== 'main' && entry.edge.kind !== 'branch') return [];
    const angle = Math.atan2(entry.to.y - entry.from.y, entry.to.x - entry.from.x);
    const slope = Math.abs(Math.atan(Math.tan(angle)));
    if (slope > MAX_SLOPE) return [];
    return SPOTS.map((share) => {
      const center = { x: entry.from.x + (entry.to.x - entry.from.x) * share, y: entry.from.y + (entry.to.y - entry.from.y) * share };
      // The tube's top edge, where the feet rest: higher than its center by half its width, along the vertical.
      return { center, foot: { x: center.x, y: center.y - half / Math.cos(slope) }, ends: [entry.edge.from, entry.edge.to] as const };
    });
  });
}

/** The page's own parts a figure must leave free: the header, the clock, the tools and the dock. */
function framesOf(layout: Layout): Box[] {
  const { width, height } = layout;
  const header = layout.narrow ? [{ x: width / 2, y: NARROW_HEADER_HEIGHT / 2, w: width, h: NARROW_HEADER_HEIGHT }] : [{ x: HEADER_WIDTH / 2, y: HEADER_HEIGHT / 2, w: HEADER_WIDTH, h: HEADER_HEIGHT }];
  return [
    ...header,
    { x: width - CLOCK_WIDTH / 2, y: CLOCK_HEIGHT / 2, w: CLOCK_WIDTH, h: CLOCK_HEIGHT },
    { x: TOOLS_WIDTH / 2, y: height - TOOLS_HEIGHT / 2, w: TOOLS_WIDTH, h: TOOLS_HEIGHT },
    { x: width / 2, y: height - layout.bottom / 2, w: width, h: layout.bottom },
  ];
}

function figureAt(pose: Pose, spot: Spot, scale: number): Omit<CrewFigure, 'pinkAsYellow' | 'on'> {
  const feetX = (pose.feet[0][0] + pose.feet[1][0]) / 2;
  // A sitting pose rests its seat on the tube's center; the others stand on its top edge.
  const anchorY = pose.seat ?? POSE_BOX.feet;
  const ground = pose.seat === undefined ? spot.foot : spot.center;
  const x = ground.x - feetX * scale;
  const y = ground.y - anchorY * scale;
  const top = y + (pose.top ?? pose.head[1] - COVER_TOP) * scale;
  const bottom = y + POSE_BOX.feet * scale;
  // The whole width of the pose's box: a broom, a ball or a tape reaches to its sides.
  return { pose, x, y, scale, box: { x: x + (POSE_BOX.width / 2) * scale, y: (top + bottom) / 2, w: POSE_BOX.width * scale, h: bottom - top } };
}

/** Spots on the tubes of the pose's station first, so the shield stands by Filtro (B7). */
function orderFor(pose: Pose, spots: readonly Spot[]): Spot[] {
  if (pose.near === undefined) return [...spots];
  return [...spots.filter((spot) => spot.ends.includes(pose.near ?? '')), ...spots.filter((spot) => !spot.ends.includes(pose.near ?? ''))];
}

export function crewFor(runId: number | null, view: RunView, scene: Scene, layout: Layout): readonly CrewFigure[] {
  const next = generator(seedOf(`circuit-crew-${runId ?? 'idle'}`));
  const count = MIN_FIGURES + Math.floor(next() * (MAX_FIGURES - MIN_FIGURES + 1));
  const poses = shuffled(
    POSES.filter((pose) => !seriousOnly(view) || pose.tone === 'serio'),
    next,
  );
  const spots = shuffled(spotsOf(scene, layout), next);
  const scale = (layout.radius * HEIGHT_SCALE) / POSE_HEIGHT;
  const blocked = [...scene.obstacles, ...framesOf(layout)];
  const pinkStations = view.stations.filter(isPinkStation);
  const pinkPlaces = pinkStations.flatMap((station) => layout.places[station.id] ?? []);
  const crew: CrewFigure[] = [];
  for (const pose of poses) {
    if (crew.length === count) break;
    const placed = orderFor(pose, spots)
      .map((spot) => ({ spot, figure: figureAt(pose, spot, scale) }))
      .find(({ figure }) => figure.box.y - figure.box.h / 2 >= 0 && [...blocked, ...crew.map((other) => other.box)].every((other) => !overlaps(figure.box, other, CLEARANCE)));
    if (placed === undefined) continue;
    const { spot, figure } = placed;
    // Beside a pink station is on one of its tubes, or within reach of it.
    const pinkAsYellow =
      pinkStations.some((station) => spot.ends.includes(station.id)) || pinkPlaces.some((place) => Math.hypot(place.x - figure.box.x, place.y - figure.box.y) < place.r * PINK_REACH_SCALE);
    crew.push({ ...figure, on: spot.ends, pinkAsYellow });
  }
  return crew;
}

/** The color a prop is drawn in, with the pink one turned yellow by a pink station. */
export function accentOf(accent: Accent, pinkAsYellow: boolean): Accent {
  return accent === 'pink' && pinkAsYellow ? 'yellow' : accent;
}
