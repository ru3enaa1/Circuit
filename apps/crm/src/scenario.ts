import { z } from 'zod';

import { EMAIL_MAX_LENGTH, NOTE_BODY_MAX_LENGTH, SHORT_TEXT_MAX_LENGTH, SLUG_PATTERN } from './db/schema.ts';

// ADR-0009 D7–D9: the CRM part of a scenario, scenarios/<id>/crm.json, as data only (product
// rule 4: the core stays generic, the scenario is a package that changes). The seed reads it with
// readFile and JSON.parse and checks it here, whole, before it connects: loading a package never
// runs its code. The limits are the database's own (schema.ts), the ones the API uses, so what
// passes here also passes the constraints. Every object is strict, so a package cannot slip in
// ids, keys, permissions or authors (D9): those belong to the database and to the code. And every
// package is synthetic by construction (CLAUDE.md §1): its addresses are under domains reserved
// for tests and examples, and every revenue figure says it is fictitious.

const SLUG = new RegExp(SLUG_PATTERN);
const NUL = '\u0000';
/** The floor of contacts_email_shape, as input.ts writes it: one @, no space on either side. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;
/** D9: RFC 2606 §2 and RFC 6761 §6.2 reserve these top-level domains; no mail is ever delivered there. */
const RESERVED_DOMAIN = /@[^@\s]+\.(?:test|example)$/;
/** D9: every revenue figure of a package is invented, and says so where it is read. */
export const FICTITIOUS_MARK = '(ficticio)';
/** PostgreSQL has no year 0000; zod's ISO checks take it (CLAUDE.md §8). */
const YEAR_ZERO = /^0000-/;
/** How many problems a refusal names, so a broken package is fixed in few rounds without a wall of text. */
const MAX_REPORTED_PATHS = 5;

/** Stored as it is written: no transform, so the seed writes exactly what the package says. */
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes(NUL) && value.isWellFormed() && value.trim() === value);
const shortText = text(SHORT_TEXT_MAX_LENGTH);
const slug = z.string().regex(SLUG);
const email = z
  .string()
  .max(EMAIL_MAX_LENGTH)
  .regex(EMAIL_SHAPE)
  .refine((value) => value === value.toLowerCase() && RESERVED_DOMAIN.test(value));
/** ISO 8601 with Z, the only form zod's datetime takes by default (ADR-0009, «Restricciones»). */
const instant = z.iso.datetime().refine((value) => !YEAR_ZERO.test(value));
const day = z.iso.date().refine((value) => !YEAR_ZERO.test(value));

const stage = z.strictObject({ key: slug, label: shortText, position: z.int().min(0) });
const company = z.strictObject({
  name: shortText,
  industry: shortText.optional(),
  sizeRange: shortText.optional(),
  revenueRange: shortText.refine((value) => value.includes(FICTITIOUS_MARK)).optional(),
  createdAt: instant.optional(),
});
const note = z.strictObject({ body: text(NOTE_BODY_MAX_LENGTH), createdAt: instant.optional() });
const task = z.strictObject({ title: shortText, dueOn: day.optional(), completedAt: instant.optional(), createdAt: instant.optional() });
const contact = z.strictObject({
  fullName: shortText,
  email,
  /** The key of a stage of the same account. */
  stage: slug,
  /** The name of a company of the same account; absent for a contact without one. */
  company: shortText.optional(),
  createdAt: instant.optional(),
  notes: z.array(note).default([]),
  tasks: z.array(task).default([]),
});

type Issue = { readonly message: string; readonly path: (string | number)[] };

/** Each value of `values` once; every later repeat is an issue at its own index. */
function repeats(values: readonly string[], path: (index: number) => (string | number)[]): Issue[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    if (!seen.has(value)) {
      seen.add(value);
      return [];
    }
    return [{ message: 'repetido', path: path(index) }];
  });
}

/** D8: the rules that join the rows of one account, which no single field can check. */
function accountIssues(account: z.output<typeof accountShape>): Issue[] {
  const stageKeys = new Set(account.stages.map((row) => row.key));
  const companyNames = new Set(account.companies.map((row) => row.name));
  const positions = account.stages.map((row) => row.position);
  return [
    ...repeats(account.stages.map((row) => row.key), (index) => ['stages', index, 'key']),
    ...account.stages.flatMap((row, index) =>
      row.position < positions.length && positions.indexOf(row.position) === index ? [] : [{ message: 'fuera de 0..n-1', path: ['stages', index, 'position'] }],
    ),
    ...repeats(account.companies.map((row) => row.name), (index) => ['companies', index, 'name']),
    ...repeats(account.contacts.map((row) => row.email), (index) => ['contacts', index, 'email']),
    ...account.contacts.flatMap((row, index) => (stageKeys.has(row.stage) ? [] : [{ message: 'sin etapa', path: ['contacts', index, 'stage'] }])),
    ...account.contacts.flatMap((row, index) =>
      row.company === undefined || companyNames.has(row.company) ? [] : [{ message: 'sin empresa', path: ['contacts', index, 'company'] }],
    ),
  ];
}

const accountShape = z.strictObject({
  slug,
  name: shortText,
  createdAt: instant.optional(),
  stages: z.array(stage).min(1),
  companies: z.array(company).default([]),
  contacts: z.array(contact).default([]),
});
const account = accountShape.superRefine((value, context) => {
  for (const issue of accountIssues(value)) context.addIssue({ code: 'custom', ...issue });
});

const scenarioShape = z
  .strictObject({
    /** When every row without its own createdAt was made (D15): a clone gets the same dates. */
    createdAt: instant,
    /** D8: exactly one account is the agent's, and it is one of the package. */
    agentAccount: slug,
    accounts: z.array(account).min(1),
  })
  .superRefine((value, context) => {
    const slugs = value.accounts.map((row) => row.slug);
    for (const issue of repeats(slugs, (index) => ['accounts', index, 'slug'])) context.addIssue({ code: 'custom', ...issue });
    if (!slugs.includes(value.agentAccount)) context.addIssue({ code: 'custom', message: 'no es una cuenta del paquete', path: ['agentAccount'] });
  });

export type Scenario = z.output<typeof scenarioShape>;
export type ScenarioAccount = Scenario['accounts'][number];

/** A refusal of the package. Its message names where, never what: the value stays out of it. */
export class ScenarioError extends Error {
  override readonly name = 'ScenarioError';
}

function shownPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((shown, part) => {
    if (typeof part === 'number') return `${shown}[${part}]`;
    return shown === '' ? String(part) : `${shown}.${String(part)}`;
  }, '');
}

/**
 * `accounts[0].contacts[2].email`. zod reports every unknown key of an object in one issue, so
 * each is named on its own, by its name: a key of the package and not a value.
 */
function pathsOf(issue: z.core.$ZodIssue): string[] {
  if (issue.code === 'unrecognized_keys') return issue.keys.map((key) => shownPath([...issue.path, key]));
  return [shownPath(issue.path)];
}

/** D8: the whole package, or a ScenarioError that names up to five places to look. */
export function parseScenario(data: unknown): Scenario {
  const result = scenarioShape.safeParse(data);
  if (result.success) return result.data;
  const paths = [...new Set(result.error.issues.flatMap(pathsOf))];
  const named = paths.slice(0, MAX_REPORTED_PATHS).map((path) => `«${path === '' ? '(raíz)' : path}»`);
  const more = paths.length > MAX_REPORTED_PATHS ? ` y ${paths.length - MAX_REPORTED_PATHS} más` : '';
  throw new ScenarioError(`El paquete no es válido: revisa ${named.join(', ')}${more}.`);
}
