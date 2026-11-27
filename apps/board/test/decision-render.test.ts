import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { JsonValue, RunEvent, RunSummary } from '../src/api.ts';
import { Board, type BoardProps } from '../src/components/Board.tsx';
import { correctedActions, correctionItems } from '../src/correction.ts';
import { CIRCUIT_ROUTE, type Route } from '../src/route.ts';
import { CATALOG, COMMAND_TEXTS, DECISION_TEXTS, TRYOUT_TEXTS } from '../src/texts.ts';
import { boardInfo, goldenEvents, goldenPersonal } from './support.ts';

// ADR-0012 on the board: Persona's room is the approval (docs/diseno.md §10), and «Probar una
// solicitud» sits beside the dock (§8). Rendered to a string, as the browser renders it (B3).

const info = boardInfo();
const normal = goldenEvents('normal');
const waiting = normal.slice(0, 5);
const PERSON: Route = { kind: 'station', station: 'person' };

function render(events: readonly RunEvent[], route: Route, overrides: Partial<BoardProps> = {}): string {
  const runs: RunSummary[] = [{ id: 12, startedAt: '2026-11-26T09:00:00.000Z', events: events.length, lastStation: events.at(-1)?.station ?? null, lastOutcome: events.at(-1)?.outcome ?? null, lastStatus: events.at(-1)?.status ?? null }];
  return renderToStaticMarkup(createElement(Board, { status: 'ready', info, tools: [], runs, runId: 12, events, width: 1536, height: 864, route, ...overrides }));
}

