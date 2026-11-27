import type { CSSProperties, ReactNode } from 'react';

import type { CircuitInfo } from '../api.ts';
import { telemetryOf } from '../format.ts';
import type { Layout } from '../layout.ts';
import { actionText, outcomeTag, redactedText, secondaryNodes, statusText, type SecondaryNode } from '../nodes.ts';
import type { RunView, StationView } from '../projection.ts';
import { actionFacts, exitsOf } from '../room.ts';
import { actionsOf, routeHash, type Route } from '../route.ts';
import { ROOM_TEXTS, STATION_NAMES, STATUS_TEXTS, textOf } from '../texts.ts';
import { Portal } from './Portal.tsx';
import { StationBall, stationClass, timeShares } from './StationBall.tsx';

/**
 * Inside a station (docs/diseno.md §10, ADR-0013): the station at the center, large, with its
 * nodes whole around it and its ways out ahead, the one taken in yellow. Everything comes from
 * the same projected view the orbit paints, so entering changes what is seen and never the run.
 */

export type RoomRoute = Exclude<Route, { readonly kind: 'circuit' }>;

export interface RoomProps {
  readonly view: RunView;
  readonly info: CircuitInfo;
  readonly layout: Layout;
  /** Resolved against the view (resolveRoute): its station and its action exist. */
  readonly route: RoomRoute;
}

/** The room's bubble: large, but never more than a third of the band between the header and the dock. */
const ROOM_SCALE = 2.2;
const ROOM_BAND_SHARE = 0.3;
/** The action's bubble is smaller than its station's: it is a part of CRM. */
const ACTION_SCALE = 0.7;
/** Room around the bubble for its ring of marks and the confidence arc. */
const RING_ROOM = 26;

function roomRadius(layout: Layout): number {
  return Math.round(Math.min(layout.radius * ROOM_SCALE, (layout.height - layout.top - layout.bottom) * ROOM_BAND_SHARE));
}

function Ball({ station, r, info, view, action }: { readonly station: StationView; readonly r: number; readonly info: CircuitInfo; readonly view: RunView; readonly action?: number }) {
  const size = Math.ceil((r + RING_ROOM) * 2);
  return (
    <svg className="room__ball" width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden="true">
      <g className={stationClass(station)} data-station={station.id} data-status={station.status} data-action={action}>
        <StationBall station={station} r={r} threshold={info.lowConfidenceBelow} timeShare={timeShares(view).get(station.id) ?? 0} />
      </g>
    </svg>
  );
}

function NodeList({ nodes, linkOf }: { readonly nodes: readonly SecondaryNode[]; readonly linkOf?: ((node: SecondaryNode) => string | null) | undefined }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="room__nodes">
      {nodes.map((node) => {
        const href = linkOf?.(node) ?? null;
        return (
          <li key={node.key} className={node.filled ? 'room-node is-filled' : 'room-node'} data-node={node.key}>
            {href === null ? node.text : <a href={href}>{node.text}</a>}
          </li>
        );
      })}
    </ul>
  );
}

/** CRM's nodes open its actions: the second level (§10). */
const actionLink = (node: SecondaryNode): string | null => {
  const match = /^action-(\d+)$/.exec(node.key);
  return match?.[1] === undefined ? null : routeHash({ kind: 'action', station: 'crm', index: Number(match[1]) + 1 });
};

