import type { CircuitInfo, JsonValue } from './api.ts';
import { formatCost, formatDecimal, formatDuration, formatInteger, totalsOf } from './format.ts';
import type { Layout, Point } from './layout.ts';
import { actionText, runClock, secondaryNodes } from './nodes.ts';
import type { RunView, StationView } from './projection.ts';
import { overlaps, type Box, type Scene } from './scene.ts';
import { TUBE_SCALE } from './shape.ts';
import { RUN_TEXTS } from './texts.ts';

/**
 * The two panels of an ultrawide window (docs/diseno.md §9, ADR-0014 G5): beside Persona, the
 * quote and the proposed actions on the left, the confidence and the run's totals on the right.
 * Where they go is searched in the free center of the orbit, clear of every station, text and
 * tube; what they say is the projection's, and a panel with no data is not drawn (principle 3).
 * Pure: the same view and size give the same panels.
 */

export interface SidePanel extends Box {
  readonly side: 'left' | 'right';
}

export interface LeftFacts {
  readonly quote: string | null;
  readonly document: string | null;
  readonly actions: readonly string[];
}

export interface RightFacts {
  readonly confidence: number | null;
  readonly threshold: number;
  readonly lines: readonly string[];
  readonly duration: string | null;
  readonly spent: string | null;
}

/** A panel's size: as wide as a short column of text, never past a share of the window. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 340;
const PANEL_WIDTH_SHARE = 0.13;
const PANEL_HEIGHT = 250;
/** The search: steps of this many px, outwards from Persona and up and down from its height. */
const STEP = 16;
const VERTICAL_STEPS = 10;
const CLEARANCE = 10;
/** Points sampled along each line to test it against a panel. */
const SAMPLES = 120;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Every line of the orbit as a segment with its half width: the tubes, the stop, the lines to the edge. */
function linesOf(scene: Scene, layout: Layout): { readonly from: Point; readonly to: Point; readonly half: number }[] {
  const tube = (layout.radius * TUBE_SCALE) / 2;
  const edges = scene.edges.map((entry) => ({ from: entry.from, to: entry.to, half: entry.edge.kind === 'main' || entry.edge.kind === 'branch' ? tube : 1 }));
  return scene.entry === null ? edges : [...edges, { from: scene.entry.from, to: scene.entry.to, half: 1 }];
}

function crosses(box: Box, line: { readonly from: Point; readonly to: Point; readonly half: number }): boolean {
  const reachX = box.w / 2 + line.half + CLEARANCE;
  const reachY = box.h / 2 + line.half + CLEARANCE;
  for (let index = 0; index <= SAMPLES; index++) {
    const share = index / SAMPLES;
    const x = line.from.x + (line.to.x - line.from.x) * share;
    const y = line.from.y + (line.to.y - line.from.y) * share;
    if (Math.abs(x - box.x) < reachX && Math.abs(y - box.y) < reachY) return true;
  }
  return false;
}

/** The first free place on one side of Persona, from close to it outwards, at its height first. */
function searchSide(side: 'left' | 'right', layout: Layout, scene: Scene, taken: readonly Box[]): SidePanel | null {
  const person = scene.stations.find((entry) => entry.place.side === 'center');
  if (person === undefined) return null;
  const w = clamp(layout.width * PANEL_WIDTH_SHARE, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
  const h = PANEL_HEIGHT;
  const direction = side === 'left' ? -1 : 1;
  const lines = linesOf(scene, layout);
  const blocked = (box: Box) => [...scene.obstacles, ...taken].some((other) => overlaps(box, other, CLEARANCE)) || lines.some((line) => crosses(box, line));
  const inside = (box: Box) => box.x - box.w / 2 >= CLEARANCE && box.x + box.w / 2 <= layout.width - CLEARANCE && box.y - box.h / 2 >= CLEARANCE && box.y + box.h / 2 <= layout.height - layout.bottom - CLEARANCE;
  const start = person.place.r + w / 2 + CLEARANCE;
  for (let out = start; out < layout.width / 2; out += STEP) {
    for (let step = 0; step <= VERTICAL_STEPS * 2; step++) {
      // 0, +1, -1, +2, -2…: at Persona's height first.
      const offset = (step % 2 === 0 ? -1 : 1) * Math.ceil(step / 2) * STEP;
      const box = { x: person.place.x + direction * out, y: person.place.y + offset, w, h };
      if (inside(box) && !blocked(box)) return { ...box, side };
    }
  }
  return null;
}

/** Where the two panels go; none outside an ultrawide window. */
export function panelSlots(layout: Layout, scene: Scene): readonly SidePanel[] {
  if (!layout.wide) return [];
  const left = searchSide('left', layout, scene, []);
  const right = searchSide('right', layout, scene, left === null ? [] : [left]);
  return [left, right].filter((panel): panel is SidePanel => panel !== null);
}

const stationOf = (view: RunView, id: string): StationView | undefined => view.stations.find((station) => station.id === id);
const text = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** The left panel's data: Conocimiento's quote, whole, and CRM's proposed actions. Null when there is none. */
export function leftFacts(view: RunView, info: CircuitInfo): LeftFacts | null {
  const knowledge = stationOf(view, 'knowledge')?.event ?? null;
  const crm = stationOf(view, 'crm')?.event ?? null;
  const quote = knowledge === null ? null : text(knowledge.detail['quote']);
  const documentId = knowledge === null ? null : text(knowledge.detail['documentId']);
  const document = documentId === null ? null : (info.documents.find((entry) => entry.id === documentId)?.title ?? documentId);
  const actions = Array.isArray(crm?.detail['actions']) ? (crm.detail['actions'] as readonly JsonValue[]).flatMap((action) => actionText(action, true) ?? []) : [];
  return quote === null && actions.length === 0 ? null : { quote, document, actions };
}

/** The right panel's data: the confidence against its threshold, what Clasificación said, and the totals. */
export function rightFacts(view: RunView, info: CircuitInfo, events: Parameters<typeof totalsOf>[0]): RightFacts | null {
  const classification = stationOf(view, 'classification');
  const raw = classification?.event?.detail['confidence'];
  const confidence = typeof raw === 'number' ? raw : null;
  const lines = classification === undefined ? [] : secondaryNodes(classification, info, { whole: true }).filter((node) => node.key !== 'confidence').map((node) => node.text);
  const totals = totalsOf(events);
  // The same stored time as the clock in the corner, so the page never says two durations.
  const clock = runClock(events, false);
  const duration = clock === null ? null : formatDuration(clock.elapsedMs);
  const spent =
    totals.measured === 0 ? null : totals.tokens === null || totals.costMicroUsd === null ? (info.model === 'simulator' ? RUN_TEXTS.simulator.text : RUN_TEXTS.unmeasured.text) : `${formatInteger(totals.tokens)} ${RUN_TEXTS.tokens.text} · ${formatCost(totals.costMicroUsd)}`;
  if (confidence === null && lines.length === 0 && duration === null) return null;
  return { confidence, threshold: info.lowConfidenceBelow, lines, duration, spent };
}

/** «0,82», as the panel writes the confidence. */
export function confidenceText(value: number): string {
  return formatDecimal(value, 2);
}
