// The Machine Components' solids for their "- 3D" tools, built from what their 2D tools draw or their
// sizes (the shapes files beside this one). Wheels stand on the layer with their axis up, shafts,
// worms and springs lie along x as their drawings run, each with its lowest point on the layer. Kept
// apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { chainLinks, plateThickness, type ChainSize } from "./chainShapes.ts";
import { circleOutline, helical, lathe, lying, mapSolid, onEdge, onLayer, prism, sectionProfile, sweep, tube, type Point3, type Solid } from "./solids3d.ts";
import { axial, extensionCoils, type Coils, type ExtensionSpring } from "./springShapes.ts";
import type { TorsionFront } from "./torsionShapes.ts";
import { hubEnds, wormSizes, type Worm } from "./wormShapes.ts";

/** points a coil of wire takes, and a loop */
const COIL_STEPS = 24;
/** a wire's sides, round; fewer than a tube's since a spring has so many coils */
const WIRE_SIDES = 8;
/** how far a tooth or thread sinks into the body it stands on, as a share of the body's radius */
const SINK = 0.995;

/**
 * A toothed wheel from its front view's toothed outline and its section: the section turned, cut
 * down to the teeth's root, and the teeth standing on that across each stretch of the section that
 * reached past the root. Its axis is z, with the section's x along it.
 */
export function toothedSolid(toothed: readonly Pt[], section: readonly (readonly Pt[])[]): Solid {
  const root = Math.min(...toothed.map((p) => Math.hypot(p.x, p.y)));
  const profiles = section.map(sectionProfile).filter((p) => p.length >= 3);
  const faces = profiles.flatMap((p) => lathe(p.map((q) => ({ x: Math.min(q.x, root), y: q.y }))));
  const spans: [number, number][] = [];
  for (const p of profiles) {
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length];
      const part = (q: Pt, other: Pt): number => (q.x > root ? q.y : other.x > root ? q.y + ((other.y - q.y) * (root - q.x)) / (other.x - q.x) : NaN);
      const [y0, y1] = [part(a, b), part(b, a)];
      if (Number.isFinite(y0) && Number.isFinite(y1) && y0 !== y1) spans.push([Math.min(y0, y1), Math.max(y0, y1)]);
    });
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  const inside = circleOutline({ x: 0, y: 0 }, root * SINK);
  for (const [from, to] of merged) faces.push(...prism([toothed, inside], from, to));
  return faces;
}

/** A worm: its body and hubs turned, with its thread screwed round the root for each start. */
export function wormSolid(w: Worm): Solid {
  const { module, lead, outside, root } = wormSizes(w);
  const half = w.faceWidth / 2;
  const ends = hubEnds(w);
  const bore = w.bore ? w.bore.diameter / 2 : 0;
  const hub = w.hub ? w.hub.diameter / 2 : root / 2;
  const left = ends.left < -half ? hub : root / 2;
  const right = ends.right > half ? hub : root / 2;
  const body = lathe([
    { x: bore, y: ends.left },
    { x: left, y: ends.left },
    { x: left, y: -half },
    { x: root / 2, y: -half },
    { x: root / 2, y: half },
    { x: right, y: half },
    { x: right, y: ends.right },
    { x: bore, y: ends.right },
  ]);
  const slope = Math.tan((w.pressureAngle * Math.PI) / 180);
  const tip = Math.max(w.axialPitch / 4 - module * slope, 0.05 * w.axialPitch);
  const base = w.axialPitch / 4 + 1.25 * module * slope;
  const turns = (w.faceWidth - 2 * base) / lead;
  const thread: Solid = [];
  if (turns > 0) {
    const section = [
      { x: (root / 2) * SINK, y: -half },
      { x: outside / 2, y: -half + base - tip },
      { x: outside / 2, y: -half + base + tip },
      { x: (root / 2) * SINK, y: -half + 2 * base },
    ];
    const one = helical(section, lead, turns);
    for (let k = 0; k < w.starts; k++) {
      const t = (k * 2 * Math.PI) / w.starts;
      const [c, s] = [Math.cos(t), Math.sin(t)];
      thread.push(...mapSolid(one, ([x, y, z]) => [c * x - s * y, s * x + c * y, z]));
    }
  }
  return onLayer(lying([...body, ...thread]));
}

