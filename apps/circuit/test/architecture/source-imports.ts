/**
 * Reads the import specifiers of a TypeScript file without a full parser.
 *
 * Why not a library: dependency-cruiser and typescript-eslint read code through the
 * TypeScript compiler API, and TypeScript 7.0.2 only exports its version at `typescript`
 * (the compiler API sits under `typescript/unstable/*`). A small scanner with its own tests
 * is cheaper than depending on an unstable API.
 *
 * It errs on the safe side: a commented-out import is ignored, but import-like text inside a
 * string may be reported. A false alarm is visible in the test output; a missed import is not.
 */

export type ImportKind = 'static' | 'dynamic' | 'require';

export interface ImportReference {
  readonly specifier: string;
  readonly kind: ImportKind;
}

export interface SourceImports {
  /** In source order, without repeats. */
  readonly imports: readonly ImportReference[];
  /** `import(x)` or `require(x)` whose target is not a literal: it hides a dependency. */
  readonly computed: number;
}

// `import x from 'a'`, `import type { T } from 'a'`, `export * from 'a'`, `export { x } from 'a'`.
const FROM_CLAUSE = /\bfrom\s*(['"])([^'"\r\n]+)\1/g;
// `import 'a'`, kept for its side effects.
const BARE_IMPORT = /\bimport\s*(['"])([^'"\r\n]+)\1/g;
// `import(...)` and `require(...)`; the argument is read separately to catch computed targets.
const CALL_IMPORT = /\b(import|require)\s*\(\s*/g;
// A literal argument: quotes or a backtick, then the closing parenthesis or an options comma.
const LITERAL_ARGUMENT = /^(['"`])([^'"`\r\n]*)\1\s*[,)]/;
const TEMPLATE_INTERPOLATION = '${';

export function readImports(source: string): SourceImports {
  const code = stripComments(source);
  const found: { readonly index: number; readonly ref: ImportReference }[] = [];

  for (const pattern of [FROM_CLAUSE, BARE_IMPORT]) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier !== undefined) {
        found.push({ index: match.index, ref: { specifier, kind: 'static' } });
      }
    }
  }

  let computed = 0;
  for (const match of code.matchAll(CALL_IMPORT)) {
    const kind: ImportKind = match[1] === 'require' ? 'require' : 'dynamic';
    const argument = LITERAL_ARGUMENT.exec(code.slice(match.index + match[0].length));
    const specifier = argument?.[2];
    if (specifier === undefined || specifier.includes(TEMPLATE_INTERPOLATION)) {
      computed += 1;
      continue;
    }
    found.push({ index: match.index, ref: { specifier, kind } });
  }

  return { imports: inSourceOrderWithoutRepeats(found), computed };
}

function inSourceOrderWithoutRepeats(
  found: readonly { readonly index: number; readonly ref: ImportReference }[],
): ImportReference[] {
  const seen = new Set<string>();
  return [...found]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.ref)
    .filter((ref) => {
      const key = `${ref.kind}:${ref.specifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Replaces comments with whitespace and keeps strings intact, so a commented-out import does
 * not count. Newlines survive, which keeps the text of each line where it was.
 * Known limit: a regular expression literal holding a quote can be read as a string start.
 * That only hides comments (more false alarms), never code, because strings are kept.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out.push(source.slice(i, stop).replace(/[^\n]/g, ' '));
      i = stop;
      continue;
    }
    const char = source.charAt(i);
    if (char === "'" || char === '"' || char === '`') {
      const end = endOfString(source, i, char);
      out.push(source.slice(i, end));
      i = end;
      continue;
    }
    out.push(char);
    i += 1;
  }
  return out.join('');
}

/** Index just past the string that opens at `start`, honoring backslash escapes. */
function endOfString(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return source.length;
}
