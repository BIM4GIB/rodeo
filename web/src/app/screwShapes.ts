// Screws for the Fastener tool (Vectorworks' Fasteners tool set), in 2D: hex, square and hex
// flange heads (bolts and cap screws), socket heads (cap, flat and button), slotted machine and cap
// screw heads (flat and oval countersunk, round, pan, truss, fillister), set screws and shoulder
// screws. A screw stands head up, its bearing face's centre on the origin and its shank hanging
// down -y; a countersunk head's top is the bearing face, flush, its cone below. Front looks across
// a hex head's corners (three faces) and along a slot (its cross-section notched in the head),
// Side across the flats and the slot's length; Top looks down on the head, two corners left and
// right, and Bottom up at the shank's end. A threaded shank is a shaft (shaftShapes.ts) in any of
// its thread displays. Sizes are mm.

import type { Pt } from "../core/index.ts";
import { lathe, polygonBody, type Solid } from "./solids3d.ts";
import { either, endChamfer, inBox, inCircle, inPolygon, outside, pointChamfer, pointedShank, pointFace, pointLength, type BoltThread, type PointSize, type ThumbPoint } from "./boltShapes.ts";
import { lockWasher, nut, plainWasher, type FastenerView, type NutBody, type PlainWasher } from "./fastenerShapes.ts";
import { hexTop, prismFaces, type Chamfered } from "./nutShapes.ts";
import { arc, type FastenerDrawing } from "./rivetShapes.ts";
import type { ThreadDisplay } from "./shaftShapes.ts";

type Drawing = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: FastenerDrawing["arcs"][number][]; hidden: Pt[][] };

const ARC_STEPS = 24;
const O: Pt = { x: 0, y: 0 };
const empty = (): Drawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });
const round2 = (n: number): number => Math.round(n * 100) / 100;
const mirror = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y })).reverse();

export type HeadKind = "hex" | "square" | "hexFlange" | "socket" | "flatSocket" | "buttonSocket" | "flat" | "oval" | "round" | "pan" | "truss" | "fillister" | "carriage" | "none";

/**
 * A screw head: across its flats (hex, square) or its diameter, its height (a countersunk head's
 * cone), what rises above that (an oval head's raise, a fillister's crown; a button or carriage
 * head's rim under its dome), a pan
 * head's corner radius (a headless screw's crowned end's radius, 0 for flat), its socket (hex or
 * spline) or slot, a flange or washer face under it, a countersink's included angle, and whether
 * a socket head's top edge is rounded rather than chamfered. A headless ("none") set screw's end
 * is chamfered as deep as its thread, its socket or slot cut in it.
 */
export interface ScrewHead {
  readonly kind: HeadKind;
  readonly width: number;
  readonly height: number;
  readonly crown: number;
  readonly radius: number;
  readonly socket: { readonly flats: number; readonly depth: number; readonly spline?: boolean } | null;
  readonly slot: { readonly width: number; readonly depth: number } | null;
  readonly flange: { readonly diameter: number; readonly thickness: number } | null;
  readonly washerFace: { readonly diameter: number; readonly height: number } | null;
  readonly angle: number;
  readonly rounded: boolean;
  /** a cross (Phillips) or square (Robertson) recess: its width across and depth */
  readonly recess?: { readonly kind: "cross" | "square"; readonly width: number; readonly depth: number } | null;
  /** a carriage bolt's square neck under its head: across its flats, and how deep */
  readonly neck?: { readonly flats: number; readonly depth: number } | null;
  /** a socket head's top edge chamfer or radius where the standard gives it (0 for a plain edge) */
  readonly edge?: number;
}

/** A wood or tapping screw's thread: its root diameter, pitch, how long its point tapers, to a sharp gimlet or a blunt end (`end` across, else half the root), drawn as a thread or plain. */
export interface WoodThread {
  readonly root: number;
  readonly pitch: number;
  readonly taper: number;
  readonly point: "gimlet" | "blunt";
  readonly end?: number;
  readonly threads: boolean;
}

/** A screw: its head, thread, length under the head (a countersunk head's or a headless screw's overall), thread length, point, a shoulder screw's shoulder, and its thread's display. */
export interface Screw {
  readonly head: ScrewHead;
  readonly thread: BoltThread;
  readonly length: number;
  readonly threadLength: number;
  readonly point: ThumbPoint;
  /** the point's sizes from the standard's table, where it gives them */
  readonly pointSize?: PointSize | null;
  /** a shoulder screw's shoulder (or a square head set screw's neck relief): its diameter and length under the head, and the undercut where the thread starts; `length` is then the thread's */
  readonly shoulder: { readonly diameter: number; readonly length: number; readonly undercut?: { readonly diameter: number; readonly width: number } | null } | null;
  readonly display: ThreadDisplay;
  readonly fillet: boolean;
  /** a wood, lag or tapping screw's tapered thread in place of a machine thread */
  readonly wood?: WoodThread | null;
}

