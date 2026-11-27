import type { CircuitInfo } from '../api.ts';
import { curvedPath, ellipseArc, straightPath, type Layout, type Point, type StationPlace } from '../layout.ts';
import type { EdgeView, RunView, StationView } from '../projection.ts';
import { RUN_TEXTS } from '../texts.ts';
import { timeShares } from './StationBall.tsx';
import { StationNode } from './StationNode.tsx';

/**
 * The circuit (docs/diseno.md §6): the necks in the order of the route, the branch to Persona,
 * the injection stop and the two lines that reach the edge of the screen. Every color and dash
 * comes from the projected view: an edge is lit because an event took it.
 */

export interface OrbitProps {
  readonly view: RunView;
  readonly layout: Layout;
  readonly info: CircuitInfo;
  /** The station just left (ADR-0013): the circuit comes back out of it, and it takes the focus. */
  readonly returningFrom?: string | null;
}

/** How far the stop's small bubble sits from Filtro, in radii, and its size. */
const STOP_DISTANCE = 2.3;
const STOP_SCALE = 0.42;
/** Up and to the right: away from the request's text on the top left and from Filtro's nodes. */
const STOP_DIRECTION_DEGREES = 315;
const BRANCH_BOW = 0.35;
/** The branch's label sits this far outside its curve, so the line never crosses the text. */
const LABEL_CLEARANCE = 16;

interface EdgeShape {
  readonly path: string;
  readonly label: Point | null;
  readonly stop: Point | null;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function stopPoint(from: StationPlace): Point {
  const distance = from.r * STOP_DISTANCE;
  return { x: from.x + distance * Math.cos(toRadians(STOP_DIRECTION_DEGREES)), y: from.y + distance * Math.sin(toRadians(STOP_DIRECTION_DEGREES)) };
}

function shapeOf(edge: EdgeView, layout: Layout): EdgeShape | null {
  const from = layout.places[edge.from];
  if (from === undefined) return null;
  if (edge.kind === 'stop') {
    const stop = stopPoint(from);
    return { path: straightPath(from, stop), label: null, stop };
  }
  if (edge.kind === 'exit') return { path: straightPath(from, { x: 0, y: from.y }), label: null, stop: null };
  const to = layout.places[edge.to];
  if (to === undefined) return null;
  if (edge.kind === 'branch') {
    const bow = Math.hypot(to.x - from.x, to.y - from.y) * BRANCH_BOW;
    // The curve's middle is halfway from the chord's middle to the control point; the label goes a little further out.
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const out = (BRANCH_BOW * length) / 2 + LABEL_CLEARANCE;
    const middle = { x: (from.x + to.x) / 2 + ((to.y - from.y) / length) * out, y: (from.y + to.y) / 2 - ((to.x - from.x) / length) * out };
    return { path: curvedPath(from, to, bow), label: middle, stop: null };
  }
  if (from.angle !== null && to.angle !== null) return { path: ellipseArc(layout, from.angle, to.angle), label: null, stop: null };
  return { path: straightPath(from, to), label: null, stop: null };
}

function edgeClass(edge: EdgeView, stations: readonly StationView[]): string {
  const statusOf = (id: string) => stations.find((station) => station.id === id)?.status;
  const off = statusOf(edge.from) === 'skipped' || statusOf(edge.to) === 'skipped';
  return ['edge', `edge--${edge.kind}`, edge.taken ? 'is-taken' : '', edge.toWaiting ? 'is-waiting' : '', off && !edge.taken ? 'is-off' : '']
    .filter((name) => name !== '')
    .join(' ');
}

function Edge({ edge, view, layout }: { readonly edge: EdgeView; readonly view: RunView; readonly layout: Layout }) {
  const shape = shapeOf(edge, layout);
  if (shape === null) return null;
  const className = edgeClass(edge, view.stations);
  return (
    <g className={className} data-edge={`${edge.from}>${edge.to}`} data-taken={edge.taken ? 'true' : 'false'}>
      <path d={shape.path} />
      {shape.label === null ? null : (
        <text className="edge__label" x={shape.label.x} y={shape.label.y} textAnchor="middle">
          {RUN_TEXTS.branch.text}
        </text>
      )}
      {shape.stop === null ? null : (
        <g className="edge__stop" transform={`translate(${Math.round(shape.stop.x)} ${Math.round(shape.stop.y)})`}>
          <circle r={layout.radius * STOP_SCALE} />
          <rect x={-layout.radius * 0.12} y={-layout.radius * 0.12} width={layout.radius * 0.24} height={layout.radius * 0.24} />
        </g>
      )}
    </g>
  );
}

/** The way in: from the edge of the screen to the first station, lit once the request arrived. */
function EntryLine({ view, layout }: { readonly view: RunView; readonly layout: Layout }) {
  const first = view.stations[0];
  const place = first === undefined ? undefined : layout.places[first.id];
  if (first === undefined || place === undefined) return null;
  const arrived = first.status !== 'pending';
  return (
    <g className={`edge edge--entry${arrived ? ' is-taken' : ''}`} data-edge="entry">
      <path d={straightPath({ x: 0, y: place.y }, place)} />
    </g>
  );
}

export function Orbit({ view, layout, info, returningFrom = null }: OrbitProps) {
  const shares = timeShares(view);
  const from = returningFrom === null ? undefined : layout.places[returningFrom];
  // The way back is the way in, reversed (§10): a CSS animation from the station left, run once on mount.
  const style = from === undefined ? undefined : { transformOrigin: `${Math.round(from.x)}px ${Math.round(from.y)}px` };
  return (
    <svg className={from === undefined ? 'orbit' : 'orbit is-returning'} style={style} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="presentation">
      <g className="orbit__edges">
        <EntryLine view={view} layout={layout} />
        {view.edges.map((edge) => (
          <Edge key={`${edge.from}>${edge.to}`} edge={edge} view={view} layout={layout} />
        ))}
      </g>
      <g className="orbit__stations">
        {view.stations.map((station) => {
          const place = layout.places[station.id];
          return place === undefined ? null : (
            <StationNode key={station.id} station={station} place={place} layout={layout} info={info} timeShare={shares.get(station.id) ?? 0} focused={station.id === returningFrom} />
          );
        })}
      </g>
    </svg>
  );
}
