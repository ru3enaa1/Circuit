import type { JsonValue } from './api.ts';
import { ACTION_NAMES, DECISION_TEXTS, textOf } from './texts.ts';

/**
 * The mentor's correction (ADR-0012, `corrected`), as data: which fields of each proposed action
 * the form lets them edit, and the list the form gives back. Pure: the form keeps no state, its
 * inputs hold what was typed, and this reads them when it is sent. The server checks the list
 * again with the core's rules (A8); this only builds it in the shape the route takes.
 */

export interface CorrectionField {
  /** The input's name in the form: `<field>-<index>`. */
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly multiline: boolean;
  /** A date input (`create_task`'s due date). */
  readonly date: boolean;
}

export interface CorrectionItem {
  readonly index: number;
  readonly type: string;
  /** «Nota», «Tarea»… */
  readonly name: string;
  /** The checkbox that keeps the action in the list: `keep-<index>`. */
  readonly keep: string;
  readonly fields: readonly CorrectionField[];
}

type JsonRecord = { readonly [key: string]: JsonValue };

const recordOf = (value: JsonValue): JsonRecord | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null);
const stringOf = (record: JsonRecord, key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');

/** What the mentor may change, by type. A new contact keeps its name: the room never shows it (§15). */
const EDITABLE: Readonly<Record<string, readonly { readonly key: string; readonly multiline?: boolean; readonly date?: boolean }[]>> = {
  create_contact: [],
  update_contact: [{ key: 'fullName' }],
  add_note: [{ key: 'body', multiline: true }],
  create_task: [{ key: 'title' }, { key: 'dueOn', date: true }],
  move_stage: [{ key: 'stage' }],
};

const LABELS: Readonly<Record<string, string>> = {
  fullName: DECISION_TEXTS.fullName.text,
  body: DECISION_TEXTS.body.text,
  title: DECISION_TEXTS.title.text,
  dueOn: DECISION_TEXTS.dueOn.text,
  stage: DECISION_TEXTS.stage.text,
};

const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** One item per proposed action of a type the board knows; an unknown type is left out of the form. */
export function correctionItems(actions: readonly JsonValue[]): readonly CorrectionItem[] {
  return actions.flatMap((value, index) => {
    const action = recordOf(value);
    const type = action === null ? '' : stringOf(action, 'type');
    const editable = EDITABLE[type];
    if (action === null || editable === undefined) return [];
    const fields = editable.map(({ key, multiline = false, date = false }) => ({ name: `${key}-${index}`, label: LABELS[key] ?? key, value: stringOf(action, key), multiline, date }));
    return [{ index, type, name: capitalized(textOf(ACTION_NAMES, type)), keep: `keep-${index}`, fields }];
  });
}

/** Reads one input of the form: its text, or null when the form has no such input (or a checkbox is off). */
export type FormReader = (name: string) => string | null;

/**
 * The corrected list: the kept actions, in the proposal's order, with what the mentor typed. A
 * new contact keeps its proposed name, and the server takes its e-mail from the proposal (A8).
 */
export function correctedActions(actions: readonly JsonValue[], read: FormReader): readonly Record<string, string | null>[] {
  return correctionItems(actions).flatMap((item) => {
    if (read(item.keep) === null) return [];
    const action = recordOf(actions[item.index] ?? null) ?? {};
    if (item.type === 'create_contact') return [{ type: item.type, fullName: stringOf(action, 'fullName') }];
    const typed = Object.fromEntries(item.fields.map((field) => [field.name.slice(0, field.name.lastIndexOf('-')), read(field.name) ?? field.value]));
    // An empty due date is no due date; every other empty field goes as typed, and the server refuses it.
    if (item.type === 'create_task') return [{ type: item.type, title: typed['title'] ?? '', dueOn: typed['dueOn'] === '' ? null : (typed['dueOn'] ?? null) }];
    return [{ type: item.type, ...typed }];
  });
}
