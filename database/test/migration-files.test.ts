import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, REPO_ROOT } from '../config.js';
import { checkJournal, findDestructiveStatements, readMigrationFolder } from './migration-rules.js';

// The rules from migration-rules.ts, run on the real migration folder. No database needed.

const MIGRATIONS_PATH = join(REPO_ROOT, MIGRATIONS_DIR);
const folder = readMigrationFolder(MIGRATIONS_PATH);

describe('database/migrations', () => {
  // Without this, an empty or misplaced folder would pass every check below.
  it('holds at least one migration', () => {
    expect(folder.sqlFiles.length).toBeGreaterThan(0);
  });

  it('matches its journal, in order', () => {
    expect(checkJournal(folder.journal, folder.sqlFiles)).toEqual({
      unlisted: [],
      missing: [],
      outOfOrder: [],
    });
  });

  it.each(folder.sqlFiles)('%s only moves forward', (file) => {
    const sql = readFileSync(join(MIGRATIONS_PATH, file), 'utf8');
    expect(findDestructiveStatements(sql)).toEqual([]);
  });
});
