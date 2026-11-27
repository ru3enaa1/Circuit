import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

/**
 * The board's files (ADR-0011 B7): every file of apps/board/dist, read once at start-up into a
 * fixed list. The server answers only the paths of the list, so no URL is ever resolved against
 * the disk: `..` or an encoded `%2e%2e` cannot reach a file outside the list.
 */

export interface BoardFile {
  readonly contentType: string;
  readonly body: Buffer;
}

/** Served path (`/assets/index-a1b2.js`) → file. */
export type BoardFiles = ReadonlyMap<string, BoardFile>;

/** The types a Vite build writes. A file of another type is left out of the list. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** What a served path may look like: Vite's names, with no dot segment and no odd character. */
const SERVED_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export const INDEX_PATH = '/index.html';

/** The list, or an empty one when the board was not built (`npm run board:build`). A link is left out: lstat sees it, and it could point anywhere. */
export function readBoardFiles(distDir: string): BoardFiles {
  const files = new Map<string, BoardFile>();
  let names: string[];
  try {
    names = readdirSync(distDir, { recursive: true, encoding: 'utf8' });
  } catch {
    return files;
  }
  for (const name of names.sort()) {
    const path = join(distDir, name);
    const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
    const served = `/${name.split(sep).join('/')}`;
    if (contentType === undefined || !SERVED_PATH.test(served) || !lstatSync(path).isFile()) continue;
    files.set(served, { contentType, body: readFileSync(path) });
  }
  return files;
}
