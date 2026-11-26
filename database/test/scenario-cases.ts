// ADR-0009 D8 and D9: one broken package per rule of apps/crm/src/scenario.ts, each with the path
// its refusal must name and the value that must stay out of every output. scenario.test.ts runs
// them through parseScenario and through the seed, which must refuse them before it connects.

/** A package is untyped JSON until it is parsed, so the cases change it as such. */
export type Json = any;

/** A small package that passes every rule; each case breaks exactly one. */
export function validPackage(): Json {
  return {
    createdAt: '2026-11-01T09:00:00Z',
    agentAccount: 'cuenta-a',
    accounts: [
      {
        slug: 'cuenta-a',
        name: 'Cuenta A',
        stages: [
          { key: 'nueva', label: 'Nueva', position: 0 },
          { key: 'otra', label: 'Otra', position: 1 },
        ],
        companies: [{ name: 'Empresa Uno', industry: 'Servicios', sizeRange: '10 personas', revenueRange: 'COP 100 millones (ficticio)' }],
        contacts: [
          {
            fullName: 'Persona Uno',
            email: 'uno@empresa.test',
            stage: 'nueva',
            company: 'Empresa Uno',
            notes: [{ body: 'Nota de prueba' }],
            tasks: [{ title: 'Tarea de prueba', dueOn: '2026-11-30' }],
          },
          { fullName: 'Persona Dos', email: 'dos@empresa.example', stage: 'otra' },
        ],
      },
      { slug: 'cuenta-b', name: 'Cuenta B', stages: [{ key: 'nueva', label: 'Nueva', position: 0 }] },
    ],
  };
}

export interface BrokenPackage {
  readonly rule: string;
  /** The package as JSON text, so a key such as __proto__ arrives the way JSON.parse makes it. */
  readonly json: string;
  readonly path: string;
  /** Text of the value that the refusal must not repeat; empty when the value is not text. */
  readonly value: string;
}

function broken(rule: string, path: string, value: string, change: (pkg: Json) => void): BrokenPackage {
  const pkg = validPackage();
  change(pkg);
  return { rule, json: JSON.stringify(pkg), path, value };
}

/** Built from their code points, so no editor or tool can turn them into something else in this file. */
const NUL = String.fromCharCode(0);
const LONE_SURROGATE = String.fromCharCode(0xdc00);
/** How the format names an unknown key that is not a field name (scenario.ts). */
const UNNAMED_KEY = '(clave desconocida)';

const first = (pkg: Json): Json => pkg.accounts[0];
const contact = (pkg: Json): Json => pkg.accounts[0].contacts[0];

