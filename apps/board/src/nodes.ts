import type { CircuitInfo, JsonValue, RunEvent } from './api.ts';
import { formatClock, formatDecimal, formatDueDate, formatInteger, shorten } from './format.ts';
import type { RunView, StationView } from './projection.ts';
import { ACTION_NAMES, DECISION_NODES, FAILURE_REASONS, INTENTS, NODE_TEXTS, OUTCOME_TAGS, RUN_TEXTS, STATUS_TEXTS, URGENCIES, textOf } from './texts.ts';

/**
 * The texts around each station (docs/diseno.md §5 and §7), read only from its event's detail.
 * A node whose data the event does not carry is not drawn (principle 3). Pure, like the
 * projection: the same view gives the same nodes.
 */

export interface SecondaryNode {
  readonly key: string;
  readonly text: string;
  /** Persona's decision taken: drawn filled, the others in outline. */
  readonly filled: boolean;
}

/** The quote in the orbit is cut; inside a station's room it is whole (ADR-0013 E3). */
export const QUOTE_MAX_LENGTH = 90;
const TASK_TITLE_MAX_LENGTH = 28;

type Detail = RunEvent['detail'];

const text = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const count = (value: JsonValue | undefined): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);
const node = (key: string, value: string, filled = false): SecondaryNode => ({ key, text: value, filled });

/** In the orbit the texts are cut to fit; inside a room they are whole. */
export interface NodeOptions {
  readonly whole?: boolean;
}

function titleOf(info: CircuitInfo, documentId: string | null): string | null {
  if (documentId === null) return null;
  return info.documents.find((document) => document.id === documentId)?.title ?? documentId;
}

/** «1 correo aparte · 1 teléfono · 1 documento tachados», from counts only: never what was crossed out. */
export function personalSummary(detail: Detail): string {
  const phones = count(detail['phones']);
  const documents = count(detail['documents']);
  const parts = [
    ...(detail['hasEmail'] === true ? [`1 ${NODE_TEXTS.emailAside.text}`] : []),
    ...(phones > 0 ? [`${phones} ${phones === 1 ? NODE_TEXTS.phone.text : NODE_TEXTS.phones.text}`] : []),
    ...(documents > 0 ? [`${documents} ${documents === 1 ? NODE_TEXTS.document.text : NODE_TEXTS.documents.text}`] : []),
  ];
  return parts.length === 0 ? NODE_TEXTS.noPersonal.text : `${parts.join(' · ')} ${NODE_TEXTS.crossedOut.text}`;
}

function filterNodes(event: RunEvent): SecondaryNode[] {
  if (event.outcome === 'injection') {
    return [node('delimit', NODE_TEXTS.delimited.text), node('injection', `${NODE_TEXTS.injection.text}: ${text(event.detail['pattern']) ?? '—'}`)];
  }
  return [node('delimit', NODE_TEXTS.delimited.text), node('injection', NODE_TEXTS.noInjection.text), node('personal', personalSummary(event.detail))];
}

function classificationNodes(event: RunEvent, info: CircuitInfo): SecondaryNode[] {
  const { detail } = event;
  const intent = text(detail['intent']);
  const topic = titleOf(info, text(detail['topic']));
  const urgency = text(detail['urgency']);
  const confidence = detail['confidence'];
  return [
    ...(intent === null ? [] : [node('intent', textOf(INTENTS, intent))]),
    ...(topic === null ? [] : [node('topic', topic)]),
    ...(urgency === null ? [] : [node('urgency', `${NODE_TEXTS.urgency.text} ${textOf(URGENCIES, urgency)}`)]),
    ...(typeof confidence === 'number' ? [node('confidence', `${NODE_TEXTS.confidence.text} ${formatDecimal(confidence, 2)}`)] : []),
  ];
}

function knowledgeNodes(event: RunEvent, info: CircuitInfo, whole: boolean): SecondaryNode[] {
  if (event.outcome === 'no_source') return [node('source', NODE_TEXTS.noSource.text)];
  const title = titleOf(info, text(event.detail['documentId']));
  const quote = text(event.detail['quote']);
  return [...(title === null ? [] : [node('document', title)]), ...(quote === null ? [] : [node('quote', `«${whole ? quote : shorten(quote, QUOTE_MAX_LENGTH)}»`)])];
}

/** «nota», «etapa: programa propuesto», «tarea: Agendar la conversación… · 1 dic». */
export function actionText(action: JsonValue, whole = false): string | null {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return null;
  const record = action as { readonly [key: string]: JsonValue };
  const type = text(record['type']);
  if (type === null) return null;
  const name = textOf(ACTION_NAMES, type);
  const stage = text(record['stage']);
  if (type === 'move_stage' && stage !== null) return `${name}: ${stage.replaceAll('-', ' ')}`;
  const title = text(record['title']);
  const dueOn = text(record['dueOn']);
  if (type === 'create_task' && title !== null) {
    return `${name}: ${whole ? title : shorten(title, TASK_TITLE_MAX_LENGTH)}${dueOn === null ? '' : ` · ${formatDueDate(dueOn)}`}`;
  }
  return name;
}

