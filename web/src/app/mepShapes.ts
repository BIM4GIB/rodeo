// What MEP's Receptacle, Switch, Comm Device and Incandescent Fixture draw (tools/mep.ts), and
// Event Design's Speaker and Speaker Array, as plain geometry. The four indicators are symbols on paper, built here
// in paper millimetres and scaled by the tool (2D Scale Factor × the layer's scale), standing
// on their insertion point with their stem running up +y from the wall; a ceiling or floor
// device is centred on it instead. A speaker is drawn full size from above, facing −y: its box
// (or a ceiling speaker's grill), its dispersion lines and the coverage shadow they make on the
// listening plane; a speaker array its bumper with the speakers hanging under it, and the
// coverage of all of them together. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";

export type ReceptacleType = "regular" | "split" | "special" | "range" | "junction";
export type ReceptacleConfig = "simplex" | "duplex" | "triplex" | "quad";
export type DeviceLocation = "floor" | "wall" | "ceiling";
export type SwitchConfig = "regular" | "ceilingPull" | "singleRecep" | "doubleRecep";
export type CommConfig =
  | "telephone"
  | "data"
  | "dataVoice"
  | "tv"
  | "watchman"
  | "sound"
  | "staff"
  | "paging"
  | "fireAlarm"
  | "clock"
  | "nurseCall"
  | "pushbutton"
  | "bell"
  | "bellTransformer"
  | "chime"
  | "doorOpener";
export type FixtureMounting = "surface" | "recessed" | "pendant";
export type FixtureType = "downLight" | "wallWash" | "standard";

/** What an indicator draws: a marker's parts, halves shaded grey (filled at half strength), and its config label apart (it may stay level). */
export interface IndicatorDrawing extends MarkerDrawing {
  readonly shaded: Pt[][];
  readonly label?: MarkerText;
}

/** an indicator's circle radius, its stem from the wall, and its label's height, paper mm */
const R = 2;
const STEM = 4;
const LABEL = 2;
/** a label's gap from the symbol, paper mm */
const LABEL_GAP = 1;
/** points round a full circle, for filled discs and halves */
const DISC_STEPS = 32;

const at = (x: number, y: number): Pt => ({ x, y });

function empty(): { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[]; shaded: Pt[][]; label?: MarkerText } {
  return { outlines: [], lines: [], circles: [], filled: [], texts: [], shaded: [] };
}
type Draft = ReturnType<typeof empty>;

/** The points round a circle's arc from `from` to `to` degrees, anticlockwise. */
function arc(c: Pt, r: number, from: number, to: number): Pt[] {
  const steps = Math.max(2, Math.ceil((Math.abs(to - from) / 360) * DISC_STEPS));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return at(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  });
}

/** A square of half-side `h` round `c`. */
const square = (c: Pt, h: number): Pt[] => [at(c.x - h, c.y - h), at(c.x + h, c.y - h), at(c.x + h, c.y + h), at(c.x - h, c.y + h)];

/** The label, left-justified `LABEL_GAP` right of `right`, level with `y`; none when blank. */
function label(d: Draft, text: string, right: number, y: number): void {
  if (text.trim()) d.label = { at: at(right + LABEL_GAP, y), text: text.trim(), height: LABEL, justify: "left" };
}

/** `d` scaled by `k` about the insertion point, text heights with it. */
function scaled(d: Draft, k: number): IndicatorDrawing {
  const s = (pts: readonly Pt[]): Pt[] => pts.map((p) => at(p.x * k, p.y * k));
  const text = (t: MarkerText): MarkerText => ({ ...t, at: at(t.at.x * k, t.at.y * k), height: t.height * k });
  return {
    outlines: d.outlines.map(s),
    lines: d.lines.map(s),
    circles: d.circles.map((c) => ({ center: at(c.center.x * k, c.center.y * k), radius: c.radius * k })),
    filled: d.filled.map(s),
    shaded: d.shaded.map(s),
    texts: d.texts.map(text),
    label: d.label && text(d.label),
  };
}

export interface Receptacle {
  readonly type: ReceptacleType;
  readonly config: ReceptacleConfig;
  readonly location: DeviceLocation;
  readonly label: string;
}

/**
 * A receptacle's indicator, `k` drawing mm to the paper mm: a circle with the config's lines
 * through it (and across it for a triplex or quad), the left half filled when split-wired; a
 * triangle in it for special purpose, three lines for an electric range, a larger circle round a
 * J for a junction box. On a wall the lines run down to the wall at the insertion point; on the
 * ceiling or floor they stop at the circle, a floor box squared round it.
 */
