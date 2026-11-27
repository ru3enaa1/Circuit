import type { CSSProperties } from 'react';

import type { CrewMove } from '../crew-moves.ts';
import { accentOf, type CrewFigure } from '../crew.ts';
import { POSE_BOX, type Accent, type Joint, type Pose } from '../crew-poses.ts';

/**
 * The crew on the tubes (docs/diseno.md §11): each figure as B7 draws it, a short flat shadow,
 * limbs of line, joints of dot and a head of ball, with its props in the palette's colors.
 * Decoration: hidden from assistive technology. A figure that mounts arrives (ADR-0019): it walks in
 * along a line and the tubes, or steps out of a door on its spot; once the run closes, one walks to
 * Cierre and slides down the last line. The way comes from crew-moves.ts as custom properties, and
 * motion.css walks it once: no state and no timer here.
 */

const COLORS: Readonly<Record<Accent, string>> = {
  yellow: 'var(--yellow)',
  pink: 'var(--pink)',
  bone: 'var(--bone)',
  background: 'var(--bg)',
};

const HEAD = 11;
const JOINT = 3.2;
const SHADOW_HEIGHT = 2.6;
const SHADOW_EXTRA = 9;

/** The door a figure steps out of, in the pose's box: as wide as a figure with its arms down. */
const DOOR_WIDTH = 50;
const DOOR_KNOB = 3.2;
/** The door reaches from the floor to this far above the head's center, as the figure's cover does. */
const DOOR_ABOVE_HEAD = 12;

const circle = ([x, y]: Joint, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const line = (...points: readonly Joint[]) => `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`;

function limbs(pose: Pose): string {
  return (
    line(pose.head, pose.neck, pose.hip) +
    line(pose.neck, pose.elbows[0], pose.hands[0]) +
    line(pose.neck, pose.elbows[1], pose.hands[1]) +
    line(pose.hip, pose.knees[0], pose.feet[0]) +
    line(pose.hip, pose.knees[1], pose.feet[1])
  );
}

function joints(pose: Pose): string {
  return circle(pose.head, HEAD) + [pose.neck, pose.hip, ...pose.elbows, ...pose.hands, ...pose.knees, ...pose.feet].map((joint) => circle(joint, JOINT)).join('');
}

/** The door of B7's lines and dots: a dark doorway in a bone frame, and a leaf that swings open on its hinge. */
function Door({ pose }: { readonly pose: Pose }) {
  const feetX = (pose.feet[0][0] + pose.feet[1][0]) / 2;
  const top = pose.top ?? pose.head[1] - DOOR_ABOVE_HEAD;
  const x = feetX - DOOR_WIDTH / 2;
  const height = POSE_BOX.feet - top;
  return (
    <g className="crew__door">
      <rect className="crew__door-way" x={x} y={top} width={DOOR_WIDTH} height={height} />
      <g className="crew__door-leaf">
        <rect className="crew__door-panel" x={x} y={top} width={DOOR_WIDTH} height={height} />
        <path className="crew__door-knob" d={circle([x + DOOR_WIDTH - 9, top + height * 0.55], DOOR_KNOB)} />
      </g>
    </g>
  );
}

const px = (value: number) => `${value}px`;

/** The way as the custom properties motion.css reads: --w0x … --w16x, the time and the start. */
function walkStyle(move: CrewMove): CSSProperties {
  const points = Object.fromEntries(move.walk.flatMap((point, index) => [[`--w${index}x`, px(point.x)], [`--w${index}y`, px(point.y)]]));
  return { ...points, '--walk-ms': `${move.walkMs}ms`, '--walk-at': `${move.atMs}ms` } as CSSProperties;
}

function slideStyle(move: CrewMove): CSSProperties | undefined {
  const { slide } = move;
  if (slide === null) return undefined;
  return {
    '--slide-x': px(slide.by.x),
    '--slide-y': px(slide.by.y),
    '--slide-turn': `${slide.turn}deg`,
    '--slide-at': `${slide.atMs}ms`,
    transformOrigin: `${px(slide.origin.x)} ${px(slide.origin.y)}`,
  } as CSSProperties;
}

function Figure({ figure }: { readonly figure: CrewFigure }) {
  const { pose } = figure;
  const [left, right] = pose.feet;
  const shadowX = (left[0] + right[0]) / 2 + 3;
  const round = (value: number) => Math.round(value * 100) / 100;
  return (
    <g className="crew__figure" data-pose={pose.id} transform={`translate(${round(figure.x)} ${round(figure.y)}) scale(${round(figure.scale)})`}>
      {figure.move.kind === 'door' ? <Door pose={pose} /> : null}
      {/* The body takes the entrance's transform: the figure's own place stays in its attribute (ADR-0018). */}
      <g className="crew__body">
        {/* A sitting figure casts no shadow on the floor: it sits on the tube. */}
        {pose.seat === undefined ? <ellipse className="crew__shadow" cx={shadowX} cy={POSE_BOX.feet + 3} rx={Math.abs(right[0] - left[0]) / 2 + SHADOW_EXTRA} ry={SHADOW_HEIGHT} /> : null}
        <path className="crew__limbs" d={limbs(pose)} />
        <path className="crew__joints" d={joints(pose)} />
        {pose.props.map((prop, index) => (
          <path
            key={`${pose.id}-${index}`}
            d={prop.d}
            fill={prop.fill === null ? 'none' : COLORS[accentOf(prop.fill, figure.pinkAsYellow)]}
            stroke={prop.stroke === null ? 'none' : COLORS[accentOf(prop.stroke, figure.pinkAsYellow)]}
            strokeWidth={prop.width === 0 ? undefined : prop.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </g>
  );
}

/** The figure walks its way (or waits at its door), inside the slide when it is the one that leaves. */
function Journey({ figure }: { readonly figure: CrewFigure }) {
  const { move } = figure;
  const walk = (
    <g className={`crew__walk is-${move.kind}`} data-figure={figureKey(figure)} style={walkStyle(move)}>
      <Figure figure={figure} />
    </g>
  );
  return move.slide === null ? walk : <g className="crew__slide" data-figure={figureKey(figure)} style={slideStyle(move)}>{walk}</g>;
}

/**
 * A figure is the same one only on the same spot, so one that moves enters again where it lands and
 * never jumps (ADR-0018); the one that leaves mounts anew, so its slide starts when the run closes.
 */
export function figureKey(figure: CrewFigure): string {
  return figure.move.kind === 'leave' ? `${figure.key}@sale` : figure.key;
}

export function Crew({ figures }: { readonly figures: readonly CrewFigure[] }) {
  if (figures.length === 0) return null;
  return (
    <g className="crew" aria-hidden="true">
      {figures.map((figure) => (
        <Journey key={figureKey(figure)} figure={figure} />
      ))}
    </g>
  );
}
