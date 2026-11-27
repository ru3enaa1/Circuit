import type { CircuitInfo } from './api.ts';
import { formatDuration, measureOf } from './format.ts';
import type { Layout, Point, StationPlace } from './layout.ts';
import { outcomeTag, secondaryNodes, statusText } from './nodes.ts';
import type { EdgeView, RunView, StationView } from './projection.ts';
import { DECISION_TEXTS, RUN_TEXTS } from './texts.ts';
import { INNER_RING_GAP, OUTER_RING_SCALE, armDistance, armRadius, armsOf, planArms, toward, type Arm } from './shape.ts';

/**
 * Where everything of the orbit goes (docs/diseno.md §6 and §7), as boceto B1 places it: each
 * station's nodes in the widest gap between its tubes, their short names beyond them, the
 * telemetry at the end of a guide line, the branch's label and the injection stop. Texts that
 * would touch are nudged apart. Pure: the same view and size give the same scene, and the crew
 * and the panels read its boxes to stay clear of it.
 */

/** A box by its center, in px. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ArmLabel extends Box {
  readonly key: string;
  readonly label: string;
  /** The node's value, from the event: the tooltip. */
  readonly title: string;
  /** Persona's decision taken. */
  readonly filled: boolean;
  /** Its station was left behind, or this way out was not the one taken. */
  readonly muted: boolean;
}

export interface Telemetry extends Box {
  readonly primary: string;
  readonly secondary: string | null;
  readonly lead: { readonly from: Point; readonly to: Point };
}

export interface StationScene {
  readonly station: StationView;
  readonly place: StationPlace;
  readonly arms: readonly Arm[];
  readonly labels: readonly ArmLabel[];
  readonly telemetry: Telemetry | null;
  readonly outerRing: number;
  readonly innerRing: number;
}

export interface StopScene {
  readonly center: Point;
  readonly r: number;
  readonly label: Box;
}

export interface EdgeScene {
  readonly edge: EdgeView;
  readonly from: Point;
  readonly to: Point;
  /** The branch's label, placed where it touches no node and no station. */
  readonly label: Box | null;
  readonly stop: StopScene | null;
}

export interface Scene {
  readonly stations: readonly StationScene[];
  readonly edges: readonly EdgeScene[];
  /** The line the requests come in by, from the first station to past the edge of the window. */
  readonly entry: { readonly from: Point; readonly to: Point } | null;
  /** Every bubble, node and text: what nothing else may cover. */
  readonly obstacles: readonly Box[];
}

/** JetBrains Mono's advance at 10 and 10.5 px, to know a text's width without a browser. */
const LABEL_CHAR = 6.1;
const TELEMETRY_CHAR = 6.7;
const LABEL_HEIGHT = 12;
const TELEMETRY_LINE = 13;
/** The stop's guide turns this far from Filtro's way out, in radians, so it clears its tubes. */
const STOP_TURN = 0.7;
/** How far past its nodes the stop's small bubble sits. */
const STOP_REACH = 34;
/** Kept free around a text, and between a text and the edge of the window. */
const TEXT_MARGIN = 3;
const EDGE_MARGIN = 6;
/** The branch's label tries these points along its tube, the middle first. */
const BRANCH_TRIES = [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75] as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function overlaps(a: Box, b: Box, margin = TEXT_MARGIN): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin - 1;
}

/** Keeps a box inside the window and above the dock. */
function inWindow(layout: Layout, box: Box): Box {
  const bottom = layout.height - layout.bottom;
  return { ...box, x: clamp(box.x, box.w / 2 + EDGE_MARGIN, layout.width - box.w / 2 - EDGE_MARGIN), y: clamp(box.y, box.h / 2 + 4, bottom - box.h / 2 - 4) };
}

/** The way a station looks out of the orbit: its angle on the ellipse, or away from the center. */
function outward(place: StationPlace, layout: Layout): number {
  if (place.angle !== null) return toRadians(place.angle);
  return Math.atan2(place.y - layout.center.y, place.x - layout.center.x);
}

function stopAngle(place: StationPlace, layout: Layout): number {
  return outward(place, layout) + STOP_TURN;
}

/** Every angle at which something leaves a station: its tubes, its stop and its lines to the edge. */
function connectionsOf(view: RunView, layout: Layout): ReadonlyMap<string, number[]> {
  const connections = new Map<string, number[]>(view.stations.map((station) => [station.id, []]));
  const add = (id: string, angle: number) => connections.get(id)?.push(angle);
  for (const edge of view.edges) {
    const from = layout.places[edge.from];
    if (from === undefined) continue;
    if (edge.kind === 'stop') add(edge.from, stopAngle(from, layout));
    else if (edge.kind === 'exit') add(edge.from, outward(from, layout));
    else {
      const to = layout.places[edge.to];
      if (to === undefined) continue;
      add(edge.from, Math.atan2(to.y - from.y, to.x - from.x));
      add(edge.to, Math.atan2(from.y - to.y, from.x - to.x));
    }
  }
  const first = view.stations[0];
  const entry = first === undefined ? undefined : layout.places[first.id];
  if (first !== undefined && entry !== undefined) add(first.id, outward(entry, layout));
  return connections;
}