const countersunk = (h: ScrewHead): boolean => h.kind === "flat" || h.kind === "flatSocket" || h.kind === "oval";
const prism = (h: ScrewHead): boolean => h.kind === "hex" || h.kind === "square" || h.kind === "hexFlange";
/** across a hex or square head's corners */
const cornersOf = (h: ScrewHead): number => (h.kind === "square" ? h.width * Math.SQRT2 : h.width / Math.cos(Math.PI / 6));

/** the widest the head reaches from the axis */
export const headHalf = (h: ScrewHead): number => Math.max(prism(h) ? cornersOf(h) / 2 : h.width / 2, (h.flange?.diameter ?? 0) / 2, (h.washerFace?.diameter ?? 0) / 2);

/** how far a countersunk head's cone reaches down from its top, where it meets the shank */
const coneDepth = (h: ScrewHead, d: number): number => Math.max(0, (h.width - d) / 2 / Math.tan((h.angle * Math.PI) / 360));

/** a headless screw's end: its chamfer, as deep as the thread, and its crown's rise over the face inside it */
function endCap(h: ScrewHead, t: BoltThread): { chamfer: number; rise: number } {
  const chamfer = endChamfer(t);
  const f = t.diameter / 2 - chamfer;
  const R = h.radius;
  return { chamfer, rise: R > f ? R - Math.sqrt(R * R - f * f) : 0 };
}

/** how much of a screw's length its head takes: a countersunk head's cone or a headless screw's chamfered end, which its length includes */
export function underHead(h: ScrewHead, t: BoltThread): number {
  if (countersunk(h)) return coneDepth(h, t.diameter);
  if (h.kind !== "none") return 0;
  const cap = endCap(h, t);
  return cap.chamfer + cap.rise;
}

export function screwProblem(s: Screw): string | null {
  const D = s.thread.diameter;
  const h = s.head;
  const point = s.pointSize ?? {};
  if (h.kind === "none") {
    // a socket or slot must leave the point's chamfer whole
    const room = s.length - pointLength(s.thread, s.point, point) - pointChamfer(s.thread, s.point, point);
    if (h.socket && !(h.socket.flats < D && h.socket.depth < room)) return "the socket must fit in the screw: lengthen it";
    if (h.slot && !(h.slot.width < D && h.slot.depth < room)) return "the slot must fit in the screw: lengthen it";
  } else {
    if (!(h.width > (s.shoulder?.diameter ?? D))) return "the head must be wider than the shank";
    if (h.socket && !(h.socket.flats < h.width && h.socket.depth < h.height + h.crown + (countersunk(h) ? coneDepth(h, D) : 0))) return "the socket must fit in the head";
    if (h.slot && !(h.slot.width < h.width && h.slot.depth < h.height + h.crown)) return "the slot must fit in the head";
  }
  // under the head a countersunk cone or a carriage bolt's neck, then the point (a wood thread's taper)
  const under = underHead(h, s.thread) + (h.neck?.depth ?? 0);
  const least = under + (s.wood ? s.wood.taper : pointLength(s.thread, s.point, point) + Math.max(2 * endChamfer(s.thread), endChamfer(s.thread) + pointChamfer(s.thread, s.point, point)));
  if (!(s.length > least)) return `the length must be more than ${round2(least + (s.shoulder?.length ?? 0))} mm`;
  if (!(s.threadLength > 0 && s.threadLength <= s.length - under + 1e-9)) return "the thread must be within the length";
  return null;
}

/** points round a circular arc through (a, y0), (0, y0 + rise) and (-a, y0), right to left */
function capArc(a: number, y0: number, rise: number, steps = ARC_STEPS): Pt[] {
  if (rise <= 1e-9) return [{ x: a, y: y0 }, { x: -a, y: y0 }];
  const R = (a * a + rise * rise) / (2 * rise);
  const c = { x: 0, y: y0 + rise - R };
  const t = Math.atan2(y0 - c.y, a);
  return arc(c, R, t, Math.PI - t, steps);
}

