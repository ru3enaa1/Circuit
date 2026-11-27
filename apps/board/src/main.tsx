import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import './panels.css';
import './side-panels.css';
import './room.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Board } from './components/Board.tsx';
import { useEscapeGoesUp, useRoute } from './use-route.ts';
import { useRunFeed } from './use-run-events.ts';
import { useViewport } from './use-viewport.ts';

// The board's entry (ADR-0011). The fonts are served by circuit from the build, never from
// another origin (B7, docs/diseno.md §4).

function App() {
  const feed = useRunFeed();
  const { width, height } = useViewport();
  const route = useRoute();
  useEscapeGoesUp();
  return (
    <Board
      status={feed.status}
      info={feed.info}
      tools={feed.tools}
      runs={feed.runs}
      runId={feed.runId}
      events={feed.received.slice(0, feed.revealed)}
      width={width}
      height={height}
      route={route}
      onSelectRun={feed.select}
    />
  );
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