/** What the telemetry says (§5 and §7): the time and the outcome once done; the state otherwise. */
function telemetryLines(station: StationView, layout: Layout): { primary: string; secondary: string | null } | null {
  const { event } = station;
  const state = statusText(station);
  if (station.status === 'completed' && event !== null) {
    const parts = [outcomeTag(station), measureOf(event)].filter((part): part is string => part !== null);
    return { primary: formatDuration(event.durationMs), secondary: layout.shortTelemetry || parts.length === 0 ? null : parts.join(' · ') };
  }
  if (state === null) return null;
  // Persona waiting is a door (§10): «espera a la persona · entrar para decidir».
  if (station.status === 'waiting' && station.decidedBy === 'person') return { primary: state, secondary: DECISION_TEXTS.enterToDecide.text };
  const duration = event === null || layout.shortTelemetry ? null : formatDuration(event.durationMs);
  return { primary: state, secondary: duration };
}

function placeTelemetry(station: StationView, place: StationPlace, layout: Layout, lead: number): Telemetry | null {
  const lines = telemetryLines(station, layout);
  if (lines === null) return null;
  const r = armRadius(layout.radius);
  const near = place.r + 4;
  const far = armDistance(place.r, layout.radius) + r + 14;
  const w = Math.max(lines.primary.length, lines.secondary?.length ?? 0) * TELEMETRY_CHAR + 10;
  const h = lines.secondary === null ? TELEMETRY_LINE + 2 : TELEMETRY_LINE * 2 + 2;
  const cos = Math.cos(lead);
  const sin = Math.sin(lead);
  const reach = far + 4 + (w / 2) * Math.abs(cos) + (h / 2) * Math.abs(sin);
  const box = inWindow(layout, { x: place.x + reach * cos, y: place.y + reach * sin, w, h });
  return { ...box, ...lines, lead: { from: toward(place, lead, near), to: toward(place, lead, far) } };
}

function placeLabels(station: StationView, place: StationPlace, layout: Layout, arms: readonly Arm[], info: CircuitInfo): ArmLabel[] {
  const nodes = secondaryNodes(station, info);
  const decided = station.decidedBy === 'person' && station.outcome !== null;
  const muted = station.status === 'skipped';
  const reach = armDistance(place.r, layout.radius) + armRadius(layout.radius) + 6;
  return arms.map((arm, index) => {
    const node = nodes[index];
    const label = node?.label ?? '';
    const w = label.length * LABEL_CHAR;
    const cos = Math.abs(Math.cos(arm.angle));
    const sin = Math.abs(Math.sin(arm.angle));
    // Every other label steps out a line, so two neighbors on a steep side never share a row.
    const distance = reach + (w / 2) * cos + 7 * sin + (index % 2) * 13 * sin;
    const box = inWindow(layout, { x: place.x + distance * Math.cos(arm.angle), y: place.y + distance * Math.sin(arm.angle), w, h: LABEL_HEIGHT });
    const filled = node?.filled === true;
    return { ...box, key: node?.key ?? String(index), label, title: node?.text ?? '', filled, muted: muted || (decided && !filled) };
  });
}

function stationScene(station: StationView, layout: Layout, info: CircuitInfo, connections: readonly number[]): StationScene | null {
  const place = layout.places[station.id];
  if (place === undefined) return null;
  const count = secondaryNodes(station, info).length;
  const plan = planArms(connections, count);
  const arms = armsOf(place, place.r, layout.radius, plan.arms);
  return {
    station,
    place,
    arms,
    labels: placeLabels(station, place, layout, arms, info),
    telemetry: placeTelemetry(station, place, layout, plan.lead),
    outerRing: place.r * OUTER_RING_SCALE,
    innerRing: armDistance(place.r, layout.radius) + armRadius(layout.radius) + INNER_RING_GAP,
  };
}

function stopScene(place: StationPlace, layout: Layout): StopScene {
  const r = armRadius(layout.radius);
  const angle = stopAngle(place, layout);
  const center = toward(place, angle, armDistance(place.r, layout.radius) + r + STOP_REACH);
  const w = RUN_TEXTS.stopLabel.text.length * LABEL_CHAR;
  const side = Math.cos(angle) < 0 ? -1 : 1;
  const label = inWindow(layout, { x: center.x + side * (r + 8 + w / 2), y: center.y, w, h: LABEL_HEIGHT });
  return { center, r, label };
}

function edgeScene(edge: EdgeView, layout: Layout): EdgeScene | null {
  const from = layout.places[edge.from];
  if (from === undefined) return null;
  if (edge.kind === 'stop') {
    const stop = stopScene(from, layout);
    return { edge, from, to: stop.center, label: null, stop };
  }
  if (edge.kind === 'exit') {
    const far = Math.hypot(layout.width, layout.height);
    return { edge, from, to: toward(from, outward(from, layout), far), label: null, stop: null };
  }
  const to = layout.places[edge.to];
  return to === undefined ? null : { edge, from, to, label: null, stop: null };
}

