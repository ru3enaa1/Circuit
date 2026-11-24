import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rules every migration folder must keep. They are plain functions so migration-rules.test.ts
// can feed them planted violations, and migration-files.test.ts runs them on the real folder.

// Statements that destroy data or the objects that hold it. Migrations only move forward
// (CLAUDE.md §7). Comments are scanned too, on purpose: a false alarm on a comment costs a
// rewording, while stripping comments could hide a statement after a `--` inside a string.
// A removal that cannot be avoided needs a row-count guard and a reviewed exception here.
const DESTRUCTIVE_STATEMENT =
  /\b(?:DROP\s+(?:TABLE|SCHEMA|COLUMN|DATABASE|MATERIALIZED\s+VIEW|VIEW|TYPE|SEQUENCE|ROLE|OWNED)|TRUNCATE|DELETE\s+FROM)\b/gi;

export function findDestructiveStatements(sql: string): readonly string[] {
  return Array.from(sql.matchAll(DESTRUCTIVE_STATEMENT), (match) => match[0]);
}

// A role that can log in, or a password, never comes from a migration: migrations are
// public, and the users that connect get their passwords from .env (ADR-0005 D14). NOLOGIN
// and catalog columns such as rolcanlogin do not match, because the word must stand alone.
// Comments are scanned too, for the same reason as above.
const CREDENTIAL_CLAUSE = /\b(?:LOGIN|PASSWORD)\b/gi;

export function findCredentialClauses(sql: string): readonly string[] {
  return Array.from(sql.matchAll(CREDENTIAL_CLAUSE), (match) => match[0]);
}

export interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  /** Creation time in ms. Drizzle applies only migrations newer than the last one applied. */
  readonly when: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEntry(raw: unknown, position: number): JournalEntry {
  if (
    !isRecord(raw) ||
    typeof raw['idx'] !== 'number' ||
    typeof raw['tag'] !== 'string' ||
    typeof raw['when'] !== 'number'
  ) {
    throw new Error(`Entrada ${position} del journal sin idx, tag o when válidos.`);
  }
  return { idx: raw['idx'], tag: raw['tag'], when: raw['when'] };
}

export function parseJournal(text: string): readonly JournalEntry[] {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !Array.isArray(data['entries'])) {
    throw new Error('El journal de migraciones no tiene una lista "entries".');
  }
  return data['entries'].map(parseEntry);
}

export interface JournalMismatch {
  /** SQL files the journal does not list: drizzle skips them without a word. */
  readonly unlisted: readonly string[];
  /** Journal entries without their SQL file: drizzle fails on them. */
  readonly missing: readonly string[];
  /** Entries out of sequence or not newer than the previous one: drizzle would skip them. */
  readonly outOfOrder: readonly string[];
}

export function checkJournal(
  entries: readonly JournalEntry[],
  sqlFiles: readonly string[],
): JournalMismatch {
  const listed = new Set(entries.map((entry) => `${entry.tag}.sql`));
  const present = new Set(sqlFiles);
  return {
    unlisted: sqlFiles.filter((file) => !listed.has(file)),
    missing: [...listed].filter((file) => !present.has(file)),
    outOfOrder: entries
      .filter((entry, position) => {
        const previous = entries[position - 1];
        return entry.idx !== position || (previous !== undefined && entry.when <= previous.when);
      })
      .map((entry) => entry.tag),
  };
}

/** Migration tag → SHA-256 in hex. */
export type MigrationHashes = Readonly<Record<string, string>>;

export interface HashMismatch {
  /** Pinned migrations whose file changed: a migration that may already be applied was edited. */
  readonly edited: readonly string[];
  /** Journal entries without a pinned hash: a new migration must add its line. */
  readonly unpinned: readonly string[];
  /** Pinned hashes without a journal entry: a migration was renamed or removed. */
  readonly orphaned: readonly string[];
}

/**
 * Drizzle records this same hash (the SHA-256 of the file read as UTF-8) in
 * drizzle.__drizzle_migrations, but never compares it again: an edited migration would leave
 * every database that already ran it different from a new one, without a word (audit H6).
 */
export function hashMigrations(dir: string, entries: readonly JournalEntry[]): MigrationHashes {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.tag,
      createHash('sha256').update(readFileSync(join(dir, `${entry.tag}.sql`), 'utf8')).digest('hex'),
    ]),
  );
}

export function checkMigrationHashes(pinned: MigrationHashes, actual: MigrationHashes): HashMismatch {
  const pinnedTags = Object.keys(pinned);
  const actualTags = Object.keys(actual);
  return {
    edited: pinnedTags.filter((tag) => Object.hasOwn(actual, tag) && actual[tag] !== pinned[tag]),
    unpinned: actualTags.filter((tag) => !Object.hasOwn(pinned, tag)),
    orphaned: pinnedTags.filter((tag) => !Object.hasOwn(actual, tag)),
  };
}

export interface MigrationFolder {
  readonly sqlFiles: readonly string[];
  readonly journal: readonly JournalEntry[];
}

export function readMigrationFolder(dir: string): MigrationFolder {
  return {
    sqlFiles: readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort(),
    journal: parseJournal(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')),
  };
}