/** `top`, left to right, with a notch from x0 to x1 cut down to `floor` */
function notch(top: readonly Pt[], x0: number, x1: number, floor: number): Pt[] {
  const yAt = (x: number): number => {
    for (let i = 0; i + 1 < top.length; i++) {
      const [a, b] = [top[i], top[i + 1]];
      if ((x - a.x) * (x - b.x) <= 1e-12) return Math.abs(b.x - a.x) < 1e-12 ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
    return top[top.length - 1].y;
  };
  const out: Pt[] = [];
  let done = false;
  for (const p of top) {
    if (!done && p.x >= x0) {
      out.push({ x: x0, y: yAt(x0) }, { x: x0, y: floor }, { x: x1, y: floor }, { x: x1, y: yAt(x1) });
      done = true;
    }
    if (p.x <= x0 || p.x >= x1) out.push(p);
  }
  return out;
}

/** The head's profile from the front or side: its outline above y = base, left to right over the top (open at its foot), and the lines and hidden lines inside it. A headless screw's is its chamfered end, below y = 0. */
function profile(h: ScrewHead, view: "front" | "side", d: number, t: BoltThread): { over: Pt[]; lines: Pt[][]; hidden: Pt[][]; foot: number } {
  const lines: Pt[][] = [];
  const hidden: Pt[][] = [];
  const W = h.width / 2;
  const k = h.height;
  let over: Pt[];
  let foot = W;
  let floor = k;
  if (prism(h)) {
    const G = cornersOf(h);
    // a square, corners front and back as in its top view, shows the same two faces from the side
    const xs = h.kind === "square" ? [-G / 2, 0, G / 2] : view === "front" ? [-G / 2, -G / 4, G / 4, G / 2] : [-W, 0, W];
    const base = h.flange?.thickness ?? h.washerFace?.height ?? 0;
    const body = k - base;
    const c = Math.min(((G - 0.95 * h.width) / 2) * Math.tan(Math.PI / 6), body / 4);
    const chamfered: Chamfered = "top";
    const f = prismFaces(xs, body, c, chamfered);
    const lift = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: p.x, y: p.y + base }));
    over = [...lift(f.top)];
    lines.push(...f.lines.map(lift));
    foot = xs[xs.length - 1];
    // the body's bearing edge, and the flange or washer face it stands on
    const under = h.flange ?? (h.washerFace ? { diameter: h.washerFace.diameter, thickness: h.washerFace.height } : null);
    if (under) {
      const F = under.diameter / 2;
      over = [{ x: -F, y: 0 }, { x: -F, y: base }, { x: -foot, y: base }, ...over, { x: foot, y: base }, { x: F, y: base }, { x: F, y: 0 }];
      lines.push([{ x: -Math.min(F, foot), y: base }, { x: Math.min(F, foot), y: base }]);
      foot = F;
    } else over = [{ x: -foot, y: 0 }, ...over, { x: foot, y: 0 }];
  } else if (countersunk(h)) {
    // the top face (flat, or an oval head's raise) at y = 0; the cone below, down to the shank
    const depth = coneDepth(h, d);
    const top = h.kind === "oval" ? capArc(W, 0, h.crown).reverse() : [{ x: -W, y: 0 }, { x: W, y: 0 }];
    over = [{ x: -d / 2, y: -depth }, ...top, { x: d / 2, y: -depth }];
    if (h.kind === "oval") lines.push([{ x: -W, y: 0 }, { x: W, y: 0 }]);
    foot = d / 2;
    floor = h.kind === "oval" ? h.crown : 0;
  } else if (h.kind === "round" || h.kind === "truss" || h.kind === "buttonSocket" || h.kind === "carriage") {
    // a domed head: a short rim (a button or carriage head's) then a circular cap to its height
    const rim = h.kind === "buttonSocket" ? Math.min(h.crown, k / 3) : h.kind === "carriage" ? Math.min(h.crown, k / 2) : 0;
    over = [{ x: -W, y: 0 }, ...capArc(W, rim, k - rim).reverse(), { x: W, y: 0 }];
  } else if (h.kind === "pan") {
    const r = Math.min(h.radius || 0.25 * k, k, W);
    over = [{ x: -W, y: 0 }, ...arc({ x: -W + r, y: k - r }, r, Math.PI, Math.PI / 2, ARC_STEPS / 2), ...arc({ x: W - r, y: k - r }, r, Math.PI / 2, 0, ARC_STEPS / 2), { x: W, y: 0 }];
  } else if (h.kind === "fillister") {
    // its side `height` high, its oval crown rising `crown` above
    over = [{ x: -W, y: 0 }, ...capArc(W, k, h.crown).reverse(), { x: W, y: 0 }];
    lines.push([{ x: -W, y: k }, { x: W, y: k }]);
    floor = k + h.crown;
  } else if (h.kind === "socket") {
    const e = socketEdge(h);
    const corner = e <= 1e-9 ? [{ x: -W, y: k }] : h.rounded ? arc({ x: -W + e, y: k - e }, e, Math.PI, Math.PI / 2, ARC_STEPS / 4) : [{ x: -W, y: k - e }, { x: -W + e, y: k }];
    over = [{ x: -W, y: 0 }, ...corner, ...mirror(corner), { x: W, y: 0 }];
  } else {
    // a headless screw's end: chamfered in to its face, crowned or flat, its top on y = 0
    const cap = endCap(h, t);
    const f = d / 2 - cap.chamfer;
    over = [{ x: -d / 2, y: -cap.chamfer - cap.rise }, ...capArc(f, -cap.rise, cap.rise).reverse(), { x: d / 2, y: -cap.chamfer - cap.rise }];
    foot = d / 2;
  }
  // the top's highest point, where a slot or socket starts
  const top = Math.max(floor, ...over.map((p) => p.y));
  if (h.slot) {
    const n = h.slot.width / 2;
    const bottom = top - h.slot.depth;
    if (view === "front") over = notch(over, -n, n, bottom);
    else {
      // along the slot: its floor hidden, its ends cut through the crown
      hidden.push([{ x: -W, y: bottom }, { x: W, y: bottom }]);
    }
  }
  if (h.socket) {
    // a hex socket across its corners from the front (an inner corner's edges hidden too), a spline socket across its splines
    const spline = h.socket.spline === true;
    const s = view === "front" && !spline ? h.socket.flats / Math.cos(Math.PI / 6) / 2 : h.socket.flats / 2;
    const surface = countersunk(h) ? 0 : top;
    const bottom = surface - h.socket.depth;
    // the socket's walls, and its drilled end's 118° cone
    const tip = bottom - s * Math.tan((31 * Math.PI) / 180);
    hidden.push([{ x: -s, y: surface }, { x: -s, y: bottom }, { x: 0, y: tip }, { x: s, y: bottom }, { x: s, y: surface }]);
    if (view === "front" && !spline) hidden.push([{ x: -s / 2, y: surface }, { x: -s / 2, y: bottom }], [{ x: s / 2, y: surface }, { x: s / 2, y: bottom }]);
  }
  if (h.recess) {
    // the recess's walls closing to its bottom
    const m = h.recess.width / 2;
    const bottom = top - h.recess.depth;
    hidden.push(h.recess.kind === "cross" ? [{ x: -m, y: top }, { x: 0, y: bottom }, { x: m, y: top }] : [{ x: -m, y: top }, { x: -m, y: top - 0.7 * h.recess.depth }, { x: 0, y: bottom }, { x: m, y: top - 0.7 * h.recess.depth }, { x: m, y: top }]);
  }
  return { over, lines, hidden, foot };
}

