import type { MouseEvent } from 'react';

import type { CircuitInfo } from '../api.ts';
import { COMMAND_TEXTS, TRYOUT_TEXTS } from '../texts.ts';
import type { CommandState } from '../use-run-events.ts';

/**
 * «Probar una solicitud» beside the dock (docs/diseno.md §8, ADR-0012 A12): the scenario's
 * samples by their labels, and a click starts a run with one. The board then follows the newest
 * run, so the circuit lights up as its events are stored. A native disclosure, so it opens and
 * closes without state of its own.
 */

export interface TryoutProps {
  readonly samples: CircuitInfo['samples'];
  readonly command: CommandState;
  /** Absent where nothing can be sent, as in a rendering to a string. */
  readonly onTryout?: ((sampleId: string) => void) | undefined;
}

export function Tryout({ samples, command, onTryout }: TryoutProps) {
  if (samples.length === 0) return null;
  const off = command.status === 'sending' || onTryout === undefined;
  const problem = command.status === 'failed' && command.kind === 'tryout' && command.problem !== null ? COMMAND_TEXTS[command.problem].text : null;
  const choose = (event: MouseEvent<HTMLButtonElement>, sampleId: string) => {
    // The list closes as the run starts: the circuit is what is worth looking at now.
    event.currentTarget.closest('details')?.removeAttribute('open');
    onTryout?.(sampleId);
  };
  return (
    <div className="tryout" data-tryout>
      {/* Outside the disclosure, so a refusal shows with the list closed. */}
      {problem === null ? null : (
        <p className="tryout__problem" role="alert">
          {problem}
        </p>
      )}
      <details>
        <summary className="tryout__open">{TRYOUT_TEXTS.open.text}</summary>
        <div className="tryout__menu">
          <p className="tryout__hint">{TRYOUT_TEXTS.hint.text}</p>
          <ul>
            {samples.map((sample) => (
              <li key={sample.id}>
                <button type="button" data-sample={sample.id} disabled={off} onClick={(event) => choose(event, sample.id)}>
                  {sample.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
