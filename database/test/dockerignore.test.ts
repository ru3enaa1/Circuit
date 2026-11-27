import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../config.ts';

// ADR-0020 D7: what enters the image is a list of what is allowed, so a new secret file in the
// clone stays out without anyone remembering to exclude it (plan F6: no secret in the image).

/** What must never reach the build context, whatever is allowed back in. */
const NEVER = ['.env', '.secrets/crm-agent-key', 'docs/privado/propuesta.md', 'database/backups/x/circuit.dump', 'database/dev/x', 'node_modules/x', '.git/config', 'forbidden-phrases.local.txt', '.coderachnid/HANDOFF.md', 'apps/board/dist/index.html'];
/** What the image needs: without it, npm ci, the board's build or a service would fail. */
const NEEDED = ['package.json', 'package-lock.json', '.npmrc', 'apps/crm/src/main.ts', 'apps/circuit/src/main.ts', 'apps/board/index.html', 'database/seed.ts', 'database/migrations/0000_init.sql', 'drizzle.config.ts', 'scenarios/escuela/crm.json', 'docker/with-secrets.sh', 'tsconfig.base.json'];

interface Rule {
  readonly allow: boolean;
  readonly pattern: RegExp;
}

/** Docker's rules for what this file uses: `*` and `**`, a leading `!`, and a match on the path or a parent. */
function rulesOf(text: string): readonly Rule[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const allow = line.startsWith('!');
      const glob = (allow ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
      const source = glob
        .split('**')
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
        .join('.*');
      return { allow, pattern: new RegExp(`^${source}(/.*)?$`) };
    });
}

/** The last rule that matches decides, as in Docker. */
function sentToDocker(rules: readonly Rule[], path: string): boolean {
  let sent = true;
  for (const rule of rules) if (rule.pattern.test(path)) sent = rule.allow;
  return sent;
}

describe('ADR-0020 D7 · .dockerignore', () => {
  const text = readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf8');
  const rules = rulesOf(text);

  it('starts by leaving everything out', () => {
    expect(rules[0]).toEqual({ allow: false, pattern: rulesOf('*')[0]?.pattern });
  });

  it.each(NEVER)('never sends %s', (path) => {
    expect(sentToDocker(rules, path)).toBe(false);
  });

  it.each(NEEDED)('sends %s, which the image needs', (path) => {
    expect(existsSync(join(REPO_ROOT, path)), `${path} existe en el clon`).toBe(true);
    expect(sentToDocker(rules, path)).toBe(true);
  });

  it('(control) the reading of the rules bites: without the leading *, .env would be sent', () => {
    expect(sentToDocker(rules.slice(1), 'forbidden-phrases.local.txt')).toBe(true);
  });
});
