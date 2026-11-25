import type { LightMyRequestResponse } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIXTURE_AUTHORS, inTransaction, sha256, testApiKey } from '../../../database/test/crm-fixture.ts';
import { DATABASE_HOOK_TIMEOUT_MS } from '../../../database/test/disposable-db.ts';
import { buildServer } from '../src/server/server.ts';
import {
  bearer,
  bodyOf,
  errorCodeOf,
  expectInvalid,
  interceptingConnector,
  rowCounts,
  useCrmUnderTest,
  type Statement,
} from './crm-under-test.ts';

// ADR-0008 D11 and D12: GET /accounts/:slug/export, through the real server on a disposable
// database as crm_app. Every 403 has the 200 of the {read,export} key next to it as control, so
// a refusal for another reason (a missing route, a broken query) does not pass for this one.

const EXPORT_DENIED = 'La llave no tiene permiso de exportación.';
/** ADR-0006 D12: the fields of a contact, the list reads-db.test.ts checks for one contact. */
const CONTACT_KEYS = ['companyId', 'createdAt', 'email', 'fullName', 'id', 'stageId'];
/** ADR-0006 D14: the default page and the largest one, as the notes page. */
const DEFAULT_PAGE = 50;
const LARGEST_PAGE = 100;
/** More than the default page and fewer than the largest, so both limits show in one account. */
const BULK_CONTACTS = 55;
/** Pages of this size split the account's contacts unevenly, so the last page is a short one. */
const PAGE_STEP = 20;

const crm = useCrmUnderTest();

/** An export key of account b, made here as the admin: the fixture gives one only to a. */
const exportKeyOfB = testApiKey('exportacion-b');

beforeAll(async () => {
  const { a, b } = crm().fixture;
  await inTransaction(crm().db.pool, { context: FIXTURE_AUTHORS, commit: true }, async (client) => {
    await client.query("INSERT INTO crm.api_keys (account_id, label, key_hash, permissions) VALUES ($1, 'exportacion', $2, '{read,export}')", [
      b.id,
      sha256(exportKeyOfB),
    ]);
    await client.query(
      `INSERT INTO crm.contacts (account_id, stage_id, full_name, email)
       SELECT $1, $2, 'Persona ' || n, 'masa-' || n || '@cuenta-a.test' FROM generate_series(1, $3::int) AS n`,
      [a.id, a.stageId, BULK_CONTACTS],
    );
  });
}, DATABASE_HOOK_TIMEOUT_MS);

const exportKeyOfA = () => bearer(crm().fixture.extras.exportKey);

function exportOf(query = '', headers: Record<string, string> = exportKeyOfA(), slug = 'cuenta-a'): Promise<LightMyRequestResponse> {
  return crm().app.inject({ method: 'GET', url: `/accounts/${slug}/export${query}`, headers });
}

interface Exported {
  readonly id: number;
  readonly [field: string]: unknown;
}

/** The contacts of a 200, failing on any other status so a refusal never reads as an empty list. */
function contactsOf(response: LightMyRequestResponse): readonly Exported[] {
  expect(response.statusCode, response.body).toBe(200);
  const body = bodyOf(response) as { contacts: Exported[] };
  expect(Object.keys(body)).toEqual(['contacts']);
  return body.contacts;
}

const idsOf = (contacts: readonly Exported[]): number[] => contacts.map((contact) => contact.id);

/** The account's active contacts, newest first, read as the admin past every policy. */
async function activeIds(accountId: string): Promise<number[]> {
  // Qualified, so the order is the bigint's and not the text's (CLAUDE.md §8).
  const result = await crm().db.pool.query<{ id: string }>(
    'SELECT contacts.id::text AS id FROM crm.contacts WHERE account_id = $1 AND archived_at IS NULL ORDER BY contacts.id DESC',
    [accountId],
  );
  return result.rows.map((row) => Number(row.id));
}

function expectError(response: LightMyRequestResponse, status: number, code: string): void {
  expect(response.statusCode, response.body).toBe(status);
  expect(errorCodeOf(response)).toBe(code);
}

describe('D11 · exporting takes `export`', () => {
  it('every key without it gets 403 «exportación»; the {read,export} key gets 200 (control)', async () => {
    const { a, extras } = crm().fixture;
    // The agent's {read,write}, then {read,write,delete}, {read} and {write}.
    for (const key of [a.apiKey, extras.deleteKey, extras.readOnlyKey, extras.writeOnlyKey]) {
      const response = await exportOf('', bearer(key));
      expect(response.statusCode, response.body).toBe(403);
      expect(bodyOf(response)).toEqual({ error: { code: 'sin_permiso', message: EXPORT_DENIED } });
    }
    expect(contactsOf(await exportOf()).length).toBeGreaterThan(0);
  });

  it('the key, the account and the permission come before the query: an invalid one is never a 400 before them', async () => {
    const { a, revokedApiKey } = crm().fixture;
    const invalid = '?formato=csv';
    expectError(await exportOf(invalid, {}), 401, 'sin_llave');
    expectError(await exportOf(invalid, bearer(testApiKey('desconocida'))), 401, 'llave_invalida');
    expectError(await exportOf(invalid, bearer(revokedApiKey)), 401, 'llave_invalida');
    expectError(await exportOf(invalid, exportKeyOfA(), 'cuenta-b'), 403, 'cuenta_ajena');
    expectError(await exportOf(invalid, bearer(a.apiKey)), 403, 'sin_permiso');
    // Control: with every check passed, the same query is the 400.
    expectInvalid(await exportOf(invalid), 'consulta', 'csv');
  });
});

