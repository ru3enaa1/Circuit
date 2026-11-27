import { ringArc, ringPoint } from '../layout.ts';
import type { RunView, StationView } from '../projection.ts';

/**
 * A station's bubble (docs/diseno.md §5): its ring of marks, its share of the time, the
 * confidence arc of Clasificación, the bubble and the mark of its state. The same drawing in the
 * orbit and, larger, inside its room (ADR-0013), so a state looks the same wherever it is seen.
 */

export interface StationBallProps {
  readonly station: StationView;
  readonly r: number;
  /** The confidence threshold, from GET /api/circuit; never written on the board (§7). */
  readonly threshold: number;
  /** This station's share of the run's stored time, 0 to 1: the yellow arc on its ring (§7). */
  readonly timeShare: number;
}

/** The ring of marks and the time arc sit this far outside the bubble; the confidence arc, further. */
const RING_GAP = 7;
const CONFIDENCE_GAP = 15;
const THRESHOLD_MARK = 5;

function Mark({ station, r }: { readonly station: StationView; readonly r: number }) {
  if (station.status === 'completed') return <circle className="station__dot" r={r * 0.16} />;
  if (station.status === 'stopped') return <rect className="station__icon" x={-r * 0.24} y={-r * 0.24} width={r * 0.48} height={r * 0.48} />;
  if (station.status === 'failed') {
    const d = r * 0.26;
    return <path className="station__icon station__icon--line" d={`M ${-d} ${-d} L ${d} ${d} M ${d} ${-d} L ${-d} ${d}`} />;
  }
  if (station.status === 'skipped') return <path className="station__slash" d={`M ${-r * 0.7} ${r * 0.7} L ${r * 0.7} ${-r * 0.7}`} />;
  if (station.status === 'waiting' && station.decidedBy === 'person') return <circle className="station__dot station__dot--person" r={r * 0.14} />;
  return null;
}

function ConfidenceArc({ station, r, threshold }: { readonly station: StationView; readonly r: number; readonly threshold: number }) {
  const confidence = station.event?.detail['confidence'];
  if (typeof confidence !== 'number') return null;
  const origin = { x: 0, y: 0 };
  const arc = ringArc(origin, r, confidence);
  const inner = ringPoint(origin, r - THRESHOLD_MARK, threshold);
  const outer = ringPoint(origin, r + THRESHOLD_MARK, threshold);
  return (
    <g className="confidence" data-confidence={confidence}>
      <circle className="confidence__track" r={r} />
      {arc === null ? null : <path className="confidence__value" d={arc} />}
      <line className="confidence__threshold" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
    </g>
  );
}

export function StationBall({ station, r, threshold, timeShare }: StationBallProps) {
  const timeArc = station.status === 'completed' ? ringArc({ x: 0, y: 0 }, r + RING_GAP, timeShare) : null;
  return (
    <>
      <circle className="station__ticks" r={r + RING_GAP} />
      {timeArc === null ? null : <path className="station__time" d={timeArc} />}
      {station.id === 'classification' ? <ConfidenceArc station={station} r={r + CONFIDENCE_GAP} threshold={threshold} /> : null}
      <circle className="station__ball" r={r} />
      <Mark station={station} r={r} />
    </>
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
