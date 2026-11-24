import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// The CRM owns its tables (ADR-0003 M3, ADR-0005). drizzle-kit reads this file next to
// database/schema.ts and writes the migrations into database/migrations, one history for
// the whole repository. What drizzle-kit cannot express — roles, grants, row-level security,
// the audit trigger and the key lookup — lives in the hand-written 0002_crm_security.sql.
// Never run `drizzle-kit push`: it would drop what that migration adds.

export const crm = pgSchema('crm');

/** Names, titles and labels: room for any real one, too short to hold a document. */
export const SHORT_TEXT_MAX_LENGTH = 200;
/** A note is a paragraph or two of follow-up, not a transcript of the conversation. */
export const NOTE_BODY_MAX_LENGTH = 4000;
/** RFC 5321 §4.5.3.1.3 caps a path at 256 octets, angle brackets included: 254 for the address. */
export const EMAIL_MAX_LENGTH = 254;
/** Account slugs and stage keys end up in URLs and in code: lowercase ASCII, digits, hyphens. */
export const SLUG_PATTERN = '^[a-z0-9-]{1,40}$';
/** Keys are stored only as their SHA-256 digest (ADR-0005 D10). */
export const API_KEY_HASH_BYTES = 32;
/** Closed set (D11). The agent's key gets read and write only; F1.4 proves the other two fail. */
export const API_KEY_PERMISSIONS = ['read', 'write', 'delete', 'export'] as const;
/** Every insert or update on these tables leaves an audit row, written by a trigger (D7). */
export const AUDITED_TABLES = ['companies', 'contacts', 'notes', 'tasks'] as const;
/** Nothing is deleted (D6), so an audit row records one of these two. */
export const AUDIT_OPERATIONS = ['insert', 'update'] as const;

// Every fragment below is built from the constants above and literal column names, never
// from input, so sql.raw is safe. sql`` would turn the numbers into bind parameters, which a
// CHECK constraint cannot hold.
function lengthBetween(column: string, max: number): SQL {
  return sql.raw(`char_length(${column}) BETWEEN 1 AND ${max}`);
}

