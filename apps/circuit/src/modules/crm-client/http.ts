import {
  CrmWriteFailed,
  type AppliedAction,
  type Approval,
  type ContactSummary,
  type CrmAction,
  type CrmReader,
  type CrmWriter,
} from '../circuit/index.ts';
import type { CrmEndpoint } from './config.ts';

/**
 * The core's CRM ports over the CRM's HTTP API, with the agent's key (ADR-0012 A9, ADR-0003 M3).
 * It never imports apps/crm: it knows the routes and the bodies as data. Every request has a
 * time limit and refuses a redirect, so the key goes to the CRM and nowhere else. Nothing here
 * logs, and no error carries the key, a body or a fetch message.
 */

/** The CRM's own statement limit is 5 s (ADR-0006); a request that takes longer is abandoned. */
export const CRM_REQUEST_TIMEOUT_MS = 5_000;

const OK = 200;
const LAST_SUCCESS = 299;

/** The fetch the client uses; a test passes one that counts. */
export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** A read the CRM refused or never answered: station 5 fails with port_error, and nothing of it is stored. */
export class CrmReadFailed extends Error {
  override readonly name = 'CrmReadFailed';
  readonly status: number | null;

  constructor(status: number | null) {
    super(status === null ? 'El CRM no respondió la lectura.' : `El CRM respondió ${status} a la lectura.`);
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

interface Stage {
  readonly id: number;
  readonly key: string;
  readonly position: number;
}

function stagesOf(body: unknown): Stage[] {
  const stages = isRecord(body) ? body['stages'] : undefined;
  if (!Array.isArray(stages)) throw new CrmReadFailed(OK);
  return stages.map((stage: unknown) => {
    if (!isRecord(stage) || !isId(stage['id']) || typeof stage['key'] !== 'string' || typeof stage['position'] !== 'number') throw new CrmReadFailed(OK);
    return { id: stage['id'], key: stage['key'], position: stage['position'] };
  });
}

/** The id of the row a write gave back, under the name the route uses (`contact`, `note`, `task`). */
function idIn(answer: Answer, field: string): AppliedAction {
  const row = isRecord(answer.body) ? answer.body[field] : undefined;
  if (!isRecord(row) || !isId(row['id'])) throw new CrmWriteFailed(answer.status);
  return { id: row['id'], status: answer.status };
}

export class HttpCrmClient implements CrmReader, CrmWriter {
  private readonly endpoint: CrmEndpoint;
  private readonly account: string;
  private readonly fetch: Fetch;

  constructor(endpoint: CrmEndpoint, account: string, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
    this.endpoint = endpoint;
    this.account = account;
    this.fetch = fetchImpl;
  }

  async findContactByEmail(email: string): Promise<ContactSummary | null> {
    const found = await this.read('POST', '/contacts/search', { email });
    const contacts = isRecord(found.body) ? found.body['contacts'] : undefined;
    if (!Array.isArray(contacts)) throw new CrmReadFailed(found.status);
    const first: unknown = contacts[0];
    if (first === undefined) return null;
    if (!isRecord(first) || !isId(first['id']) || typeof first['fullName'] !== 'string') throw new CrmReadFailed(found.status);
    const stage = (await this.stages()).find((entry) => entry.id === first['stageId']);
    if (stage === undefined) throw new CrmReadFailed(found.status);
    return { id: first['id'], fullName: first['fullName'], stage: stage.key };
  }

  /** One approved action, one request, never retried (ADR-0012 A5). */
  async apply(approval: Approval, action: CrmAction, contactId: number | null): Promise<AppliedAction> {
    // The Approval lists what may be written; an action that is not one of its own is not sent.
    if (!approval.actions.includes(action)) throw new CrmWriteFailed(null);
    const signed = { approvedBy: approval.approvedBy, approvalRef: approval.approvalRef };
    if (action.type === 'create_contact') {
      const first = [...(await this.stagesForWrite())].sort((a, b) => a.position - b.position)[0];
      if (first === undefined) throw new CrmWriteFailed(null);
      const body = { fullName: action.fullName, email: action.email, stageId: first.id, approval: signed };
      return idIn(await this.write('POST', '/contacts', body), 'contact');
    }
    if (contactId === null) throw new CrmWriteFailed(null);
    const contact = `/contacts/${contactId}`;
    switch (action.type) {
      case 'update_contact':
        return idIn(await this.write('PATCH', contact, { fullName: action.fullName, approval: signed }), 'contact');
      case 'add_note':
        return idIn(await this.write('POST', `${contact}/notes`, { body: action.body, approval: signed }), 'note');
      case 'create_task': {
        const body = action.dueOn === null ? { title: action.title, approval: signed } : { title: action.title, dueOn: action.dueOn, approval: signed };
        return idIn(await this.write('POST', `${contact}/tasks`, body), 'task');
      }
      case 'move_stage': {
        const stage = (await this.stagesForWrite()).find((entry) => entry.key === action.stage);
        if (stage === undefined) throw new CrmWriteFailed(null);
        return idIn(await this.write('PATCH', contact, { stageId: stage.id, approval: signed }), 'contact');
      }
    }
  }

  private async stages(): Promise<Stage[]> {
    return stagesOf((await this.read('GET', '/stages')).body);
  }

  /** The stages, read before a write; a failed read is a failed write that sent nothing. */
  private async stagesForWrite(): Promise<Stage[]> {
    try {
      return await this.stages();
    } catch (error) {
      throw new CrmWriteFailed(error instanceof CrmReadFailed ? error.status : null);
    }
  }

  private async read(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
    const answer = await this.send(method, path, body);
    if (answer === null) throw new CrmReadFailed(null);
    if (answer.status < OK || answer.status > LAST_SUCCESS) throw new CrmReadFailed(answer.status);
    return answer;
  }

  private async write(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<Answer> {
    const answer = await this.send(method, path, body);
    if (answer === null) throw new CrmWriteFailed(null);
    if (answer.status < OK || answer.status > LAST_SUCCESS) throw new CrmWriteFailed(answer.status);
    return answer;
  }

  /** The answer, or null when there was none: refused redirect, time limit, closed port. */
  private async send(method: string, path: string, body?: unknown): Promise<Answer | null> {
    const url = new URL(`/accounts/${encodeURIComponent(this.account)}${path}`, this.endpoint.baseUrl);
    const headers: Record<string, string> = { authorization: `Bearer ${this.endpoint.key}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // ADR-0012 A9: a redirect would carry the key to wherever it points.
        redirect: 'error',
        signal: AbortSignal.timeout(CRM_REQUEST_TIMEOUT_MS),
      });
    } catch {
      // fetch's error and its cause hold the URL and the system's words: none of it is kept.
      return null;
    }
    if (response.status < OK || response.status > LAST_SUCCESS) {
      await response.body?.cancel();
      return { status: response.status, body: null };
    }
    try {
      return { status: response.status, body: (await response.json()) as unknown };
    } catch {
      return { status: response.status, body: null };
    }
  }
}