/** a socket head's top edge: the standard's chamfer or radius, else in proportion to the head */
const socketEdge = (h: ScrewHead): number => h.edge ?? Math.min(0.08 * h.width, h.height / 4);

/** a six-spline socket seen from the top: splines out to `width` across from roots 0.85 of it (the roots are Rodeo's estimate) */
function splineOutline(width: number): Pt[] {
  const R = width / 2;
  const r = 0.85 * R;
  return Array.from({ length: 6 }, (_, i) => (i * Math.PI) / 3).flatMap((a) =>
    [[r, a - 0.3], [R, a - 0.2], [R, a + 0.2], [r, a + 0.3]].map(([q, u]) => ({ x: q * Math.cos(u), y: q * Math.sin(u) })),
  );
}

/** a cross recess's outline seen from the top: arms a fifth of its width wide */
function crossOutline(width: number): Pt[] {
  const m = width / 2;
  const a = width / 10;
  return [
    { x: a, y: a }, { x: a, y: m }, { x: -a, y: m }, { x: -a, y: a }, { x: -m, y: a }, { x: -m, y: -a },
    { x: -a, y: -a }, { x: -a, y: -m }, { x: a, y: -m }, { x: a, y: -a }, { x: m, y: -a }, { x: m, y: a },
  ];
}

/** half a wood thread's end: a gimlet's sharp point, or a blunt end `end` (else half the root) across */
const woodTip = (w: WoodThread): number => (w.point === "gimlet" ? 0 : (w.end ?? 0.5 * w.root) / 2);

