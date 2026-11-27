import { FAILED_ICON, ICON_BOX, STOP_ICON, iconOf } from '../icons.ts';
import { ringArc, ringPoint } from '../layout.ts';
import type { RunView, StationView } from '../projection.ts';
import { CONFIDENCE_GAP, DOT_SCALE, SELECTION_GAP, armsOf, bubblePath, circlePath } from '../shape.ts';
import { STATION_NAMES, textOf } from '../texts.ts';

/**
 * A station as boceto B1 draws it (docs/diseno.md §5): the bubble and its nodes on arms, one
 * shape, with its icon, name and number inside. Seven looks, each with its own shape as well as
 * its color. The same drawing in the orbit and, larger, inside its room (ADR-0013), so a state
 * looks the same wherever it is seen. Coordinates are around the station's center.
 */

export interface StationBallProps {
  readonly station: StationView;
  /** The bubble's radius. */
  readonly r: number;
  /** The circuit's R: the nodes and the texts inside are sized by it, so Persona's are not larger. */
  readonly base: number;
  /** Where each node's arm goes, in radians. */
  readonly armAngles: readonly number[];
  /** The confidence threshold, from GET /api/circuit; never written on the board (§7). */
  readonly threshold: number;
  /** The station the run is on: a yellow ring with the halo (§4). */
  readonly selected?: boolean;
}

/** The icon and the texts inside the bubble, against R (B1). Under this R the icon does not fit. */
const ICON_SCALE = 0.42;
const ICON_MIN_RADIUS = 38;
const NAME_SCALE = 0.25;
const NAME_MIN = 9.5;
const NUMBER_SCALE = 0.2;
const NUMBER_MIN = 8;
const NAME_LINE = 1.15;
/** Persona waiting: a thick pink ring inside its outline, against R (§5). */
const WAIT_RING_SCALE = 0.2;
const WAIT_RING_INSET = 0.1;
/** The stop's dashed ring, inside Filtro's outline, in px. */
const STOP_RING_INSET = 6;
const THRESHOLD_IN = 5;
const THRESHOLD_OUT = 7;
const SKIP_SLOPE = 0.5;
const SKIP_REACH = 0.8;

const ORIGIN = { x: 0, y: 0 };
/** States drawn in pink: they wait for the person, or the run stopped or failed there. */
const PINK = new Set(['stopped', 'failed']);

export function isPink(station: StationView): boolean {
  return PINK.has(station.status) || (station.status === 'waiting' && station.decidedBy === 'person');
}

/** Filled: its event arrived, or it is the next one while the run goes on (B1's «active»). */
function isFilled(station: StationView): boolean {
  return station.status === 'completed' || (station.status === 'waiting' && station.decidedBy !== 'person');
}

function iconFor(station: StationView): string {
  if (station.status === 'stopped') return STOP_ICON;
  if (station.status === 'failed') return FAILED_ICON;
  return iconOf(station.id);
}

function Inside({ station, base }: { readonly station: StationView; readonly base: number }) {
  const icon = base < ICON_MIN_RADIUS ? 0 : base * ICON_SCALE;
  const name = Math.max(NAME_MIN, base * NAME_SCALE);
  const number = Math.max(NUMBER_MIN, base * NUMBER_SCALE);
  const height = icon + (icon > 0 ? 1 : 0) + name * NAME_LINE + 1 + number;
  const top = -height / 2;
  const nameY = top + icon + (icon > 0 ? 1 : 0) + (name * NAME_LINE) / 2;
  const scale = icon / ICON_BOX;
  return (
    <g className="station__inside">
      {icon === 0 ? null : <path className="station__icon" d={iconFor(station)} transform={`translate(${round(-icon / 2)} ${round(top)}) scale(${round3(scale)})`} />}
      <text className="station__name" y={round(nameY)} fontSize={round(name)}>
        {textOf(STATION_NAMES, station.id)}
      </text>
      <text className="station__number" y={round(nameY + (name * NAME_LINE) / 2 + 1 + number / 2)} fontSize={round(number)}>
        {String(station.number).padStart(2, '0')}
      </text>
    </g>
  );
}

