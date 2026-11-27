import type { CircuitInfo, CrmTool, RunEvent, RunSummary } from '../api.ts';
import { crewFor } from '../crew.ts';
import { layoutFor } from '../layout.ts';
import { idleView, projectRun } from '../projection.ts';
import { CIRCUIT_ROUTE, resolveRoute, routeHash, type Route } from '../route.ts';
import { sceneOf } from '../scene.ts';
import { leftFacts, panelSlots, rightFacts } from '../side-panels.ts';
import { RUN_TEXTS } from '../texts.ts';
import { Crew } from './Crew.tsx';
import { Orbit } from './Orbit.tsx';
import { BrandLine, ClockPanel, Dock, RequestPanel, StopCard, ToolList, runState, type FeedStatus } from './Panels.tsx';
import { Room, RoomHeader } from './Room.tsx';
import type { DecisionBody } from './Decision.tsx';
import { SidePanels } from './SidePanels.tsx';
import { Tryout } from './Tryout.tsx';
import type { CommandState } from '../use-run-events.ts';

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
  /** The board's two commands (ADR-0012) and their state; absent in a rendering to a string. */
  readonly command?: CommandState;
  readonly onTryout?: (sampleId: string) => void;
  readonly onDecide?: (runId: number, body: DecisionBody) => void;
}

const IDLE_COMMAND: CommandState = { status: 'idle', kind: null, problem: null, field: null };

export function Board(props: BoardProps) {
  const { info } = props;
  const command = props.command ?? IDLE_COMMAND;
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
  const scene = sceneOf(view, layout, info);
  const state = runState(props.status, props.runId, view, props.events);
  // The side panels of an ultrawide window (§9): only those with data are drawn, and the crew keeps off them.
  const left = leftFacts(view, info);
  const right = rightFacts(view, info, props.events);
  const panels = panelSlots(layout, scene).filter((panel) => (panel.side === 'left' ? left : right) !== null);
  const className = ['board', layout.narrow ? 'is-narrow' : '', route.kind === 'circuit' ? '' : 'is-room'].filter((name) => name !== '').join(' ');
  return (
    <main className={className} data-finished={view.finished ? 'true' : 'false'} data-route={route.kind}>
      {route.kind === 'circuit' ? (
        <>
          <Orbit view={view} layout={layout} info={info} scene={scene} returningFrom={route.from}>
            <Crew figures={crewFor(props.runId, view, scene, layout, panels)} />
          </Orbit>
          <SidePanels panels={panels} left={left} right={right} />
          <StopCard view={view} scene={scene} layout={layout} events={props.events} />
          <RequestPanel info={info} runs={props.runs} runId={props.runId} events={props.events} onSelectRun={props.onSelectRun} />
        </>
      ) : (
        <>
          {/* Keyed by the address, so each room mounts anew and its way in plays again (§10). */}
          <Room key={routeHash(route)} view={view} info={info} layout={layout} route={route} runId={props.runId} command={command} onDecide={props.onDecide} />
          <RoomHeader brand={<BrandLine info={info} />} view={view} route={route} />
        </>
      )}
      <ClockPanel state={state} view={view} events={props.events} runs={props.runs} info={info} />
      <Dock view={view} narrow={layout.narrow} selected={route.kind === 'circuit' ? null : route.station} />
      {layout.narrow || route.kind !== 'circuit' ? null : <ToolList tools={props.tools} />}
      {route.kind === 'circuit' ? <Tryout samples={info.samples} command={command} onTryout={props.onTryout} /> : null}
    </main>
  );
}