function oneOf(column: string, values: readonly string[]): SQL {
  return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(', ')})`);
}

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// Builders are mutable, so each column gets a fresh one.
// bigint identity and not uuid: on a fresh database the same seed and the same input give
// the same ids (CLAUDE.md, Reproducible). RLS keeps sequential ids from leaking across
// accounts (D4).
const identityId = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const accountId = () => bigint('account_id', { mode: 'number' }).notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
// Deleting is archiving (D6): the row stays, and the audit trail keeps pointing at it.
const archivedAt = () => timestamp('archived_at', { withTimezone: true });

/** The CRM's tenant: one school per account. The agent's key never sees another one. */
export const accounts = crm.table(
  'accounts',
  {
    id: identityId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('accounts_slug_key').on(t.slug),
    check('accounts_slug_format', sql.raw(`slug ~ '${SLUG_PATTERN}'`)),
    check('accounts_name_length', lengthBetween('name', SHORT_TEXT_MAX_LENGTH)),
  ],
);

export const apiKeys = crm.table(
  'api_keys',
  {
    id: identityId(),
    accountId: accountId(),
    label: text('label').notNull(),
    keyHash: bytea('key_hash').notNull(),
    permissions: text('permissions').array().notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: 'api_keys_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    // Target of the composite foreign key from audit_log (D3).
    unique('api_keys_account_id_id_key').on(t.accountId, t.id),
    unique('api_keys_key_hash_key').on(t.keyHash),
    check('api_keys_key_hash_length', sql.raw(`octet_length(key_hash) = ${API_KEY_HASH_BYTES}`)),
    check(
      'api_keys_permissions_valid',
      // array_ndims is NULL for an empty array, so '{}' fails here too.
      sql.raw(
        `cardinality(permissions) > 0 AND array_ndims(permissions) = 1 AND permissions <@ ARRAY[${API_KEY_PERMISSIONS.map(
          (permission) => `'${permission}'`,
        ).join(', ')}]::text[]`,
      ),
    ),
    check('api_keys_label_length', lengthBetween('label', SHORT_TEXT_MAX_LENGTH)),
  ],
);

/** Rows per account that the scenario's seed brings, not an enum: the core stays generic. */
export const pipelineStages = crm.table(
  'pipeline_stages',
  {
    id: identityId(),
    accountId: accountId(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    foreignKey({ name: 'pipeline_stages_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    unique('pipeline_stages_account_id_id_key').on(t.accountId, t.id),
    unique('pipeline_stages_account_id_key_key').on(t.accountId, t.key),
    unique('pipeline_stages_account_id_position_key').on(t.accountId, t.position),
    check('pipeline_stages_key_format', sql.raw(`key ~ '${SLUG_PATTERN}'`)),
    check('pipeline_stages_label_length', lengthBetween('label', SHORT_TEXT_MAX_LENGTH)),
    check('pipeline_stages_position_range', sql.raw('position >= 0')),
  ],
);

/** The prospect's company, not the CRM's tenant (that is an account). No personal data. */
export const companies = crm.table(
  'companies',
  {
    id: identityId(),
    accountId: accountId(),
    name: text('name').notNull(),
    industry: text('industry'),
    sizeRange: text('size_range'),
    revenueRange: text('revenue_range'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    foreignKey({ name: 'companies_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    unique('companies_account_id_id_key').on(t.accountId, t.id),
    check('companies_name_length', lengthBetween('name', SHORT_TEXT_MAX_LENGTH)),
    check('companies_industry_length', lengthBetween('industry', SHORT_TEXT_MAX_LENGTH)),
    check('companies_size_range_length', lengthBetween('size_range', SHORT_TEXT_MAX_LENGTH)),
    check('companies_revenue_range_length', lengthBetween('revenue_range', SHORT_TEXT_MAX_LENGTH)),
  ],
);

/**
 * The person who writes in. Name and email are the only personal data in the schema (D2).
 * The stage lives here because station 5 moves the contact through the pipeline.
 */
export const contacts = crm.table(
  'contacts',
  {
    id: identityId(),
    accountId: accountId(),
    companyId: bigint('company_id', { mode: 'number' }),
    stageId: bigint('stage_id', { mode: 'number' }).notNull(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    foreignKey({ name: 'contacts_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    // Composite with the account (D3): a contact cannot point at another account's company or
    // stage. A NULL company_id skips the check (MATCH SIMPLE), which is what "no company" means.
    foreignKey({
      name: 'contacts_company_fk',
      columns: [t.accountId, t.companyId],
      foreignColumns: [companies.accountId, companies.id],
    }),
    foreignKey({
      name: 'contacts_stage_fk',
      columns: [t.accountId, t.stageId],
      foreignColumns: [pipelineStages.accountId, pipelineStages.id],
    }),
    unique('contacts_account_id_id_key').on(t.accountId, t.id),
    // Station 5 looks a contact up by email; an archived contact frees the address.
    uniqueIndex('contacts_account_email_active_key')
      .on(t.accountId, t.email)
      .where(sql.raw('archived_at IS NULL')),
    check('contacts_full_name_length', lengthBetween('full_name', SHORT_TEXT_MAX_LENGTH)),
    check('contacts_email_length', lengthBetween('email', EMAIL_MAX_LENGTH)),
    // Stored lowercase so the unique index compares addresses, not their spelling.
    check('contacts_email_lowercase', sql.raw('email = lower(email)')),
    // A floor, not validation: zod validates in F1.2; this only refuses what is not an address.
    check('contacts_email_shape', sql.raw(`email ~ '^[^@[:space:]]+@[^@[:space:]]+$'`)),
  ],
);

export const notes = crm.table(
  'notes',
  {
    id: identityId(),
    accountId: accountId(),
    contactId: bigint('contact_id', { mode: 'number' }).notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    foreignKey({ name: 'notes_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    foreignKey({
      name: 'notes_contact_fk',
      columns: [t.accountId, t.contactId],
      foreignColumns: [contacts.accountId, contacts.id],
    }),
    index('notes_account_id_contact_id_idx').on(t.accountId, t.contactId),
    check('notes_body_length', lengthBetween('body', NOTE_BODY_MAX_LENGTH)),
  ],
);

export const tasks = crm.table(
  'tasks',
  {
    id: identityId(),
    accountId: accountId(),
    contactId: bigint('contact_id', { mode: 'number' }).notNull(),
    title: text('title').notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    foreignKey({ name: 'tasks_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    foreignKey({
      name: 'tasks_contact_fk',
      columns: [t.accountId, t.contactId],
      foreignColumns: [contacts.accountId, contacts.id],
    }),
    index('tasks_account_id_contact_id_idx').on(t.accountId, t.contactId),
    check('tasks_title_length', lengthBetween('title', SHORT_TEXT_MAX_LENGTH)),
  ],
);

/**
 * Who proposed and who approved each write (CLAUDE.md: every CRM write is logged). Written
 * only by the trigger in 0002; it records column names, never values (D7), so archiving a
 * contact does not leave its email behind in a table nothing can delete from.
 */
export const auditLog = crm.table(
  'audit_log',
  {
    id: identityId(),
    accountId: accountId(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    tableName: text('table_name').notNull(),
    rowId: bigint('row_id', { mode: 'number' }).notNull(),
    operation: text('operation').notNull(),
    changedColumns: text('changed_columns').array().notNull(),
    // NULL for writes made without a key: the seed (F1.5).
    apiKeyId: bigint('api_key_id', { mode: 'number' }),
    proposedBy: text('proposed_by').notNull(),
    approvedBy: text('approved_by').notNull(),
    approvalRef: text('approval_ref'),
  },
  (t) => [
    foreignKey({ name: 'audit_log_account_fk', columns: [t.accountId], foreignColumns: [accounts.id] }),
    // A key from another account cannot sign a write in this one.
    foreignKey({
      name: 'audit_log_api_key_fk',
      columns: [t.accountId, t.apiKeyId],
      foreignColumns: [apiKeys.accountId, apiKeys.id],
    }),
    index('audit_log_account_id_table_name_row_id_idx').on(t.accountId, t.tableName, t.rowId),
    check('audit_log_table_name_valid', oneOf('table_name', AUDITED_TABLES)),
    check('audit_log_operation_valid', oneOf('operation', AUDIT_OPERATIONS)),
    check('audit_log_proposed_by_length', lengthBetween('proposed_by', SHORT_TEXT_MAX_LENGTH)),
    check('audit_log_approved_by_length', lengthBetween('approved_by', SHORT_TEXT_MAX_LENGTH)),
    check('audit_log_approval_ref_length', lengthBetween('approval_ref', SHORT_TEXT_MAX_LENGTH)),
  ],
);
