import type { FormEvent } from 'react';

import type { CircuitInfo, JsonValue } from '../api.ts';
import { correctedActions, correctionItems, type CorrectionItem } from '../correction.ts';
import { ICON_BOX, STOP_ICON } from '../icons.ts';
import { COMMAND_TEXTS, DECISION_TEXTS, ROOM_TEXTS } from '../texts.ts';
import type { CommandState } from '../use-run-events.ts';

/**
 * The person station's room as the approval (docs/diseno.md §10, ADR-0012): station 5's proposal
 * and its three ways out, which are the buttons. The approval lives in the circuit, never in a
 * dialog on top. It keeps no state: the correction's inputs hold what is typed and are read when
 * it is sent; whether a decision is on its way comes from the feed. What is decided reaches the
 * board as the stored events of stations 6 and 7, like everything else.
 */

/** The body of POST /api/runs/:id/decision: no approver, the server signs with CIRCUIT_MENTOR (A6, A7). */
export type DecisionBody =
  | { readonly decision: 'approved' | 'rejected' }
  | { readonly decision: 'corrected'; readonly actions: readonly Record<string, string | null>[] };

export interface DecisionCardProps {
  readonly runId: number;
  readonly info: CircuitInfo;
  /** Station 5's proposal as stored. */
  readonly actions: readonly JsonValue[];
  readonly command: CommandState;
  /** Absent where nothing can be sent, as in a rendering to a string: the buttons are drawn, off. */
  readonly onDecide?: ((runId: number, body: DecisionBody) => void) | undefined;
}

function problemText(command: CommandState): string | null {
  if (command.status !== 'failed' || command.kind !== 'decision' || command.problem === null) return null;
  const text = COMMAND_TEXTS[command.problem].text;
  return command.problem === 'invalid' && command.field !== null ? `${text} «${command.field}».` : text;
}

function CorrectionFields({ item }: { readonly item: CorrectionItem }) {
  return (
    <fieldset className="correction" data-correction={item.index}>
      <legend>
        <label className="correction__keep">
          <input type="checkbox" name={item.keep} defaultChecked aria-label={`${DECISION_TEXTS.keep.text} ${item.name}`} />
          <span>{item.name}</span>
        </label>
      </legend>
      {item.fields.map((field) => (
        <label key={field.name} className="correction__field">
          <span>{field.label}</span>
          {field.multiline ? (
            <textarea name={field.name} defaultValue={field.value} rows={3} />
          ) : (
            <input type={field.date ? 'date' : 'text'} name={field.name} defaultValue={field.value} />
          )}
        </label>
      ))}
    </fieldset>
  );
}

function StopMark() {
  return (
    <svg className="decision__icon" width="14" height="14" viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`} aria-hidden="true">
      <path d={STOP_ICON} />
    </svg>
  );
}

export function DecisionCard({ runId, info, actions, command, onDecide }: DecisionCardProps) {
  const items = correctionItems(actions);
  const off = command.status === 'sending' || onDecide === undefined;
  const sending = command.status === 'sending' && command.kind === 'decision';
  const problem = problemText(command);
  const correct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : null;
    };
    onDecide?.(runId, { decision: 'corrected', actions: correctedActions(actions, read) });
  };
  return (
    <section className="room__block decision" data-decision-card aria-busy={sending}>
      <h3>{ROOM_TEXTS.decision.text}</h3>
      {actions.length === 0 ? <p className="decision__note">{DECISION_TEXTS.nothingProposed.text}</p> : null}
      <div className="decision__ways">
        <button type="button" className="way way--approve" data-way="approved" disabled={off} onClick={() => onDecide?.(runId, { decision: 'approved' })}>
          {DECISION_TEXTS.approve.text}
        </button>
        {items.length === 0 ? null : (
          <details className="decision__correct" data-way="corrected">
            <summary className="way way--correct">{DECISION_TEXTS.correct.text}</summary>
            <form className="correction-form" onSubmit={correct}>
              {items.map((item) => (
                <CorrectionFields key={item.index} item={item} />
              ))}
              <button type="submit" className="way way--approve" disabled={off}>
                {DECISION_TEXTS.approveCorrection.text}
              </button>
            </form>
          </details>
        )}
        <button type="button" className="way way--reject" data-way="rejected" disabled={off} onClick={() => onDecide?.(runId, { decision: 'rejected' })}>
          <StopMark />
          {DECISION_TEXTS.reject.text}
        </button>
      </div>
      <p className="decision__signed">
        {DECISION_TEXTS.signedBy.text} <strong>{info.mentor}</strong> · <code>{`run-${runId}`}</code>
      </p>
      {sending ? (
        <p className="decision__status" role="status">
          {DECISION_TEXTS.sending.text}
        </p>
      ) : null}
      {problem === null ? null : (
        <p className="decision__problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
