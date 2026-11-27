import type { CircuitInfo, CrmTool, RunEvent, RunSummary } from '../api.ts';
import { formatCost, formatDuration, formatInteger, totalsOf } from '../format.ts';
import { ICON_BOX, iconOf } from '../icons.ts';
import type { Layout } from '../layout.ts';
import { redactedText, runClock, runStateText } from '../nodes.ts';
import { isFinished, type RunView } from '../projection.ts';
import { routeHash } from '../route.ts';
import { currentStation, type Scene } from '../scene.ts';
import { MODEL_NAMES, RUN_TEXTS, STATION_NAMES, STATUS_TEXTS, textOf } from '../texts.ts';
import { Logo } from './Logo.tsx';

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
  readonly runs: readonly RunSummary[];
  readonly runId: number | null;
  readonly events: readonly RunEvent[];
  readonly onSelectRun?: ((id: number) => void) | undefined;
}

function runLine(run: RunSummary, info: CircuitInfo): string {
  if (run.lastStation === null) return `N.º ${run.id} · ${RUN_TEXTS.running.text}`;
  const last = { station: run.lastStation, outcome: run.lastOutcome ?? '', status: run.lastStatus ?? 'completed' };
  const state = run.lastStatus === 'stopped' ? STATUS_TEXTS.stopped.text : run.lastStatus === 'failed' ? STATUS_TEXTS.failed.text : isFinished(info, last) ? RUN_TEXTS.done.text : RUN_TEXTS.running.text;
  return `N.º ${run.id} · ${stationName(run.lastStation)} · ${state}`;
}

export interface RunState {
  readonly text: string;
  /** Yellow while it goes on, pink when it waits for the person or stopped, quiet once done. */
  readonly tone: 'running' | 'alert' | 'quiet';
}

/** The run's state for the top right (§6): «en curso · Conocimiento», «espera a la persona», «terminada». */
export function runState(status: FeedStatus, runId: number | null, view: RunView, events: readonly RunEvent[]): RunState {
  if (status === 'loading') return { text: RUN_TEXTS.loading.text, tone: 'quiet' };
  if (status === 'unreachable') return { text: RUN_TEXTS.unreachable.text, tone: 'alert' };
  if (runId === null) return { text: RUN_TEXTS.idle.text, tone: 'quiet' };
  const last = events.at(-1) ?? null;
  const waiting = view.stations.find((station) => station.id === view.waitingAt);
  const tone = waiting?.decidedBy === 'person' || last?.status === 'stopped' || last?.status === 'failed' ? 'alert' : view.waitingAt === null ? 'quiet' : 'running';
  return { text: runStateText(view, last, stationName), tone };
}

/** The logo's size beside the brand line: B1's line is small and quiet, so the mark is too (§12). */
const LOGO_SIZE = 20;

/** «Circuit · Escuela · Simulador» (§6): the logo at 32 px, «Circuit» in Plex Sans 600, then the scenario and the model (§6, §12). */
export function BrandLine({ info }: { readonly info: CircuitInfo }) {
  const detail = [capitalized(info.scenario), textOf(MODEL_NAMES, info.model)].join(' · ');
  return (
    <p className="request__brand">
      <Logo size={LOGO_SIZE} />
      <span className="brand__name">{RUN_TEXTS.brand.text}</span>
      <span className="brand__detail">{` · ${detail}`}</span>
    </p>
  );
}

/** The top left: the brand line, «Solicitud N.º 12», its state and its crossed-out text (§6). */
export function RequestPanel(props: RequestPanelProps) {
  const { info, runs, runId } = props;
  const text = redactedText(props.events);
  return (
    <header className="request">
      <BrandLine info={info} />
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
      {text === null ? null : <p className="request__text">{`«${text}»`}</p>}
    </header>
  );
}

export interface ClockPanelProps {
  readonly state: RunState;
  readonly view: RunView;
  readonly events: readonly RunEvent[];
  readonly runs: readonly RunSummary[];
  readonly info: CircuitInfo;
}

/** The top right: stored time, never a clock that moves (§7), the totals and the runs in progress. */
/** «130 ms» or «7,5 s» as a large number and a small unit, as B1 writes the clock. */
function splitDuration(text: string): { readonly value: string; readonly unit: string } {
  const space = text.lastIndexOf(' ');
  return space < 0 ? { value: text, unit: '' } : { value: text.slice(0, space), unit: text.slice(space + 1) };
}

