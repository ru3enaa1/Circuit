import { and, DrizzleQueryError, eq, isNull, sql } from 'drizzle-orm';
import pg from 'pg';

import { ApiError } from '../server/errors.ts';
import type { Scope } from './scope.ts';
import { CONTACT, findCompany, findContact, findStage, NOTE, TASK } from './reads.ts';
import { contacts, notes, tasks } from './schema.ts';

// ADR-0007: what each write does, inside the transaction of withWriteScope, which has already
// set the account and the authors. The trigger of 0002 writes the audit row in that same
// transaction (D6). The account always comes from the key (scope.accountId), never from the
// request; id and created_at are never sent, so drizzle writes them as `default` (D8); and an
// update assigns only the columns listed here.

/** The index that keeps an address unique among an account's active contacts (0001). */
const ACTIVE_EMAIL_INDEX = 'contacts_account_email_active_key';
const UNIQUE_VIOLATION = '23505';

export interface NewContact {
  readonly fullName: string;
  readonly email: string;
  readonly stageId: number;
  readonly companyId?: number | null | undefined;
}

export interface ContactChanges {
  readonly fullName?: string | undefined;
  readonly email?: string | undefined;
  readonly stageId?: number | undefined;
  readonly companyId?: number | null | undefined;
}

export interface NewTask {
  readonly title: string;
  readonly dueOn?: string | undefined;
}

/**
 * D11: the unique index is the barrier, not a lookup made first, which another request could
 * beat. drizzle-orm 0.45.4 wraps the driver's error in a DrizzleQueryError, so the code and the
 * index are read from its cause; the wrapper's message holds the statement's values and is
 * never read (CLAUDE.md §8).
 */
function isActiveEmailTaken(error: unknown): boolean {
  const source = error instanceof DrizzleQueryError ? error.cause : error;
  return source instanceof pg.DatabaseError && source.code === UNIQUE_VIOLATION && source.constraint === ACTIVE_EMAIL_INDEX;
}

/** A write that may repeat an active address: 409 for that, and any other error as it came (D12). */
async function guardEmail<T>(statement: PromiseLike<T>): Promise<T> {
  try {
    return await statement;
  } catch (error) {
    if (isActiveEmailTaken(error)) throw new ApiError('ya_existe');
    throw error;
  }
}

/**
 * D10: a stage or a company the key's account cannot see, or an archived company, is a field
 * of the request that is wrong: 400 naming it, the same for another account and for an id that
 * does not exist. The composite foreign keys stay behind this as the barrier.
 */
async function checkReferences(scope: Scope, references: { readonly stageId?: number | undefined; readonly companyId?: number | null | undefined }) {
  if (references.stageId !== undefined && (await findStage(scope, references.stageId)) === undefined) {
    throw new ApiError('entrada_invalida', 'stageId');
  }
  // null takes the company away, so there is nothing to look up.
  if (typeof references.companyId === 'number' && (await findCompany(scope, references.companyId)) === undefined) {
    throw new ApiError('entrada_invalida', 'companyId');
  }
}

/** D10: the contact of the route, active and of the key's account, or 404 the same in each case. */
async function activeContactId(scope: Scope, contactId: number): Promise<number> {
  const contact = await findContact(scope, contactId);
  if (contact === undefined) throw new ApiError('no_encontrado');
  return contact.id;
}

function onlyOne<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('Una escritura con RETURNING no devolvió su fila.');
  return row;
}

export async function createContact(scope: Scope, contact: NewContact) {
  await checkReferences(scope, contact);
  const rows = await guardEmail(
    scope.db
      .insert(contacts)
      .values({
        accountId: scope.accountId,
        stageId: contact.stageId,
        companyId: contact.companyId ?? null,
        fullName: contact.fullName,
        email: contact.email,
      })
      .returning(CONTACT),
  );
  return onlyOne(rows);
}

/**
 * Only the fields the request named; the rest stay as they are. The filter on archived_at
 * also guards a contact archived after the route was read. A change that changes no value is
 * still a write, with an empty changed_columns (D6, pregunta 5).
 */
export async function updateContact(scope: Scope, contactId: number, changes: ContactChanges) {
  await checkReferences(scope, changes);
  const rows = await guardEmail(
    scope.db
      .update(contacts)
      .set({
        ...(changes.fullName === undefined ? {} : { fullName: changes.fullName }),
        ...(changes.email === undefined ? {} : { email: changes.email }),
        ...(changes.stageId === undefined ? {} : { stageId: changes.stageId }),
        ...(changes.companyId === undefined ? {} : { companyId: changes.companyId }),
      })
      .where(and(eq(contacts.accountId, scope.accountId), eq(contacts.id, contactId), isNull(contacts.archivedAt)))
      .returning(CONTACT),
  );
  if (rows[0] === undefined) throw new ApiError('no_encontrado');
  return rows[0];
}

export async function addNote(scope: Scope, contactId: number, body: string) {
  const ownerId = await activeContactId(scope, contactId);
  const rows = await scope.db.insert(notes).values({ accountId: scope.accountId, contactId: ownerId, body }).returning(NOTE);
  return onlyOne(rows);
}

export async function addTask(scope: Scope, contactId: number, task: NewTask) {
  const ownerId = await activeContactId(scope, contactId);
  const rows = await scope.db
    .insert(tasks)
    .values({ accountId: scope.accountId, contactId: ownerId, title: task.title, dueOn: task.dueOn ?? null })
    .returning(TASK);
  return onlyOne(rows);
}

/**
 * Deleting is archiving (ADR-0005 D6), with the database's own clock. Only an active contact
 * is archived: archiving it again finds nothing, so it is 404 and leaves no second audit row.
 */
export async function archiveContact(scope: Scope, contactId: number): Promise<void> {
  const rows = await scope.db
    .update(contacts)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(contacts.accountId, scope.accountId), eq(contacts.id, contactId), isNull(contacts.archivedAt)))
    .returning({ id: contacts.id });
  if (rows[0] === undefined) throw new ApiError('no_encontrado');
}