/** The wire centre's path along a coil spring lying along x: the top of a coil at each whole coil. */
function coilCentre(c: Coils, from = 0): Point3[] {
  const count = Math.max(2, Math.ceil(c.total * COIL_STEPS));
  const hand = c.leftHand ? -1 : 1;
  return Array.from({ length: count + 1 }, (_, i) => {
    const u = (i / count) * c.total;
    const t = from + u * 2 * Math.PI;
    const r = c.r0 + ((c.r1 - c.r0) * u) / c.total;
    return [axial(c, u), r * Math.cos(t), hand * r * Math.sin(t)];
  });
}

const roundSection = (wire: number): Pt[] => circleOutline({ x: 0, y: 0 }, wire / 2, WIRE_SIDES);

/** A compression spring lying along x; a ground end is cut flat at 0 or the working length. */
export function coilSolid(c: Coils): Solid {
  const path = coilCentre(c);
  let faces: Solid;
  if (c.wire.kind === "round") faces = sweep(path, roundSection(c.wire.width));
  else {
    const [h, w] = [c.wire.height / 2, c.wire.width / 2];
    const section = [
      { x: -h, y: -w },
      { x: h, y: -w },
      { x: h, y: w },
      { x: -h, y: w },
    ];
    faces = sweep(path, section, false, [1, 0, 0]);
  }
  if (c.ground) faces = mapSolid(faces, ([x, y, z]) => [Math.min(Math.max(x, 0), c.length), y, z]);
  return onLayer(faces);
}

/** An extension spring lying along x: its coils stretched to the working length, with a loop or a hook at each end, face on from above or edgewise. */
export function extensionSolid(e: ExtensionSpring): Solid {
  const coils = extensionCoils(e);
  const r = (e.outside - e.wire) / 2;
  const c: Coils = {
    wire: { kind: "round", width: e.wire },
    total: coils,
    along: [
      { u: 0, s: e.hook + e.wire / 2 },
      { u: coils, s: e.length - e.hook - e.wire / 2 },
    ],
    r0: r,
    r1: r,
    length: e.length,
    ground: false,
    leftHand: e.leftHand,
  };
  const path = coilCentre(c);
  const faces = sweep(path, roundSection(e.wire));
  const loop = (e.hook - e.wire) / 2;
  const flat = e.view !== "edgewise";
  for (const side of [-1, 1]) {
    const cx = side < 0 ? e.hook / 2 : e.length - e.hook / 2;
    const on = (t: number): Point3 => [cx + loop * Math.cos(t), flat ? loop * Math.sin(t) : 0, flat ? 0 : loop * Math.sin(t)];
    if (e.style === "hook") {
      // a hook opens on its outer side, above the axis, as the front view draws it
      const [a, b] = side > 0 ? [Math.PI / 12, (5 * Math.PI) / 12] : [(7 * Math.PI) / 12, (11 * Math.PI) / 12];
      const steps = COIL_STEPS;
      faces.push(...tube(Array.from({ length: steps + 1 }, (_, i) => on(b + ((a + 2 * Math.PI - b) * i) / steps)), e.wire / 2, false, WIRE_SIDES));
    } else faces.push(...tube(Array.from({ length: COIL_STEPS }, (_, i) => on((i * 2 * Math.PI) / COIL_STEPS)), e.wire / 2, true, WIRE_SIDES));
    // the wire from the last coil to the loop's inner shoulder
    const coil = side < 0 ? path[0] : path[path.length - 1];
    faces.push(...tube([coil, on(side < 0 ? Math.PI / 4 : (3 * Math.PI) / 4)], e.wire / 2, false, WIRE_SIDES));
  }
  return onLayer(faces);
}