function Facts({ station, view, info }: { readonly station: StationView; readonly view: RunView; readonly info: CircuitInfo }) {
  const nodes = secondaryNodes(station, info, { whole: true });
  const received = station.id === 'intake' ? redactedText(view.stations.flatMap((entry) => (entry.event === null ? [] : [entry.event]))) : null;
  const proposal = station.decidedBy === 'person' ? actionsOf(view.stations.find((entry) => entry.id === 'crm')).flatMap((action) => actionText(action, true) ?? []) : [];
  if (nodes.length === 0 && received === null) return <p className="room__empty">{ROOM_TEXTS.notYet.text}</p>;
  return (
    <>
      {received === null ? null : (
        <section className="room__block">
          <h3>{ROOM_TEXTS.received.text}</h3>
          <p className="room__received">{received}</p>
        </section>
      )}
      {proposal.length === 0 ? null : (
        <section className="room__block" data-proposal>
          <h3>{ROOM_TEXTS.proposal.text}</h3>
          <ul className="room__nodes">
            {proposal.map((text, index) => (
              <li key={`proposal-${index + 1}`} className="room-node">
                {text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="room__block">
        <h3>{station.id === 'crm' ? ROOM_TEXTS.proposedActions.text : station.decidedBy === 'person' ? ROOM_TEXTS.decision.text : ROOM_TEXTS.nodes.text}</h3>
        <NodeList nodes={nodes} linkOf={station.id === 'crm' ? actionLink : undefined} />
      </section>
    </>
  );
}

function Exits({ view, station }: { readonly view: RunView; readonly station: StationView }) {
  const exits = exitsOf(view, station.id);
  if (exits.length === 0) return null;
  return (
    <section className="room__block room__exits">
      <h3>{ROOM_TEXTS.exits.text}</h3>
      <ul>
        {exits.map((exit) => (
          <li key={exit.to} className={exit.taken ? 'exit is-taken' : 'exit'} data-exit={exit.to} data-taken={exit.taken ? 'true' : 'false'}>
            {view.stations.some((entry) => entry.id === exit.to) ? <a href={routeHash({ kind: 'station', station: exit.to })}>{exit.destination}</a> : <span>{exit.destination}</span>}
            <span className="exit__label">{exit.label}</span>
            {exit.taken ? <span className="exit__taken">{ROOM_TEXTS.taken.text}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StationCore({ station, view, info, layout }: { readonly station: StationView; readonly view: RunView; readonly info: CircuitInfo; readonly layout: Layout }) {
  const tag = outcomeTag(station);
  const state = statusText(station) ?? STATUS_TEXTS[station.status === 'completed' ? 'completed' : 'pending'].text;
  const telemetry = station.event === null || station.status === 'failed' ? null : telemetryOf(station.event);
  return (
    <>
      <div className="room__core">
        <Ball station={station} r={roomRadius(layout)} info={info} view={view} />
        <h2 className="room__name">{textOf(STATION_NAMES, station.id)}</h2>
        {tag === null ? null : <p className="room__tag">{tag}</p>}
        <p className={`room__state room__state--${station.status}`}>{state}</p>
        {telemetry === null ? null : <p className="room__telemetry">{telemetry}</p>}
      </div>
      <div className="room__detail">
        <Facts station={station} view={view} info={info} />
        <Exits view={view} station={station} />
      </div>
    </>
  );
}

function ActionCore({ station, view, info, layout, index }: { readonly station: StationView; readonly view: RunView; readonly info: CircuitInfo; readonly layout: Layout; readonly index: number }) {
  const facts = actionFacts(view, index);
  if (facts === null) return null;
  const total = actionsOf(station).length;
  return (
    <>
      <div className="room__core">
        <Ball station={station} r={Math.round(roomRadius(layout) * ACTION_SCALE)} info={info} view={view} action={index} />
        <h2 className="room__name">{facts.name}</h2>
        <p className="room__tag">{`${ROOM_TEXTS.action.text} ${index} ${ROOM_TEXTS.ofTotal.text} ${total}`}</p>
        <p className={facts.decided ? 'room__state' : 'room__state room__state--waiting'} data-action-state>
          {facts.state}
        </p>
      </div>
      <div className="room__detail">
        <section className="room__block">
          <ul className="room__nodes">
            {facts.lines.map((line) => (
              <li key={line.key} className="room-node" data-line={line.key}>
                {line.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

export function Room({ view, info, layout, route }: RoomProps) {
  const station = view.stations.find((entry) => entry.id === route.station);
  if (station === undefined) return null;
  const place = layout.places[station.id];
  // The camera goes into the bubble (§10): the room grows out of where the station sits in the orbit.
  const style: CSSProperties | undefined = place === undefined ? undefined : { transformOrigin: `${Math.round(place.x)}px ${Math.round(place.y)}px` };
  return (
    <section className={layout.narrow ? 'room is-narrow' : 'room'} style={style} data-room={station.id} data-room-kind={route.kind}>
      <Portal view={view} layout={layout} route={route} />
      {route.kind === 'action' ? <ActionCore station={station} view={view} info={info} layout={layout} index={route.index} /> : <StationCore station={station} view={view} info={info} layout={layout} />}
    </section>
  );
}

/** The top left inside a room: the brand line and the breadcrumb, «Circuito › CRM › Tarea» (§10). */
export function RoomHeader({ brand, view, route }: { readonly brand: ReactNode; readonly view: RunView; readonly route: RoomRoute }) {
  const name = textOf(STATION_NAMES, route.station);
  const action = route.kind === 'action' ? actionFacts(view, route.index) : null;
  return (
    <header className="request is-room">
      {brand}
      <nav className="crumbs" aria-label={ROOM_TEXTS.whereYouAre.text}>
        <ol>
          <li>
            <a href={routeHash({ kind: 'circuit', from: route.station })}>{ROOM_TEXTS.circuit.text}</a>
          </li>
          <li>{action === null ? <span aria-current="page">{name}</span> : <a href={routeHash({ kind: 'station', station: route.station })}>{name}</a>}</li>
          {action === null ? null : (
            <li>
              <span aria-current="page">{action.name}</span>
            </li>
          )}
        </ol>
      </nav>
    </header>
  );
}