export const BROKEN_PACKAGES: readonly BrokenPackage[] = [
  broken('an unknown key at the top', 'extra', 'valor-extra', (pkg) => (pkg.extra = 'valor-extra')),
  {
    rule: 'a __proto__ key, as JSON.parse makes it (H9 of ADR-0006)',
    json: JSON.stringify(validPackage()).replace('{', '{"__proto__":{"polluted":"valor-proto"},'),
    path: '__proto__',
    value: 'valor-proto',
  },
  broken('D9: keys in an account', 'accounts[0].keys', 'crmk-de-mentira', (pkg) => (first(pkg).keys = ['crmk-de-mentira'])),
  broken('D9: permissions in an account', 'accounts[0].permissions', 'export', (pkg) => (first(pkg).permissions = ['export'])),
  broken('D9: an author on a note', 'accounts[0].contacts[0].notes[0].proposedBy', 'autor-falso', (pkg) => (contact(pkg).notes[0].proposedBy = 'autor-falso')),
  broken('D9: an id on a contact', 'accounts[0].contacts[0].id', '', (pkg) => (contact(pkg).id = 7)),
  broken('D9: an address outside the reserved domains', 'accounts[0].contacts[0].email', 'persona@gmail.com', (pkg) => (contact(pkg).email = 'persona@gmail.com')),
  broken('D9: a bare reserved word is not a reserved domain', 'accounts[0].contacts[0].email', 'persona@test', (pkg) => (contact(pkg).email = 'persona@test')),
  broken('D9: a revenue without the mark', 'accounts[0].companies[0].revenueRange', 'COP 100 millones', (pkg) => (first(pkg).companies[0].revenueRange = 'COP 100 millones')),
  broken('an account slug that is not a slug', 'accounts[0].slug', 'Cuenta A', (pkg) => {
    first(pkg).slug = 'Cuenta A';
    pkg.agentAccount = 'Cuenta A';
  }),
  broken('a stage key that is not a slug', 'accounts[0].stages[0].key', 'Etapa Nueva', (pkg) => {
    first(pkg).stages[0].key = 'Etapa Nueva';
    contact(pkg).stage = 'Etapa Nueva';
  }),
  broken('a name over 200 characters', 'accounts[0].name', 'n'.repeat(201), (pkg) => (first(pkg).name = 'n'.repeat(201))),
  broken('a note over 4000 characters', 'accounts[0].contacts[0].notes[0].body', 'b'.repeat(4001), (pkg) => (contact(pkg).notes[0].body = 'b'.repeat(4001))),
  broken('an address over 254 characters', 'accounts[0].contacts[0].email', `${'a'.repeat(250)}@x.test`, (pkg) => (contact(pkg).email = `${'a'.repeat(250)}@x.test`)),
  broken('an address with capitals', 'accounts[0].contacts[0].email', 'Persona@empresa.test', (pkg) => (contact(pkg).email = 'Persona@empresa.test')),
  broken('an address without an @', 'accounts[0].contacts[0].email', 'sin-arroba.test', (pkg) => (contact(pkg).email = 'sin-arroba.test')),
  broken('a NUL in a name', 'accounts[0].contacts[0].fullName', 'Persona\u0000Nula', (pkg) => (contact(pkg).fullName = 'Persona\u0000Nula')),
  broken('a name with spaces around it', 'accounts[0].contacts[0].fullName', ' Persona Uno ', (pkg) => (contact(pkg).fullName = ' Persona Uno ')),
  broken('an empty title', 'accounts[0].contacts[0].tasks[0].title', '', (pkg) => (contact(pkg).tasks[0].title = '')),
  broken('a day that does not exist', 'accounts[0].contacts[0].tasks[0].dueOn', '2026-02-30', (pkg) => (contact(pkg).tasks[0].dueOn = '2026-02-30')),
  broken('a day of the year 0000', 'accounts[0].contacts[0].tasks[0].dueOn', '0000-01-01', (pkg) => (contact(pkg).tasks[0].dueOn = '0000-01-01')),
  broken('an instant without its Z', 'createdAt', '2026-11-01T09:00:00+05:00', (pkg) => (pkg.createdAt = '2026-11-01T09:00:00+05:00')),
  broken('an instant of the year 0000', 'accounts[0].contacts[0].createdAt', '0000-01-01T00:00:00Z', (pkg) => (contact(pkg).createdAt = '0000-01-01T00:00:00Z')),
  broken('a stage key repeated', 'accounts[0].stages[1].key', '', (pkg) => (first(pkg).stages[1].key = 'nueva')),
  broken('positions that are not 0 to n-1', 'accounts[0].stages[1].position', '', (pkg) => (first(pkg).stages[1].position = 2)),
  broken('a contact on a stage the account lacks', 'accounts[0].contacts[0].stage', 'etapa-fantasma', (pkg) => (contact(pkg).stage = 'etapa-fantasma')),
  broken('a contact of a company the account lacks', 'accounts[0].contacts[0].company', 'Empresa Fantasma', (pkg) => (contact(pkg).company = 'Empresa Fantasma')),
  broken('a company name repeated', 'accounts[0].companies[1].name', '', (pkg) => first(pkg).companies.push({ name: 'Empresa Uno' })),
  broken('an address repeated in one account', 'accounts[0].contacts[1].email', 'uno@empresa.test', (pkg) => (first(pkg).contacts[1].email = 'uno@empresa.test')),
  broken('an account slug repeated', 'accounts[1].slug', '', (pkg) => (pkg.accounts[1].slug = 'cuenta-a')),
  broken('an agent account that is not in the package', 'agentAccount', 'cuenta-fantasma', (pkg) => (pkg.agentAccount = 'cuenta-fantasma')),
  broken('no account', 'accounts', '', (pkg) => (pkg.accounts = [])),
  broken('an account without stages', 'accounts[1].stages', '', (pkg) => (pkg.accounts[1].stages = [])),
  broken('a negative position', 'accounts[0].stages[0].position', '', (pkg) => (first(pkg).stages[0].position = -1)),
  // Audit of ADR-0009, H2 and H6: what PostgreSQL would refuse or change, in the address and in a name.
  broken('a NUL in an address', 'accounts[0].contacts[0].email', `uno${NUL}x@empresa.test`, (pkg) => (contact(pkg).email = `uno${NUL}x@empresa.test`)),
  broken('a lone surrogate in an address', 'accounts[0].contacts[0].email', `uno${LONE_SURROGATE}x@empresa.test`, (pkg) => {
    contact(pkg).email = `uno${LONE_SURROGATE}x@empresa.test`;
  }),
  broken('a lone surrogate in a name', 'accounts[0].contacts[0].fullName', `Persona${LONE_SURROGATE}Uno`, (pkg) => (contact(pkg).fullName = `Persona${LONE_SURROGATE}Uno`)),
  // Audit of ADR-0009, H5: an unknown key that is not a field name is not repeated, whatever it holds.
  broken('an unknown key shaped like an address', UNNAMED_KEY, 'persona.real@gmail.com', (pkg) => (pkg['persona.real@gmail.com'] = 1)),
  broken('an unknown key of 10 000 characters', UNNAMED_KEY, 'k'.repeat(10_000), (pkg) => (pkg['k'.repeat(10_000)] = 1)),
];