export function receptacle(o: Receptacle, k: number): IndicatorDrawing {
  const d = empty();
  const wall = o.location === "wall";
  const r = o.type === "junction" ? 1.5 * R : R;
  const c = at(0, wall ? STEM + r : 0);
  d.circles.push({ center: c, radius: r });
  if (o.type === "junction") {
    d.texts.push({ at: c, text: "J", height: 1.1 * r, justify: "centre" });
    if (wall) d.lines.push([at(0, 0), at(0, c.y - r)]);
  } else if (o.type === "special") {
    d.outlines.push([at(c.x - 0.45 * r, c.y + 0.6 * r), at(c.x - 0.45 * r, c.y - 0.6 * r), at(c.x + 0.75 * r, c.y)]);
    if (wall) d.lines.push([at(0, 0), at(0, c.y - r)]);
  } else {
    const xs = o.type === "range" ? [-0.35 * r, 0, 0.35 * r] : o.config === "simplex" ? [0] : [-0.25 * r, 0.25 * r];
    for (const x of xs) d.lines.push([at(x, c.y + r), at(x, wall ? 0 : c.y - r)]);
    if (o.type !== "range") {
      const across = o.config === "triplex" ? [0] : o.config === "quad" ? [0.35 * r, -0.35 * r] : [];
      for (const dy of across) {
        const half = Math.sqrt(r * r - dy * dy);
        d.lines.push([at(c.x - half, c.y + dy), at(c.x + half, c.y + dy)]);
      }
    }
    if (o.type === "split") d.filled.push(arc(c, r, 90, 270));
  }
  if (o.location === "floor") d.outlines.push(square(c, 1.6 * r));
  label(d, o.label, o.location === "floor" ? 1.6 * r : r, c.y);
  return scaled(d, k);
}

export interface Switch {
  readonly config: SwitchConfig;
  readonly label: string;
}

/**
 * A switch's indicator: a $ off the wall, its label low beside it as a subscript; a ceiling
 * pull's circle centred on the point; or a switch with a receptacle, a circle on a wall stem with
 * one or two lines through it.
 */
export function wallSwitch(o: Switch, k: number): IndicatorDrawing {
  const d = empty();
  if (o.config === "regular") {
    const h = 2 * R;
    d.texts.push({ at: at(0, STEM - 0.5), text: "$", height: h, justify: "centre" });
    label(d, o.label, 0.35 * h, STEM - 0.5 - 0.35 * h);
  } else if (o.config === "ceilingPull") {
    d.circles.push({ center: at(0, 0), radius: R });
    label(d, o.label, R, 0);
  } else {
    const c = at(0, STEM + R);
    d.circles.push({ center: c, radius: R });
    for (const x of o.config === "singleRecep" ? [0] : [-0.25 * R, 0.25 * R]) d.lines.push([at(x, c.y + R), at(x, 0)]);
    label(d, o.label, R, c.y);
  }
  return scaled(d, k);
}

export interface CommDevice {
  readonly config: CommConfig;
  readonly label: string;
}

/** a lettered device's box side, and a small device's, paper mm */
const LETTER_BOX = 5.4;
const SMALL_BOX = 3;

/**
 * A communication device's indicator on a stem from the wall: a triangle (open for a telephone,
 * solid for data, half solid for data/voice), a box lettered TV, BT, CH or D, a watchman's arrow,
 * a sound speaker's trapezoid, a diamond (round a circle for staff), a fire alarm's small box, a
 * clock's hexagon, a nurse call's circle, a pushbutton's box round a dot, or a bell.
 */
