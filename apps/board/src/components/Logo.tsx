import { LOGO_CORNER, LOGO_HOLE, LOGO_NECK_WIDTH, logoShapes, type LogoTone } from '../logo.ts';
import { MARK_HALF, MARK_VIEWBOX } from '../mark.ts';

/**
 * The logo 4a as a pure component (ADR-0014 G1, G3): the same props give the same markup, with
 * no state, no CSS and no text. It sits beside the word «Circuit», so it is hidden from screen
 * readers; with `background`, it is the tab icon (`public/favicon.svg`).
 */

export interface LogoProps {
  readonly size: number;
  readonly tone?: LogoTone;
  readonly background?: boolean;
}

export function Logo({ size, tone = 'dark', background = false }: LogoProps) {
  const shapes = logoShapes(tone);
  return (
    <svg className="logo" width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
      {background ? <rect x={-MARK_HALF} y={-MARK_HALF} width={2 * MARK_HALF} height={2 * MARK_HALF} rx={LOGO_CORNER} fill={shapes.background} /> : null}
      {shapes.necks.map((neck) => (
        <line key={neck.key} x1={neck.x1} y1={neck.y1} x2={neck.x2} y2={neck.y2} stroke={neck.color} strokeWidth={LOGO_NECK_WIDTH} strokeLinecap="round" />
      ))}
      {shapes.dots.map((dot) =>
        dot.hollow ? (
          // A ring from the hole to the edge: radius halfway, stroke as wide as the gap.
          <circle key={dot.id} cx={dot.x} cy={dot.y} r={(dot.r + LOGO_HOLE) / 2} fill="none" stroke={shapes.mark} strokeWidth={dot.r - LOGO_HOLE} />
        ) : (
          <circle key={dot.id} cx={dot.x} cy={dot.y} r={dot.r} fill={shapes.mark} />
        ),
      )}
    </svg>
  );
}
