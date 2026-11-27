import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A CRM over real HTTP on 127.0.0.1 that keeps every request it gets (ADR-0012 A2, A5, A9). It
 * answers the routes the client uses with the CRM's shapes, so the tests count requests that
 * really crossed a socket. It is not the CRM: the end-to-end test starts that one.
 */

export const FAKE_ACCOUNT = 'escuela-andamio';
/** A key of the agent's shape, known to the test so it can look for it where it must not be. */
export const FAKE_KEY = `crmk_${'A'.repeat(42)}Q`;

export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface FakeCrmHttp {
  readonly url: URL;
  readonly requests: SeenRequest[];
  /** The writes only: the requests that are not the stages or a search. */
  writes(): SeenRequest[];
  /** Answers this write (1-based, counting writes only) with the status, once. */
  failWrite(index: number, status: number): void;
  /** Answers every request with a redirect to this URL. */
  redirectTo(target: URL | null): void;
  close(): Promise<void>;
}

const STAGES = [
  { id: 11, key: 'nueva', label: 'Nueva solicitud', position: 0 },
  { id: 12, key: 'diagnostico', label: 'Diagnóstico', position: 1 },
  { id: 13, key: 'programa-propuesto', label: 'Programa propuesto', position: 2 },
];
const LUCIA = { id: 7, fullName: 'Lucía Restrepo Arango', email: 'lucia@hiloverde.test', companyId: null, stageId: 12, createdAt: '2026-11-03T14:00:00.000Z' };

const isRead = (request: SeenRequest): boolean => request.path.endsWith('/stages') || request.path.endsWith('/contacts/search');

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text === '' ? null : (JSON.parse(text) as unknown));
      } catch {
        resolve(text);
      }
    });
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function answer(seen: SeenRequest, nextId: () => number): { readonly status: number; readonly body: unknown } {
  const prefix = `/accounts/${FAKE_ACCOUNT}`;
  const route = seen.path.startsWith(prefix) ? `${seen.method} ${seen.path.slice(prefix.length).replace(/\/[0-9]+(?=\/|$)/g, '/:id')}` : 'otra';
  switch (route) {
    case 'GET /stages':
      return { status: 200, body: { stages: STAGES } };
    case 'POST /contacts/search': {
      const email = typeof seen.body === 'object' && seen.body !== null ? (seen.body as Record<string, unknown>)['email'] : undefined;
      return { status: 200, body: { contacts: email === LUCIA.email ? [LUCIA] : [] } };
    }
    case 'POST /contacts':
      return { status: 201, body: { contact: { ...LUCIA, id: nextId() } } };
    case 'PATCH /contacts/:id':
      return { status: 200, body: { contact: { ...LUCIA, id: Number(/\/contacts\/([0-9]+)/.exec(seen.path)?.[1]) } } };
    case 'POST /contacts/:id/notes':
      return { status: 201, body: { note: { id: nextId(), body: 'x', createdAt: '2026-11-27T09:00:00.000Z' } } };
    case 'POST /contacts/:id/tasks':
      return { status: 201, body: { task: { id: nextId(), title: 'x', dueOn: null, doneAt: null, createdAt: '2026-11-27T09:00:00.000Z' } } };
    default:
      return { status: 404, body: { error: 'no_encontrado' } };
  }
}

export async function startFakeCrmHttp(): Promise<FakeCrmHttp> {
  const requests: SeenRequest[] = [];
  const failures = new Map<number, number>();
  let redirect: URL | null = null;
  let id = 500;
  const nextId = () => (id += 1);
  const server: Server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const seen: SeenRequest = { method: request.method ?? '', path: request.url ?? '', authorization: request.headers.authorization, body };
      requests.push(seen);
      if (redirect !== null) {
        response.writeHead(302, { location: redirect.href });
        response.end();
        return;
      }
      const writeIndex = requests.filter((entry) => !isRead(entry)).length;
      const failure = isRead(seen) ? undefined : failures.get(writeIndex);
      if (failure !== undefined) {
        failures.delete(writeIndex);
        send(response, failure, { error: 'error_interno', detail: 'cuerpo que no debe guardarse' });
        return;
      }
      const { status, body: reply } = answer(seen, nextId);
      send(response, status, reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}`),
    requests,
    writes: () => requests.filter((entry) => !isRead(entry)),
    failWrite: (index, status) => failures.set(index, status),
    redirectTo: (target) => {
      redirect = target;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