/** A wood or tapping screw's shank hanging from `top`: plain, then threaded to a point tapering over its last `taper`; as a thread's zigzag, or plain with its root hidden. */
function taperedShank(D: number, length: number, threadLength: number, w: WoodThread, top: number): { edge: Pt[]; lines: Pt[][]; hidden: Pt[][] } {
  const yT = top - Math.max(0, length - threadLength);
  const yE = top - length;
  const taper = Math.min(w.taper, threadLength);
  const tip = woodTip(w);
  const along = (full: number, y: number): number => (y >= yE + taper ? full : tip + ((full - tip) * (y - yE)) / Math.max(taper, 1e-9));
  const crest = (y: number): number => along(D / 2, y);
  const root = (y: number): number => Math.min(along(w.root / 2, y), crest(y));
  const lines: Pt[][] = [];
  const hidden: Pt[][] = [];
  let right: Pt[];
  let left: Pt[];
  if (w.threads) {
    // crests and roots each half a pitch apart, the left side half a pitch behind the right
    const side = (phase: number): Pt[] => {
      const out: Pt[] = [];
      for (let k = 0, y = yT - phase; y > yE + 1e-9; k++, y -= w.pitch / 2) out.push({ x: k % 2 === 0 ? crest(y) : root(y), y });
      return out;
    };
    right = [{ x: D / 2, y: top }, { x: D / 2, y: yT }, ...side(0)];
    left = [{ x: D / 2, y: top }, { x: D / 2, y: yT }, ...side(w.pitch / 4)];
  } else {
    right = [{ x: D / 2, y: top }, { x: D / 2, y: Math.min(yT, yE + taper) }, { x: crest(yE + taper), y: yE + taper }];
    left = right;
    const r = w.root / 2;
    const ys = [yT, yE + taper, yE];
    for (const sgn of [-1, 1]) hidden.push([{ x: sgn * r, y: ys[0] }, { x: sgn * r, y: Math.min(ys[0], ys[1]) }, { x: sgn * root(yE), y: yE }]);
  }
  const end = tip > 1e-9 ? [{ x: tip, y: yE }, { x: -tip, y: yE }] : [{ x: 0, y: yE }];
  const edge = [...right, ...end, ...left.map((p) => ({ x: -p.x, y: p.y })).reverse()];
  return { edge, lines, hidden };
}

/** The head seen from the top (a headless screw's end): its outline, a chamfer or flange circle, its socket or slot. */
function headTop(d: Drawing, h: ScrewHead, t: BoltThread): void {
  const W = h.width / 2;
  if (h.kind === "none") d.circles.push({ center: O, radius: t.diameter / 2 }, { center: O, radius: t.diameter / 2 - endChamfer(t) });
  if (h.kind === "hex" || h.kind === "hexFlange") d.outlines.push(hexTop({ flats: h.width, height: h.height }));
  else if (h.kind === "square") {
    const R = cornersOf(h) / 2;
    d.outlines.push(Array.from({ length: 4 }, (_, i) => ({ x: R * Math.cos((i * Math.PI) / 2), y: R * Math.sin((i * Math.PI) / 2) })));
  } else if (h.kind !== "none") d.circles.push({ center: O, radius: W });
  if (prism(h)) d.circles.push({ center: O, radius: (0.95 * h.width) / 2 });
  if (h.flange) d.circles.push({ center: O, radius: h.flange.diameter / 2 });
  if (h.kind === "socket" && socketEdge(h) > 1e-9) d.circles.push({ center: O, radius: W - socketEdge(h) });
  if (h.kind === "fillister" || h.kind === "pan") d.circles.push({ center: O, radius: W - (h.kind === "pan" ? Math.min(h.radius || 0.25 * h.height, W) : 0.15 * W) });
  if (h.socket) d.outlines.push(h.socket.spline ? splineOutline(h.socket.flats) : hexTop({ flats: h.socket.flats, height: 0 }));
  if (h.recess) {
    const m = h.recess.width / 2;
    d.outlines.push(h.recess.kind === "cross" ? crossOutline(h.recess.width) : [{ x: -m, y: -m }, { x: m, y: -m }, { x: m, y: m }, { x: -m, y: m }]);
  }
  if (h.slot) {
    // the slot runs front to back
    const n = h.slot.width / 2;
    const L = Math.sqrt(Math.max(0, W * W - n * n));
    d.lines.push([{ x: -n, y: -L }, { x: -n, y: L }], [{ x: n, y: -L }, { x: n, y: L }]);
  }
}

