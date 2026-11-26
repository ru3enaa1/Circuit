import { InvalidInput, isRecord, requireIsoDate, requireOneOf, requirePattern, requireText } from './validate.ts';

/**
 * The CRM actions station 5 may propose and the mentor may correct (ADR-0010 D14, ADR-0012
 * A8). The list is closed: there is no delete, no archive and no export, which the agent's key
 * could not do anyway (ADR-0005). The limits are the CRM API's (ADR-0007 D9), repeated here
 * because apps/circuit never imports the CRM's code (ADR-0003 M3); `database/test/crm-limits.test.ts`
 * reads them from the CRM's schema and fails if they drift apart.
 */

export const SHORT_TEXT_MAX_LENGTH = 200;
export const NOTE_BODY_MAX_LENGTH = 4000;
/** The shape of a stage key, the same as the CRM's slugs. */
export const STAGE_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;
/** More than this is not a follow-up but a batch, and a batch is not what one request needs. */
export const MAX_ACTIONS = 5;

export const ACTION_TYPES = ['create_contact', 'update_contact', 'add_note', 'create_task', 'move_stage'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// Type aliases, not interfaces: an alias fits an event detail, which only holds JSON.
/** The email is the one station 2 took out of the text, never one the model wrote (D4). */
export type CreateContact = {
  readonly type: 'create_contact';
  readonly fullName: string;
  readonly email: string;
};
export type UpdateContact = {
  readonly type: 'update_contact';
  readonly fullName: string;
};
export type AddNote = {
  readonly type: 'add_note';
  readonly body: string;
};
export type CreateTask = {
  readonly type: 'create_task';
  readonly title: string;
  readonly dueOn: string | null;
};
export type MoveStage = {
  readonly type: 'move_stage';
  readonly stage: string;
};
export type CrmAction = CreateContact | UpdateContact | AddNote | CreateTask | MoveStage;

/** What the actions may assume about the request's contact. */
export interface ActionContext {
  /** Station 5 found the contact by the request's email. */
  readonly contactKnown: boolean;
  /** The email station 2 took out of the text, or null when the text had none. */
  readonly email: string | null;
}

/**
 * The actions as the core accepts them, or InvalidInput naming the first field that failed.
 * Fields the list does not name are left out, so a reply cannot smuggle anything through.
 * Every action works on the request's contact: an existing one, or the one a create_contact
 * at the head of the list makes. Nothing names another contact.
 */
export function validateActions(value: unknown, context: ActionContext): CrmAction[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) throw new InvalidInput('actions');
  return value.map((raw: unknown, index) => {
    const field = `actions[${index}]`;
    if (!isRecord(raw)) throw new InvalidInput(field);
    const type = requireOneOf(raw['type'], `${field}.type`, ACTION_TYPES);
    if (type === 'create_contact') {
      // Only first, only once, only when the CRM has no contact for that email, and only with
      // an email to give it: otherwise it would make a duplicate or a contact nobody can reach.
      if (index !== 0 || context.contactKnown || context.email === null) throw new InvalidInput(`${field}.type`);
      // The same check parseStoredActions makes: a proposal it could not read back would leave
      // the run at station 6 for good (audit of ADR-0010, H3).
      const email = requireStorableEmail(context.email, `${field}.email`);
      return { type, fullName: requireText(raw['fullName'], `${field}.fullName`, SHORT_TEXT_MAX_LENGTH), email };
    }
    if (!context.contactKnown && !startsWithCreate(value)) throw new InvalidInput(`${field}.type`);
    return actionOn(type, raw, field);
  });
}

function startsWithCreate(actions: readonly unknown[]): boolean {
  const first = actions[0];
  return isRecord(first) && first['type'] === 'create_contact';
}

function actionOn(type: Exclude<ActionType, 'create_contact'>, raw: Readonly<Record<string, unknown>>, field: string): CrmAction {
  switch (type) {
    case 'update_contact':
      return { type, fullName: requireText(raw['fullName'], `${field}.fullName`, SHORT_TEXT_MAX_LENGTH) };
    case 'add_note':
      return { type, body: requireText(raw['body'], `${field}.body`, NOTE_BODY_MAX_LENGTH) };
    case 'create_task': {
      const dueOn = raw['dueOn'] === undefined || raw['dueOn'] === null ? null : requireIsoDate(raw['dueOn'], `${field}.dueOn`);
      return { type, title: requireText(raw['title'], `${field}.title`, SHORT_TEXT_MAX_LENGTH), dueOn };
    }
    case 'move_stage':
      return { type, stage: requirePattern(raw['stage'], `${field}.stage`, STAGE_KEY_PATTERN) };
  }
}

/** The floor the CRM's contacts_email_shape enforces, and its length limit. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;
export const EMAIL_MAX_LENGTH = 254;

function requireStorableEmail(value: unknown, field: string): string {
  const email = requireText(value, field, EMAIL_MAX_LENGTH);
  if (!EMAIL_SHAPE.test(email)) throw new InvalidInput(field);
  return email;
}

/**
 * Actions read back from a stored event (station 5's proposal, or the mentor's decision).
 * They passed validateActions before they were stored; this checks them again, because what
 * comes out of a store is data like any other, and it keeps the email a create_contact holds.
 */
export function parseStoredActions(value: unknown): CrmAction[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) throw new InvalidInput('actions');
  return value.map((raw: unknown, index) => {
    const field = `actions[${index}]`;
    if (!isRecord(raw)) throw new InvalidInput(field);
    const type = requireOneOf(raw['type'], `${field}.type`, ACTION_TYPES);
    if (type !== 'create_contact') return actionOn(type, raw, field);
    if (index !== 0) throw new InvalidInput(`${field}.type`);
    const email = requireStorableEmail(raw['email'], `${field}.email`);
    return { type, fullName: requireText(raw['fullName'], `${field}.fullName`, SHORT_TEXT_MAX_LENGTH), email };
  });
}

/** The email a stored create_contact holds, or null: the only email a correction may use. */
export function emailOf(actions: readonly CrmAction[]): string | null {
  const first = actions[0];
  return first?.type === 'create_contact' ? first.email : null;
}
