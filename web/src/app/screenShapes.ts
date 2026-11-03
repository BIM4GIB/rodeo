// What Event Design's Television, Video Screen, Blended Screen and LED Screen draw (tools/screens.ts)
// in Top/Plan, as plain geometry, seen from above with the screen facing −y: a television's casing
// (a flat panel, or a CRT tapering back), on its stand; a video screen's surface with its frame or
// border, its support, a centre line, and the projector throwing onto it with its cone (a blended
// screen's several projectors sharing its image, overlapping); an LED array's row of modules on
// its base structure; and the coverage zone in front of a television or video screen where viewers
// can see it. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

export type TvType = "flat" | "crt" | "crtCurved";
export type ZoneReference = "width" | "height" | "diagonal";
export type ScreenType = "front" | "rear" | "led";
export type ScreenFrame = "none" | "frame" | "border";
export type ScreenSupport = "none" | "goalpost" | "tripod" | "rollDown" | "rollUp";
export type ScreenFeet = "both" | "front" | "back" | "none";
export type LedShape = "tileFlat" | "tileCap" | "diskFlat" | "diskCap" | "tube" | "dome";
export type LedBasis = "countsSpacing" | "dimsSpacing" | "dimsCounts";
export type LedBase = "blocks" | "frame" | "curtain" | "web" | "vertStrips" | "horizStrips" | "none";

/** The viewing area in front of a screen: between Near and Far times the reference dimension from its middle, within the Max Horiz. Angle either side of dead on. */
export interface Coverage {
  readonly show: boolean;
  readonly reference: ZoneReference;
  /** degrees */
  readonly maxAngle: number;
  readonly near: number;
  readonly far: number;
}

/** What a screen draws, its coverage zone apart (drawn unfilled, so what lies in it shows). */
export interface ScreenPlan extends MarkerDrawing {
  /** the coverage zone's outline, when shown */
  readonly zone: Pt[][];
}

/** a flat panel's depth, a stand's base depth and an LED tile's or disk's depth, mm */
const PANEL_DEPTH = 60;
const STAND_DEPTH = 250;
const TILE_DEPTH = 80;
const DISK_DEPTH = 40;
/** a projector's size from above, mm */
const PROJECTOR_WIDTH = 500;
const PROJECTOR_DEPTH = 400;
/** a goalpost leg's size, mm, and its feet's length as a share of the image height (at least the minimum) */
const LEG = 50;
const FOOT_SHARE = 0.35;
const FOOT_MIN = 600;
/** room a case's motor takes at one end, mm */
const MOTOR = 200;
/** most LED modules along one row */
export const MAX_MODULES = 1000;
const ARC_STEPS = 48;

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const empty = (): ScreenPlan => ({ outlines: [], lines: [], circles: [], filled: [], texts: [], zone: [] });