/** The screw from the front or side in parts: the head's outlines and lines, the shank's, and how high the head reaches. */
function sideParts(s: Screw, view: "front" | "side"): { head: Pt[][]; headLines: Pt[][]; headHidden: Pt[][]; shank: { edge: Pt[]; lines: Pt[][]; hidden: Pt[][] }; joined: boolean; top: number; end: number } {
  const h = s.head;
  const t = s.thread;
  const D = t.diameter;
  const p = profile(h, view, s.shoulder?.diameter ?? D, t);
  const joined = countersunk(h) || h.kind === "none";
  const start = joined ? -underHead(h, t) : 0;
  // a shoulder, or a carriage bolt's square neck (seen across its corners), comes first under the head
  const neck = h.neck ? h.neck.depth : 0;
  const shoulderLength = s.shoulder ? s.shoulder.length : neck;
  const shankLength = s.length + start - neck;
  const shank = s.wood
    ? taperedShank(D, shankLength, Math.min(s.threadLength, shankLength), s.wood, start - shoulderLength)
    : pointedShank(t, shankLength, s.point, s.display, Math.max(0, shankLength - s.threadLength), start - shoulderLength, s.pointSize ?? {}, s.shoulder?.undercut?.diameter ?? D);
  const head: Pt[][] = [];
  const headLines = [...p.lines];
  if (h.neck) {
    const n = h.neck.flats / Math.SQRT2;
    head.push([{ x: -n, y: 0 }, { x: -n, y: -neck }, { x: n, y: -neck }, { x: n, y: 0 }]);
    headLines.push([{ x: 0, y: 0 }, { x: 0, y: -neck }]);
  }
  if (joined) shank.edge.push(...p.over.slice(1, -1));
  if (h.kind === "none") {
    // the chamfer's edge across the shank, broken where a slot seen end on cuts below it
    const n = h.slot && view === "front" && -h.slot.depth < start ? h.slot.width / 2 : 0;
    headLines.push(...(n > 0 ? [[{ x: -D / 2, y: start }, { x: -n, y: start }], [{ x: n, y: start }, { x: D / 2, y: start }]] : [[{ x: -D / 2, y: start }, { x: D / 2, y: start }]]));
  } else if (!countersunk(h)) {
    if (p.over.length) head.push(p.over);
    if (s.shoulder) {
      const r = s.shoulder.diameter / 2;
      head.push([{ x: -r, y: 0 }, { x: -r, y: -shoulderLength }, { x: r, y: -shoulderLength }, { x: r, y: 0 }]);
    }
    if (s.fillet) {
      // the underhead fillet's small radius where the shank meets the bearing face
      const r = 0.05 * D;
      const R = (s.shoulder?.diameter ?? D) / 2;
      headLines.push(arc({ x: R + r, y: -r }, r, Math.PI / 2, Math.PI, 6), arc({ x: -R - r, y: -r }, r, Math.PI / 2, 0, 6));
    }
  }
  return { head, headLines, headHidden: p.hidden, shank, joined, top: Math.max(0, ...p.over.map((q) => q.y)), end: -(s.shoulder?.length ?? 0) - s.length };
}

/** The head's footprint seen along the axis: its outline and what it covers. */
function headPrint(h: ScrewHead): { outline: Pt[] | null; radius: number; covers: (p: Pt) => boolean } {
  if (h.kind === "hex" || h.kind === "hexFlange" || h.kind === "square") {
    const R = cornersOf(h) / 2;
    const outline = h.kind === "square" ? Array.from({ length: 4 }, (_, i) => ({ x: R * Math.cos((i * Math.PI) / 2), y: R * Math.sin((i * Math.PI) / 2) })) : hexTop({ flats: h.width, height: h.height });
    const F = (h.flange?.diameter ?? 0) / 2;
    return { outline, radius: 0, covers: (q) => inPolygon(outline, q) || Math.hypot(q.x, q.y) < F };
  }
  return { outline: null, radius: h.width / 2, covers: inCircle(O, h.kind === "none" ? 0 : h.width / 2) };
}

/** A screw from the front, side, top or bottom. */
export function screw(s: Screw, view: FastenerView, beyond: number | null): FastenerDrawing {
  return combination({ screw: s, top: [], bearing: 0, bottom: [] }, view, beyond);
}

/** A washer, lock washer or nut on a screw's shank. */
export type StackItem = { readonly kind: "washer" | "lock"; readonly washer: PlainWasher } | { readonly kind: "nut"; readonly nut: NutBody };

/** A screw with washers under its head, and washers and a nut `bearing` below its head's bearing face (where the joint ends). */
export interface Combination {
  readonly screw: Screw;
  /** under the head, nearest it first */
  readonly top: readonly StackItem[];
  readonly bearing: number;
  /** below the joint, nearest it first */
  readonly bottom: readonly StackItem[];
}

export const itemHeight = (i: StackItem): number => (i.kind === "nut" ? i.nut.height : i.washer.thickness);

/** each item and the span it fills: the top stack down from the head, the bottom from the joint */
function stacked(c: Combination): { item: StackItem; y0: number; y1: number; facing: "up" | "down" }[] {
  const out: { item: StackItem; y0: number; y1: number; facing: "up" | "down" }[] = [];
  let y = 0;
  for (const item of c.top) {
    out.push({ item, y0: y - itemHeight(item), y1: y, facing: "down" });
    y -= itemHeight(item);
  }
  y = -c.bearing;
  for (const item of c.bottom) {
    out.push({ item, y0: y - itemHeight(item), y1: y, facing: "up" });
    y -= itemHeight(item);
  }
  return out;
}

