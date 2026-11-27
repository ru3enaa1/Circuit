import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Logo } from '../src/components/Logo.tsx';

// ADR-0014 G3: the tab icon is the logo's own markup, with its background, as a file Vite copies
// to dist and circuit serves from its fixed list (B7). The CSP refuses a data: URL, so the icon
// cannot be inlined. The file is never edited by hand: `npm run board:favicon` rewrites it.

const FAVICON = '../public/favicon.svg';
/** A standalone SVG file needs its namespace; inside the page, React's markup does not. */
const SVG_NAMESPACE = 'xmlns="http://www.w3.org/2000/svg"';
const REGENERATE = 'npm run board:favicon';

describe('G3 · the tab icon', () => {
  it('is the markup of <Logo> with its background', async () => {
    const markup = renderToStaticMarkup(createElement(Logo, { size: 32, background: true })).replace('<svg ', `<svg ${SVG_NAMESPACE} `);
    await expect(`${markup}\n`, `apps/board/public/favicon.svg no es el logo. Regenéralo con ${REGENERATE}.`).toMatchFileSnapshot(FAVICON);
  });

  it('is linked by index.html from a path of its own', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(index).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });
});
