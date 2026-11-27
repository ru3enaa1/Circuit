import type { CircuitInfo } from '../api.ts';
import { formatDecimal, shorten, telemetryOf } from '../format.ts';
import { ringArc, ringPoint, type Layout, type StationPlace } from '../layout.ts';
import { outcomeTag, secondaryNodes, statusText, type SecondaryNode } from '../nodes.ts';
import type { StationView } from '../projection.ts';
import { NODE_TEXTS, STATION_NAMES, STATUS_TEXTS, textOf } from '../texts.ts';

/**
 * One station as its projected view says (docs/diseno.md §5): seven looks, each with its own
 * shape and text as well as its color. It keeps nothing: the same view paints the same station.
 */

export interface StationNodeProps {
  readonly station: StationView;
  readonly place: StationPlace;
  readonly layout: Layout;
  readonly info: CircuitInfo;
  /** This station's share of the run's stored time, 0 to 1: the yellow arc on its ring (§7). */
  readonly timeShare: number;
}

/** Past the ring of marks and the confidence arc (r + 20), so no text crosses them. */
const RING_CLEARANCE = 24;
/** One line of nodes: 13 px text at 1.45. */
const NODE_LINE_PX = 19;
/** On half a screen the texts must fit beside a small bubble. */
const NARROW_TEXT_MAX = 22;
/** The average width of a character of the side texts, in px, to know what fits. */
const CHARACTER_WIDTH = 7;
/** Kept free between a text and the edge of the window. */
const EDGE_MARGIN = 12;
/** Fewer characters than this say nothing useful: the side texts are left out. */
const MIN_SIDE_CHARS = 8;
/** Persona's three ways out, side by side under its name, its tag and its state. */
const CENTER_NODE_GAP = 84;
const CENTER_NODE_OFFSET = 80;

function ariaLabel(station: StationView, name: string): string {
  const state = statusText(station) ?? STATUS_TEXTS[station.status === 'completed' ? 'completed' : 'pending'].text;
  const confidence = station.event?.detail['confidence'];
  const extra = typeof confidence === 'number' ? `, ${NODE_TEXTS.confidence.text} ${formatDecimal(confidence, 2)}` : '';
  return `${name}, ${state}${extra}`;
}

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
  const inner = ringPoint(origin, r - 5, threshold);
  const outer = ringPoint(origin, r + 5, threshold);
  return (
    <g className="confidence" data-confidence={confidence}>
      <circle className="confidence__track" r={r} />
      {arc === null ? null : <path className="confidence__value" d={arc} />}
      <line className="confidence__threshold" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
    </g>
  );
}

/** Where a station's texts go, and how many characters fit before the edge of the window. */
function sideGeometry(place: StationPlace, layout: Layout) {
  const gap = place.r + RING_CLEARANCE;
  const room = place.side === 'left' ? place.x - gap - EDGE_MARGIN : place.side === 'right' ? layout.width - place.x - gap - EDGE_MARGIN : Infinity;
  const maxChars = Math.min(layout.narrow ? NARROW_TEXT_MAX : Infinity, Math.floor(room / CHARACTER_WIDTH));
  // A station in the upper half stacks its nodes upwards, away from the necks that leave it downwards.
  const upwards = place.side !== 'center' && place.y < layout.center.y - place.r / 2;
  return {
    anchor: place.side === 'left' ? 'end' : place.side === 'right' ? 'start' : 'middle',
    x: place.side === 'left' ? -gap : place.side === 'right' ? gap : 0,
    maxChars,
    nodeY: (index: number, count: number) =>
      place.side === 'center' ? place.r + CENTER_NODE_OFFSET : upwards ? -10 - (count - index) * NODE_LINE_PX : 18 + index * NODE_LINE_PX,
  } as const;
}

function SideTexts({ station, place, layout, nodes }: { readonly station: StationView; readonly place: StationPlace; readonly layout: Layout; readonly nodes: readonly SecondaryNode[] }) {
  const { anchor, x, maxChars, nodeY } = sideGeometry(place, layout);
  // Too little room beside the bubble: the station keeps its name and state, and nothing is cut by the edge.
  if (maxChars < MIN_SIDE_CHARS) return null;
  const telemetry = station.event === null || station.status === 'failed' || place.side === 'center' ? null : telemetryOf(station.event);
  const shown = telemetry !== null && layout.shortTelemetry ? (telemetry.split(' · ')[0] ?? telemetry) : telemetry;
  const fit = (text: string) => shorten(text, maxChars);
  return (
    <g className="station__side" textAnchor={anchor}>
      {shown === null ? null : (
        <text className="telemetry" x={x} y={-10}>
          {fit(shown)}
        </text>
      )}
      {nodes.map((node, index) => {
        // Beside the bubble the nodes stack; under the center station they make one row.
        const nodeX = place.side === 'center' ? (index - (nodes.length - 1) / 2) * CENTER_NODE_GAP : x;
        const y = nodeY(index, nodes.length);
        const dotX = place.side === 'left' ? nodeX + 8 : place.side === 'right' ? nodeX - 8 : nodeX;
        return (
          <g key={node.key} className={node.filled ? 'node is-filled' : 'node'} data-node={node.key}>
            <circle className="node__dot" cx={dotX} cy={place.side === 'center' ? y - 18 : y - 4} r={place.side === 'center' ? 5 : 3} />
            <text x={nodeX} y={y}>
              {fit(node.text)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function StationNode({ station, place, layout, info, timeShare }: StationNodeProps) {
  const name = textOf(STATION_NAMES, station.id);
  const state = statusText(station);
  const tag = outcomeTag(station);
  const timeArc = station.status === 'completed' ? ringArc({ x: 0, y: 0 }, place.r + 7, timeShare) : null;
  const nodes = layout.narrow && place.side !== 'center' ? secondaryNodes(station, info).slice(0, 2) : secondaryNodes(station, info);
  const below = place.r + RING_CLEARANCE + 6;
  return (
    <g
      className={`station station--${station.status}${station.decidedBy === 'person' ? ' station--person' : ''}`}
      data-station={station.id}
      data-status={station.status}
      transform={`translate(${Math.round(place.x)} ${Math.round(place.y)})`}
      role="group"
      tabIndex={0}
      aria-label={ariaLabel(station, name)}
    >
      <circle className="station__ticks" r={place.r + 7} />
      {timeArc === null ? null : <path className="station__time" d={timeArc} />}
      {station.id === 'classification' ? <ConfidenceArc station={station} r={place.r + 15} threshold={info.lowConfidenceBelow} /> : null}
      <circle className="station__ball" r={place.r} />
      <Mark station={station} r={place.r} />
      <text className="station__name" y={below} textAnchor="middle">
        {name}
      </text>
      {tag === null ? null : (
        <text className="station__tag" y={below + 16} textAnchor="middle">
          {tag}
        </text>
      )}
      {state === null ? null : (
        <text className="station__state" y={below + (tag === null ? 16 : 32)} textAnchor="middle">
          {state}
        </text>
      )}
      <SideTexts station={station} place={place} layout={layout} nodes={nodes} />
    </g>
  );
}
