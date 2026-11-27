import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOARD_MISSING } from '../src/server/server.ts';
import { SECURITY_HEADERS } from '../src/server/guard.ts';
import { GOOD_HOST, TEST_PORT, fakeBoardDir, readBoardFiles, testServer } from './support/server.ts';

// ADR-0011 B6 and B7: only the server's own Host is answered, CORS never is, nothing outside the
// fixed list of the board's files is served, and every answer carries the three headers.

const board = fakeBoardDir();
const { app } = testServer({ board: readBoardFiles(board.dist) });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  board.remove();
});

const ROUTES = ['/', '/index.html', '/assets/index-a1b2.js', '/api/circuit', '/api/runs', '/api/runs/1/events', '/api/tools', '/no-such-page'];

const get = (url: string, host: string = GOOD_HOST, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { host, ...headers } });

function expectSecurityHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers[name], name).toBe(value);
}

describe('B6 · the Host header', () => {
  it.each(['ejemplo.test', `ejemplo.test:${TEST_PORT}`, '127.0.0.1:1', `127.0.0.2:${TEST_PORT}`, '127.0.0.1', `localhost.ejemplo.test:${TEST_PORT}`])(
    'a request with Host %s gets 403 on every route, with nothing useful in the body',
    async (host) => {
      for (const url of ROUTES) {
        const response = await get(url, host);
        expect(response.statusCode, url).toBe(403);
        expect(response.json(), url).toEqual({ error: 'anfitrion_no_permitido' });
        expectSecurityHeaders(response.headers);
      }
    },
  );

  it.each([`127.0.0.1:${TEST_PORT}`, `localhost:${TEST_PORT}`, `LOCALHOST:${TEST_PORT}`])('Host %s is answered (control)', async (host) => {
    expect((await get('/api/circuit', host)).statusCode).toBe(200);
  });

  it('a URL the router cannot read is refused by Host first, then answered 400 with the headers', async () => {
    const foreign = await get('/api/runs/%zz/events', 'ejemplo.test');
    const own = await get('/api/runs/%zz/events');

    expect(foreign.statusCode).toBe(403);
    expectSecurityHeaders(foreign.headers);
    expect(own.statusCode).toBe(400);
    expect(own.json()).toEqual({ error: 'entrada_invalida', field: 'ruta' });
    expectSecurityHeaders(own.headers);
  });

  it('never answers CORS: an OPTIONS or a GET with a foreign Origin carries no access-control header', async () => {
    const origin = { origin: 'http://ejemplo.test', 'access-control-request-method': 'POST' };
    for (const url of ROUTES) {
      const preflight = await app.inject({ method: 'OPTIONS', url, headers: { host: GOOD_HOST, ...origin } });
      const read = await get(url, GOOD_HOST, origin);
      for (const response of [preflight, read]) {
        expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-')), url).toEqual([]);
      }
      expect(preflight.statusCode, url).toBe(404);
    }
  });
});

describe('B7 · the board from a fixed list of files', () => {
  it('serves the index at / and at /index.html, a script and a font, with their types', async () => {
    const index = await get('/');
    const script = await get('/assets/index-a1b2.js');
    const font = await get('/assets/plex-latin-400.woff2');

    expect([index.statusCode, script.statusCode, font.statusCode]).toEqual([200, 200, 200]);
    expect(index.body).toContain('<div id="root">');
    expect((await get('/index.html')).body).toBe(index.body);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(font.headers['content-type']).toBe('font/woff2');
  });

  it.each([
    '/../package.json',
    '/%2e%2e/package.json',
    '/assets/../../.env',
    '/assets/%2e%2e/%2e%2e/.env',
    '/assets/..%2f..%2f.env',
    '/.env',
    '/package.json',
    '/assets/notes.txt',
    '/assets/',
    '/assets',
  ])('%s gives 404 and none of the files around dist', async (url) => {
    const response = await get(url);

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('never-served');
    expect(response.body).not.toContain('secret');
  });

  it('every answer carries the three headers: the page, a file, the API, a 404 and an error', async () => {
    for (const url of ['/', '/assets/index-a1b2.js', '/api/circuit', '/no-such-page', '/api/runs/abc/events']) {
      expectSecurityHeaders((await get(url)).headers);
    }
  });

  it('without a build, / says which command builds the board, and nothing else is served', async () => {
    const empty = testServer();
    const response = await empty.app.inject({ method: 'GET', url: '/', headers: { host: GOOD_HOST } });

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(BOARD_MISSING);
    expectSecurityHeaders(response.headers);
    await empty.app.close();
  });

  it('a missing dist folder gives an empty list', () => {
    expect(readBoardFiles(`${board.dir}/no-such-dist`).size).toBe(0);
  });
});
