import { ringArc, ringPoint } from '../layout.ts';
import { confidenceText, type LeftFacts, type RightFacts, type SidePanel } from '../side-panels.ts';
import { PANEL_TEXTS } from '../texts.ts';

/**
 * The two panels of an ultrawide window (docs/diseno.md §9, ADR-0014 G5), placed where
 * side-panels.ts found room and filled only with the projection's data.
 */

/** The confidence gauge: its radius, its stroke and the threshold's mark, in px. */
const GAUGE_RADIUS = 30;
const GAUGE_BOX = 76;
const MARK_IN = 6;
const MARK_OUT = 8;

function place(panel: SidePanel) {
  return { left: Math.round(panel.x - panel.w / 2), top: Math.round(panel.y - panel.h / 2), width: Math.round(panel.w), height: Math.round(panel.h) };
}

function Gauge({ value, threshold }: { readonly value: number; readonly threshold: number }) {
  const center = { x: 0, y: 0 };
  const arc = ringArc(center, GAUGE_RADIUS, value);
  const inner = ringPoint(center, GAUGE_RADIUS - MARK_IN, threshold);
  const outer = ringPoint(center, GAUGE_RADIUS + MARK_OUT, threshold);
  return (
    <svg className="side-panel__gauge" width={GAUGE_BOX} height={GAUGE_BOX} viewBox={`${-GAUGE_BOX / 2} ${-GAUGE_BOX / 2} ${GAUGE_BOX} ${GAUGE_BOX}`} aria-hidden="true">
      <circle className="confidence__track" r={GAUGE_RADIUS} />
      {arc === null ? null : <path className="confidence__value" d={arc} />}
      <line className="confidence__threshold" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
    </svg>
  );
}

function Left({ panel, facts }: { readonly panel: SidePanel; readonly facts: LeftFacts }) {
  return (
    <aside className="side-panel side-panel--left" style={place(panel)} aria-label={PANEL_TEXTS.regions.text} data-side-panel="left">
      {facts.quote === null ? null : (
        <section>
          <h3>{PANEL_TEXTS.quote.text}</h3>
          {facts.document === null ? null : <p className="side-panel__document">{facts.document}</p>}
          <p className="side-panel__quote">{`«${facts.quote}»`}</p>
        </section>
      )}
      {facts.actions.length === 0 ? null : (
        <section>
          <h3>{PANEL_TEXTS.actions.text}</h3>
          <ul>
            {facts.actions.map((action, index) => (
              <li key={`action-${index + 1}`}>{action}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function Right({ panel, facts }: { readonly panel: SidePanel; readonly facts: RightFacts }) {
  return (
    <aside className="side-panel side-panel--right" style={place(panel)} aria-label={PANEL_TEXTS.regions.text} data-side-panel="right">
      {facts.confidence === null ? null : (
        <section className="side-panel__confidence">
          <Gauge value={facts.confidence} threshold={facts.threshold} />
          <div>
            <h3>{PANEL_TEXTS.confidence.text}</h3>
            <p className="side-panel__value" data-panel-confidence>
              {confidenceText(facts.confidence)}
            </p>
          </div>
        </section>
      )}
      {facts.lines.length === 0 ? null : (
        <section>
          <h3>{PANEL_TEXTS.classified.text}</h3>
          <ul>
            {facts.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {facts.duration === null ? null : (
        <section>
          <h3>{PANEL_TEXTS.run.text}</h3>
          <p className="side-panel__totals" data-panel-duration>
            {facts.spent === null ? facts.duration : `${facts.duration} · ${facts.spent}`}
          </p>
        </section>
      )}
    </aside>
  );
}

export interface SidePanelsProps {
  readonly panels: readonly SidePanel[];
  readonly left: LeftFacts | null;
  readonly right: RightFacts | null;
}

export function SidePanels({ panels, left, right }: SidePanelsProps) {
  return (
    <>
      {panels.map((panel) => {
        if (panel.side === 'left') return left === null ? null : <Left key="left" panel={panel} facts={left} />;
        return right === null ? null : <Right key="right" panel={panel} facts={right} />;
      })}
    </>
  );
}
