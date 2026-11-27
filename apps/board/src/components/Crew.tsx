import { accentOf, type CrewFigure } from '../crew.ts';
import { POSE_BOX, type Accent, type Joint, type Pose } from '../crew-poses.ts';

/**
 * The crew on the tubes (docs/diseno.md §11): each figure as B7 draws it, a short flat shadow,
 * limbs of line, joints of dot and a head of ball, with its props in the palette's colors.
 * Decoration: hidden from assistive technology, and it never moves (nothing here animates).
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

function Figure({ figure }: { readonly figure: CrewFigure }) {
  const { pose } = figure;
  const [left, right] = pose.feet;
  const shadowX = (left[0] + right[0]) / 2 + 3;
  const round = (value: number) => Math.round(value * 100) / 100;
  return (
    <g className="crew__figure" data-pose={pose.id} transform={`translate(${round(figure.x)} ${round(figure.y)}) scale(${round(figure.scale)})`}>
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
  );
}

export function Crew({ figures }: { readonly figures: readonly CrewFigure[] }) {
  if (figures.length === 0) return null;
  return (
    <g className="crew" aria-hidden="true">
      {figures.map((figure) => (
        <Figure key={figure.pose.id} figure={figure} />
      ))}
    </g>
  );
}