export function commDevice(o: CommDevice, k: number): IndicatorDrawing {
  const d = empty();
  const lettered: Partial<Record<CommConfig, string>> = { tv: "TV", bellTransformer: "BT", chime: "CH", doorOpener: "D" };
  const letters = lettered[o.config];
  // the shape's right edge and its middle's height, for the label
  let right = R;
  let mid = STEM + R;
  if (letters) {
    const h = LETTER_BOX / 2;
    mid = STEM + h;
    right = h;
    d.outlines.push(square(at(0, mid), h));
    d.texts.push({ at: at(0, mid), text: letters, height: letters.length > 1 ? 0.48 * LETTER_BOX : 0.6 * LETTER_BOX, justify: "centre" });
  } else {
    switch (o.config) {
      case "telephone":
      case "data":
      case "dataVoice": {
        const top = STEM + 1.7 * R;
        const tri = [at(-R, top), at(R, top), at(0, STEM)];
        mid = STEM + 0.85 * R;
        d.outlines.push(tri);
        if (o.config === "data") d.filled.push(tri);
        if (o.config === "dataVoice") d.filled.push([at(0, top), at(R, top), at(0, STEM)]);
        break;
      }
      case "watchman": {
        const h = 1.2;
        mid = STEM + h;
        d.outlines.push([at(-R, STEM), at(0.4 * R, STEM), at(R, mid), at(0.4 * R, STEM + 2 * h), at(-R, STEM + 2 * h)]);
        break;
      }
      case "sound":
        mid = STEM + 1.2;
        d.outlines.push([at(-0.6 * R, STEM), at(0.6 * R, STEM), at(1.1 * R, STEM + 2.4), at(-1.1 * R, STEM + 2.4)]);
        right = 1.1 * R;
        break;
      case "staff":
      case "paging": {
        const h = 1.1 * R;
        mid = STEM + h;
        d.outlines.push([at(0, STEM), at(h, mid), at(0, mid + h), at(-h, mid)]);
        if (o.config === "staff") d.circles.push({ center: at(0, mid), radius: 0.8 * R });
        right = h;
        break;
      }
      case "fireAlarm":
        mid = STEM + SMALL_BOX / 2;
        right = SMALL_BOX / 2;
        d.outlines.push(square(at(0, mid), SMALL_BOX / 2));
        break;
      case "clock":
        mid = STEM + R;
        d.outlines.push(Array.from({ length: 6 }, (_, i) => at(R * Math.cos(((-90 + 60 * i) * Math.PI) / 180), mid + R * Math.sin(((-90 + 60 * i) * Math.PI) / 180))));
        right = R * Math.cos(Math.PI / 6);
        break;
      case "nurseCall":
        d.circles.push({ center: at(0, mid), radius: R });
        break;
      case "pushbutton":
        d.outlines.push(square(at(0, mid), R));
        d.circles.push({ center: at(0, mid), radius: 0.3 * R });
        break;
      case "bell": {
        const h = 0.7 * R;
        mid = STEM + h;
        d.outlines.push(square(at(0, mid), h));
        d.lines.push(arc(at(-h, mid), h, 90, 270));
        d.lines.push([at(h, STEM), at(h + 0.6 * R, STEM + 2 * h)]);
        right = h + 0.6 * R;
        break;
      }
    }
  }
  d.lines.push([at(0, 0), at(0, STEM)]);
  label(d, o.label, right, mid);
  return scaled(d, k);
}

export interface Fixture {
  readonly mounting: FixtureMounting;
  readonly location: Exclude<DeviceLocation, "floor">;
  readonly type: FixtureType;
  readonly emergency: boolean;
  readonly label: string;
}

/**
 * An incandescent fixture's indicator: a circle (an R in it when recessed, a dot when pendant)
 * on a stem from the wall, or centred on the point on the ceiling; a down light's diagonal across
 * it, a wall washer's right half shaded, an emergency light's lower right half shaded.
 */
export function fixture(o: Fixture, k: number): IndicatorDrawing {
  const d = empty();
  const wall = o.location === "wall";
  const c = at(0, wall ? STEM + R : 0);
  d.circles.push({ center: c, radius: R });
  if (wall) d.lines.push([at(0, 0), at(0, STEM)]);
  if (o.mounting === "recessed") d.texts.push({ at: c, text: "R", height: 1.1 * R, justify: "centre" });
  if (o.mounting === "pendant") d.filled.push(arc(c, 0.3 * R, 0, 360).slice(0, -1));
  if (o.type === "downLight") d.lines.push([arc(c, R, 135, 135)[0], arc(c, R, -45, -45)[0]]);
  if (o.type === "wallWash") d.shaded.push(arc(c, R, -90, 90));
  if (o.emergency) d.shaded.push(arc(c, R, -150, 30));
  label(d, o.label, R, c.y);
  return scaled(d, k);
}