const attribute = (markup: string, name: string) => [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((match) => match[1]);
const proposal = (normal[4]?.detail['actions'] ?? []) as readonly JsonValue[];
const onDecide = () => undefined;

describe('the correction, as data', () => {
  it('offers the editable fields of each proposed action, with their stored values', () => {
    const items = correctionItems(proposal);

    expect(items.map((item) => [item.type, item.fields.map((field) => field.name)])).toEqual([
      ['add_note', ['body-0']],
      ['move_stage', ['stage-1']],
      ['create_task', ['title-2', 'dueOn-2']],
    ]);
    expect(items[2]?.fields[1]).toMatchObject({ value: '2026-12-01', date: true });
  });

  it('gives back the kept actions, in order, with what was typed; an empty due date is none', () => {
    const typed: Record<string, string> = { 'keep-0': 'on', 'body-0': 'Otra nota.', 'keep-2': 'on', 'title-2': 'Llamar', 'dueOn-2': '' };

    expect(correctedActions(proposal, (name) => typed[name] ?? null)).toEqual([
      { type: 'add_note', body: 'Otra nota.' },
      { type: 'create_task', title: 'Llamar', dueOn: null },
    ]);
  });

  it('a new contact keeps its proposed name: the room never shows it, so the form never edits it', () => {
    const actions = [{ type: 'create_contact', fullName: 'Mateo Vélez', email: 'mateo@rutaclara.test' }, { type: 'add_note', body: 'Nota.' }];
    const items = correctionItems(actions);

    expect(items[0]?.fields).toEqual([]);
    expect(correctedActions(actions, (name) => (name.startsWith('keep-') ? 'on' : null))).toEqual([
      { type: 'create_contact', fullName: 'Mateo Vélez' },
      { type: 'add_note', body: 'Nota.' },
    ]);
  });

  it('leaves out an action of a type the board does not know', () => {
    expect(correctionItems([{ type: 'delete_contact' }, { type: 'add_note', body: 'x' }]).map((item) => item.index)).toEqual([1]);
  });
});

describe("Persona's room while it waits", () => {
  it('draws Approve, Correct and Reject, and the correction form with every proposed action kept', () => {
    const markup = render(waiting, PERSON, { onDecide });

    expect(attribute(markup, 'data-way')).toEqual(['approved', 'corrected', 'rejected']);
    expect(attribute(markup, 'data-correction')).toEqual(['0', '1', '2']);
    expect(markup).toContain('name="keep-0" checked=""');
    expect(markup).toContain('value="programa-propuesto"');
    expect(markup).toContain(DECISION_TEXTS.approveCorrection.text);
    expect(markup).not.toMatch(/<button[^>]*disabled/);
  });

  it('says who signs and how the CRM will find it: the mentor and run-<id>', () => {
    const markup = render(waiting, PERSON, { onDecide });

    expect(markup).toContain(`${DECISION_TEXTS.signedBy.text} <strong>mentor</strong>`);
    expect(markup).toContain('<code>run-12</code>');
  });

  it('while a decision is on its way, every button is off and it says so', () => {
    const markup = render(waiting, PERSON, { onDecide, command: { status: 'sending', kind: 'decision', problem: null, field: null } });

    expect(markup.match(/<button[^>]*disabled/g)).toHaveLength(3);
    expect(markup).toContain(DECISION_TEXTS.sending.text);
  });

  it.each([
    [{ problem: 'conflict', field: null }, COMMAND_TEXTS.conflict.text],
    [{ problem: 'invalid', field: 'actions[0].body' }, `${COMMAND_TEXTS.invalid.text} «actions[0].body».`],
    [{ problem: 'unreachable', field: null }, COMMAND_TEXTS.unreachable.text],
  ] as const)('a refused decision says why: %j', (refusal, text) => {
    const markup = render(waiting, PERSON, { onDecide, command: { status: 'failed', kind: 'decision', ...refusal } });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(text);
  });

  it('a complaint has nothing proposed: no correction, and approving closes without writing', () => {
    const complaint = goldenEvents('complaint');
    const markup = render(complaint.slice(0, 3), PERSON, { onDecide });

    expect(attribute(markup, 'data-way')).toEqual(['approved', 'rejected']);
    expect(markup).toContain(DECISION_TEXTS.nothingProposed.text);
  });

  it('without a way to send, the buttons are drawn and off', () => {
    const markup = render(waiting, PERSON);

    expect(markup.match(/<button[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('the orbit says «entrar para decidir» beside Persona while it waits', () => {
    expect(render(waiting, CIRCUIT_ROUTE)).toContain(DECISION_TEXTS.enterToDecide.text);
    expect(render(normal, CIRCUIT_ROUTE)).not.toContain(DECISION_TEXTS.enterToDecide.text);
  });

  it('shows nothing the filter crossed out, the new contact\'s e-mail included', () => {
    const markup = render(waiting, PERSON, { onDecide });

    for (const value of goldenPersonal('normal')) expect(markup).not.toContain(value);
  });
});

describe('«Probar una solicitud»', () => {
  it('lists the scenario\'s samples by their labels, never their text', () => {
    const markup = render(normal, CIRCUIT_ROUTE, { onTryout: () => undefined });

    expect(markup).toContain(TRYOUT_TEXTS.open.text);
    expect(attribute(markup, 'data-sample')).toEqual(info.samples.map((sample) => sample.id));
    for (const sample of info.samples) expect(markup).toContain(sample.label);
    expect(markup).not.toContain('lucia@hiloverde.test');
  });

  it('is not drawn inside a room, and a refused tryout says why', () => {
    expect(render(normal, PERSON)).not.toContain('data-tryout');
    const markup = render(normal, CIRCUIT_ROUTE, { onTryout: () => undefined, command: { status: 'failed', kind: 'tryout', problem: 'unreachable', field: null } });

    expect(markup).toContain(COMMAND_TEXTS.unreachable.text);
  });

  it('a refused decision does not show beside the tryout, nor a refused tryout in the room', () => {
    const decision = render(normal, CIRCUIT_ROUTE, { command: { status: 'failed', kind: 'decision', problem: 'conflict', field: null } });
    const tryout = render(waiting, PERSON, { command: { status: 'failed', kind: 'tryout', problem: 'unreachable', field: null } });

    expect(decision).not.toContain(COMMAND_TEXTS.conflict.text);
    expect(tryout).not.toContain(COMMAND_TEXTS.unreachable.text);
  });
});

describe('the texts of the commands', () => {
  it('are in the catalog, and serious', () => {
    for (const group of [DECISION_TEXTS, COMMAND_TEXTS, TRYOUT_TEXTS]) {
      expect(CATALOG).toContain(group);
      for (const entry of Object.values(group)) expect(entry.tone).toBe('serio');
    }
  });
});