function listOf(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function crmNodes(event: RunEvent, whole: boolean): SecondaryNode[] {
  const actions = listOf(event.detail['actions']);
  if (actions.length === 0) return [node('none', NODE_TEXTS.noActions.text)];
  return actions.flatMap((action, index) => {
    const value = actionText(action, whole);
    return value === null ? [] : [node(`action-${index}`, value)];
  });
}

function closeNodes(event: RunEvent): SecondaryNode[] {
  const results = listOf(event.detail['results']).flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const record = entry as { readonly [key: string]: JsonValue };
    const name = textOf(ACTION_NAMES, text(record['type']) ?? '');
    const result = text(record['result']);
    const outcome = result === 'applied' ? NODE_TEXTS.applied.text : (text(record['reason']) ?? NODE_TEXTS.notApplied.text);
    return [node(`result-${index}`, `${name} · ${outcome}`)];
  });
  return [...(results.length === 0 ? [node('none', NODE_TEXTS.noActions.text)] : results), node('log', NODE_TEXTS.log.text)];
}

function personNodes(station: StationView): SecondaryNode[] {
  return DECISION_NODES.map(({ outcome, label }) => node(outcome, label.text, station.outcome === outcome));
}

/** The nodes of one station: its state's own (Persona's three ways out) and its event's. */
export function secondaryNodes(station: StationView, info: CircuitInfo, options: NodeOptions = {}): readonly SecondaryNode[] {
  const whole = options.whole === true;
  if (station.decidedBy === 'person' && (station.status === 'waiting' || station.event !== null)) return personNodes(station);
  const { event } = station;
  if (event === null || event.status === 'failed') return [];
  switch (station.id) {
    case 'intake':
      return count(event.detail['length']) > 0 ? [node('length', `${formatInteger(count(event.detail['length']))} ${NODE_TEXTS.characters.text}`)] : [];
    case 'filter':
      return filterNodes(event);
    case 'classification':
      return classificationNodes(event, info);
    case 'knowledge':
      return knowledgeNodes(event, info, whole);
    case 'crm':
      return crmNodes(event, whole);
    case 'close':
      return closeNodes(event);
    default:
      return [];
  }
}

/** What a state says next to the bubble (§5): «en curso», «espera a la persona», «falló · …». */
export function statusText(station: StationView): string | null {
  switch (station.status) {
    case 'waiting':
      return station.decidedBy === 'person' ? STATUS_TEXTS.waitingPerson.text : STATUS_TEXTS.waiting.text;
    case 'skipped':
      return STATUS_TEXTS.skipped.text;
    case 'stopped':
      return station.outcome === 'injection' ? STATUS_TEXTS.stoppedInjection.text : STATUS_TEXTS.stopped.text;
    case 'failed': {
      const reason = text(station.event?.detail['reason']);
      return reason === null ? STATUS_TEXTS.failed.text : `${STATUS_TEXTS.failed.text} · ${textOf(FAILURE_REASONS, reason)}`;
    }
    default:
      return null;
  }
}

/** The outcome's tag under the name (§5): «sin fuente», «queja», «aprobado»… */
export function outcomeTag(station: StationView): string | null {
  return station.outcome === null ? null : (OUTCOME_TAGS[station.outcome]?.text ?? null);
}

/** The request as station 2 stored it, already crossed out (ADR-0010 A1); null before that event. */
export function redactedText(events: readonly RunEvent[]): string | null {
  return text(events.find((event) => event.station === 'filter')?.detail['text']);
}

export interface RunClock {
  /** From the first event's start to the end of the last: stored time, it never moves alone (§7). */
  readonly elapsedMs: number;
  /** While the run waits for the person, the time of its last event. */
  readonly waitingSince: string | null;
}

export function runClock(events: readonly RunEvent[], waitingForPerson: boolean): RunClock | null {
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) return null;
  const end = Date.parse(last.startedAt) + last.durationMs;
  return {
    elapsedMs: Math.max(0, end - Date.parse(first.startedAt)),
    waitingSince: waitingForPerson ? formatClock(new Date(end).toISOString()) : null,
  };
}

/** The header's state: «en curso · Conocimiento», «espera a la persona», «terminada»… */
export function runStateText(view: RunView, last: RunEvent | null, stationName: (id: string) => string): string {
  const waiting = view.stations.find((station) => station.id === view.waitingAt);
  if (waiting?.decidedBy === 'person') return RUN_TEXTS.waitingPerson.text;
  if (view.waitingAt !== null) return `${RUN_TEXTS.running.text} · ${stationName(view.waitingAt)}`;
  if (last?.status === 'stopped') return RUN_TEXTS.stopped.text;
  if (last?.status === 'failed') return `${RUN_TEXTS.failed.text} · ${stationName(last.station)}`;
  return RUN_TEXTS.done.text;
}
