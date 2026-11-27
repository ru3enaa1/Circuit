import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Where the CRM is and the key circuit presents to it (ADR-0012 A9). The CRM runs on this
 * machine, so the address must be loopback: a typo cannot send the agent's key to another host.
 * The key is read once, at start-up, from the file the seed wrote (ADR-0009 D20); it is never
 * copied anywhere else, and no message quotes it or the file's content.
 */

export const DEFAULT_CRM_URL = 'http://127.0.0.1:4010';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);
/** ADR-0020 D2: inside Compose the CRM is its service, crm, on Compose's own network; never outside it. */
const COMPOSE_CRM_HOST = 'crm';
/**
 * The shape of the agent's key, `crmk_` and 43 characters of base64url (ADR-0008 D1). Looser than
 * the CRM's own check, which apps/circuit cannot import (ADR-0003 M3): the CRM still decides.
 */
const KEY_SHAPE = /^crmk_[A-Za-z0-9_-]{43}$/;
/** The seed ends the file with a newline (database/seed.ts); an editor may add a CR before it. */
const TRAILING_NEWLINE = /\r?\n$/;

export interface CrmEndpoint {
  /** The CRM's origin, as a URL with no path, query or credentials. */
  readonly baseUrl: URL;
  readonly key: string;
}

/** A setting circuit cannot reach the CRM with. Its message names the variable, never a value. */
export class CrmClientConfigError extends Error {
  override readonly name = 'CrmClientConfigError';
}

const URL_RULE = 'CRM_URL debe ser http://127.0.0.1:<puerto> o http://localhost:<puerto>, sin ruta.';

/**
 * CRM_URL, unset for the default; anything that is not plain http to loopback (or, inside Compose,
 * to the crm service) stops the start-up.
 */
export function readCrmUrl(value: string | undefined, inCompose = false): URL {
  const text = value === undefined || value === '' ? DEFAULT_CRM_URL : value;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new CrmClientConfigError(URL_RULE);
  }
  const plain = url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '';
  const allowedHost = LOOPBACK_HOSTS.has(url.hostname) || (inCompose && url.hostname === COMPOSE_CRM_HOST);
  if (url.protocol !== 'http:' || !allowedHost || !plain) throw new CrmClientConfigError(URL_RULE);
  return url;
}

/** The key in the file CRM_AGENT_KEY_FILE names, relative to the repository root unless absolute. */
export function readAgentKey(keyFile: string | undefined, repoRoot: string): string {
  if (keyFile === undefined || keyFile === '') throw new CrmClientConfigError('Falta CRM_AGENT_KEY_FILE: copia su línea de .env.example a .env.');
  let text: string;
  try {
    text = readFileSync(isAbsolute(keyFile) ? keyFile : join(repoRoot, keyFile), 'utf8');
  } catch {
    // The file system's message carries the path and the system's words; the variable is enough.
    throw new CrmClientConfigError('No se pudo leer el archivo de CRM_AGENT_KEY_FILE. Corre npm run db:seed, que escribe la llave del agente.');
  }
  const key = text.replace(TRAILING_NEWLINE, '');
  if (!KEY_SHAPE.test(key)) throw new CrmClientConfigError('El archivo de CRM_AGENT_KEY_FILE no tiene la forma de una llave del CRM. Corre npm run db:seed.');
  return key;
}

export function readCrmEndpoint(env: Readonly<Record<string, string | undefined>>, repoRoot: string, inCompose = false): CrmEndpoint {
  return { baseUrl: readCrmUrl(env['CRM_URL'], inCompose), key: readAgentKey(env['CRM_AGENT_KEY_FILE'], repoRoot) };
}
