import type { JsonValue } from './api.ts';
import { formatDueDate } from './format.ts';
import { END, type EdgeKind, type RunView } from './projection.ts';
import { actionsOf } from './route.ts';
import { ACTION_NAMES, ROOM_TEXTS, RUN_TEXTS, STATION_NAMES, textOf } from './texts.ts';

/**
 * What a room says (docs/diseno.md §10, ADR-0013), read only from the projected view: a
 * station's ways out, with the one taken, and one proposed action of CRM with its state. Pure,
 * like the projection, so the same events give the same room.
 */

export interface RoomExit {
  readonly to: string;
  readonly kind: EdgeKind;
  /** «ruta normal», «queja, fuera de alcance o duda», «alto», «salida». */
  readonly label: string;
  /** The station it leads to, or «fin del circuito». */
  readonly destination: string;
  readonly taken: boolean;
}

const EXIT_LABELS: Readonly<Record<EdgeKind, string>> = {
  main: ROOM_TEXTS.normalRoute.text,
  branch: RUN_TEXTS.branch.text,
  stop: ROOM_TEXTS.stopRoute.text,
  exit: ROOM_TEXTS.endRoute.text,
};

/** A station's ways out, in the table's order; the one its event took is marked (E3). */
export function exitsOf(view: RunView, stationId: string): readonly RoomExit[] {
  return view.edges
    .filter((edge) => edge.from === stationId)
    .map((edge) => ({
      to: edge.to,
      kind: edge.kind,
      label: EXIT_LABELS[edge.kind],
      destination: edge.to === END ? ROOM_TEXTS.endOfCircuit.text : textOf(STATION_NAMES, edge.to),
      taken: edge.taken,
    }));
}

export interface ActionLine {
  readonly key: string;
  readonly text: string;
}

export interface ActionFacts {
  /** «Tarea», «Nota», «Etapa». */
  readonly name: string;
  readonly lines: readonly ActionLine[];
  /** «espera aprobación», «aprobada», «aplicada»… */
  readonly state: string;
  /** The person decided: approved, corrected or rejected. */
  readonly decided: boolean;
}

type JsonRecord = { readonly [key: string]: JsonValue };

const recordOf = (value: JsonValue | undefined): JsonRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
const textOfField = (record: JsonRecord, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};
const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The fields a room shows, and only these: the contact's name and e-mail of `create_contact`
 * never leave the event (docs/diseno.md §15), even though the board would escape them.
 */
function linesOf(action: JsonRecord): ActionLine[] {
  const title = textOfField(action, 'title');
  const dueOn = textOfField(action, 'dueOn');
  const stage = textOfField(action, 'stage');
  const body = textOfField(action, 'body');
  return [
    ...(title === null ? [] : [{ key: 'title', text: title }]),
    ...(dueOn === null ? [] : [{ key: 'dueOn', text: `${ROOM_TEXTS.dueOn.text} ${formatDueDate(dueOn)}` }]),
    ...(stage === null ? [] : [{ key: 'stage', text: stage.replaceAll('-', ' ') }]),
    ...(body === null ? [] : [{ key: 'body', text: body }]),
  ];
}

const DECISION_STATES: Readonly<Record<string, string>> = {
  approved: ROOM_TEXTS.approved.text,
  corrected: ROOM_TEXTS.corrected.text,
  rejected: ROOM_TEXTS.rejected.text,
};

/** What happened to the action: Cierre's result when it has one for it, else the person's decision. */
function stateOf(view: RunView, action: JsonRecord, index: number): { readonly state: string; readonly decided: boolean } {
  const person = view.stations.find((station) => station.decidedBy === 'person');
  const decision = person?.outcome ?? null;
  const close = view.stations.find((station) => station.id === 'close')?.event;
  const result = recordOf(Array.isArray(close?.detail['results']) ? (close.detail['results'] as readonly JsonValue[])[index - 1] : undefined);
  // A corrected proposal may change the list: a result counts only if it is for the same kind of action.
  if (result !== null && textOfField(result, 'type') === textOfField(action, 'type')) {
    const applied = textOfField(result, 'result') === 'applied';
    return { state: applied ? ROOM_TEXTS.applied.text : (textOfField(result, 'reason') ?? ROOM_TEXTS.notApplied.text), decided: true };
  }
  const decided = decision === null ? undefined : DECISION_STATES[decision];
  return decided === undefined ? { state: ROOM_TEXTS.waitingApproval.text, decided: false } : { state: decided, decided: true };
}

/** One proposed action of CRM, counted from 1 as the address does; null when the event has no such action. */
export function actionFacts(view: RunView, index: number): ActionFacts | null {
  const crm = view.stations.find((station) => station.id === 'crm');
  const action = recordOf(actionsOf(crm)[index - 1]);
  const type = action === null ? null : textOfField(action, 'type');
  if (action === null || type === null) return null;
  return { name: capitalized(textOf(ACTION_NAMES, type)), lines: linesOf(action), ...stateOf(view, action, index) };
}
