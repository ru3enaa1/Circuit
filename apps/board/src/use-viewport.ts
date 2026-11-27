import { useSyncExternalStore } from 'react';

import { WORK_HEIGHT, WORK_WIDTH } from './layout.ts';

/**
 * The window's size, read from the browser as an external store (no component state, ADR-0011
 * B1). The layout is recomputed from it on every resize (docs/diseno.md §9).
 */

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

let cached: Viewport = { width: WORK_WIDTH, height: WORK_HEIGHT };

function read(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // The same object while the size holds, as useSyncExternalStore requires.
  if (width !== cached.width || height !== cached.height) cached = { width, height };
  return cached;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** Without a window (rendered on the server), the working size. */
const serverViewport = (): Viewport => ({ width: WORK_WIDTH, height: WORK_HEIGHT });

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, read, serverViewport);
}
