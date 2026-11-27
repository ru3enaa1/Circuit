import type { CircuitInfo, CrmTool, RunEvent, RunSummary } from '../api.ts';
import { formatCost, formatDuration, formatInteger, totalsOf } from '../format.ts';
import { redactedText, runClock, runStateText } from '../nodes.ts';
import { isFinished, type RunView } from '../projection.ts';
import { MODEL_NAMES, RUN_TEXTS, STATION_NAMES, STATUS_TEXTS, textOf } from '../texts.ts';

/**
 * What surrounds the circuit (docs/diseno.md §6): the request on the top left, the run's clock
 * on the top right, the dock at the bottom and the CRM's tools. Every text comes from the
 * events, the table or the catalog.
 */

const stationName = (id: string) => textOf(STATION_NAMES, id);
const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export type FeedStatus = 'loading' | 'ready' | 'unreachable';

export interface RequestPanelProps {
  readonly info: CircuitInfo;
  readonly status: FeedStatus;
  readonly runs: readonly RunSummary[];
  readonly runId: number | null;
  readonly view: RunView;
  readonly events: readonly RunEvent[];
  readonly onSelectRun?: ((id: number) => void) | undefined;
}

function runLine(run: RunSummary, info: CircuitInfo): string {
  if (run.lastStation === null) return `N.º ${run.id} · ${RUN_TEXTS.running.text}`;
  const last = { station: run.lastStation, outcome: run.lastOutcome ?? '', status: run.lastStatus ?? 'completed' };
  const state = run.lastStatus === 'stopped' ? STATUS_TEXTS.stopped.text : run.lastStatus === 'failed' ? STATUS_TEXTS.failed.text : isFinished(info, last) ? RUN_TEXTS.done.text : RUN_TEXTS.running.text;
  return `N.º ${run.id} · ${stationName(run.lastStation)} · ${state}`;
}

function stateLine(props: RequestPanelProps): string {
  if (props.status === 'loading') return RUN_TEXTS.loading.text;
  if (props.status === 'unreachable') return RUN_TEXTS.unreachable.text;
  if (props.runId === null) return RUN_TEXTS.idle.text;
  return runStateText(props.view, props.events.at(-1) ?? null, stationName);
}

/** The top left: the brand line, «Solicitud N.º 12», its state and its crossed-out text (§6). */
export function RequestPanel(props: RequestPanelProps) {
  const { info, runs, runId } = props;
  const text = redactedText(props.events);
  const brand = [RUN_TEXTS.brand.text, capitalized(info.scenario), textOf(MODEL_NAMES, info.model)].join(' · ');
  return (
    <header className="request">
      <p className="request__brand">{brand}</p>
      <details className="runs">
        <summary>
          <h1 className="request__title">{runId === null ? RUN_TEXTS.latestRuns.text : `${RUN_TEXTS.request.text} ${runId}`}</h1>
        </summary>
        <ol className="runs__list">
          {runs.length === 0 ? <li className="runs__empty">{RUN_TEXTS.noRuns.text}</li> : null}
          {runs.map((run) => (
            <li key={run.id}>
              <button type="button" className={run.id === runId ? 'runs__item is-current' : 'runs__item'} data-run={run.id} onClick={() => props.onSelectRun?.(run.id)}>
                {runLine(run, info)}
              </button>
            </li>
          ))}
        </ol>
      </details>
      <p className="request__state" data-run-state>
        {stateLine(props)}
      </p>
      {text === null ? null : <p className="request__text">{text}</p>}
    </header>
  );
}

export interface ClockPanelProps {
  readonly view: RunView;
  readonly events: readonly RunEvent[];
  readonly runs: readonly RunSummary[];
  readonly info: CircuitInfo;
}

/** The top right: stored time, never a clock that moves (§7), the totals and the runs in progress. */
export function ClockPanel({ view, events, runs, info }: ClockPanelProps) {
  const waiting = view.stations.find((station) => station.id === view.waitingAt);
  const clock = runClock(events, waiting?.decidedBy === 'person');
  const totals = totalsOf(events);
  const inProgress = runs.filter((run) => run.lastStation !== null && !isFinished(info, { station: run.lastStation, outcome: run.lastOutcome ?? '', status: run.lastStatus ?? 'completed' })).length;
  const spent =
    totals.tokens === null || totals.costMicroUsd === null
      ? info.model === 'simulator'
        ? RUN_TEXTS.simulator.text
        : RUN_TEXTS.unmeasured.text
      : `${formatInteger(totals.tokens)} ${RUN_TEXTS.tokens.text} · ${formatCost(totals.costMicroUsd)}`;
  return (
    <aside className="clock">
      {clock === null ? null : (
        <p className="clock__time" data-clock>
          {clock.waitingSince === null ? formatDuration(clock.elapsedMs) : `${RUN_TEXTS.waitingSince.text} ${clock.waitingSince}`}
        </p>
      )}
      {clock === null ? null : <p className="clock__label">{clock.waitingSince === null ? RUN_TEXTS.duration.text : formatDuration(clock.elapsedMs)}</p>}
      {totals.measured === 0 ? null : <p className="clock__spent">{spent}</p>}
      <p className="clock__runs">
        {formatInteger(inProgress)} {RUN_TEXTS.inProgress.text}
      </p>
    </aside>
  );
}

export interface DockProps {
  readonly view: RunView;
  readonly narrow: boolean;
}

/** The bottom: one pill per station, and the yellow bubble over the one the run is on (§6). */
export function Dock({ view, narrow }: DockProps) {
  const lastEvent = [...view.stations].reverse().find((station) => station.event !== null);
  const current = view.waitingAt ?? lastEvent?.id ?? null;
  return (
    <nav className={narrow ? 'dock is-narrow' : 'dock'} aria-label={RUN_TEXTS.stations.text}>
      <ol>
        {view.stations.map((station) => (
          <li key={station.id} className={`pill pill--${station.status}${station.id === current ? ' is-current' : ''}`} data-dock-station={station.id}>
            <span className="pill__number">{station.number}</span>
            {narrow ? null : <span className="pill__name">{stationName(station.id)}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The CRM's tools, as GET /api/tools gives them (ADR-0011 B8): the board keeps no list of its own. */
export function ToolList({ tools }: { readonly tools: readonly CrmTool[] }) {
  if (tools.length === 0) return null;
  return (
    <aside className="tools" aria-label={RUN_TEXTS.tools.text}>
      <p className="tools__title">{RUN_TEXTS.tools.text}</p>
      <ul>
        {tools.map((tool) => (
          <li key={tool.name} data-tool={tool.name} className={`tool tool--${tool.access}`}>
            {tool.label} · {tool.access === 'read' ? RUN_TEXTS.reads.text : RUN_TEXTS.writes.text}
          </li>
        ))}
      </ul>
    </aside>
  );
}
