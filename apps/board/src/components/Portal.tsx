import type { Layout } from '../layout.ts';
import { MARK_VIEWBOX, at, markDots, markNeck, round, type MarkSizes } from '../mark.ts';
import type { RunView } from '../projection.ts';
import { actionsOf, parentOf, routeHash, type Route } from '../route.ts';
import { ROOM_TEXTS, STATION_NAMES, textOf } from '../texts.ts';
import { focusOnMount } from './StationBall.tsx';

/**
 * The way back (docs/diseno.md §10): a ring of marks with the level above in miniature, and
 * where we are in yellow. From a station, the whole circuit; from an action, CRM and its
 * actions. A link to the parent route, so a click, Enter or Esc all go one level up (E4).
 */

/** The miniature's own sizes in the box of the logo (§12, mark.ts): the same figure, thicker. */
const MINI_SIZES: MarkSizes = { orbit: 32, station: 6, center: 9 };
const MINI_CRM = 13;
const MINI_ACTION = 5;
/** The portal grows with R, between a size that still reads and one that never competes with the room. */
const PORTAL_SCALE = 2.6;
const PORTAL_MIN = 96;
const PORTAL_MAX = 184;

/** The circuit as the logo draws it: Persona at the center, the others around, the room's station in yellow. */
function MiniCircuit({ view, here }: { readonly view: RunView; readonly here: string }) {
  const dots = markDots(view.stations.map((station) => ({ id: station.id, center: station.decidedBy === 'person' })), MINI_SIZES);
  const byId = new Map(dots.map((dot) => [dot.id, dot]));
  return (
    <g className="mini">
      {view.edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (from === undefined || to === undefined) return null;
        return <line key={`${edge.from}>${edge.to}`} className={edge.taken ? 'mini__edge is-taken' : 'mini__edge'} {...markNeck(from, to)} />;
      })}
      {view.stations.map((station, index) => {
        const dot = dots[index]!;
        const className = `mini__station mini--${station.status}${station.id === here ? ' is-here' : ''}`;
        return <circle key={station.id} className={className} data-mini={station.id} cx={dot.x} cy={dot.y} r={dot.r} />;
      })}
    </g>
  );
}

/** CRM and its proposed actions around it, the one we are in in yellow. */
function MiniActions({ count, here }: { readonly count: number; readonly here: number }) {
  const points = Array.from({ length: count }, (_, index) => at(-90 + (index * 360) / Math.max(1, count), MINI_SIZES.orbit));
  return (
    <g className="mini">
      {points.map((point, index) => (
        <line key={`edge-${index + 1}`} className={index + 1 === here ? 'mini__edge is-taken' : 'mini__edge'} x1={0} y1={0} x2={round(point.x)} y2={round(point.y)} />
      ))}
      <circle className="mini__station mini--completed" r={MINI_CRM} />
      {points.map((point, index) => (
        <circle key={`action-${index + 1}`} className={index + 1 === here ? 'mini__station is-here' : 'mini__station'} data-mini={`action-${index + 1}`} cx={round(point.x)} cy={round(point.y)} r={MINI_ACTION} />
      ))}
    </g>
  );
}

export interface PortalProps {
  readonly view: RunView;
  readonly layout: Layout;
  readonly route: Exclude<Route, { readonly kind: 'circuit' }>;
}

export function Portal({ view, layout, route }: PortalProps) {
  const parent = parentOf(route);
  if (parent === null) return null;
  const size = Math.round(Math.min(PORTAL_MAX, Math.max(PORTAL_MIN, layout.radius * PORTAL_SCALE)));
  const label = route.kind === 'action' ? textOf(STATION_NAMES, route.station) : ROOM_TEXTS.circuit.text;
  const crm = view.stations.find((station) => station.id === route.station);
  // Entering a room puts the focus on the way back: Enter returns, as Esc does (§14).
  return (
    <a className="portal" href={routeHash(parent)} aria-label={`${ROOM_TEXTS.backTo.text} ${label}`} ref={focusOnMount} data-portal={routeHash(parent)}>
      <svg className="portal__ring" width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
        <circle className="portal__ticks" r={47} />
        {route.kind === 'action' ? <MiniActions count={actionsOf(crm).length} here={route.index} /> : <MiniCircuit view={view} here={route.station} />}
      </svg>
      <span className="portal__label">{label}</span>
      <span className="portal__help">{route.kind === 'action' ? ROOM_TEXTS.helpAction.text : ROOM_TEXTS.help.text}</span>
    </a>
  );
}