/** Arc points round `c` at radius `r` from `a0` to `a1` radians. */
function arc(c: Pt, r: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = a0 + ((a1 - a0) * k) / steps;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

/** Width and height of an image `diagonal` across at `aspect` (width over height). */
export function imageSize(diagonal: number, aspect: number): { width: number; height: number } {
  const height = diagonal / Math.sqrt(aspect * aspect + 1);
  return { width: height * aspect, height };
}

/** The coverage zone in front of a screen face whose middle is `c`, the image `w` by `h`; a message when it can't draw. */
function coverageZone(c: Pt, w: number, h: number, z: Coverage): Pt[] | string | null {
  if (!z.show) return null;
  if (!(z.maxAngle > 0 && z.maxAngle < 90)) return "Set the coverage zone's Max Horiz. Angle over 0° and under 90°.";
  if (!(z.near >= 0 && z.far > z.near)) return "Set the coverage zone's Far Multiplier above its Near Multiplier, both 0 or more.";
  const ref = z.reference === "width" ? w : z.reference === "height" ? h : Math.hypot(w, h);
  const a = (z.maxAngle * Math.PI) / 180;
  const ahead = -Math.PI / 2;
  const far = arc(c, z.far * ref, ahead - a, ahead + a);
  const near = z.near > 0 ? arc(c, z.near * ref, ahead + a, ahead - a) : [c];
  return [...far, ...near];
}

export interface Television {
  readonly type: TvType;
  /** width over height: 4/3 or 16/9 */
  readonly aspect: number;
  readonly diagonal: number;
  readonly stand: boolean;
  readonly coverage: Coverage;
}

/** A television with the middle of its back on the origin, facing −y. A message when it can't draw. */
export function television(t: Television): ScreenPlan | string {
  if (!(t.diagonal > 0)) return "Set the television's Size over 0.";
  if (t.type === "crtCurved" && t.aspect > 1.5) return "A curved CRT screen can't be 16:9: choose 4:3 or another TV Type.";
  const { width: w, height: h } = imageSize(t.diagonal, t.aspect);
  const plan = empty();
  let face: number;
  if (t.type === "flat") {
    const cw = w + 2 * Math.max(10, 0.02 * w);
    face = -PANEL_DEPTH;
    plan.outlines.push(box(-cw / 2, face, cw / 2, 0));
    if (t.stand) plan.outlines.push(box(-0.2 * cw, face / 2 - STAND_DEPTH / 2, 0.2 * cw, face / 2 + STAND_DEPTH / 2));
  } else {
    // a CRT is about as deep as it's wide: a bezel at the front, the tube tapering behind it
    const cw = w * 1.15;
    const depth = 0.85 * cw;
    const bezel = 0.12 * depth;
    face = -depth;
    const front = t.type === "crtCurved" ? arc({ x: 0, y: -depth + cw * 1.5 }, Math.hypot(cw / 2, cw * 1.5), -Math.PI / 2 - Math.atan2(cw / 2, cw * 1.5), -Math.PI / 2 + Math.atan2(cw / 2, cw * 1.5), 16) : [{ x: -cw / 2, y: -depth }, { x: cw / 2, y: -depth }];
    if (t.type === "crtCurved") face = -depth - (Math.hypot(cw / 2, cw * 1.5) - cw * 1.5);
    plan.outlines.push([...front, { x: cw / 2, y: -depth + bezel }, { x: 0.275 * cw, y: 0 }, { x: -0.275 * cw, y: 0 }, { x: -cw / 2, y: -depth + bezel }]);
    plan.lines.push([{ x: -cw / 2, y: -depth + bezel }, { x: cw / 2, y: -depth + bezel }]);
  }
  const zone = coverageZone({ x: 0, y: face }, w, h, t.coverage);
  if (typeof zone === "string") return zone;
  if (zone) plan.zone.push(zone);
  return plan;
}

export interface VideoScreen {
  readonly type: ScreenType;
  /** the image's width and height */
  readonly width: number;
  readonly height: number;
  readonly frame: ScreenFrame;
  readonly borderLeft: number;
  readonly borderRight: number;
  /** a frame's thickness */
  readonly frameDepth: number;
  readonly support: ScreenSupport;
  readonly feet: ScreenFeet;
  readonly caseDepth: number;
  readonly motor: "left" | "right" | "none";
  readonly centreline: boolean;
  readonly projector: boolean;
  readonly cone: boolean;
  /** the projector's distance from the screen over the image's width */
  readonly throwRatio: number;
  readonly coverage: Coverage;
}

/** a video screen's depth from above: a frame's, or a border's or bare screen's 20 mm */
const thickness = (s: VideoScreen): number => (s.frame === "frame" ? s.frameDepth : 20);

/** A video screen with the middle of its image's face on the origin, facing −y. A message when it can't draw. */
export function videoScreen(s: VideoScreen): ScreenPlan | string {
  if (!(s.width > 0 && s.height > 0)) return "Set the screen's image Width and Height over 0.";
  const bordered = s.frame !== "none";
  const [bl, br] = bordered ? [Math.max(0, s.borderLeft), Math.max(0, s.borderRight)] : [0, 0];
  const thick = thickness(s);
  if (!(thick > 0)) return "Set the frame's Depth over 0.";
  const x0 = -s.width / 2 - bl;
  const x1 = s.width / 2 + br;
  const plan = empty();
  plan.outlines.push(box(x0, 0, x1, thick));
  if (s.support === "goalpost") {
    const foot = Math.max(FOOT_MIN, FOOT_SHARE * s.height);
    for (const x of [x0 - LEG / 2, x1 + LEG / 2]) {
      plan.outlines.push(box(x - LEG / 2, thick / 2 - LEG / 2, x + LEG / 2, thick / 2 + LEG / 2));
      if (s.feet === "front" || s.feet === "both") plan.lines.push([{ x, y: thick / 2 - LEG / 2 }, { x, y: thick / 2 - foot }]);
      if (s.feet === "back" || s.feet === "both") plan.lines.push([{ x, y: thick / 2 + LEG / 2 }, { x, y: thick / 2 + foot }]);
    }
  } else if (s.support === "tripod") {
    const hub = { x: 0, y: thick + LEG };
    const reach = Math.max(FOOT_MIN, FOOT_SHARE * s.height);
    plan.circles.push({ center: hub, radius: LEG / 2 });
    for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3]) plan.lines.push([hub, { x: hub.x + reach * Math.cos(a), y: hub.y + reach * Math.sin(a) }]);
  } else if (s.support === "rollDown" || s.support === "rollUp") {
    if (!(s.caseDepth > 0)) return "Set the case's Depth over 0.";
    const c0 = x0 - (s.motor === "left" ? MOTOR : 0);
    const c1 = x1 + (s.motor === "right" ? MOTOR : 0);
    plan.outlines.push(box(c0, thick / 2 - s.caseDepth / 2, c1, thick / 2 + s.caseDepth / 2));
  }
  if (s.centreline) plan.lines.push([{ x: 0, y: -s.width / 4 }, { x: 0, y: thick + s.width / 4 }]);
  if (s.type !== "led" && (s.projector || s.cone)) {
    if (!(s.throwRatio > 0)) return "Set the projector's Throw Ratio over 0.";
    const d = s.throwRatio * s.width;
    const rear = s.type === "rear";
    const lens = { x: 0, y: rear ? thick + d : -d };
    if (s.projector) plan.outlines.push(rear ? box(-PROJECTOR_WIDTH / 2, lens.y, PROJECTOR_WIDTH / 2, lens.y + PROJECTOR_DEPTH) : box(-PROJECTOR_WIDTH / 2, lens.y - PROJECTOR_DEPTH, PROJECTOR_WIDTH / 2, lens.y));
    if (s.cone) {
      const y = rear ? thick : 0;
      plan.lines.push([{ x: -s.width / 2, y }, lens, { x: s.width / 2, y }]);
    }
  }
  const zone = coverageZone({ x: 0, y: 0 }, s.width, s.height, s.coverage);
  if (typeof zone === "string") return zone;
  if (zone) plan.zone.push(zone);
  return plan;
}