export function combinationProblem(c: Combination): string | null {
  const problem = screwProblem(c.screw);
  if (problem) return problem;
  const topStack = c.top.reduce((sum, i) => sum + itemHeight(i), 0);
  if (c.bottom.length && !(c.bearing >= topStack - 1e-9)) return `the bearing length must leave room for the washers under the head (at least ${round2(topStack)} mm)`;
  const items = stacked(c);
  const reach = c.screw.length + (c.screw.shoulder?.length ?? 0);
  const last = items[items.length - 1];
  if (last && !(-last.y0 <= reach + 1e-9)) return "the washers and nut reach past the screw's end: lengthen it or shorten Bearing Length";
  const nutAt = items.find((i) => i.item.kind === "nut");
  const threadStart = reach - c.screw.threadLength;
  if (nutAt && !(-nutAt.y1 >= threadStart - 1e-9)) return "the nut must sit on the thread: lengthen the thread or Bearing Length";
  for (const i of items) {
    const hole = i.item.kind === "nut" ? i.item.nut.major : i.item.washer.inside;
    if (hole < c.screw.thread.diameter - 1e-6) return "a washer or nut is too small for the screw";
  }
  return null;
}

/**
 * A hex or square headed screw with its washers and nut as a solid: the head above z = 0 (its
 * bearing face), the plain shank and the stacks below, the shank round without its thread, a lock
 * washer a plain ring.
 */
export function combinationSolid(c: Combination): Solid {
  const { head, thread, length } = c.screw;
  const r = thread.diameter / 2;
  const faces = lathe([{ x: 0, y: 0 }, { x: r, y: 0 }, { x: r, y: -length }, { x: 0, y: -length }]);
  faces.push(...polygonBody(head.kind === "square" ? 4 : 6, head.width, 0, head.height, false, true));
  for (const { item, y0, y1 } of stacked(c)) {
    if (item.kind === "nut") faces.push(...polygonBody(item.nut.shape === "square" ? 4 : 6, item.nut.flats, y0, y1, item.nut.chamfered === "both", item.nut.chamfered !== "none"));
    else {
      const w = item.washer;
      faces.push(...lathe([{ x: w.inside / 2, y: y0 }, { x: w.outside / 2, y: y0 }, { x: w.outside / 2, y: y1 }, { x: w.inside / 2, y: y1 }]));
    }
  }
  return faces;
}

/** an item from the front or side between y0 and y1, facing up (its bearing face at y1) or down */
function itemSide(i: StackItem, view: "front" | "side", y0: number, y1: number, facing: "up" | "down"): { d: FastenerDrawing; half: number } {
  const d = i.kind === "nut" ? nut(i.nut, view, null) : i.kind === "lock" ? lockWasher(i.washer, view, null) : plainWasher(i.washer, view, null);
  const place = (p: Pt): Pt => (facing === "up" ? { x: p.x, y: y1 - p.y } : { x: p.x, y: y0 + p.y });
  const xs = d.outlines.flat().map((p) => Math.abs(p.x));
  return { d: { outlines: d.outlines.map((o) => o.map(place)), lines: d.lines.map((l) => l.map(place)), circles: [], arcs: [], hidden: [] }, half: Math.max(...xs) };
}

/** an item's footprint along the axis: what it covers, and its outline drawn where nearer things leave it showing */
function itemPrint(i: StackItem): { covers: (p: Pt) => boolean; draw: (d: Drawing, covered: ((p: Pt) => boolean) | null, from: "top" | "bottom") => void } {
  if (i.kind === "nut") {
    const n = i.nut;
    const polygon = n.shape === "hex" ? hexTop({ flats: n.flats, height: n.height }) : (() => {
      const R = (n.flats * Math.SQRT2) / 2;
      return Array.from({ length: 4 }, (_, k) => ({ x: R * Math.cos((k * Math.PI) / 2), y: R * Math.sin((k * Math.PI) / 2) }));
    })();
    return {
      covers: (q) => inPolygon(polygon, q),
      draw: (d, covered, from) => {
        drawVisible(d, polygon, covered);
        // seen from below a nut under the joint shows its top: its chamfer and any crown
        if (from === "bottom" && n.chamfered !== "none") drawCircle(d, (0.95 * n.flats) / 2, covered);
        if (from === "bottom" && n.slots?.crown) drawCircle(d, n.slots.crown / 2, covered);
      },
    };
  }
  const R = i.washer.outside / 2;
  return { covers: inCircle(O, R), draw: (d, covered) => drawCircle(d, R, covered) };
}

