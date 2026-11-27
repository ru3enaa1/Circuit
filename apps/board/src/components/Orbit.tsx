import type { ReactNode } from 'react';

import type { CircuitInfo } from '../api.ts';
import type { Layout, Point } from '../layout.ts';
import type { EdgeView, RunView, StationView } from '../projection.ts';
import { currentStation, type Box, type EdgeScene, type Scene } from '../scene.ts';
import { RAIL_WIDTH, TUBE_SCALE, braidPath, circlePath, segmentPath } from '../shape.ts';
import { RUN_TEXTS } from '../texts.ts';
import { StationRings, timeShares } from './StationBall.tsx';
import { StationNode } from './StationNode.tsx';

/**
 * The circuit (docs/diseno.md §6), as boceto B1 draws it: tubes of two rails between the
 * stations, the route in yellow inside the tubes the run took, the branch to Persona, the
 * injection stop and the two lines that reach the edge of the screen. Every color and dash comes
 * from the projected view: a tube is lit because an event took it.
 */

export interface OrbitProps {
  readonly view: RunView;
  readonly layout: Layout;
  readonly info: CircuitInfo;
  readonly scene: Scene;
  /** The station just left (ADR-0013): the circuit comes back out of it, and it takes the focus. */
  readonly returningFrom?: string | null;
  /** What stands on the tubes, under the stations: the crew (§11). */
  readonly children?: ReactNode;
}

/** The braid's strands reach this share of the tube's core from its center line (ADR-0019). */
const BRAID_REACH = 0.75;
/** One whole wave of a strand, against the tube's width: two crossings per wave. */
const BRAID_WAVE = 2.4;

/** The small square of the stop, against its bubble. */
const STOP_SQUARE = 0.6;

const round = (value: number) => Math.round(value * 10) / 10;

function edgeClass(edge: EdgeView, stations: readonly StationView[]): string {
  const statusOf = (id: string) => stations.find((station) => station.id === id)?.status;
  const off = statusOf(edge.from) === 'skipped' || statusOf(edge.to) === 'skipped';
  return ['edge', `edge--${edge.kind}`, edge.taken ? 'is-taken' : '', edge.toWaiting ? 'is-waiting' : '', off && !edge.taken ? 'is-off' : '']
    .filter((name) => name !== '')
    .join(' ');
}

function BoxLabel({ box, text, className }: { readonly box: Box; readonly text: string; readonly className: string }) {
  return (
    <g className={className}>
      <rect x={round(box.x - box.w / 2)} y={round(box.y - box.h / 2)} width={round(box.w)} height={round(box.h)} />
      <text x={round(box.x)} y={round(box.y)}>
        {text}
      </text>
    </g>
  );
}

/**
 * The request on its way to the station that waits (ADR-0019): two strands, yellow and pink, that
 * braid across the tube once, when the event that made this route dashed mounts them. Each is
 * measured in one, so motion.css grows it from the station left; when it connects, both strands
 * turn the color of the state and fade into the one route.
 */
function Braid({ from, to, core, person }: { readonly from: Point; readonly to: Point; readonly core: number; readonly person: boolean }) {
  const amplitude = (core / 2) * BRAID_REACH;
  const wave = core * BRAID_WAVE;
  return (
    <g className={person ? 'edge__braid is-person' : 'edge__braid'}>
      <path className="edge__strand edge__strand--a" d={braidPath(from, to, amplitude, wave, 1)} pathLength={1} />
      <path className="edge__strand edge__strand--b" d={braidPath(from, to, amplitude, wave, -1)} pathLength={1} />
    </g>
  );
}

interface TubeProps {
  readonly from: Point;
  readonly to: Point;
  readonly layout: Layout;
  readonly taken: boolean;
  readonly waiting: boolean;
  /** The station it leads to waits for the person: the route settles pink, as Persona does. */
  readonly person: boolean;
}

function Tube({ from, to, layout, taken, waiting, person }: TubeProps) {
  const width = round(layout.radius * TUBE_SCALE);
  const core = round(width - 2 * RAIL_WIDTH);
  const d = segmentPath(from, to);
  const now = ['edge__route', 'is-now', person ? 'is-person' : ''].filter((name) => name !== '').join(' ');
  return (
    <>
      <path className="edge__tube" d={d} strokeWidth={width} />
      <path className="edge__core" d={d} strokeWidth={core} />
      {/* The solid route is measured in one unit, so motion.css draws it from the station left (ADR-0016). */}
      {taken ? <path className={waiting ? now : 'edge__route'} d={d} pathLength={waiting ? undefined : 1} /> : null}
      {taken && waiting ? <Braid from={from} to={to} core={core} person={person} /> : null}
    </>
  );
}

