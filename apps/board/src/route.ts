import type { JsonValue } from './api.ts';
import type { RunView, StationView } from './projection.ts';

/**
 * What the page looks at (ADR-0013): the circuit, a station's room or one proposed action inside
 * CRM. It lives in the address's fragment, never in React state (ADR-0011 B1), so entering and
 * leaving change what is seen and never the run. The fragment is the user's input: it is read
 * with closed expressions and checked against the projected view, and the raw text is never shown.
 */

export type Route =
  /** The orbit. `from` names the station just left, for the way back's movement and focus. */
  | { readonly kind: 'circuit'; readonly from: string | null }
  | { readonly kind: 'station'; readonly station: string }
  /** `index` counts from 1, as the address shows it. */
  | { readonly kind: 'action'; readonly station: string; readonly index: number };

export const CIRCUIT_ROUTE: Route = { kind: 'circuit', from: null };

/** A station id as the table writes them: lowercase words joined by `_`, never anything else. */
const ID = '([a-z][a-z_]{0,31})';
/** One or two digits, with no leading zero: a station proposes a handful of actions. */
const INDEX = '([1-9][0-9]?)';
const FROM_PATTERN = new RegExp(`^#/desde/${ID}$`);
const STATION_PATTERN = new RegExp(`^#/estacion/${ID}$`);
const ACTION_PATTERN = new RegExp(`^#/estacion/${ID}/accion/${INDEX}$`);

/** The fragment as `location.hash` gives it (with its `#`), read only by its shape. */
export function parseRoute(hash: string): Route {
  const action = ACTION_PATTERN.exec(hash);
  if (action?.[1] !== undefined && action[2] !== undefined) return { kind: 'action', station: action[1], index: Number(action[2]) };
  const station = STATION_PATTERN.exec(hash);
  if (station?.[1] !== undefined) return { kind: 'station', station: station[1] };
  const from = FROM_PATTERN.exec(hash);
  if (from?.[1] !== undefined) return { kind: 'circuit', from: from[1] };
  return CIRCUIT_ROUTE;
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'circuit':
      return route.from === null ? '#/' : `#/desde/${route.from}`;
    case 'station':
      return `#/estacion/${route.station}`;
    case 'action':
      return `#/estacion/${route.station}/accion/${route.index}`;
  }
}

/** One level up (§10): from an action to its station, from a station to the circuit; none above the circuit. */
export function parentOf(route: Route): Route | null {
  switch (route.kind) {
    case 'circuit':
      return null;
    case 'station':
      return { kind: 'circuit', from: route.station };
    case 'action':
      return { kind: 'station', station: route.station };
  }
}

/** The proposed actions a station's room opens one by one: CRM's, from its event's detail. */
export function actionsOf(station: StationView | undefined): readonly JsonValue[] {
  if (station?.id !== 'crm' || station.event === null) return [];
  const actions = station.event.detail['actions'];
  return Array.isArray(actions) ? actions : [];
}

/**
 * The nearest view that exists: a station the table lacks leads to the circuit, an action its
 * event does not carry leads to its station's room (E1). The view is the projection's, so a
 * room never opens on anything the events did not bring.
 */
export function resolveRoute(route: Route, view: RunView): Route {
  const known = (id: string) => view.stations.find((station) => station.id === id);
  switch (route.kind) {
    case 'circuit':
      return route.from === null || known(route.from) !== undefined ? route : CIRCUIT_ROUTE;
    case 'station':
      return known(route.station) === undefined ? CIRCUIT_ROUTE : route;
    case 'action': {
      const station = known(route.station);
      if (station === undefined) return CIRCUIT_ROUTE;
      return route.index <= actionsOf(station).length ? route : { kind: 'station', station: route.station };
    }
  }
}
