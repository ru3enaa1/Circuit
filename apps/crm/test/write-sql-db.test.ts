import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server/server.ts';
import { APPROVAL, bearer, bodyOf, expectInvalid, interceptingConnector, sendJson, useCrmUnderTest, type Statement } from './crm-under-test.ts';

// ADR-0007 D8 (ADR-0005, H7): no write sends a value for id or created_at, none takes the
// account from the request, and an update assigns only the columns it may. Checked on the
// statements themselves, as the client was asked to run them, through a server whose pool
// records every one.

const crm = useCrmUnderTest();

/** The only columns a PATCH may assign; archived_at only by archiving, with the database's clock. */
const UPDATABLE = ['company_id', 'email', 'full_name', 'stage_id'];
const INSERT = /^insert into "crm"\."(\w+)" \(([^)]*)\) values \(([^)]*)\)/i;
const UPDATE = /^update "crm"\."(\w+)" set (.*?) where /i;

const statements: Statement[] = [];
let app: FastifyInstance | undefined;

beforeAll(async () => {
  app = buildServer({
    pool: interceptingConnector(crm().pool, (statement) => {
      statements.push(statement);
      return undefined;
    }),
    log: () => undefined,
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

function send(method: 'POST' | 'PATCH', path: string, body: unknown, key = crm().fixture.a.apiKey) {
  return sendJson(app!, method, `/accounts/cuenta-a/${path}`, bearer(key), body);
}

/** The column each value of an insert goes to, and the value as the statement spells it. */
function insertPairs(statement: Statement): { table: string; columns: Map<string, string> } {
  const match = INSERT.exec(statement.text);
  if (match === null) throw new Error(`No es un INSERT que se pueda leer: ${statement.text}`);
  const columns = match[2]!.split(', ').map((column) => column.replaceAll('"', ''));
  const values = match[3]!.split(', ');
  expect(values).toHaveLength(columns.length);
  return { table: match[1]!, columns: new Map(columns.map((column, index) => [column, values[index]!])) };
}

/** The value a `$n` placeholder stands for. */
function parameter(statement: Statement, placeholder: string | undefined): unknown {
  expect(placeholder).toMatch(/^\$\d+$/);
  return statement.values[Number(placeholder!.slice(1)) - 1];
}

function updateAssignments(statement: Statement): { table: string; assignments: Map<string, string> } {
  const match = UPDATE.exec(statement.text);
  if (match === null) throw new Error(`No es un UPDATE que se pueda leer: ${statement.text}`);
  const assignments = match[2]!.split(', ').map((assignment) => assignment.split(' = ') as [string, string]);
  return { table: match[1]!, assignments: new Map(assignments.map(([column, value]) => [column.replaceAll('"', ''), value])) };
}

describe('D8 · what a write sends to the database', () => {
  it('every write, as the statements show it: no id, no created_at, the key\'s account, only the allowed columns', async () => {
    const { a, extras } = crm().fixture;
    statements.length = 0;
    const contact = await send('POST', 'contacts', { fullName: 'Persona SQL', email: 'sql@cuenta-a.test', stageId: Number(a.stageId), approval: APPROVAL });
    const contactId = (bodyOf(contact) as { contact: { id: number } }).contact.id;
    const responses = [
      contact,
      await send('PATCH', `contacts/${contactId}`, { fullName: 'Persona SQL 2', email: 'sql2@cuenta-a.test', stageId: Number(extras.secondStageId), companyId: null, approval: APPROVAL }),
      await send('POST', `contacts/${contactId}/notes`, { body: 'Nota SQL', approval: APPROVAL }),
      await send('POST', `contacts/${contactId}/tasks`, { title: 'Tarea SQL', dueOn: '2026-12-24', approval: APPROVAL }),
      await send('POST', `contacts/${contactId}/archive`, { approval: APPROVAL }, extras.deleteKey),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([201, 200, 201, 201, 204]);

    expect(statements.filter((statement) => /overriding/i.test(statement.text))).toEqual([]);
    const inserts = statements.filter((statement) => /^insert/i.test(statement.text)).map((statement) => ({ statement, ...insertPairs(statement) }));
    expect(inserts.map((insert) => insert.table)).toEqual(['contacts', 'notes', 'tasks']);
    for (const { statement, columns } of inserts) {
      expect([columns.get('id'), columns.get('created_at')]).toEqual(['default', 'default']);
      expect(columns.get('archived_at') ?? 'default').toBe('default');
      expect(Number(parameter(statement, columns.get('account_id')))).toBe(Number(a.id));
    }

    const updates = statements.filter((statement) => /^update/i.test(statement.text)).map(updateAssignments);
    expect(updates.map((update) => update.table)).toEqual(['contacts', 'contacts']);
    expect([...updates[0]!.assignments.keys()].sort()).toEqual(UPDATABLE);
    expect([...updates[1]!.assignments.entries()]).toEqual([['archived_at', 'now()']]);
  });

  it.each([
    ['id', { id: 5 }],
    ['accountId', { accountId: 1 }],
    ['createdAt', { createdAt: '2020-01-01T00:00:00Z' }],
    ['archivedAt', { archivedAt: '2020-01-01T00:00:00Z' }],
  ])('a body with %s is 400 «cuerpo», and no insert is sent', async (_field, extra) => {
    statements.length = 0;
    const body = { fullName: 'Persona', email: 'campo@cuenta-a.test', stageId: Number(crm().fixture.a.stageId), approval: APPROVAL, ...extra };
    expectInvalid(await send('POST', 'contacts', body), 'cuerpo', '');
    expect(statements.filter((statement) => /^insert/i.test(statement.text))).toEqual([]);
  });

  it('a PATCH with id or createdAt is 400 «cuerpo», and no update is sent', async () => {
    statements.length = 0;
    for (const extra of [{ id: 5 }, { createdAt: '2020-01-01T00:00:00Z' }]) {
      expectInvalid(await send('PATCH', `contacts/${crm().fixture.a.contactId}`, { fullName: 'Otro', approval: APPROVAL, ...extra }), 'cuerpo', '');
    }
    expect(statements.filter((statement) => /^update/i.test(statement.text))).toEqual([]);
  });
});