/** `outline` closed, or the runs of it `covered` leaves showing */
function drawVisible(d: Drawing, outline: readonly Pt[], covered: ((p: Pt) => boolean) | null): void {
  if (!covered) return void d.outlines.push([...outline]);
  const runs = outside([...outline, outline[0]], covered);
  if (runs.length === 1 && runs[0].length === outline.length + 1) d.outlines.push([...outline]);
  else d.lines.push(...runs);
}

/** a circle round the axis, or the arcs of it `covered` leaves showing */
function drawCircle(d: Drawing, radius: number, covered: ((p: Pt) => boolean) | null): void {
  if (!covered) return void d.circles.push({ center: O, radius });
  const ring = arc(O, radius, 0, 2 * Math.PI, ARC_STEPS * 4);
  const runs = outside(ring, covered);
  if (runs.length === 1 && runs[0].length === ring.length) d.circles.push({ center: O, radius });
  else d.lines.push(...runs);
}

/** A screw with its washers and nut from the front, side, top or bottom; what's nearer hides what's behind. */
export function combination(c: Combination, view: FastenerView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const s = c.screw;
  const h = s.head;
  const t = s.thread;
  const D = t.diameter;
  const items = stacked(c);
  const half = Math.max(headHalf(h), D / 2, (s.shoulder?.diameter ?? 0) / 2, ...items.map((i) => (i.item.kind === "nut" ? (i.item.nut.flats / Math.cos(Math.PI / (i.item.nut.shape === "hex" ? 6 : 4))) / 2 : i.item.washer.outside / 2)));
  if (view === "top" || view === "bottom") {
    // nearest first: from the top the head, then the washers under it, then the bottom stack; from the bottom the shank's end, the nut, its washers, then up to the head
    const order = view === "top" ? items : [...items].reverse();
    const nearer: ((p: Pt) => boolean)[] = [];
    if (view === "top") {
      headTop(d, h, t);
      nearer.push(headPrint(h).covers);
    } else {
      // a wood thread's root where its point starts, and a blunt end
      const face = s.wood ? { end: s.wood.root / 2, recess: woodTip(s.wood) } : pointFace(t, s.point, s.pointSize ?? {});
      d.circles.push({ center: O, radius: D / 2 });
      if (face.end > 1e-9) d.circles.push({ center: O, radius: face.end });
      if (face.recess > 1e-9) d.circles.push({ center: O, radius: face.recess });
      nearer.push(inCircle(O, D / 2));
    }
    for (const i of order) {
      const print = itemPrint(i.item);
      print.draw(d, either(nearer), view);
      nearer.push(print.covers);
    }
    if (view === "bottom") {
      // the head and anything round it beyond; a flange, at the bearing face, hides what it's under
      const head = headPrint(h);
      if (h.flange) {
        drawCircle(d, h.flange.diameter / 2, either(nearer));
        nearer.push(inCircle(O, h.flange.diameter / 2));
      }
      if (head.outline) drawVisible(d, head.outline.map((p) => ({ x: p.x, y: -p.y })), either(nearer));
      else if (h.kind !== "none") drawCircle(d, head.radius, either(nearer));
      if (h.washerFace) drawCircle(d, h.washerFace.diameter / 2, either(nearer));
      if (h.neck) {
        const n = h.neck.flats / Math.SQRT2;
        drawVisible(d, [{ x: n, y: 0 }, { x: 0, y: n }, { x: -n, y: 0 }, { x: 0, y: -n }], either(nearer));
      }
      if (s.shoulder) drawCircle(d, s.shoulder.diameter / 2, either(nearer));
    }
    if (beyond !== null) d.lines.push([{ x: -half - beyond, y: 0 }, { x: half + beyond, y: 0 }], [{ x: 0, y: -half - beyond }, { x: 0, y: half + beyond }]);
    return d;
  }
  const parts = sideParts(s, view);
  const drawn = items.map((i) => ({ ...i, ...itemSide(i.item, view, i.y0, i.y1, i.facing) }));
  const covered = drawn.length ? either(drawn.map((i) => inBox(-i.half, i.y0, i.half, i.y1))) : null;
  for (const o of parts.head) d.outlines.push(o);
  d.lines.push(...parts.headLines);
  d.hidden.push(...parts.headHidden);
  drawVisible(d, parts.shank.edge, covered);
  for (const l of parts.shank.lines) d.lines.push(...(covered ? outside(l, covered) : [l]));
  for (const l of parts.shank.hidden) d.hidden.push(...(covered ? outside(l, covered) : [l]));
  for (const i of drawn) {
    d.outlines.push(...i.d.outlines);
    d.lines.push(...i.d.lines);
  }
  const bottom = Math.min(parts.end, ...items.map((i) => i.y0));
  if (beyond !== null) d.lines.push([{ x: 0, y: parts.top + beyond }, { x: 0, y: bottom - beyond }]);
  return d;
}
