import { STATION_ANGLES } from './layout.ts';

/**
 * The orbit in small (docs/diseno.md §12, ADR-0014 G1–G2): where each ball and each neck goes in
 * a box from -50 to 50. The portal's miniature and the logo are the same figure with other
 * sizes, so both place their balls here. Pure: no React, no DOM.
 */

export const MARK_VIEWBOX = '-50 -50 100 100';
/** Half the box: nothing drawn may reach past it. */
export const MARK_HALF = 50;

export interface MarkPoint {
  readonly x: number;
  readonly y: number;
}

export interface MarkSizes {
  /** Distance from the center to the balls around it. */
  readonly orbit: number;
  readonly station: number;
  /** Radius of the station at the center. */
  readonly center: number;
}

export interface MarkDot extends MarkPoint {
  readonly id: string;
  readonly r: number;
  readonly center: boolean;
}

export interface MarkNeck {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** A station the design has no angle for goes to the bottom, as the portal always did. */
const FALLBACK_ANGLE = 90;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
/** One decimal: enough at any size the board draws, and the markup stays short. */
export const round = (value: number) => Math.round(value * 10) / 10;

export function at(degrees: number, distance: number): MarkPoint {
  return { x: distance * Math.cos(toRadians(degrees)), y: distance * Math.sin(toRadians(degrees)) };
}

/** The station that decides at the center, the others around it at their angles (§6). */
export function markDots(
  stations: readonly { readonly id: string; readonly center: boolean }[],
  sizes: MarkSizes,
  angles: Readonly<Record<string, number>> = STATION_ANGLES,
): MarkDot[] {
  return stations.map(({ id, center }) => {
    const place = center ? { x: 0, y: 0 } : at(angles[id] ?? FALLBACK_ANGLE, sizes.orbit);
    return { id, center, x: round(place.x), y: round(place.y), r: center ? sizes.center : sizes.station };
  });
}

/** A neck from the edge of one ball to the edge of the other, so a hollow ball stays empty inside. */
export function markNeck(from: MarkDot, to: MarkDot): MarkNeck {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  return { x1: round(from.x + ux * from.r), y1: round(from.y + uy * from.r), x2: round(to.x - ux * to.r), y2: round(to.y - uy * to.r) };
}
