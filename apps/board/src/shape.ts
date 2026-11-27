import type { Point } from './layout.ts';

/**
 * The drawing of a station and its tubes as boceto B1 draws them (docs/diseno.md §5 and §6): a
 * bubble whose nodes are small bubbles on arms, joined to it by a metaball neck, and tubes of two
 * rails. Pure geometry: sizes in, SVG paths out, the same every time.
 */

/** A node's bubble, against the station's R. */
export const ARM_SCALE = 0.27;
/** The free space between the bubble and a node's bubble, against R. */
const ARM_GAP = 0.3;
/** The black dot inside a node's bubble when its station is filled, against the node's radius. */
export const DOT_SCALE = 0.3;
/** The outer ring, where the time arc runs, against the bubble's radius. */
export const OUTER_RING_SCALE = 2.5;
/** The inner ring sits this far past the nodes. */
export const INNER_RING_GAP = 5;
/** The tube: its width against R, and the dark core that leaves the two rails. */
export const TUBE_SCALE = 0.32;
export const RAIL_WIDTH = 1.3;
/** The yellow ring of the station the run is on, outside the bubble, in px. */
export const SELECTION_GAP = 9;
/** The confidence arc, just outside Clasificación's bubble, in px. */
export const CONFIDENCE_GAP = 6;
/** The nodes are spread at least and at most this far apart, in radians. */
const MIN_ARM_SPACING = 0.44;
const MAX_ARM_SPACING = 0.62;
/** The neck's waist: 0.5 is the boceto's, a soft join that never reaches a full tube. */
const NECK_SPREAD = 0.5;
const NECK_HANDLE = 2.4;

const TURN = 2 * Math.PI;
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const pair = (point: Point) => `${round(point.x)} ${round(point.y)}`;
const toward = (from: Point, angle: number, distance: number): Point => ({ x: from.x + distance * Math.cos(angle), y: from.y + distance * Math.sin(angle) });

export function armRadius(radius: number): number {
  return radius * ARM_SCALE;
}

/** From the station's center to a node's center. */
export function armDistance(stationRadius: number, radius: number): number {
  return stationRadius + armRadius(radius) + radius * ARM_GAP;
}

/** A whole circle as a path, so it joins the other parts of a bubble in one shape. */
export function circlePath(center: Point, r: number): string {
  const d = round(2 * r);
  return `M${round(center.x - r)} ${round(center.y)}a${round(r)} ${round(r)} 0 1 0 ${d} 0a${round(r)} ${round(r)} 0 1 0 ${-d} 0Z`;
}

/** An arc of a circle, clockwise, between two angles in radians. */
export function arcPath(center: Point, r: number, from: number, to: number): string {
  const start = toward(center, from, r);
  const end = toward(center, to, r);
  return `M${pair(start)}A${round(r)} ${round(r)} 0 ${to - from > Math.PI ? 1 : 0} 1 ${pair(end)}`;
}

export function segmentPath(from: Point, to: Point): string {
  return `M${pair(from)}L${pair(to)}`;
}

/**
 * One strand of the braid that crosses a tube while the request travels (ADR-0019): a wave around
 * the segment, half a wave per step, so two strands of opposite `side` cross at every step. The first
 * half-wave is a quadratic curve and each `T` reflects its control point, so the wave alternates
 * sides with one number per step. Its peak is `amplitude` away from the tube's center line.
 */
export function braidPath(from: Point, to: Point, amplitude: number, wavelength: number, side: 1 | -1): string {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return `M${pair(from)}`;
  const steps = Math.max(2, Math.round((2 * length) / wavelength));
  const step = { x: (to.x - from.x) / steps, y: (to.y - from.y) / steps };
  // A quadratic curve reaches half way to its control point: twice the amplitude gives the peak.
  const lift = (2 * amplitude * side) / length;
  const control = { x: from.x + step.x / 2 - (to.y - from.y) * lift, y: from.y + step.y / 2 + (to.x - from.x) * lift };
  const at = (index: number) => ({ x: from.x + step.x * index, y: from.y + step.y * index });
  const rest = Array.from({ length: steps - 1 }, (_, index) => `T${pair(at(index + 2))}`).join('');
  return `M${pair(from)}Q${pair(control)} ${pair(at(1))}${rest}`;
}