function Edge({ scene, view, layout }: { readonly scene: EdgeScene; readonly view: RunView; readonly layout: Layout }) {
  const { edge, from, to, stop, label } = scene;
  const attributes = { className: edgeClass(edge, view.stations), 'data-edge': `${edge.from}>${edge.to}`, 'data-taken': edge.taken ? 'true' : 'false' };
  if (stop !== null) {
    const square = stop.r * STOP_SQUARE;
    const stopped = view.stations.some((station) => station.status === 'stopped');
    return (
      <g {...attributes}>
        <path className="edge__guide" d={segmentPath(from, stop.center)} />
        <path className="edge__stop" d={circlePath(stop.center, stop.r)} />
        <rect className="edge__stop-square" x={round(stop.center.x - square / 2)} y={round(stop.center.y - square / 2)} width={round(square)} height={round(square)} />
        {stopped ? null : <BoxLabel box={stop.label} text={RUN_TEXTS.stopLabel.text} className="edge__label edge__label--stop" />}
      </g>
    );
  }
  if (edge.kind === 'exit') {
    return (
      <g {...attributes}>
        <path className="edge__line" d={segmentPath(from, to)} />
      </g>
    );
  }
  return (
    <g {...attributes}>
      <Tube from={from} to={to} layout={layout} taken={edge.taken} waiting={edge.toWaiting} person={edge.toWaiting && view.stations.some((station) => station.id === edge.to && station.decidedBy === 'person')} />
      {label === null ? null : <BoxLabel box={label} text={RUN_TEXTS.branch.text} className="edge__label" />}
    </g>
  );
}

/** The way in: from past the edge of the screen to the first station, lit once the request arrived. */
function EntryLine({ view, scene }: { readonly view: RunView; readonly scene: Scene }) {
  const first = view.stations[0];
  if (first === undefined || scene.entry === null) return null;
  return (
    <g className={`edge edge--entry${first.status === 'pending' ? '' : ' is-taken'}`} data-edge="entry">
      <path className="edge__line" d={segmentPath(scene.entry.to, scene.entry.from)} />
    </g>
  );
}

/** A run that ended on its route: the yellow line dims a little, as B1 does with a closed run. */
function orbitClass(view: RunView, returning: boolean): string {
  const closed = view.finished && view.stations.every((station) => station.status === 'completed' || station.status === 'skipped');
  return ['orbit', returning ? 'is-returning' : '', closed ? 'is-closed' : ''].filter((name) => name !== '').join(' ');
}

export function Orbit({ view, layout, info, scene, returningFrom = null, children }: OrbitProps) {
  const shares = timeShares(view);
  const from = returningFrom === null ? undefined : layout.places[returningFrom];
  const current = currentStation(view);
  // The way back is the way in, reversed (§10): a CSS animation from the station left, run once on mount.
  const style = from === undefined ? undefined : { transformOrigin: `${Math.round(from.x)}px ${Math.round(from.y)}px` };
  return (
    <svg className={orbitClass(view, from !== undefined)} style={style} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="presentation">
      <g className="orbit__rings">
        {scene.stations.map((entry) => (
          <StationRings key={entry.station.id} station={entry.station} x={entry.place.x} y={entry.place.y} outer={entry.outerRing} inner={entry.innerRing} timeShare={shares.get(entry.station.id) ?? 0} />
        ))}
      </g>
      <g className="orbit__edges">
        <EntryLine view={view} scene={scene} />
        {scene.edges.map((entry) => (
          <Edge key={`${entry.edge.from}>${entry.edge.to}`} scene={entry} view={view} layout={layout} />
        ))}
      </g>
      {children}
      <g className="orbit__stations">
        {scene.stations.map((entry) => (
          <StationNode key={entry.station.id} scene={entry} layout={layout} threshold={info.lowConfidenceBelow} selected={entry.station.id === current} focused={entry.station.id === returningFrom} />
        ))}
      </g>
    </svg>
  );
}
