// A label legend's labels laid round a lighting device (Spotlight's Label Legend Manager). Vectorworks
// places each label where it was dragged in a layout editor, round a layout symbol; Rodeo gives each a
// spot round the device's body (in front, behind, either side, a corner or on it), stacking the labels
// that share a spot outward in their order. The spots are as a device aimed down the page shows them,
// and turn with it unless the legend is Non-Rotating. A right-reading label stays level; one that isn't
// turns with the device, kept from reading upside down. A container is drawn round its text.

import type { Pt } from "../core/index.ts";
import type { MarkerText } from "./markerShapes.ts";

export type LabelSpot = "front" | "back" | "left" | "right" | "frontLeft" | "frontRight" | "backLeft" | "backRight" | "body";
export type LabelBox = "none" | "circle" | "oval" | "rectangle" | "hexagon" | "diamond";

export const LABEL_SPOTS: readonly { readonly id: LabelSpot; readonly label: string }[] = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "frontLeft", label: "Front Left" },
  { id: "frontRight", label: "Front Right" },
  { id: "backLeft", label: "Back Left" },
  { id: "backRight", label: "Back Right" },
  { id: "body", label: "On the Body" },
];

export const LABEL_BOXES: readonly { readonly id: LabelBox; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "circle", label: "Circle" },
  { id: "oval", label: "Oval" },
  { id: "rectangle", label: "Rectangle" },
  { id: "hexagon", label: "Hexagon" },
  { id: "diamond", label: "Diamond" },
];

/** One label to draw: its text, where it goes, its container, and its text's height in drawing units. */
export interface LegendItem {
  readonly text: string;
  readonly spot: LabelSpot;
  readonly box: LabelBox;
  readonly rightReading: boolean;
  readonly height: number;
}

/** How far the device's body reaches along its aim (front ahead, back behind, so negative) and across it each side. */
export interface BodyReach {
  readonly front: number;
  readonly back: number;
  readonly half: number;
}

export interface LegendDrawing {
  /** the containers, closed */
  readonly outlines: Pt[][];
  readonly texts: MarkerText[];
}

/** a character's width against the text's height, as an estimate (Rodeo draws text after laying it out) */
const CHAR = 0.6;
/** points round a circle or an oval */
const ROUND = 32;

/** The width and height of a label's text and, round it, its container, on its own level axes. */
export function labelSize(text: string, box: LabelBox, height: number): { readonly w: number; readonly h: number } {
  const tw = Math.max(text.length * CHAR * height, height * 0.5);
  const th = height;
  switch (box) {
    case "none":
      return { w: tw, h: th };
    case "circle": {
      const d = Math.hypot(tw, th) + height * 0.3;
      return { w: d, h: d };
    }
    case "oval":
      // an ellipse through the text box's corners, a little wider
      return { w: (tw + height * 0.3) * Math.SQRT2, h: (th + height * 0.3) * Math.SQRT2 };
    case "rectangle":
      return { w: tw + height * 0.6, h: th + height * 0.6 };
    case "hexagon":
      return { w: tw + height * 1.4, h: th + height * 0.6 };
    case "diamond":
      return { w: 2 * tw + height * 0.6, h: 2 * th + height * 0.4 };
  }
}

/** The container of size w × h round `c`, turned `angle` radians; null for none. */
function container(box: LabelBox, c: Pt, w: number, h: number, angle: number): Pt[] | null {
  const [cs, sn] = [Math.cos(angle), Math.sin(angle)];
  const put = (x: number, y: number): Pt => ({ x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs });
  const [a, b] = [w / 2, h / 2];
  switch (box) {
    case "none":
      return null;
    case "circle":
    case "oval":
      return Array.from({ length: ROUND }, (_, i) => put(a * Math.cos((i / ROUND) * 2 * Math.PI), b * Math.sin((i / ROUND) * 2 * Math.PI)));
    case "rectangle":
      return [put(-a, -b), put(a, -b), put(a, b), put(-a, b)];
    case "hexagon": {
      const k = Math.min(b, a);
      return [put(-a, 0), put(-a + k, -b), put(a - k, -b), put(a, 0), put(a - k, b), put(-a + k, b)];
    }
    case "diamond":
      return [put(-a, 0), put(0, -b), put(a, 0), put(0, b)];
  }
}