/** The soft neck between two circles (a metaball join), as the boceto draws it. */
export function neckPath(c1: Point, r1: number, c2: Point, r2: number): string {
  const distance = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const spread = Math.acos(clamp((r1 - r2) / distance, -1, 1));
  const a1a = angle + spread * NECK_SPREAD;
  const a1b = angle - spread * NECK_SPREAD;
  const a2a = angle + Math.PI - (Math.PI - spread) * NECK_SPREAD;
  const a2b = angle - Math.PI + (Math.PI - spread) * NECK_SPREAD;
  const p1a = toward(c1, a1a, r1);
  const p1b = toward(c1, a1b, r1);
  const p2a = toward(c2, a2a, r2);
  const p2b = toward(c2, a2b, r2);
  const handle = Math.min(NECK_SPREAD * NECK_HANDLE, Math.hypot(p1a.x - p2a.x, p1a.y - p2a.y) / (r1 + r2));
  const h1 = r1 * handle;
  const h2 = r2 * handle;
  return (
    `M${pair(p1a)}C${pair(toward(p1a, a1a - Math.PI / 2, h1))} ${pair(toward(p2a, a2a + Math.PI / 2, h2))} ${pair(p2a)}` +
    `L${pair(p2b)}C${pair(toward(p2b, a2b - Math.PI / 2, h2))} ${pair(toward(p1b, a1b + Math.PI / 2, h1))} ${pair(p1b)}Z`
  );
}

const normalized = (angle: number) => ((angle % TURN) + TURN) % TURN;

export interface ArmPlan {
  /** Where each node goes, in radians, 0 to the right and growing downwards. */
  readonly arms: readonly number[];
  /** The slot in the middle of the nodes, kept for the telemetry's guide line. */
  readonly lead: number;
}

/**
 * The nodes go in the widest gap between the station's connections (its tubes and its lines to
 * the edge), spread around its middle, with the middle slot left for the telemetry: what the
 * boceto does, so no node ever sits on a tube.
 */
export function planArms(connections: readonly number[], count: number): ArmPlan {
  const angles = connections.map(normalized).sort((a, b) => a - b);
  let gap = TURN;
  let start = 0;
  if (angles.length > 1) {
    gap = 0;
    angles.forEach((angle, index) => {
      const next = angles[index + 1] ?? (angles[0] ?? 0) + TURN;
      if (next - angle > gap) {
        gap = next - angle;
        start = angle;
      }
    });
  } else if (angles.length === 1) start = angles[0] ?? 0;
  const middle = start + gap / 2;
  const slots = count + 1;
  const spacing = count === 0 ? 0 : clamp((gap - 1) / count, MIN_ARM_SPACING, MAX_ARM_SPACING);
  const leadSlot = Math.floor(slots / 2);
  const at = (slot: number) => middle + (slot - (slots - 1) / 2) * spacing;
  const arms = Array.from({ length: slots }, (_, slot) => slot).filter((slot) => slot !== leadSlot).map(at);
  return { arms, lead: count === 0 ? middle : at(leadSlot) };
}

export interface Arm {
  readonly angle: number;
  readonly center: Point;
  readonly r: number;
}

export function armsOf(center: Point, stationRadius: number, radius: number, angles: readonly number[]): readonly Arm[] {
  const distance = armDistance(stationRadius, radius);
  return angles.map((angle) => ({ angle, center: toward(center, angle, distance), r: armRadius(radius) }));
}

/** The bubble, its nodes and the necks that join them: one shape, filled or outlined as one. */
export function bubblePath(center: Point, stationRadius: number, arms: readonly Arm[]): string {
  return circlePath(center, stationRadius) + arms.map((arm) => circlePath(arm.center, arm.r) + neckPath(center, stationRadius, arm.center, arm.r)).join('');
}

export { toward };