export interface Speaker {
  readonly ceiling: boolean;
  readonly frontWidth: number;
  readonly frontHeight: number;
  readonly backWidth: number;
  readonly backHeight: number;
  readonly depth: number;
  readonly grill: number;
  readonly cutout: number;
  /** on its side: its heights run across the plan */
  readonly flip: boolean;
  readonly asymmetric: boolean;
  /** degrees: the full horizontal spread, or each side's when asymmetric, and the vertical */
  readonly horizFull: number;
  readonly horizLeft: number;
  readonly horizRight: number;
  readonly vertical: number;
  readonly throwDistance: number;
  /** the speaker's height and the listeners' ears above the floor, mm */
  readonly elevation: number;
  readonly listening: number;
  /** degrees down from level */
  readonly tilt: number;
  readonly dispersion: boolean;
}

/** What a speaker draws: its box, the housing hidden above a ceiling, and the coverage shadow (drawn unfilled). */
export interface SpeakerPlan extends MarkerDrawing {
  readonly hidden: Pt[][];
  readonly zone: Pt[][];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Why the speaker can't be drawn, or null. */
export function speakerProblem(s: Speaker): string | null {
  if (s.ceiling) {
    if (!(s.grill > 0)) return "Set a Grill Diameter over 0.";
  } else {
    if (!(s.frontWidth > 0 && s.frontHeight > 0 && s.depth > 0)) return "Set the front's width and height and the depth over 0.";
    if (s.backWidth > s.frontWidth || s.backHeight > s.frontHeight) return "The back face can't be larger than the front face.";
  }
  if (!s.dispersion) return null;
  const h = s.asymmetric ? [s.horizLeft, s.horizRight] : [s.horizFull / 2];
  if (h.some((a) => !(a > 0 && a <= 90)) || !(s.vertical > 0 && s.vertical <= 180)) return "Set the dispersion angles over 0°: up to 180° in all, 90° a side.";
  if (!(s.throwDistance > 0)) return "Set a Throw Distance over 0.";
  if (!(s.listening < s.elevation)) return "The Listening Height must be below the speaker's Elevation.";
  if (!(Math.abs(s.tilt) <= 90)) return "Set a tilt from -90° to 90°.";
  return null;
}

/**
 * A speaker in plan facing −y, centred on the origin: a box tapering from its front to its back
 * (its heights across it when flipped on its side), or a ceiling speaker's grill with its
 * housing's cutout hidden above. With dispersion shown, a box throws its left and right
 * dispersion lines and a centre line from the middle of its front, their plan length the
 * throw distance tilted down; the coverage shadow is where the vertical dispersion meets the
 * listening plane within the throw, between the horizontal lines. A ceiling speaker's shadow is
 * the circle its spread covers below it.
 */
export function speaker(s: Speaker): SpeakerPlan | string {
  const problem = speakerProblem(s);
  if (problem) return problem;
  const d = { outlines: [] as Pt[][], lines: [] as Pt[][], circles: [] as { center: Pt; radius: number }[], filled: [] as Pt[][], texts: [] as MarkerText[], hidden: [] as Pt[][], zone: [] as Pt[][] };
  const drop = s.elevation - s.listening;
  // the furthest the throw reaches across the listening plane
  const reach = drop < s.throwDistance ? Math.sqrt(s.throwDistance ** 2 - drop ** 2) : 0;
  if (s.ceiling) {
    d.circles.push({ center: at(0, 0), radius: s.grill / 2 });
    if (s.cutout > 0 && s.cutout !== s.grill) d.hidden.push(arc(at(0, 0), s.cutout / 2, 0, 360).slice(0, -1));
    if (s.dispersion) {
      const half = Math.min(s.asymmetric ? (s.horizLeft + s.horizRight) / 2 : s.horizFull / 2, 89);
      const r = Math.min(drop * Math.tan(rad(half)), reach);
      if (r > 0) d.zone.push(arc(at(0, 0), r, 0, 360).slice(0, -1));
    }
    return d;
  }
  const front = s.flip ? s.frontHeight : s.frontWidth;
  const back = (s.flip ? s.backHeight : s.backWidth) || front;
  const y0 = -s.depth / 2;
  d.outlines.push([at(-front / 2, y0), at(front / 2, y0), at(back / 2, -y0), at(-back / 2, -y0)]);
  if (!s.dispersion) return d;
  const left = s.asymmetric ? s.horizLeft : s.horizFull / 2;
  const right = s.asymmetric ? s.horizRight : s.horizFull / 2;
  const f = at(0, y0);
  // facing −y the speaker's left is +x; `a` degrees off the axis toward its left
  const ray = (a: number, len: number): Pt => at(f.x + len * Math.sin(rad(a)), f.y - len * Math.cos(rad(a)));
  const len = s.throwDistance * Math.cos(rad(s.tilt));
  if (len > 0) for (const a of [left, 0, -right]) d.lines.push([f, ray(a, len)]);
  // the cone's lower and upper edges, degrees below level, meet the plane `drop` below
  const lower = s.tilt + s.vertical / 2;
  const upper = s.tilt - s.vertical / 2;
  if (lower <= 0) return d;
  const near = lower >= 90 ? 0 : drop / Math.tan(rad(lower));
  const far = Math.min(upper > 0 ? drop / Math.tan(rad(upper)) : Infinity, reach);
  if (!(far > near)) return d;
  const steps = Math.max(2, Math.ceil(((left + right) / 360) * DISC_STEPS * 2));
  const sweep = (r: number): Pt[] => Array.from({ length: steps + 1 }, (_, i) => ray(-right + ((left + right) * i) / steps, r));
  d.zone.push(near > 0 ? [...sweep(far), ...sweep(near).reverse()] : [...sweep(far), f]);
  return d;
}

/** One kind of box in a speaker array (A, B or C), hung in that order under the bumper. */
export interface ArraySpeaker {
  /** how many of them; 0 leaves the kind out */
  readonly count: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** degrees: the full horizontal spread and the vertical */
  readonly horizontal: number;
  readonly vertical: number;
  /** degrees each tilts down from the box above it (the first, from the bumper) */
  readonly splay: number;
}

export interface SpeakerArray {
  readonly columnId: string;
  readonly bumperWidth: number;
  readonly bumperDepth: number;
  readonly bumperHeight: number;
  /** the bumper's underside above the floor, mm */
  readonly trim: number;
  /** degrees the bumper tilts the top box down */
  readonly bumperTilt: number;
  readonly kinds: readonly ArraySpeaker[];
  /** the listeners' ears above the floor, mm */
  readonly listening: number;
  readonly throwDistance: number;
  /** each box's vertical spread is its splay from the box above (its own when that is 0) */
  readonly arrayAngles: boolean;
  readonly dispersion: boolean;
  /** where the hoists pick the bumper up: one in the middle, or two a quarter of its width in */
  readonly hoists: 1 | 2;
  readonly guides: boolean;
  /** the Column ID's height, mm */
  readonly textHeight: number;
}

/** the most boxes an array hangs */
export const MAX_ARRAY_BOXES = 48;

/** Why the array can't be drawn, or null. */
export function speakerArrayProblem(a: SpeakerArray): string | null {
  if (!(a.bumperWidth > 0 && a.bumperDepth > 0 && a.bumperHeight >= 0)) return "Set the bumper's width and depth over 0.";
  const kinds = a.kinds.filter((k) => k.count > 0);
  if (kinds.length === 0) return "Hang at least one speaker: set a count over 0.";
  if (a.kinds.some((k) => !Number.isInteger(k.count) || k.count < 0)) return "Set each count to a whole number, 0 or more.";
  if (kinds.reduce((n, k) => n + k.count, 0) > MAX_ARRAY_BOXES) return `Hang ${MAX_ARRAY_BOXES} speakers at most.`;
  if (kinds.some((k) => !(k.width > 0 && k.height > 0 && k.depth > 0))) return "Set each speaker's width, height and depth over 0.";
  if (!a.dispersion) return null;
  if (kinds.some((k) => !(k.horizontal > 0 && k.horizontal <= 180 && k.vertical > 0 && k.vertical <= 180))) return "Set the dispersion angles over 0°, up to 180°.";
  if (!(a.throwDistance > 0)) return "Set a Throw Distance over 0.";
  const bottom = a.trim - kinds.reduce((h, k) => h + k.count * k.height, 0);
  if (!(a.listening < bottom)) return "The Listening Height must be below the bottom speaker.";
  return null;
}

/**
 * A speaker array in plan facing −y, centred on the origin: the bumper, and the outline of each kind
 * of box hung under it (front to the bumper's front) where it differs from the bumper's. With
 * dispersion shown, the left and right lines of the widest spread and a centre line run from the
 * middle of the front, a tick across the centre line where each box's aim meets the listening
 * plane; the coverage shadow is where the boxes' vertical spreads, all together, meet that plane
 * within the throw. Rigging guides cross the bumper where the hoists pick it up.
 */
export function speakerArray(a: SpeakerArray): SpeakerPlan | string {
  const problem = speakerArrayProblem(a);
  if (problem) return problem;
  const d = { outlines: [] as Pt[][], lines: [] as Pt[][], circles: [] as { center: Pt; radius: number }[], filled: [] as Pt[][], texts: [] as MarkerText[], hidden: [] as Pt[][], zone: [] as Pt[][] };
  const y0 = -a.bumperDepth / 2;
  const rect = (w: number, dep: number): Pt[] => [at(-w / 2, y0), at(w / 2, y0), at(w / 2, y0 + dep), at(-w / 2, y0 + dep)];
  d.outlines.push(rect(a.bumperWidth, a.bumperDepth));
  const kinds = a.kinds.filter((k) => k.count > 0);
  const seen = new Set([`${a.bumperWidth}/${a.bumperDepth}`]);
  for (const k of kinds) {
    if (seen.has(`${k.width}/${k.depth}`)) continue;
    seen.add(`${k.width}/${k.depth}`);
    // under the bumper: hidden where the bumper covers it
    const box = rect(k.width, k.depth);
    if (k.width <= a.bumperWidth && k.depth <= a.bumperDepth) d.hidden.push(box);
    else d.outlines.push(box);
  }
  if (a.guides) {
    const mark = Math.min(a.bumperWidth, a.bumperDepth) * 0.15;
    for (const x of a.hoists === 2 ? [-a.bumperWidth / 4, a.bumperWidth / 4] : [0]) {
      d.lines.push([at(x - mark, -mark), at(x + mark, mark)], [at(x - mark, mark), at(x + mark, -mark)]);
    }
  }
  if (a.columnId.trim()) d.texts.push({ at: at(0, -y0 + a.textHeight * 0.6), text: a.columnId.trim(), height: a.textHeight, justify: "centre" });
  if (!a.dispersion) return d;
  // each box from the top: the middle of its front's height and its tilt below level
  const boxes: { z: number; tilt: number; vertical: number; horizontal: number }[] = [];
  let top = a.trim;
  let tilt = a.bumperTilt;
  for (const k of kinds) {
    for (let i = 0; i < k.count; i++) {
      tilt += k.splay;
      boxes.push({ z: top - k.height / 2, tilt, vertical: a.arrayAngles && k.splay > 0 ? k.splay : k.vertical, horizontal: k.horizontal });
      top -= k.height;
    }
  }
  const f = at(0, y0);
  const ray = (deg: number, len: number): Pt => at(f.x + len * Math.sin(rad(deg)), f.y - len * Math.cos(rad(deg)));
  const half = Math.min(90, Math.max(...boxes.map((b) => b.horizontal)) / 2);
  const len = a.throwDistance * Math.cos(rad(Math.min(90, Math.min(...boxes.map((b) => Math.abs(b.tilt))))));
  if (len > 0) for (const deg of [half, 0, -half]) d.lines.push([f, ray(deg, len)]);
  let near = Infinity;
  let far = -Infinity;
  const tick = a.bumperWidth * 0.15;
  for (const b of boxes) {
    const drop = b.z - a.listening;
    const reach = drop < a.throwDistance ? Math.sqrt(a.throwDistance ** 2 - drop ** 2) : 0;
    if (b.tilt > 0 && b.tilt < 90) {
      const aim = drop / Math.tan(rad(b.tilt));
      if (aim <= reach) d.lines.push([at(f.x - tick, f.y - aim), at(f.x + tick, f.y - aim)]);
    }
    const lower = b.tilt + b.vertical / 2;
    const upper = b.tilt - b.vertical / 2;
    if (lower <= 0) continue;
    const n = lower >= 90 ? 0 : drop / Math.tan(rad(lower));
    const x = Math.min(upper > 0 ? drop / Math.tan(rad(upper)) : Infinity, reach);
    if (!(x > n)) continue;
    near = Math.min(near, n);
    far = Math.max(far, x);
  }
  if (!(far > near)) return d;
  const steps = Math.max(2, Math.ceil((half / 180) * DISC_STEPS * 2));
  const sweep = (r: number): Pt[] => Array.from({ length: steps + 1 }, (_, i) => ray(-half + (2 * half * i) / steps, r));
  d.zone.push(near > 0 ? [...sweep(far), ...sweep(near).reverse()] : [...sweep(far), f]);
  return d;
}