/** Each spot's way out from the body, on the page as a device aimed down it shows it: x to the right, y up. */
const OUT: Readonly<Record<LabelSpot, readonly [number, number]>> = {
  front: [0, -1],
  back: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  frontLeft: [-1, -1],
  frontRight: [1, -1],
  backLeft: [-1, 1],
  backRight: [1, 1],
  body: [0, 0],
};

/** An angle in radians kept from reading upside down: within (-90°, 90°]. */
function readable(a: number): number {
  let t = Math.atan2(Math.sin(a), Math.cos(a));
  if (t > Math.PI / 2 + 1e-9) t -= Math.PI;
  else if (t <= -Math.PI / 2 + 1e-9) t += Math.PI;
  return t;
}

/**
 * The legend's labels round a device on the origin aimed `aim` radians whose body reaches `reach`,
 * blank ones left out. A Non-Rotating legend lays them as for a device aimed down the page, round a
 * circle the body turns within, so they stay put as it turns.
 */
export function layoutLegend(items: readonly LegendItem[], reach: BodyReach, aim: number, nonRotating: boolean): LegendDrawing {
  const outlines: Pt[][] = [];
  const texts: MarkerText[] = [];
  // the layout's frame: as a device aimed down the page shows it, turned by `turn` onto the page
  const turn = nonRotating ? 0 : aim + Math.PI / 2;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const page = (x: number, y: number): Pt => ({ x: x * c - y * s, y: x * s + y * c });
  const r = Math.max(reach.front, -reach.back, reach.half);
  // the body in the layout's frame: x across, y along, the front down
  const body = nonRotating ? { x0: -r, x1: r, y0: -r, y1: r } : { x0: -reach.half, x1: reach.half, y0: -reach.front, y1: -reach.back };
  const shown = items.filter((i) => i.text.trim());
  const groups = new Map<LabelSpot, LegendItem[]>();
  for (const i of shown) groups.set(i.spot, [...(groups.get(i.spot) ?? []), i]);
  for (const [spot, list] of groups) {
    const [ox, oy] = OUT[spot];
    // each label's level size, and its reach on the layout's axes once on the page
    const sized = list.map((item) => {
      const { w, h } = labelSize(item.text.trim(), item.box, item.height);
      // a right-reading label is level on the page, so its box turns against the layout's frame
      const level = item.rightReading || nonRotating;
      const t = level ? -turn : 0;
      const [ct, st] = [Math.abs(Math.cos(t)), Math.abs(Math.sin(t))];
      return { item, w, h, level, across: w * ct + h * st, along: w * st + h * ct };
    });
    const gap = Math.max(...list.map((i) => i.height)) * 0.4;
    // the labels stack away from the body: across for the sides, along it otherwise; on it, centred on it
    const sideways = oy === 0 && ox !== 0;
    const total = sized.reduce((n, x) => n + (sideways ? x.across : x.along), 0) + gap * (sized.length - 1);
    let run = 0;
    for (const x of sized) {
      const size = sideways ? x.across : x.along;
      let cx: number;
      let cy: number;
      if (spot === "body") {
        cx = (body.x0 + body.x1) / 2;
        cy = (body.y0 + body.y1) / 2 + total / 2 - run - size / 2;
      } else if (sideways) {
        cx = ox > 0 ? body.x1 + gap + run + size / 2 : body.x0 - gap - run - size / 2;
        cy = (body.y0 + body.y1) / 2;
      } else {
        // in front or behind: centred across, or past a side at a corner
        cx = ox === 0 ? (body.x0 + body.x1) / 2 : ox > 0 ? body.x1 + x.across / 2 : body.x0 - x.across / 2;
        cy = oy > 0 ? body.y1 + gap + run + size / 2 : body.y0 - gap - run - size / 2;
      }
      run += size + gap;
      const at = page(cx, cy);
      const angle = x.level ? 0 : readable(turn);
      const outline = container(x.item.box, at, x.w, x.h, angle);
      if (outline) outlines.push(outline);
      texts.push({ at, text: x.item.text.trim(), height: x.item.height, justify: "centre", ...(angle ? { angle: (angle * 180) / Math.PI } : {}) });
    }
  }
  return { outlines, texts };
}