export function ClockPanel({ state, view, events, runs, info }: ClockPanelProps) {
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
      <p className={`clock__state clock__state--${state.tone}`} data-run-state>
        {state.text}
      </p>
      {clock === null ? null : <ClockTime elapsedMs={clock.elapsedMs} />}
      {clock?.waitingSince == null ? null : <p className="clock__since">{`${RUN_TEXTS.waitingSince.text} ${clock.waitingSince}`}</p>}
      {totals.measured === 0 ? null : <p className="clock__spent">{spent}</p>}
      <p className="clock__runs">
        {formatInteger(inProgress)} {RUN_TEXTS.inProgress.text}
      </p>
    </aside>
  );
}

function ClockTime({ elapsedMs }: { readonly elapsedMs: number }) {
  const { value, unit } = splitDuration(formatDuration(elapsedMs));
  return (
    <p className="clock__time" data-clock>
      {value}
      <span className="clock__unit">{` ${unit}`}</span>
    </p>
  );
}

/** A station's icon at the dock's size, from the same 24-box drawing as inside its bubble. */
function PillIcon({ id }: { readonly id: string }) {
  return (
    <svg className="pill__icon" width="17" height="17" viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`} aria-hidden="true">
      <path d={iconOf(id)} />
    </svg>
  );
}

export interface DockProps {
  readonly view: RunView;
  readonly narrow: boolean;
  /** The station whose room is open (ADR-0013): the yellow bubble goes over it. */
  readonly selected?: string | null;
}

/**
 * The bottom: one pill per station, and the yellow bubble over the one the run is on, or over the
 * room that is open (§6). Each pill is a link into its station's room (§10).
 */
export function Dock({ view, narrow, selected = null }: DockProps) {
  const current = currentStation(view);
  // One pill is marked, with the outline and the yellow bar above it: the open room, else the run's station.
  const marked = selected ?? current;
  return (
    <nav className={['dock', narrow ? 'is-narrow' : '', selected === null ? '' : 'has-selection'].filter((name) => name !== '').join(' ')} aria-label={RUN_TEXTS.stations.text}>
      <ol>
        {view.stations.map((station) => (
          <li key={station.id}>
            <a
              className={`pill pill--${station.status}${station.id === current ? ' is-current' : ''}${station.id === selected ? ' is-selected' : ''}${station.id === marked ? ' is-marked' : ''}`}
              data-dock-station={station.id}
              href={routeHash({ kind: 'station', station: station.id })}
              aria-label={stationName(station.id)}
              aria-current={station.id === selected ? 'page' : undefined}
            >
              <PillIcon id={station.id} />
              {narrow ? null : <span className="pill__name">{stationName(station.id)}</span>}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The stop's card (B1): its size, and how far it sits beside the stop's small bubble. */
const CARD_WIDTH = 300;
const CARD_HEIGHT = 124;
const CARD_GAP = 14;

export interface StopCardProps {
  readonly view: RunView;
  readonly scene: Scene;
  readonly layout: Layout;
  readonly events: readonly RunEvent[];
}

/**
 * When Filtro stopped the run, a card beside the stop says so (§13: serious), with the request's
 * stored text, already crossed out, struck through: it was kept as data and never followed.
 */
export function StopCard({ view, scene, layout, events }: StopCardProps) {
  const stop = scene.edges.find((entry) => entry.stop !== null && entry.edge.taken);
  const stopped = view.stations.find((station) => station.status === 'stopped');
  if (stop?.stop == null || stopped === undefined) return null;
  const side = stop.stop.center.x >= stop.from.x ? 1 : -1;
  const half = CARD_WIDTH / 2;
  const x = Math.min(Math.max(stop.stop.center.x + side * (stop.stop.r + CARD_GAP + half), half + 6), layout.width - half - 6) - half;
  const y = Math.min(Math.max(stop.stop.center.y, CARD_HEIGHT / 2 + 4), layout.height - layout.bottom - CARD_HEIGHT / 2 - 4) - CARD_HEIGHT / 2;
  const text = redactedText(events);
  return (
    <aside className="stop-card" style={{ left: Math.round(x), top: Math.round(y), width: CARD_WIDTH }} data-stop-card>
      <p className="stop-card__title">
        <span className="stop-card__square" aria-hidden="true" />
        {RUN_TEXTS.stopTitle.text}
      </p>
      <p className="stop-card__detail">{RUN_TEXTS.stopDetail.text}</p>
      {text === null ? null : <p className="stop-card__text">{`«${text}»`}</p>}
    </aside>
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