/** A torsion spring lying along x, each leg leaving the coils on a tangent (or, facing forward or rearward, crossing them from their far side). */
export function torsionSolid(t: TorsionFront): Solid {
  const r = (t.outside - t.wire) / 2;
  const hand = t.leftHand ? -1 : 1;
  const half = t.wire / 2;
  const x1 = half + t.coils * t.wire;
  /** the coil's angle at an end for its leg, its y and z at it being r cos and hand r sin */
  const angle = (leg: TorsionFront["left"], start: boolean): number | null => {
    if (!leg) return null;
    const dir = leg.direction === "up" ? 1 : -1;
    if (leg.orientation !== "normal") return dir > 0 ? Math.PI : 0;
    return ((start ? 1 : -1) * dir * Math.PI) / 2;
  };
  const from = angle(t.left, true) ?? 0;
  const ideal = from + t.coils * 2 * Math.PI;
  const wanted = angle(t.right, false);
  // the coils turned on, at most half a coil, to bring the right leg round to its tangent
  let to = wanted === null ? ideal : wanted + 2 * Math.PI * Math.round((ideal - wanted) / (2 * Math.PI));
  if (to <= from) to += 2 * Math.PI;
  const count = Math.max(2, Math.ceil(((to - from) / (2 * Math.PI)) * COIL_STEPS));
  const coil: Point3[] = Array.from({ length: count + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / count;
    return [half + ((x1 - half) * i) / count, r * Math.cos(a), hand * r * Math.sin(a)];
  });
  const legPath = (leg: TorsionFront["left"], end: Point3): Point3[] => {
    if (!leg) return [];
    const dir = leg.direction === "up" ? 1 : -1;
    const tip = dir * leg.length;
    if (leg.orientation === "normal") return [[end[0], tip, end[2]]];
    const s = leg.orientation === "forward" ? 1 : -1;
    return [[end[0], end[1], s * r], [end[0], tip, s * r]];
  };
  const path = [...legPath(t.left, coil[0]).reverse(), ...coil, ...legPath(t.right, coil[coil.length - 1])];
  return onLayer(sweep(path, roundSection(t.wire)));
}

/** A chain lying flat on the layer, its pins upright: rollers, inner plates on the roller links, outer ones on the pin links, and pins through them all. */
export function chainSolid(chain: ChainSize, pins: readonly Pt[], startPin: boolean): Solid {
  const t = plateThickness(chain);
  const w = chain.width / 2;
  const faces: Solid = [];
  for (const link of chainLinks(chain, pins, startPin)) {
    const inner = link.pin ? w + t : w;
    faces.push(...prism([link.plate], inner, inner + t), ...prism([link.plate], -inner - t, -inner));
  }
  const reach = w + 3 * t;
  for (const p of pins) {
    faces.push(...prism([circleOutline(p, chain.roller / 2, 16)], -w, w));
    faces.push(...prism([circleOutline(p, chain.roller / 4, 12)], -reach, reach));
  }
  return onLayer(faces);
}

/**
 * An offset link standing on edge from its view from above: two cranked plates its full height (with
 * square ends, since that view can't say more), the roller and the pin turned across them, and the
 * cotter through the pin.
 */
export function offsetLinkSolid(chain: ChainSize, top: readonly (readonly Pt[])[]): Solid {
  const [plate0, plate1, roller, pin, cotter] = top;
  const h = chain.plate;
  const across = (o: readonly Pt[]): Solid => {
    const xs = o.map((p) => p.x);
    const ys = o.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const r = (Math.max(...xs) - Math.min(...xs)) / 2;
    const turned = lathe([
      { x: 0, y: -Math.max(...ys) },
      { x: r, y: -Math.max(...ys) },
      { x: r, y: -Math.min(...ys) },
      { x: 0, y: -Math.min(...ys) },
    ]);
    return mapSolid(onEdge(turned), ([x, y, z]) => [x + cx, y, z + h / 2]);
  };
  const faces = [...prism([plate0], 0, h), ...prism([plate1], 0, h), ...across(roller), ...across(pin)];
  if (cotter) faces.push(...prism([cotter], (h - 0.2 * h) / 2, (h + 0.2 * h) / 2));
  return onLayer(faces);
}

/** A member of a bevel pair from its profile, turned about the axis running from the apex toward `body` in the drawing's plane; y becomes up. */
export function bevelSolid(members: readonly { profile: readonly Pt[]; body: Pt }[]): Solid {
  return onLayer(
    members.flatMap(({ profile, body }) => {
      const ax = { x: -body.x, y: -body.y };
      const ay = { x: -ax.y, y: ax.x };
      return mapSolid(lathe(profile), ([x, y, z]) => [x * ay.x + z * ax.x, x * ay.y + z * ax.y, y]);
    }),
  );
}