export interface LedScreen {
  readonly shape: LedShape;
  /** each module's width (a disk's, tube's or dome's diameter) */
  readonly width: number;
  readonly capDepth: number;
  readonly tubeVertical: boolean;
  /** a horizontal tube's length */
  readonly tubeLength: number;
  readonly basis: LedBasis;
  readonly arrayWidth: number;
  readonly spacing: number;
  readonly count: number;
  readonly base: LedBase;
}

/** How many modules a row holds and how far apart, from what the array's built on; a message when they can't. */
export function ledRow(l: LedScreen): { count: number; spacing: number; length: number } | string {
  const along = l.shape === "tube" && !l.tubeVertical ? l.tubeLength : l.width;
  if (!(along > 0)) return l.shape === "tube" && !l.tubeVertical ? "Set the tubes' Length over 0." : "Set the modules' Width over 0.";
  let count = Math.round(l.count);
  let spacing = l.spacing;
  if (l.basis === "dimsSpacing") {
    if (!(l.arrayWidth > 0 && spacing >= 0)) return "Set the Array Width over 0 and the Horizontal Spacing to 0 or more.";
    count = Math.floor((l.arrayWidth + spacing) / (along + spacing) + 1e-9);
  } else if (l.basis === "dimsCounts") {
    if (!(l.arrayWidth > 0 && count >= 1)) return "Set the Array Width over 0 and the Horizontal Count to 1 or more.";
    spacing = count > 1 ? (l.arrayWidth - count * along) / (count - 1) : 0;
    if (spacing < 0) return "The modules don't fit across the Array Width: set a wider array or fewer modules.";
  } else if (!(count >= 1 && spacing >= 0)) return "Set the Horizontal Count to 1 or more and the Horizontal Spacing to 0 or more.";
  if (count < 1) return "No module fits across the Array Width: set a wider array or narrower modules.";
  if (count > MAX_MODULES) return `This array would have more than ${MAX_MODULES} modules in a row.`;
  return { count, spacing, length: count * along + (count - 1) * spacing };
}