describe('D12 · what the export returns', () => {
  it('the active contacts of the account, newest first, each with the fields of a contact and nothing else', async () => {
    const { a } = crm().fixture;
    const all = contactsOf(await exportOf(`?limit=${LARGEST_PAGE}`));
    expect(all.map((contact) => Object.keys(contact).sort())).toEqual(all.map(() => CONTACT_KEYS));
    expect(idsOf(all)).toEqual(await activeIds(a.id));
    // The same contact the read of one contact returns, field by field.
    const one = await crm().app.inject({ method: 'GET', url: `/accounts/cuenta-a/contacts/${a.contactId}`, headers: exportKeyOfA() });
    expect(all.find((contact) => contact.id === Number(a.contactId))).toEqual((bodyOf(one) as { contact: unknown }).contact);
  });

  it('a page is 50 by default and 100 at most', async () => {
    const ids = await activeIds(crm().fixture.a.id);
    expect(ids.length).toBeGreaterThan(DEFAULT_PAGE);
    expect(ids.length).toBeLessThanOrEqual(LARGEST_PAGE);
    expect(idsOf(contactsOf(await exportOf()))).toEqual(ids.slice(0, DEFAULT_PAGE));
  });

  it("with a's key no contact of b comes out, and with b's key it does", async () => {
    const { a, b } = crm().fixture;
    const ofA = idsOf(contactsOf(await exportOf(`?limit=${LARGEST_PAGE}`)));
    expect(ofA).not.toContain(Number(b.contactId));
    expect(ofA).toContain(Number(a.contactId));
    const ofB = idsOf(contactsOf(await exportOf('', bearer(exportKeyOfB), 'cuenta-b')));
    expect(ofB).toEqual([Number(b.contactId)]);
  });

  it('an archived contact does not come out', async () => {
    const { extras } = crm().fixture;
    const archived = await crm().db.pool.query('SELECT 1 FROM crm.contacts WHERE id = $1 AND archived_at IS NOT NULL', [extras.archivedContactId]);
    expect(archived.rowCount).toBe(1);
    expect(idsOf(contactsOf(await exportOf(`?limit=${LARGEST_PAGE}`)))).not.toContain(Number(extras.archivedContactId));
  });

  it('paging with before neither repeats nor skips a contact', async () => {
    const seen: number[] = [];
    const sizes: number[] = [];
    let before = '';
    for (;;) {
      const page = idsOf(contactsOf(await exportOf(`?limit=${PAGE_STEP}${before}`)));
      sizes.push(page.length);
      if (page.length === 0) break;
      seen.push(...page);
      before = `&before=${page.at(-1)}`;
    }
    const ids = await activeIds(crm().fixture.a.id);
    expect(seen).toEqual(ids);
    expect(sizes).toEqual([PAGE_STEP, PAGE_STEP, ids.length - 2 * PAGE_STEP, 0]);
  });

  it('limit 101 and a parameter of another name are 400; limit 100 is the control', async () => {
    expectInvalid(await exportOf(`?limit=${LARGEST_PAGE + 1}`), 'limit', '');
    expectInvalid(await exportOf('?formato=csv'), 'consulta', 'csv');
    expect(contactsOf(await exportOf(`?limit=${LARGEST_PAGE}`)).length).toBeGreaterThan(DEFAULT_PAGE);
  });

  it('runs READ ONLY, sets no author and leaves no row in the audit trail', async () => {
    const statements: Statement[] = [];
    const pool = interceptingConnector(crm().pool, (statement) => {
      statements.push(statement);
      return undefined;
    });
    const app = buildServer({ pool, log: () => undefined });
    const before = await rowCounts(crm().db.pool);
    const response = await app.inject({ method: 'GET', url: '/accounts/cuenta-a/export', headers: exportKeyOfA() });
    await app.close();
    expect(contactsOf(response).length).toBe(DEFAULT_PAGE);
    expect(await rowCounts(crm().db.pool)).toEqual(before);
    expect(statements[0]?.text).toBe('BEGIN TRANSACTION READ ONLY');
    const settings = statements.flatMap((statement) => statement.values);
    expect(settings).toEqual(expect.arrayContaining(['crm.account_id', 'crm.api_key_id']));
    for (const author of ['crm.proposed_by', 'crm.approved_by', 'crm.approval_ref']) expect(settings).not.toContain(author);
  });
});
