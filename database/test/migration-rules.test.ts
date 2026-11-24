import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkJournal,
  checkMigrationHashes,
  findCredentialClauses,
  findDestructiveStatements,
  hashMigrations,
  parseJournal,
  type JournalEntry,
} from './migration-rules.js';

// Positive and negative controls for the rules: each check must catch its planted violation
// and must not fire on the harmless statement that looks like it.

describe('findDestructiveStatements', () => {
  it.each([
    'DROP TABLE crm.contacts;',
    'drop schema crm cascade;',
    'ALTER TABLE crm.contacts DROP COLUMN email;',
    'DROP\n  TABLE crm.notes;',
    'DROP MATERIALIZED VIEW circuit.totals;',
    'TRUNCATE crm.tasks;',
    'DELETE FROM crm.tasks WHERE id = 1;',
    '-- DROP TABLE crm.contacts;',
  ])('flags %j', (sql) => {
    expect(findDestructiveStatements(sql)).toHaveLength(1);
  });

  it.each([
    'CREATE SCHEMA "crm";',
    'ALTER TABLE crm.contacts ALTER COLUMN email DROP DEFAULT;',
    'ALTER TABLE crm.contacts ALTER COLUMN email DROP NOT NULL;',
    'ALTER TABLE crm.contacts DROP CONSTRAINT contacts_email_unique;',
    'DROP INDEX crm.contacts_email_idx;',
    'ALTER TABLE crm.contacts ADD COLUMN dropped_at timestamptz;',
    'CREATE TABLE crm.drop_table_log (id integer);',
    'ALTER TABLE crm.tasks ADD COLUMN deleted_from text;',
  ])('does not flag %j', (sql) => {
    expect(findDestructiveStatements(sql)).toEqual([]);
  });

  it('reports every statement it finds', () => {
    expect(findDestructiveStatements('DROP TABLE a; TRUNCATE b;')).toEqual(['DROP TABLE', 'TRUNCATE']);
  });
});

describe('findCredentialClauses', () => {
  it.each([
    'CREATE ROLE crm_app LOGIN;',
    'create role crm_app with login;',
    "ALTER ROLE crm_service PASSWORD 'x';",
    "CREATE ROLE crm_app WITH LOGIN PASSWORD 'x';",
    'ALTER ROLE crm_service\n  LOGIN;',
    '-- the password lives in .env',
  ])('flags %j', (sql) => {
    expect(findCredentialClauses(sql).length).toBeGreaterThan(0);
  });

  it.each([
    'CREATE ROLE crm_service NOLOGIN;',
    'SELECT rolcanlogin FROM pg_catalog.pg_roles;',
    'CREATE TABLE crm.logins_seen (id bigint);',
    'ALTER TABLE crm.api_keys ADD COLUMN password_hash bytea;',
  ])('does not flag %j', (sql) => {
    expect(findCredentialClauses(sql)).toEqual([]);
  });
});

describe('checkJournal', () => {
  const entries: readonly JournalEntry[] = [
    { idx: 0, tag: '0000_init', when: 1000 },
    { idx: 1, tag: '0001_contacts', when: 2000 },
  ];
  const files = ['0000_init.sql', '0001_contacts.sql'];

  it('accepts a journal that matches its files', () => {
    expect(checkJournal(entries, files)).toEqual({ unlisted: [], missing: [], outOfOrder: [] });
  });

  it('catches a SQL file the journal does not list', () => {
    expect(checkJournal(entries, [...files, '0002_planted.sql']).unlisted).toEqual(['0002_planted.sql']);
  });

  it('catches a journal entry without its file', () => {
    expect(checkJournal(entries, ['0000_init.sql']).missing).toEqual(['0001_contacts.sql']);
  });

  it('catches an entry that is not newer than the previous one', () => {
    const stale = [entries[0]!, { idx: 1, tag: '0001_contacts', when: 1000 }];
    expect(checkJournal(stale, files).outOfOrder).toEqual(['0001_contacts']);
  });

  it('catches a gap in the sequence', () => {
    const gap = [entries[0]!, { idx: 2, tag: '0001_contacts', when: 2000 }];
    expect(checkJournal(gap, files).outOfOrder).toEqual(['0001_contacts']);
  });
});

describe('checkMigrationHashes', () => {
  const pinned = { '0000_init': 'aaa', '0001_contacts': 'bbb' };

  it('accepts files that match their pinned hashes', () => {
    expect(checkMigrationHashes(pinned, { ...pinned })).toEqual({ edited: [], unpinned: [], orphaned: [] });
  });

  it('catches an edited migration', () => {
    expect(checkMigrationHashes(pinned, { ...pinned, '0000_init': 'ccc' }).edited).toEqual(['0000_init']);
  });

  it('catches a new migration without its pinned hash', () => {
    expect(checkMigrationHashes(pinned, { ...pinned, '0002_new': 'ddd' }).unpinned).toEqual(['0002_new']);
  });

  it('catches a pinned migration that is gone', () => {
    expect(checkMigrationHashes(pinned, { '0000_init': 'aaa' }).orphaned).toEqual(['0001_contacts']);
  });
});

describe('hashMigrations', () => {
  it('gives the SHA-256 of each file in the journal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuit-hash-'));
    try {
      writeFileSync(join(dir, '0000_abc.sql'), 'abc');
      // FIPS 180-2, appendix B.1: the digest of "abc".
      expect(hashMigrations(dir, [{ idx: 0, tag: '0000_abc', when: 1000 }])).toEqual({
        '0000_abc': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseJournal', () => {
  it('reads the entries drizzle-kit writes', () => {
    const text = JSON.stringify({
      version: '7',
      entries: [{ idx: 0, version: '7', when: 1000, tag: '0000_init', breakpoints: true }],
    });
    expect(parseJournal(text)).toEqual([{ idx: 0, tag: '0000_init', when: 1000 }]);
  });

  it.each([
    ['no entries list', '{}'],
    ['an entry without a tag', '{"entries":[{"idx":0,"when":1000}]}'],
  ])('rejects %s', (_case, text) => {
    expect(() => parseJournal(text)).toThrow();
  });
});