/** An LED array's top row with the middle of its modules' faces on the origin, facing −y, its base structure behind. A message when it can't draw. */
export function ledScreen(l: LedScreen): ScreenPlan | string {
  const row = ledRow(l);
  if (typeof row === "string") return row;
  const capped = l.shape === "tileCap" || l.shape === "diskCap";
  if (capped && !(l.capDepth > 0)) return "Set the modules' Cap Depth over 0.";
  const along = l.shape === "tube" && !l.tubeVertical ? l.tubeLength : l.width;
  const depth = l.shape === "tileFlat" || l.shape === "tileCap" ? TILE_DEPTH : l.shape === "diskFlat" || l.shape === "diskCap" ? DISK_DEPTH : l.width;
  const plan = empty();
  const start = -row.length / 2;
  for (let k = 0; k < row.count; k++) {
    const x0 = start + k * (along + row.spacing);
    const x1 = x0 + along;
    const cx = (x0 + x1) / 2;
    if (l.shape === "tube" && l.tubeVertical) plan.circles.push({ center: { x: cx, y: l.width / 2 }, radius: l.width / 2 });
    else if (l.shape === "dome") plan.outlines.push([...arc({ x: cx, y: 0 }, l.width / 2, Math.PI, 2 * Math.PI, 24)]);
    else plan.outlines.push(box(x0, 0, x1, depth));
    if (capped) plan.outlines.push(box(x0, -l.capDepth, x1, 0));
  }
  const back = l.shape === "dome" ? 0 : depth;
  const x0 = start;
  const x1 = -start;
  if (l.base === "blocks") for (let k = 0; k < row.count; k++) plan.outlines.push(box(start + k * (along + row.spacing), back, start + k * (along + row.spacing) + along, back + 100));
  else if (l.base === "frame") plan.outlines.push(box(x0, back, x1, back + 60));
  else if (l.base === "horizStrips") plan.outlines.push(box(x0, back, x1, back + 40));
  else if (l.base === "vertStrips") for (let k = 0; k < row.count; k++) {
    const cx = start + k * (along + row.spacing) + along / 2;
    plan.outlines.push(box(cx - Math.min(50, along / 4), back, cx + Math.min(50, along / 4), back + 40));
  }
  else if (l.base === "curtain") plan.lines.push([{ x: x0, y: back + 50 }, { x: x1, y: back + 50 }]);
  else if (l.base === "web") {
    const pts: Pt[] = [];
    const n = Math.max(2, row.count * 2);
    for (let k = 0; k <= n; k++) pts.push({ x: x0 + ((x1 - x0) * k) / n, y: back + (k % 2 ? 100 : 20) });
    plan.lines.push(pts);
  }
  return plan;
}

export type MultipleProjector = "single" | "stacked" | "sideBySide";

/** most projector areas across one blended screen */
export const MAX_AREAS = 64;

export interface BlendedScreen {
  /** the screen itself, front or rear; its own projector, cone and throw ratio aren't used */
  readonly screen: VideoScreen;
  /** a projector's image width over its height */
  readonly projectorAspect: number;
  /** how much taller than the screen each projector's image is thrown, its top and bottom discarded, % */
  readonly overshoot: number;
  /** the Area Horiz. Count asked for */
  readonly areas: number;
  /** each projector's distance from the screen over its area's width */
  readonly throwRatio: number;
  /** whether the projectors are drawn (Place Screen and Projector), with their cones and centrelines */
  readonly projectors: boolean;
  readonly multiple: MultipleProjector;
  /** the gap between side-by-side projectors */
  readonly horizSpace: number;
  readonly cones: boolean;
  readonly centrelines: boolean;
}

