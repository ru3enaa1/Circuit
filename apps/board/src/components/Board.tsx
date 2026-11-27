import type { CircuitInfo, CrmTool, RunEvent, RunSummary } from '../api.ts';
import { layoutFor } from '../layout.ts';
import { idleView, projectRun } from '../projection.ts';
import { CIRCUIT_ROUTE, resolveRoute, routeHash, type Route } from '../route.ts';
import { RUN_TEXTS } from '../texts.ts';
import { Orbit } from './Orbit.tsx';
import { ClockPanel, Dock, RequestPanel, ToolList, brandLine, type FeedStatus } from './Panels.tsx';
import { Room, RoomHeader } from './Room.tsx';

/**
 * The whole page as a function of what the feed holds (ADR-0011 B1): the table, the runs, the
 * shown run's revealed events and the window's size, and what is looked at, from the address
 * (ADR-0013). It keeps no state, so rendering it with react-dom/server shows exactly what the
 * browser shows (B3), in the orbit and in every room.
 */

export interface BoardProps {
  readonly status: FeedStatus;
  readonly info: CircuitInfo | null;
  readonly tools: readonly CrmTool[];
  readonly runs: readonly RunSummary[];
  readonly runId: number | null;
  /** The events revealed so far: a prefix of the stored ones. */
  readonly events: readonly RunEvent[];
  readonly width: number;
  readonly height: number;
  /** What is looked at, as the address says it; the circuit when absent. */
  readonly route?: Route;
  readonly onSelectRun?: (id: number) => void;
}

export function Board(props: BoardProps) {
  const { info } = props;
  if (info === null) {
    return (
      <main className="board board--empty">
        <p className="board__message">{props.status === 'unreachable' ? RUN_TEXTS.unreachable.text : RUN_TEXTS.loading.text}</p>
      </main>
    );
  }
  const view = props.runId === null ? idleView(info) : projectRun(info, props.events);
  const layout = layoutFor(props.width, props.height, info.stations);
  // The address is the user's input: only a view the events brought can open (ADR-0013 E1).
  const route = resolveRoute(props.route ?? CIRCUIT_ROUTE, view);
  const className = ['board', layout.narrow ? 'is-narrow' : '', route.kind === 'circuit' ? '' : 'is-room'].filter((name) => name !== '').join(' ');
  return (
    <main className={className} data-finished={view.finished ? 'true' : 'false'} data-route={route.kind}>
      {route.kind === 'circuit' ? (
        <>
          <Orbit view={view} layout={layout} info={info} returningFrom={route.from} />
          <RequestPanel info={info} status={props.status} runs={props.runs} runId={props.runId} view={view} events={props.events} onSelectRun={props.onSelectRun} />
        </>
      ) : (
        <>
          {/* Keyed by the address, so each room mounts anew and its way in plays again (§10). */}
          <Room key={routeHash(route)} view={view} info={info} layout={layout} route={route} />
          <RoomHeader brand={brandLine(info)} view={view} route={route} />
        </>
      )}
      <ClockPanel view={view} events={props.events} runs={props.runs} info={info} />
      <Dock view={view} narrow={layout.narrow} selected={route.kind === 'circuit' ? null : route.station} />
      {layout.narrow || route.kind !== 'circuit' ? null : <ToolList tools={props.tools} />}
    </main>
  );
}