function ConfidenceArc({ station, r, threshold }: { readonly station: StationView; readonly r: number; readonly threshold: number }) {
  const confidence = station.event?.detail['confidence'];
  if (typeof confidence !== 'number') return null;
  const arc = ringArc(ORIGIN, r, confidence);
  const inner = ringPoint(ORIGIN, r - THRESHOLD_IN, threshold);
  const outer = ringPoint(ORIGIN, r + THRESHOLD_OUT, threshold);
  return (
    <g className="confidence" data-confidence={confidence}>
      <circle className="confidence__track" r={r} />
      {arc === null ? null : <path className="confidence__value" d={arc} />}
      <line className="confidence__threshold" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
    </g>
  );
}

function Marks({ station, r, base }: { readonly station: StationView; readonly r: number; readonly base: number }) {
  if (station.status === 'waiting' && station.decidedBy === 'person') {
    return <circle className="station__wait-ring" r={r - base * WAIT_RING_INSET} strokeWidth={round(base * WAIT_RING_SCALE)} />;
  }
  if (station.status === 'stopped') return <circle className="station__stop-ring" r={r - STOP_RING_INSET} />;
  if (station.status === 'skipped') {
    const x = r * SKIP_REACH;
    const y = r * SKIP_SLOPE;
    return <path className="station__strike" d={`M${round(-x)} ${round(y)}L${round(x)} ${round(-y)}`} />;
  }
  return null;
}

export function StationBall({ station, r, base, armAngles, threshold, selected = false }: StationBallProps) {
  const arms = armsOf(ORIGIN, r, base, armAngles);
  const shape = bubblePath(ORIGIN, r, arms);
  const filled = isFilled(station);
  return (
    <>
      {station.id === 'classification' ? <ConfidenceArc station={station} r={r + CONFIDENCE_GAP} threshold={threshold} /> : null}
      {filled ? (
        <>
          {/* Keyed by the state: a station that completes mounts its fill anew, so its arms bloom out (ADR-0018). */}
          <path key={station.status} className="station__fill" d={shape} />
          {arms.length === 0 ? null : <path className="station__dots" d={arms.map((arm) => circlePath(arm.center, arm.r * DOT_SCALE)).join('')} />}
        </>
      ) : (
        <>
          {/* The outline of the whole shape, then its inside in black over the strokes that cross it. */}
          <path className="station__outline" d={shape} />
          <path className="station__hollow" d={shape} />
        </>
      )}
      <Marks station={station} r={r} base={base} />
      {selected && !isPink(station) ? <circle className="station__selected" r={r + SELECTION_GAP} /> : null}
      <Inside station={station} base={base} />
    </>
  );
}

/** The two faint rings around a station and its share of the run's time on the outer one (§7). */
export function StationRings({ station, x, y, outer, inner, timeShare }: { readonly station: StationView; readonly x: number; readonly y: number; readonly outer: number; readonly inner: number; readonly timeShare: number }) {
  const center = { x, y };
  const time = station.status === 'completed' ? ringArc(center, outer, timeShare) : null;
  return (
    <g className="rings" data-rings={station.id}>
      <path className="rings__ring" d={circlePath(center, outer) + circlePath(center, inner)} />
      {time === null ? null : <path className="rings__time" d={time} />}
    </g>
  );
}

/** The class of a station's group: its state, and Persona's own look (§5). */
export function stationClass(station: StationView): string {
  return `station station--${station.status}${station.decidedBy === 'person' ? ' station--person' : ''}`;
}

/** Each completed station's share of the run's stored time (§7, the time ring). */
export function timeShares(view: RunView): ReadonlyMap<string, number> {
  const total = view.stations.reduce((sum, station) => sum + (station.event?.durationMs ?? 0), 0);
  return new Map(view.stations.map((station) => [station.id, total > 0 ? (station.event?.durationMs ?? 0) / total : 0]));
}

/** Gives the focus back to what mounts with it, once (ADR-0013): module-level, so React calls it on mount only. */
export function focusOnMount(element: Element | null): void {
  if (element instanceof HTMLElement || element instanceof SVGElement) element.focus({ preventScroll: true });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