/** How a blended screen's image is shared: the areas, each one's size, and how much and how far apart they overlap. */
export interface Blend {
  readonly count: number;
  readonly areaWidth: number;
  readonly areaHeight: number;
  readonly overlap: number;
  /** from one area's middle to the next */
  readonly spacing: number;
}

/**
 * The areas projectors share an image `width` by `height` in: each as high as the image plus the
 * overshoot and as wide as the projector's aspect makes that, as many as asked but never fewer
 * than cover the width, overlapping evenly to fill it exactly. A message when they can't.
 */
export function blendAreas(width: number, height: number, aspect: number, overshoot: number, asked: number): Blend | string {
  if (!(width > 0 && height > 0)) return "Set the screen's image Width and Height over 0.";
  if (!(aspect > 0)) return "Choose the projectors' Aspect.";
  if (!(overshoot >= 0 && overshoot < 100)) return "Set the Overshoot from 0% to under 100%.";
  const areaHeight = height * (1 + overshoot / 100);
  const areaWidth = areaHeight * aspect;
  const least = Math.max(1, Math.ceil(width / areaWidth - 1e-9));
  const count = Math.max(least, Math.round(asked) || 1);
  if (count > MAX_AREAS) return `More than ${MAX_AREAS} projector areas: use projectors with a wider Aspect or a narrower screen.`;
  if (count === 1) return { count, areaWidth, areaHeight, overlap: 0, spacing: 0 };
  const overlap = (count * areaWidth - width) / (count - 1);
  const spacing = areaWidth - overlap;
  if (!(spacing > 0)) return "One projector's image covers the whole screen: set Area Horiz. Count to 1.";
  return { count, areaWidth, areaHeight, overlap, spacing };
}

/**
 * A blended screen with the middle of its image's face on the origin, facing −y: the video screen,
 * and the projectors sharing its image, each its throw away in front (behind, for rear
 * projection) facing its area, its cone reaching the area's edges and its centreline to the
 * area's middle; side-by-side pairs stand the Horiz Space apart. A message when it can't draw.
 */
export function blendedScreen(b: BlendedScreen): ScreenPlan | string {
  const s = b.screen;
  if (s.type === "led") return "A blended screen is projected: choose Front or Rear.";
  const plan = videoScreen({ ...s, projector: false, cone: false });
  if (typeof plan === "string") return plan;
  const blend = blendAreas(s.width, s.height, b.projectorAspect, b.overshoot, b.areas);
  if (typeof blend === "string") return blend;
  if (!b.projectors) return plan;
  if (!(b.throwRatio > 0)) return "Set the projectors' Throw Ratio over 0.";
  if (b.multiple === "sideBySide" && !(b.horizSpace >= 0)) return "Set the Horiz Space 0 or more.";
  const rear = s.type === "rear";
  const thick = thickness(s);
  const d = b.throwRatio * blend.areaWidth;
  const face = rear ? thick : 0;
  const lensY = rear ? thick + d : -d;
  const body = (x: number): Pt[] => (rear ? box(x - PROJECTOR_WIDTH / 2, lensY, x + PROJECTOR_WIDTH / 2, lensY + PROJECTOR_DEPTH) : box(x - PROJECTOR_WIDTH / 2, lensY - PROJECTOR_DEPTH, x + PROJECTOR_WIDTH / 2, lensY));
  const pair = (PROJECTOR_WIDTH + b.horizSpace) / 2;
  for (let i = 0; i < blend.count; i++) {
    const x = blend.count === 1 ? 0 : -s.width / 2 + blend.areaWidth / 2 + i * blend.spacing;
    const lens = { x, y: lensY };
    if (b.multiple === "sideBySide") plan.outlines.push(body(x - pair), body(x + pair));
    else plan.outlines.push(body(x));
    if (b.cones) plan.lines.push([{ x: x - blend.areaWidth / 2, y: face }, lens, { x: x + blend.areaWidth / 2, y: face }]);
    if (b.centrelines) plan.lines.push([lens, { x, y: face }]);
  }
  return plan;
}
