import { STATION_ANGLES } from './layout.ts';
import { markDots, markNeck, type MarkDot, type MarkNeck, type MarkSizes } from './mark.ts';

/**
 * The logo 4a (docs/diseno.md §12, ADR-0014 G1): the orbit of §6 in a 100 × 100 box. It is a
 * brand mark, so its stations are fixed here and do not follow the scenario's table. Colors go
 * as values, not CSS, so the same markup is the page's logo and the tab's icon (G3).
 */

export type LogoTone = 'dark' | 'light';

/** §12: Persona of radius 11,5 with a hole of 6; the others of 7,6 on a circle of 39. */
const LOGO_SIZES: MarkSizes = { orbit: 39, station: 7.6, center: 11.5 };
export const LOGO_HOLE = 6;
export const LOGO_NECK_WIDTH = 2.4;
/** The tab icon's square; rounded so it reads as a tile on any tab bar. */
export const LOGO_CORNER = 18;
/** Filtro moves from 242° to 250° so the mark breathes at 16 px (§12). */
const LOGO_ANGLES: Readonly<Record<string, number>> = { ...STATION_ANGLES, filter: 250 };

/** The palette of §4. */
const BONE = '#F3F1EC';
const BLACK = '#0A0A0B';
const YELLOW = '#FFD23F';
const PINK = '#FF5FA2';

const TONES: Readonly<Record<LogoTone, { readonly mark: string; readonly background: string }>> = {
  dark: { mark: BONE, background: BLACK },
  light: { mark: BLACK, background: BONE },
};

const CENTER = 'person';
const AROUND = ['intake', 'filter', 'classification', 'knowledge', 'crm', 'close'] as const;

type NeckColor = 'mark' | 'branch' | 'arrival';
/** 1→2→3→4→5 and Persona→Cierre in the mark's color; the branch in yellow; CRM→Persona in pink. */
const NECKS: readonly (readonly [string, string, NeckColor])[] = [
  ['intake', 'filter', 'mark'],
  ['filter', 'classification', 'mark'],
  ['classification', 'knowledge', 'mark'],
  ['knowledge', 'crm', 'mark'],
  ['person', 'close', 'mark'],
  ['classification', 'person', 'branch'],
  ['crm', 'person', 'arrival'],
];

export interface LogoNeck extends MarkNeck {
  readonly key: string;
  readonly color: string;
}

export interface LogoDot extends MarkDot {
  /** Persona is a ring: drawn as a stroke between the hole and the edge. */
  readonly hollow: boolean;
}

export interface LogoShapes {
  readonly background: string;
  readonly mark: string;
  readonly necks: readonly LogoNeck[];
  readonly dots: readonly LogoDot[];
}

export function logoShapes(tone: LogoTone): LogoShapes {
  const colors = TONES[tone];
  const dots = markDots([...AROUND.map((id) => ({ id, center: false })), { id: CENTER, center: true }], LOGO_SIZES, LOGO_ANGLES);
  const byId = new Map(dots.map((dot) => [dot.id, dot]));
  const necks = NECKS.map(([from, to, color]) => ({
    key: `${from}>${to}`,
    color: color === 'branch' ? YELLOW : color === 'arrival' ? PINK : colors.mark,
    ...markNeck(byId.get(from)!, byId.get(to)!),
  }));
  return { background: colors.background, mark: colors.mark, necks, dots: dots.map((dot) => ({ ...dot, hollow: dot.center })) };
}