const ballBox = (place: StationPlace, extra = 0): Box => ({ x: place.x, y: place.y, w: place.r * 2 + extra, h: place.r * 2 + extra });
const armBox = (arm: Arm): Box => ({ x: arm.center.x, y: arm.center.y, w: arm.r * 2, h: arm.r * 2 });

/** The branch's label goes on its tube where it touches no node's name and no station with its nodes. */
function branchLabel(scene: EdgeScene, stations: readonly StationScene[], layout: Layout): Box {
  const w = RUN_TEXTS.branch.text.length * LABEL_CHAR + 12;
  const at = (t: number): Box => ({ x: scene.from.x + (scene.to.x - scene.from.x) * t, y: scene.from.y + (scene.to.y - scene.from.y) * t, w, h: 14 });
  const reach = 2 * armRadius(layout.radius) + 30;
  const clear = (box: Box) => stations.every((entry) => !overlaps(box, ballBox(entry.place, reach)) && entry.labels.every((label) => !overlaps(box, label)));
  return BRANCH_TRIES.map(at).find(clear) ?? at(0.5);
}

/** Moves a box out from its station, then sideways, until it touches nothing; else it stays. */
function nudge<T extends Box>(box: T, direction: Point, blocked: (candidate: T) => boolean, layout: Layout, step: number, sideways: readonly number[]): T {
  if (!blocked(box)) return box;
  for (let k = 1; k <= 8; k++) {
    for (const side of sideways) {
      const candidate = { ...box, ...inWindow(layout, { ...box, x: box.x + k * step * direction.x - side * direction.y, y: box.y + k * step * direction.y + side * direction.x }) };
      if (!blocked(candidate)) return candidate;
    }
  }
  return box;
}

function directionOf(box: Box, place: StationPlace): Point {
  const length = Math.hypot(box.x - place.x, box.y - place.y) || 1;
  return { x: (box.x - place.x) / length, y: (box.y - place.y) / length };
}

const rounded = <T extends Box>(box: T): T => ({ ...box, x: round(box.x), y: round(box.y) });

export function sceneOf(view: RunView, layout: Layout, info: CircuitInfo): Scene {
  const connections = connectionsOf(view, layout);
  const placed = view.stations.flatMap((station) => stationScene(station, layout, info, connections.get(station.id) ?? []) ?? []);
  const edges = view.edges.flatMap((edge) => edgeScene(edge, layout) ?? []).map((entry) => (entry.edge.kind === 'branch' ? { ...entry, label: branchLabel(entry, placed, layout) } : entry));

  const balls = placed.map((entry) => ballBox(entry.place));
  const armBoxes = placed.flatMap((entry) => entry.arms.map(armBox));
  const fixed = edges.flatMap((entry) => [...(entry.label === null ? [] : [entry.label]), ...(entry.stop === null ? [] : [entry.stop.label])]);
  // The telemetry moves first, out of the way of the nodes and their names (B1); then a name that
  // still touches a bubble, a node or a text steps out (with R = 80, a steep name meets the next node).
  const labels = placed.flatMap((entry) => entry.labels);
  const telemetries = placed.map((entry) => entry.telemetry);
  telemetries.forEach((telemetry, index) => {
    const entry = placed[index];
    if (telemetry === null || entry === undefined) return;
    const others = () => telemetries.filter((other, at): other is Telemetry => other !== null && at !== index);
    const blocked = (box: Box) => [...armBoxes, ...fixed, ...labels, ...others(), ...balls].some((other) => overlaps(box, other));
    telemetries[index] = nudge(telemetry, directionOf(telemetry, entry.place), blocked, layout, 12, [0, 16, -16, 32, -32]);
  });
  const settled = telemetries.filter((telemetry): telemetry is Telemetry => telemetry !== null);
  const stations = placed.map((entry, index) => {
    const moved = entry.labels.map((label) => {
      const blocked = (box: Box) => [...armBoxes, ...fixed, ...settled, ...balls].some((other) => overlaps(box, other)) || labels.some((other) => other !== label && overlaps(box, other));
      const placedLabel = nudge(label, directionOf(label, entry.place), blocked, layout, 8, [0, 12, -12]);
      labels[labels.indexOf(label)] = placedLabel;
      return placedLabel;
    });
    const telemetry = telemetries[index] ?? null;
    return { ...entry, labels: moved.map(rounded), telemetry: telemetry === null ? null : rounded(telemetry) };
  });

  const first = stations[0];
  const entryAngle = first === undefined ? 0 : outward(first.place, layout);
  return {
    stations,
    edges,
    entry: first === undefined ? null : { from: first.place, to: toward(first.place, entryAngle, Math.hypot(layout.width, layout.height)) },
    obstacles: [...balls, ...armBoxes, ...fixed, ...stations.flatMap((entry) => [...entry.labels, ...(entry.telemetry === null ? [] : [entry.telemetry])])],
  };
}

/** The station the run is on: the one that waits, else the last with an event (the dock's too). */
export function currentStation(view: RunView): string | null {
  const last = [...view.stations].reverse().find((station) => station.event !== null);
  return view.waitingAt ?? last?.id ?? null;
}

