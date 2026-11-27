import { useEffect, useSyncExternalStore } from 'react';

import { parentOf, parseRoute, routeHash, type Route } from './route.ts';

/**
 * The route, read from the address's fragment as an external store (ADR-0013): no component
 * state (ADR-0011 B1), and the browser's «back» works as Esc does. Links change the fragment;
 * only Esc writes it here, one level up (§10, §14).
 */

const readHash = () => window.location.hash;

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** Without a window (rendered on the server), the circuit. */
const serverHash = () => '';

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, readHash, serverHash));
}

/** Esc goes one level up; on the circuit it does nothing. Read at the key's time, so it keeps nothing. */
export function useEscapeGoesUp(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const parent = parentOf(parseRoute(window.location.hash));
      if (parent !== null) window.location.hash = routeHash(parent);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
