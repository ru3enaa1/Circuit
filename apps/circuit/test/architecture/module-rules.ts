import { posix } from 'node:path';

import {
  CRM_PACKAGE,
  MODULE_NAMES,
  MODULE_RULES,
  PACKAGE_OWNERS,
  type ModuleName,
} from './module-map.ts';
import { readImports } from './source-imports.ts';

/**
 * - `not-through-index`: reaches into another module instead of its index.ts (ADR-0003 M1).
 * - `module-not-allowed`: imports a module the map does not allow; for the core, any (M2).
 * - `package-not-allowed`: imports a package the module's list does not allow (M2 for the core).
 * - `package-owner`: imports a package reserved to another module, such as the SDK (D2).
 * - `leaves-app`: reaches code outside apps/circuit, the CRM included (M3).
 * - `computed-import`: an import whose target is not a literal, so no rule can see it.
 */
export type RuleId =
  | 'not-through-index'
  | 'module-not-allowed'
  | 'package-not-allowed'
  | 'package-owner'
  | 'leaves-app'
  | 'computed-import';

export interface SourceFile {
  /** Relative to the app root, with forward slashes: `src/modules/circuit/engine.ts`. */
  readonly path: string;
  readonly source: string;
}

export interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly rule: RuleId;
  readonly detail: string;
}

const MODULES_DIR = 'src/modules';
const PARENT_DIR = '..';
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export function checkSourceFiles(files: readonly SourceFile[]): Violation[] {
  return files.flatMap(checkFile);
}

/** Names declared in a package.json, across every dependency section. */
export function declaredDependencies(manifest: Readonly<Record<string, unknown>>): string[] {
  return DEPENDENCY_SECTIONS.flatMap((section) => {
    const entries = manifest[section];
    return typeof entries === 'object' && entries !== null ? Object.keys(entries) : [];
  });
}

/** The module a path belongs to, or null for files outside src/modules (composition root). */
export function moduleOf(path: string): ModuleName | null {
  const prefix = `${MODULES_DIR}/`;
  if (!path.startsWith(prefix)) return null;
  const folder = path.slice(prefix.length).split('/')[0];
  return MODULE_NAMES.find((name) => name === folder) ?? null;
}

function checkFile(file: SourceFile): Violation[] {
  const { imports, computed } = readImports(file.source);
  const violations = imports.flatMap((ref) => checkImport(file.path, ref.specifier));
  if (computed > 0) {
    violations.push({
      file: file.path,
      specifier: '(computed)',
      rule: 'computed-import',
      detail: `${computed} import(s) with a computed target; use a string literal`,
    });
  }
  return violations;
}

function checkImport(file: string, specifier: string): Violation[] {
  const violation = (rule: RuleId, detail: string): Violation => ({
    file,
    specifier,
    rule,
    detail,
  });
  if (specifier.startsWith('/') || specifier.startsWith('file:')) {
    return [violation('leaves-app', 'absolute paths can point anywhere; use a relative path')];
  }
  return isRelative(specifier)
    ? checkRelative(file, specifier, violation)
    : checkPackage(file, specifier, violation);
}

type MakeViolation = (rule: RuleId, detail: string) => Violation;

function checkRelative(file: string, specifier: string, violation: MakeViolation): Violation[] {
  const target = posix.normalize(posix.join(posix.dirname(file), specifier));
  if (target === PARENT_DIR || target.startsWith(`${PARENT_DIR}/`)) {
    return [violation('leaves-app', 'apps/circuit talks to other apps only over HTTP')];
  }
  const fromModule = moduleOf(file);
  const toModule = moduleOf(target);
  if (toModule === fromModule) return [];

  const violations: Violation[] = [];
  if (toModule === null) {
    // Only a module can be here: files outside modules have fromModule === null.
    violations.push(violation('module-not-allowed', 'a module imports only other modules'));
    return violations;
  }
  if (!isIndexOf(target, toModule)) {
    violations.push(violation('not-through-index', `use ${MODULES_DIR}/${toModule}/index`));
  }
  if (fromModule !== null && !MODULE_RULES[fromModule].modules.includes(toModule)) {
    violations.push(violation('module-not-allowed', `${fromModule} may not import ${toModule}`));
  }
  return violations;
}

function checkPackage(file: string, specifier: string, violation: MakeViolation): Violation[] {
  const name = packageName(specifier);
  const fromModule = moduleOf(file);
  const violations: Violation[] = [];
  if (name === CRM_PACKAGE) {
    violations.push(violation('leaves-app', 'apps/circuit talks to the CRM only over HTTP'));
  }
  const owner = PACKAGE_OWNERS[name];
  if (owner !== undefined && owner !== fromModule) {
    violations.push(violation('package-owner', `only the ${owner} module may import ${name}`));
  }
  if (fromModule !== null && !MODULE_RULES[fromModule].packages.includes(name)) {
    violations.push(violation('package-not-allowed', `${fromModule} may not import ${name}`));
  }
  return violations;
}

function isRelative(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === PARENT_DIR ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

/**
 * `src/modules/model/index.ts` and `.js` both name the index: the repository imports with
 * `.ts` (type stripping, ADR-0006 D1), and `.js` is what nodenext would accept otherwise.
 */
function isIndexOf(target: string, module: ModuleName): boolean {
  return target.replace(/\.(js|ts)$/, '') === `${MODULES_DIR}/${module}/index`;
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`; `node:fs` stays as written. */
function packageName(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name ?? specifier;
}
