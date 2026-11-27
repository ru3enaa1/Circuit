import { formatDecimal } from '../format.ts';
import type { Layout } from '../layout.ts';
import { statusText } from '../nodes.ts';
import type { StationView } from '../projection.ts';
import { routeHash } from '../route.ts';
import type { ArmLabel, StationScene, Telemetry } from '../scene.ts';
import { NODE_TEXTS, STATION_NAMES, STATUS_TEXTS, textOf } from '../texts.ts';
import { StationBall, focusOnMount, stationClass } from './StationBall.tsx';

/**
 * One station in the orbit as its projected view and the scene say (docs/diseno.md §5 and §7):
 * the bubble with its nodes, each node's short name, and the telemetry at the end of its guide
 * line. It keeps nothing: the same view paints the same station.
 */

export interface StationNodeProps {
  readonly scene: StationScene;
  readonly layout: Layout;
  readonly threshold: number;
  /** The station the run is on: the yellow ring. */
  readonly selected: boolean;
  /** The station just left (ADR-0013): it takes the focus back when the circuit mounts. */
  readonly focused?: boolean;
}

/** One line of the telemetry: 10.5 px mono at 13 px. */
const TELEMETRY_LINE = 13;

/** «Clasificación, hecha, confianza 0,82» (§14): the name and the state, never the color alone. */
export function stationLabel(station: StationView, name: string): string {
  const state = statusText(station) ?? STATUS_TEXTS[station.status === 'completed' ? 'completed' : 'pending'].text;
  const confidence = station.event?.detail['confidence'];
  const extra = typeof confidence === 'number' ? `, ${NODE_TEXTS.confidence.text} ${formatDecimal(confidence, 2)}` : '';
  return `${name}, ${state}${extra}`;
}

const round = (value: number) => Math.round(value * 10) / 10;

function Label({ label, dx, dy }: { readonly label: ArmLabel; readonly dx: number; readonly dy: number }) {
  if (label.label === '') return null;
  const className = ['node-label', label.filled ? 'is-filled' : '', label.muted ? 'is-muted' : ''].filter((name) => name !== '').join(' ');
  return (
    <text className={className} data-node={label.key} x={round(label.x - dx)} y={round(label.y - dy)}>
      <title>{label.title}</title>
      {label.label}
    </text>
  );
}

function TelemetryLabel({ telemetry, dx, dy }: { readonly telemetry: Telemetry; readonly dx: number; readonly dy: number }) {
  const x = round(telemetry.x - dx);
  const top = telemetry.y - dy - telemetry.h / 2;
  return (
    <g className="telemetry">
      <rect className="telemetry__back" x={round(x - telemetry.w / 2)} y={round(top)} width={round(telemetry.w)} height={round(telemetry.h)} />
      <text className="telemetry__primary" x={x} y={round(top + 1 + TELEMETRY_LINE / 2)}>
        {telemetry.primary}
      </text>
      {telemetry.secondary === null ? null : (
        <text className="telemetry__secondary" x={x} y={round(top + 1 + TELEMETRY_LINE * 1.5)}>
          {telemetry.secondary}
        </text>
      )}
    </g>
  );
}

export function StationNode({ scene, layout, threshold, selected, focused }: StationNodeProps) {
  const { station, place, telemetry } = scene;
  const name = textOf(STATION_NAMES, station.id);
  const dx = place.x;
  const dy = place.y;
  // A link: Tab reaches it in the order of the circuit, Enter enters (ADR-0013). Entering changes what is seen, never the run.
  return (
    <a className="station-link" href={routeHash({ kind: 'station', station: station.id })} aria-label={stationLabel(station, name)} ref={focused ? focusOnMount : undefined}>
      <g className={stationClass(station)} data-station={station.id} data-status={station.status} transform={`translate(${round(place.x)} ${round(place.y)})`}>
        {telemetry === null ? null : (
          <path className="telemetry__lead" d={`M${round(telemetry.lead.from.x - dx)} ${round(telemetry.lead.from.y - dy)}L${round(telemetry.lead.to.x - dx)} ${round(telemetry.lead.to.y - dy)}`} />
        )}
        <StationBall station={station} r={place.r} base={layout.radius} armAngles={scene.arms.map((arm) => arm.angle)} threshold={threshold} selected={selected} />
        {telemetry === null ? null : <TelemetryLabel telemetry={telemetry} dx={dx} dy={dy} />}
        {scene.labels.map((label) => (
          <Label key={label.key} label={label} dx={dx} dy={dy} />
        ))}
      </g>
    </a>
  );
}
