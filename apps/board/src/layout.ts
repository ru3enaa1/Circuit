import type { CircuitStation } from './api.ts';

/**
 * The orbit (docs/diseno.md §6 and §9): Persona at the center, the other stations around it on
 * an ellipse, in the order of the route and clockwise. The page is recomposed for each window,
 * never scaled: R, the ellipse and what fits are computed again. Pure: a size gives a layout.
 */

/** The working size (§3): a 1920×1080 laptop at Windows' 125 % scale. */
export const WORK_WIDTH = 1536;
export const WORK_HEIGHT = 864;
const BASE_RADIUS = 50;
const MIN_RADIUS = 33;
const MAX_RADIUS = 80;
/** Persona is the station that decides, and the figure says so by its size (§6). */
export const CENTER_SCALE = 1.3;
/** Past this, the ellipse stops widening and leaves room for the side panels (§9, F2.3c). */
const MAX_ELLIPSE_RATIO = 2.2;
/** Narrower than this (half a screen), the header stacks and the ellipse turns tall (§9). */
const NARROW_RATIO = 1.05;
/** On half a screen the ellipse turns tall (§9): its width stays under its height. */
const NARROW_ELLIPSE_RATIO = 0.95;
/** Below this R the telemetry shows the duration only (§9, 1280×720). */
const SHORT_TELEMETRY_BELOW = 45;

/** Degrees, 0 to the right and growing downwards, as the screen's y (§6). */
export const STATION_ANGLES: Readonly<Record<string, number>> = {
  intake: 195,
  filter: 242,
  classification: 305,
  knowledge: 10,
  crm: 65,
  close: 130,
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface StationPlace extends Point {
  readonly r: number;
  /** Null for the station at the center. */
  readonly angle: number | null;
  /** Where its texts go: away from the center. */
  readonly side: 'left' | 'right' | 'center';
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly center: Point;
  readonly rx: number;
  readonly ry: number;
  /** Half a screen: the dock shows numbers only, the texts are shorter. */
  readonly narrow: boolean;
  /** Small bubbles: the telemetry says the duration only. */
  readonly shortTelemetry: boolean;
  /** Room kept at the top for the request and the clock, and at the bottom for the dock. */
  readonly top: number;
  readonly bottom: number;
  readonly places: Readonly<Record<string, StationPlace>>;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** R = clamp(50 × min(width/1536, height/864), 33, 80) (§9). */
export function radiusFor(width: number, height: number): number {
  return clamp(BASE_RADIUS * Math.min(width / WORK_WIDTH, height / WORK_HEIGHT), MIN_RADIUS, MAX_RADIUS);
}

/** The point of the ellipse at an angle. */
export function onEllipse(center: Point, rx: number, ry: number, degrees: number): Point {
  return { x: center.x + rx * Math.cos(toRadians(degrees)), y: center.y + ry * Math.sin(toRadians(degrees)) };
}

/** Stations the table adds and the design has no angle for share the free bottom of the orbit. */
function angleOf(id: string, index: number): number {
  return STATION_ANGLES[id] ?? 90 + index * 12;
}

export function layoutFor(width: number, height: number, stations: readonly CircuitStation[]): Layout {
  const radius = radiusFor(width, height);
  const scale = radius / BASE_RADIUS;
  const narrow = width / height < NARROW_RATIO;
  // The header takes two lines and the request's text; the dock, one row of pills.
  const top = (narrow ? 190 : 150) * Math.min(1, height / WORK_HEIGHT) + radius * 0.4;
  const bottom = 96 * Math.min(1, height / WORK_HEIGHT);
  const band = height - top - bottom;
  const center = { x: width / 2, y: top + band / 2 };
  // Below each bubble go its name and its state; at the sides, its telemetry and its nodes.
  const ry = Math.max(radius * 2, band / 2 - radius - 40 * scale);
  const sideRoom = narrow ? 34 * scale : 200 * scale;
  const rx = Math.max(radius * 2, Math.min(width / 2 - radius - sideRoom, ry * (narrow ? NARROW_ELLIPSE_RATIO : MAX_ELLIPSE_RATIO)));

  const places: Record<string, StationPlace> = {};
  stations.forEach((station, index) => {
    if (station.decidedBy === 'person') {
      places[station.id] = { ...center, r: radius * CENTER_SCALE, angle: null, side: 'center' };
      return;
    }
    const angle = angleOf(station.id, index);
    const point = onEllipse(center, rx, ry, angle);
    places[station.id] = { ...point, r: radius, angle, side: point.x < center.x ? 'left' : 'right' };
  });
  return { width, height, radius, center, rx, ry, narrow, shortTelemetry: radius < SHORT_TELEMETRY_BELOW, top, bottom, places };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The arc of the ellipse from one angle to the next, clockwise: the necks between stations. */
export function ellipseArc(layout: Layout, from: number, to: number): string {
  const start = onEllipse(layout.center, layout.rx, layout.ry, from);
  const end = onEllipse(layout.center, layout.rx, layout.ry, to);
  const sweep = (to - from + 360) % 360;
  return `M ${round(start.x)} ${round(start.y)} A ${round(layout.rx)} ${round(layout.ry)} 0 ${sweep > 180 ? 1 : 0} 1 ${round(end.x)} ${round(end.y)}`;
}

export function straightPath(from: Point, to: Point): string {
  return `M ${round(from.x)} ${round(from.y)} L ${round(to.x)} ${round(to.y)}`;
}

/** A curve that bows away from the straight line, so the branch never covers a neck. */
export function curvedPath(from: Point, to: Point, bow: number): string {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const control = { x: middle.x + ((to.y - from.y) / length) * bow, y: middle.y - ((to.x - from.x) / length) * bow };
  return `M ${round(from.x)} ${round(from.y)} Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`;
}

/** The arc of a circle from the top, clockwise, over a share of the turn (0 to 1). */
export function ringArc(center: Point, r: number, share: number): string | null {
  const clamped = clamp(share, 0, 0.9999);
  if (clamped <= 0) return null;
  const start = { x: center.x, y: center.y - r };
  const angle = toRadians(clamped * 360 - 90);
  const end = { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) };
  return `M ${round(start.x)} ${round(start.y)} A ${round(r)} ${round(r)} 0 ${clamped > 0.5 ? 1 : 0} 1 ${round(end.x)} ${round(end.y)}`;
}

/** A point on a circle at a share of the turn, from the top, clockwise: the threshold's mark. */
export function ringPoint(center: Point, r: number, share: number): Point {
  const angle = toRadians(share * 360 - 90);
  return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) };
}
