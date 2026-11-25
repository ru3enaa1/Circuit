import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';

import { MAX_PAGE_SIZE } from '../server/limits.ts';
import type { Scope } from './read-scope.ts';
import { auditLog, companies, contacts, notes, pipelineStages, tasks } from './schema.ts';

// ADR-0006 D12: what each read returns, as fixed lists of columns. The keys of these objects
// are the keys of the JSON: never account_id, never archived_at. Archived rows are not
// returned (pregunta 2). Every query filters by the key's account even though RLS does too
// (ADR-0005 D4): the filter matches the indexes, and RLS stays the barrier behind it.
// ADR-0007 D13: the writes answer with these same lists, and the audit log with its own.

const STAGE = {
  id: pipelineStages.id,
  key: pipelineStages.key,
  label: pipelineStages.label,
  position: pipelineStages.position,
};

export const CONTACT = {
  id: contacts.id,
  fullName: contacts.fullName,
  email: contacts.email,
  companyId: contacts.companyId,
  stageId: contacts.stageId,
  createdAt: contacts.createdAt,
};

const COMPANY = {
  id: companies.id,
  name: companies.name,
  industry: companies.industry,
  sizeRange: companies.sizeRange,
  revenueRange: companies.revenueRange,
  createdAt: companies.createdAt,
};

export const NOTE = { id: notes.id, body: notes.body, createdAt: notes.createdAt };

export const TASK = {
  id: tasks.id,
  title: tasks.title,
  dueOn: tasks.dueOn,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
};

/** Newest first, by id; `before` is the smallest id of the previous page. */
export interface Page {
  readonly limit: number;
  readonly before: number | undefined;
}

/** The stages of a pipeline are a short, ordered list that the seed brings; no pagination. */
export function listStages(scope: Scope) {
  return scope.db
    .select(STAGE)
    .from(pipelineStages)
    .where(eq(pipelineStages.accountId, scope.accountId))
    .orderBy(asc(pipelineStages.position))
    .limit(MAX_PAGE_SIZE);
}

/** At most one: the email is unique among an account's active contacts (ADR-0005). */
export function findContactsByEmail(scope: Scope, email: string) {
  return scope.db
    .select(CONTACT)
    .from(contacts)
    .where(and(eq(contacts.accountId, scope.accountId), eq(contacts.email, email), isNull(contacts.archivedAt)))
    .limit(1);
}

export async function findContact(scope: Scope, contactId: number) {
  const found = await scope.db
    .select(CONTACT)
    .from(contacts)
    .where(and(eq(contacts.accountId, scope.accountId), eq(contacts.id, contactId), isNull(contacts.archivedAt)));
  return found[0];
}

export async function findCompany(scope: Scope, companyId: number) {
  const found = await scope.db
    .select(COMPANY)
    .from(companies)
    .where(and(eq(companies.accountId, scope.accountId), eq(companies.id, companyId), isNull(companies.archivedAt)));
  return found[0];
}

export function listNotes(scope: Scope, contactId: number, page: Page) {
  return scope.db
    .select(NOTE)
    .from(notes)
    .where(
      and(
        eq(notes.accountId, scope.accountId),
        eq(notes.contactId, contactId),
        isNull(notes.archivedAt),
        page.before === undefined ? undefined : lt(notes.id, page.before),
      ),
    )
    .orderBy(desc(notes.id))
    .limit(page.limit);
}

export function listTasks(scope: Scope, contactId: number, page: Page) {
  return scope.db
    .select(TASK)
    .from(tasks)
    .where(
      and(
        eq(tasks.accountId, scope.accountId),
        eq(tasks.contactId, contactId),
        isNull(tasks.archivedAt),
        page.before === undefined ? undefined : lt(tasks.id, page.before),
      ),
    )
    .orderBy(desc(tasks.id))
    .limit(page.limit);
}

/** A stage of the key's account, by id; stages are never archived. */
export async function findStage(scope: Scope, stageId: number) {
  const found = await scope.db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.accountId, scope.accountId), eq(pipelineStages.id, stageId)));
  return found[0];
}

/**
 * ADR-0007 D13: an entry of the audit trail, never its account. changedColumns holds the
 * database's column names, as the trigger writes them (pregunta 7).
 */
const AUDIT_ENTRY = {
  id: auditLog.id,
  occurredAt: auditLog.occurredAt,
  tableName: auditLog.tableName,
  rowId: auditLog.rowId,
  operation: auditLog.operation,
  changedColumns: auditLog.changedColumns,
  apiKeyId: auditLog.apiKeyId,
  proposedBy: auditLog.proposedBy,
  approvedBy: auditLog.approvedBy,
  approvalRef: auditLog.approvalRef,
};

/** Newest first, paged like the notes; the audit trail only grows (ADR-0005 D9). */
export function listAuditLog(scope: Scope, page: Page) {
  return scope.db
    .select(AUDIT_ENTRY)
    .from(auditLog)
    .where(and(eq(auditLog.accountId, scope.accountId), page.before === undefined ? undefined : lt(auditLog.id, page.before)))
    .orderBy(desc(auditLog.id))
    .limit(page.limit);
}
