/**
 * The crew's twelve poses (docs/diseno.md §11), from the owner's sprite sheet B7: one stick
 * figure in the circuit's own language (a ball for a head, dots for joints, lines for limbs) in a
 * 120 × 140 box, its feet at y = 124. Six of play and six serious. Data only: crew.ts chooses and
 * places them, Crew.tsx draws them.
 */

export type Joint = readonly [number, number];
export type Accent = 'yellow' | 'pink' | 'bone' | 'background';

/** A shape of the pose beyond the body: a path, filled or stroked in one of the palette's colors. */
export interface Prop {
  readonly d: string;
  readonly fill: Accent | null;
  readonly stroke: Accent | null;
  readonly width: number;
}

export interface Pose {
  readonly id: string;
  readonly tone: 'juego' | 'serio';
  readonly head: Joint;
  readonly neck: Joint;
  readonly hip: Joint;
  readonly elbows: readonly [Joint, Joint];
  readonly hands: readonly [Joint, Joint];
  readonly knees: readonly [Joint, Joint];
  readonly feet: readonly [Joint, Joint];
  readonly props: readonly Prop[];
  /** Sitting on a tube: its seat is at this y of the box, and it is placed on the tube's center. */
  readonly seat?: number;
  /** The highest point of the pose, when a prop reaches above its head (the top hat). */
  readonly top?: number;
  /** The station whose tubes it prefers, as B7 tells it («escudo frente a Filtro»). */
  readonly near?: string;
}

/** The box of every pose, and where the feet stand. */
export const POSE_BOX = { width: 120, height: 140, feet: 124 } as const;

const circle = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const filled = (d: string, fill: Accent): Prop => ({ d, fill, stroke: null, width: 0 });
const stroked = (d: string, stroke: Accent, width: number): Prop => ({ d, fill: null, stroke, width });
const cap = (head: Joint, color: Accent): Prop => filled(`M${head[0] - 12} ${head[1] - 4}a12 12 0 0 1 24 0z`, color);
const brim = (head: Joint, color: Accent): Prop => stroked(`M${head[0] - 15} ${head[1] - 4}H${head[0] + 15}`, color, 3);

const STANDING = { head: [60, 30], neck: [60, 43], hip: [60, 80], knees: [[54, 102], [66, 102]], feet: [[52, 124], [68, 124]] } as const;

export const POSES: readonly Pose[] = [
  {
    id: 'barre',
    tone: 'juego',
    head: [52, 32],
    neck: [54, 45],
    hip: [58, 80],
    knees: [[50, 102], [66, 102]],
    feet: [[46, 124], [70, 124]],
    elbows: [[62, 56], [66, 64]],
    hands: [[71, 63], [76, 75]],
    props: [stroked('M66 50L92 116', 'yellow', 3), filled('M85 110L99 104L105 124L83 124Z', 'yellow')],
  },
  {
    id: 'se-asoma',
    tone: 'juego',
    head: [34, 48],
    neck: [40, 59],
    hip: [56, 88],
    knees: [[48, 106], [60, 108]],
    feet: [[44, 124], [62, 124]],
    elbows: [[44, 66], [50, 70]],
    hands: [[47, 74], [56, 78]],
    props: [{ d: circle(80, 86, 34), fill: 'background', stroke: 'bone', width: 2.5 }, filled(circle(47, 74, 3.2), 'bone'), cap([34, 48], 'pink')],
  },
  {
    id: 'empuja',
    tone: 'juego',
    head: [50, 50],
    neck: [55, 61],
    hip: [40, 92],
    knees: [[34, 108], [48, 110]],
    feet: [[20, 124], [38, 124]],
    elbows: [[60, 72], [60, 64]],
    hands: [[65, 82], [65, 68]],
    props: [{ d: circle(94, 92, 30), fill: 'background', stroke: 'bone', width: 2.5 }, cap([50, 50], 'yellow'), brim([50, 50], 'yellow')],
  },
  {
    id: 'cafe',
    tone: 'juego',
    head: [60, 40],
    neck: [60, 53],
    hip: [60, 88],
    knees: [[68, 94], [54, 94]],
    feet: [[68, 116], [54, 116]],
    elbows: [[70, 62], [54, 68]],
    hands: [[76, 54], [52, 84]],
    props: [filled('M73 44h8v9h-8z', 'pink'), stroked('M81 46h3v4h-3', 'pink', 1.5)],
    seat: 96,
  },
  {
    id: 'mide',
    tone: 'juego',
    ...STANDING,
    elbows: [[44, 52], [76, 52]],
    hands: [[28, 56], [90, 56]],
    props: [stroked('M28 56H90M36 56v5M44 56v5M52 56v5M60 56v5M68 56v5M76 56v5', 'yellow', 2), filled('M88 50h10v11h-10z', 'yellow')],
  },
  {
    id: 'saluda',
    tone: 'juego',
    head: [60, 34],
    neck: [60, 46],
    hip: [60, 82],
    knees: [[54, 104], [68, 102]],
    feet: [[50, 124], [72, 124]],
    elbows: [[50, 60], [74, 42]],
    hands: [[48, 74], [84, 24]],
    props: [filled('M77 5h14v13h-14z', 'pink'), stroked('M72 19H96', 'pink', 3)],
    top: 4,
  },
  {
    id: 'escudo',
    tone: 'serio',
    head: [54, 30],
    neck: [54, 43],
    hip: [54, 80],
    knees: [[46, 102], [62, 102]],
    feet: [[42, 124], [66, 124]],
    elbows: [[46, 58], [66, 54]],
    hands: [[44, 72], [76, 58]],
    props: [filled('M74 38h24v18q0 16-12 22q-12-6-12-22z', 'yellow')],
    near: 'filter',
  },
  {
    id: 'lupa',
    tone: 'serio',
    head: [56, 34],
    neck: [54, 47],
    hip: [48, 82],
    knees: [[44, 104], [56, 104]],
    feet: [[40, 124], [60, 124]],
    elbows: [[46, 62], [68, 54]],
    hands: [[50, 74], [78, 50]],
    props: [stroked(circle(90, 38, 10), 'pink', 3.5), stroked('M83 45L78 50', 'pink', 3.5)],
    near: 'knowledge',
  },
  {
    id: 'espera',
    tone: 'serio',
    ...STANDING,
    elbows: [[52, 60], [74, 46]],
    hands: [[50, 76], [88, 40]],
    props: [filled('M87 25h8v17h-8z', 'pink')],
    near: 'person',
  },
  {
    id: 'llave',
    tone: 'serio',
    ...STANDING,
    elbows: [[50, 60], [70, 58]],
    hands: [[46, 74], [78, 66]],
    props: [cap([60, 30], 'yellow'), brim([60, 30], 'yellow'), stroked('M78 66L89 48M84 43a6 6 0 1 1 9 7', 'yellow', 3.5)],
    near: 'crm',
  },
  {
    id: 'portapapeles',
    tone: 'serio',
    ...STANDING,
    elbows: [[52, 60], [74, 54]],
    hands: [[61, 66], [72, 60]],
    props: [filled('M60 52h17v22h-17z', 'pink'), filled('M65 50h7v4h-7z', 'bone')],
  },
  {
    id: 'firme',
    tone: 'serio',
    head: [60, 30],
    neck: [60, 43],
    hip: [60, 80],
    knees: [[57, 102], [63, 102]],
    feet: [[56, 124], [64, 124]],
    elbows: [[53, 60], [67, 60]],
    hands: [[53, 78], [67, 78]],
    props: [cap([60, 30], 'yellow'), brim([60, 30], 'yellow')],
  },
];
