import type { CircuitInfo, CrmTool, RunEvent, RunSummary } from '../api.ts';
import { layoutFor } from '../layout.ts';
import { idleView, projectRun } from '../projection.ts';
import { RUN_TEXTS } from '../texts.ts';
import { Orbit } from './Orbit.tsx';
import { ClockPanel, Dock, RequestPanel, ToolList, type FeedStatus } from './Panels.tsx';

/**
 * The whole page as a function of what the feed holds (ADR-0011 B1): the table, the runs, the
 * shown run's revealed events and the window's size. It keeps no state, so rendering it with
 * react-dom/server shows exactly what the browser shows (B3).
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
  return (
    <main className={layout.narrow ? 'board is-narrow' : 'board'} data-finished={view.finished ? 'true' : 'false'}>
      <Orbit view={view} layout={layout} info={info} />
      <RequestPanel info={info} status={props.status} runs={props.runs} runId={props.runId} view={view} events={props.events} onSelectRun={props.onSelectRun} />
      <ClockPanel view={view} events={props.events} runs={props.runs} info={info} />
      <Dock view={view} narrow={layout.narrow} />
      {layout.narrow ? null : <ToolList tools={props.tools} />}
    </main>
  );
}
