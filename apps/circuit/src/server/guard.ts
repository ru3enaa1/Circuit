/**
 * What every answer of the circuit server carries, and the first check of every request
 * (ADR-0011 B6, B7). The server listens on 127.0.0.1, but any page open on the same machine can
 * send it requests, and a domain of its own can point at 127.0.0.1 (DNS rebinding) and read the
 * answers. A browser always sends the Host it thinks it talks to, so only the server's own two
 * names pass. CORS is never answered: no other origin may read anything.
 */

/** The two names the server answers to, with its port. Compared without case, as hosts are. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const value = host.toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

/**
 * `default-src 'self'` also covers scripts, styles, fonts and connect-src: the board asks
 * nothing of another origin. `frame-ancestors 'none'`: no page can frame it to trick a click.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});

/** The body of a refused Host: nothing about the server, its routes or its data. */
export const FORBIDDEN_HOST_BODY = Object.freeze({ error: 'anfitrion_no_permitido' });
