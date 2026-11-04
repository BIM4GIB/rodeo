// Checks the build tool's geometry under Node. Run from web/:
//   npx tsx src/features/agents/build.check.ts
// Every part of every build must be well formed: numbers finite; prisms simple, counter-clockwise
// and rising; mesh faces flat, convex, of three to ten corners, and each mesh closed (every edge
// shared by exactly two faces, once each way) with a positive volume. Then: walls leave their
// openings clear, stay within their thickness, cover the rest and meet at mitred corners;
// rectangular gable and hip roofs put the ridge at the right height and length; thatch is
// thicker than tile; a window's parts stay inside its opening; bad specs are refused with errors
// naming the element and the field; a product's part comes out one closed solid of the volume
// its shapes make. Last, a cottage using every kind is built and its parts
// counted by category.

import type { Pt } from "../../core/types.ts";
import { BUILD_REFERENCE, buildParts, type BuildPart } from "./build.ts";
import { closureOf } from "./check3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V = [number, number, number];
const P = (x: number, y: number): Pt => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const sub3 = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const corners = (face: readonly number[]): V[] => Array.from({ length: face.length / 3 }, (_, i) => [face[3 * i], face[3 * i + 1], face[3 * i + 2]]);
const area2 = (o: readonly Pt[]): number => o.reduce((s, p, i) => s + p.x * o[(i + 1) % o.length].y - o[(i + 1) % o.length].x * p.y, 0) / 2;

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const on = (p: Pt, q: Pt, r: Pt): boolean => Math.abs(o(p, q, r)) < 1e-6 && Math.min(p.x, q.x) - 1e-6 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-6 && Math.min(p.y, q.y) - 1e-6 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-6;
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return (d1 * d2 < 0 && d3 * d4 < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function simple(o: readonly Pt[]): boolean {
  const n = o.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (properCross(o[i], o[(i + 1) % n], o[j], o[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** The ways a part is malformed, as short tags. */
function problems(p: BuildPart): string[] {
  const out: string[] = [];
  if (!/^#[0-9a-f]{6}$/.test(p.color) || !p.name || !p.category) out.push("labels");
  if (p.opacity !== undefined && !(p.opacity >= 0 && p.opacity <= 100)) out.push("opacity");
  const s = p.shape;
  if (s.kind === "prism") {
    const o = s.outline;
    if (![s.z0, s.z1, ...o.flatMap((q) => [q.x, q.y])].every(Number.isFinite)) return ["finite"];
    if (o.length < 3) out.push("prism corners");
    if (o.length && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) < 1e-6) out.push("prism repeats");
    if (!(s.z1 > s.z0)) out.push("prism rising");
    if (!(area2(o) > 0)) out.push("prism ccw");
    if (!simple(o)) out.push("prism simple");
    return out;
  }
  if (!s.faces.every((f) => f.length % 3 === 0 && f.every(Number.isFinite))) return ["finite"];
  const edges = new Map<string, number>();
  let vol = 0;
  for (const f of s.faces) {
    const c = corners(f);
    if (c.length < 3 || c.length > 10) out.push("face corners");
    let n: V = [0, 0, 0];
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
    }
    const k = norm3(n);
    if (k < 1e-6) {
      out.push("face area");
      continue;
    }
    n = [n[0] / k, n[1] / k, n[2] / k];
    const mid: V = c.reduce((m, q) => [m[0] + q[0] / c.length, m[1] + q[1] / c.length, m[2] + q[2] / c.length], [0, 0, 0] as V);
    if (c.some((q) => Math.abs(dot3(sub3(q, mid), n)) > 0.05)) out.push("face planar");
    for (let i = 0; i < c.length; i++) {
      const e0 = sub3(c[(i + 1) % c.length], c[i]);
      const e1 = sub3(c[(i + 2) % c.length], c[(i + 1) % c.length]);
      if (dot3(cross3(e0, e1), n) < -(0.002 * norm3(e0) * norm3(e1) + 0.01)) {
        out.push("face convex");
        break;
      }
    }
    const key = (q: V): string => q.map((x) => x.toFixed(3)).join(",");
    for (let i = 0; i < c.length; i++) {
      const e = `${key(c[i])}>${key(c[(i + 1) % c.length])}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    for (let i = 1; i + 1 < c.length; i++) vol += dot3(c[0], cross3(c[i], c[i + 1])) / 6;
  }
  for (const [e, count] of edges) {
    const [a, b] = e.split(">");
    if (count !== 1 || edges.get(`${b}>${a}`) !== 1) {
      out.push("watertight");
      break;
    }
  }
  if (!(vol > 0)) out.push("volume");
  return [...new Set(out)];
}

const faceCount = (p: BuildPart): number => (p.shape.kind === "prism" ? p.shape.outline.length + 2 : p.shape.faces.length);

/** One line per kind of fault (or one line for all when `brief`). */
function wellFormed(name: string, parts: readonly BuildPart[], brief = true): void {
  const found = parts.map((p) => ({ p, e: problems(p) }));
  const show = (tags: string[]): string => {
    const bad = found.filter(({ e }) => e.some((t) => tags.includes(t)));
    return bad.length ? ` (${bad.length} bad, e.g. ${bad.slice(0, 3).map(({ p, e }) => `${p.name}: ${e.join(", ")}`).join("; ")})` : "";
  };
  if (brief) {
    const bad = show(["finite", "labels", "opacity", "prism corners", "prism repeats", "prism rising", "prism ccw", "prism simple", "face corners", "face area", "face planar", "face convex", "watertight", "volume"]);
    check(!bad, `${name}: all ${parts.length} parts well formed${bad}`);
    return;
  }
  const prisms = parts.filter((p) => p.shape.kind === "prism").length;
  const meshes = parts.length - prisms;
  const line = (tags: string[], what: string): void => {
    const bad = show(tags);
    check(!bad, `${name}: ${what}${bad}`);
  };
  line(["finite"], `every number of ${parts.length} parts finite`);
  line(["labels", "opacity"], "every part named, in a category, coloured #rrggbb");
  line(["prism corners", "prism repeats", "prism ccw", "prism simple"], `${prisms} prisms simple and counter-clockwise, at least 3 corners, no repeated last point`);
  line(["prism rising"], "every prism's z1 above its z0");
  line(["face corners", "face area"], `${meshes} meshes' faces of 3 to 10 corners`);
  line(["face planar"], "mesh faces planar");
  line(["face convex"], "mesh faces convex");
  line(["watertight"], "meshes watertight, every edge shared once each way");
  line(["volume"], "meshes outward, with positive volume");
}

function refuses(specs: unknown, want: RegExp, what: string): void {
  try {
    buildParts(specs as unknown[]);
    check(false, `${what}: refused (it wasn't)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(want.test(msg), `${what}: "${msg}"`);
  }
}

const zs = (p: BuildPart): number[] => (p.shape.kind === "prism" ? [p.shape.z0, p.shape.z1] : p.shape.faces.flatMap((f) => corners(f).map((c) => c[2])));
const plan = (p: BuildPart): Pt[] => (p.shape.kind === "prism" ? p.shape.outline : p.shape.faces.flatMap((f) => corners(f).map((c) => P(c[0], c[1]))));
const verts = (p: BuildPart): V[] => (p.shape.kind === "prism" ? p.shape.outline.flatMap((q): V[] => [[q.x, q.y, (p.shape as { z0: number }).z0], [q.x, q.y, (p.shape as { z1: number }).z1]]) : p.shape.faces.flatMap(corners));

/** The part of a convex loop on the left of the line from a to b. */
function clipLeft(o: readonly Pt[], a: Pt, b: Pt): Pt[] {
  const f = (p: Pt): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const out: Pt[] = [];
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp * fq < 0) out.push(P(p.x + ((q.x - p.x) * fp) / (fp - fq), p.y + ((q.y - p.y) * fp) / (fp - fq)));
  }
  return out;
}
const overlapArea = (o: readonly Pt[], box: readonly Pt[]): number => {
  let r = [...o];
  for (let i = 0; i < box.length && r.length >= 3; i++) r = clipLeft(r, box[i], box[(i + 1) % box.length]);
  return r.length >= 3 ? area2(r) : 0;
};

// ---- walls with openings --------------------------------------------------------------------

{
  const t = 300;
  const H = 2700;
  const turn = (deg: number) => (p: Pt): Pt => {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return P(1000 + p.x * c - p.y * s, -500 + p.x * s + p.y * c);
  };
  const path = rect(0, 0, 8000, 5000).map(turn(20));
  const openings = [
    { segment: 0, at: 2000, width: 1200, height: 1200, sill: 900 },
    { segment: 0, at: 5000, type: "door", width: 900, height: 2100, step: true },
    { point: turn(20)(P(5000, 5100)), type: "opening", width: 1500, height: 2000, sill: 300 },
    { segment: 1, at: 2500, width: 600, height: 600, sill: 1500, style: "sash", lintel: true },
  ];
  const { parts, notes } = buildParts([{ kind: "walls", path, closed: true, thickness: t, height: H, openings }]);
  wellFormed("walls", parts);
  check(notes.length === 0, `walls: no notes (${notes.join("; ")})`);
  const walls = parts.filter((p) => p.category === "Walls");
  // each opening as the check sees it: segment, middle along it, width, sill, height
  const seg = (i: number) => {
    const a = path[i];
    const b = path[(i + 1) % 4];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const u = P((b.x - a.x) / L, (b.y - a.y) / L);
    return { a, u, n: P(-u.y, u.x), L };
  };
  const holes = [
    { seg: 0, mid: 2000, w: 1200, sill: 900, h: 1200 },
    { seg: 0, mid: 5000, w: 900, sill: 0, h: 2100 },
    { seg: 2, mid: 3000, w: 1500, sill: 300, h: 2000 },
    { seg: 1, mid: 2500, w: 600, sill: 1500, h: 600 },
  ];
  const holeBox = (h: (typeof holes)[number]): Pt[] => {
    const { a, u, n } = seg(h.seg);
    const at = (s: number, d: number): Pt => P(a.x + u.x * s + n.x * d, a.y + u.y * s + n.y * d);
    return [at(h.mid - h.w / 2, -t / 2), at(h.mid + h.w / 2, -t / 2), at(h.mid + h.w / 2, t / 2), at(h.mid - h.w / 2, t / 2)];
  };
  const intruders = walls.filter((p) => {
    const [z0, z1] = zs(p);
    return holes.some((h) => Math.min(z1, h.sill + h.h) - Math.max(z0, h.sill) > 1 && overlapArea(plan(p), holeBox(h)) > 1);
  });
  check(!intruders.length, `walls: ${walls.length} wall pieces leave the 4 openings clear${intruders.length ? ` (${intruders.map((p) => p.name).join(", ")})` : ""}`);
  // in the rectangle's own axes, the wall is the ring between it grown and shrunk by half its thickness
  const local = (q: Pt): Pt => {
    const d = P(q.x - path[0].x, q.y - path[0].y);
    const { u, n } = seg(0);
    return P(d.x * u.x + d.y * u.y, d.x * n.x + d.y * n.y);
  };
  const inRing = (q: Pt): boolean => {
    const { x, y } = local(q);
    const e = 0.01;
    const inOuter = x >= -t / 2 - e && x <= 8000 + t / 2 + e && y >= -t / 2 - e && y <= 5000 + t / 2 + e;
    const inInner = x > t / 2 + e && x < 8000 - t / 2 - e && y > t / 2 + e && y < 5000 - t / 2 - e;
    return inOuter && !inInner;
  };
  const outside = walls.filter((p) => plan(p).some((q) => !inRing(q)) || zs(p).some((z) => z < -0.01 || z > H + 0.01));
  check(!outside.length, `walls: every wall piece within the wall's thickness and height${outside.length ? ` (${outside.map((p) => p.name).join(", ")})` : ""}`);
  const perimeter = 2 * (8000 + 5000);
  const coverAt = (z: number): number => walls.filter((p) => zs(p)[0] <= z && zs(p)[1] >= z).reduce((s, p) => s + area2(plan(p)), 0);
  const want100 = (perimeter - 900) * t;
  const want1600 = (perimeter - 1200 - 900 - 1500 - 600) * t;
  // within what rounding corners to a micrometre allows
  check(Math.abs(coverAt(100) - want100) < 30, `walls: at z=100 the pieces cover the ring less the door (${coverAt(100).toFixed(0)} of ${want100} mm²)`);
  check(Math.abs(coverAt(1600) - want1600) < 30, `walls: at z=1600 the pieces cover the ring less all 4 openings (${coverAt(1600).toFixed(0)} of ${want1600} mm²)`);
  // the mitre points, found independently, are corners of the pieces on both sides
  let met = 0;
  for (let k = 0; k < 4; k++) {
    const p = seg((k + 3) % 4);
    const q = seg(k);
    for (const side of [1, -1]) {
      const pa = P(p.a.x + (p.n.x * side * t) / 2, p.a.y + (p.n.y * side * t) / 2);
      const qa = P(q.a.x + (q.n.x * side * t) / 2, q.a.y + (q.n.y * side * t) / 2);
      const den = p.u.x * q.u.y - p.u.y * q.u.x;
      const s = ((qa.x - pa.x) * q.u.y - (qa.y - pa.y) * q.u.x) / den;
      const m = P(pa.x + p.u.x * s, pa.y + p.u.y * s);
      const sharing = walls.filter((w) => w.shape.kind === "prism" && w.shape.z0 === 0 && plan(w).some((c) => Math.hypot(c.x - m.x, c.y - m.y) < 0.01));
      if (sharing.length === 2 && new Set(sharing.map((w) => w.group ?? w.name)).size === 2) met++;
    }
  }
  check(met === 8, `walls: all 4 corners mitred, both faces' mitre points shared by the pieces either side (${met} of 8)`);
  // a window's and a door's parts stay inside their openings
  for (const [label, h, skip] of [["Window 1", holes[0], /( sill| lintel)$/], ["Door 1", holes[1], /( step)$/], ["Window 2", holes[3], /( sill| lintel)$/]] as const) {
    const { a, u, n } = seg(h.seg);
    const own = parts.filter((p) => p.group === label && !skip.test(p.name));
    // outside is on the right of a counter-clockwise path
    const strays = own.filter((p) =>
      verts(p).some(([x, y, z]) => {
        const s = (x - a.x) * u.x + (y - a.y) * u.y - h.mid;
        const across = (x - a.x) * n.x + (y - a.y) * n.y;
        return Math.abs(s) > h.w / 2 + 0.01 || z < h.sill - 0.01 || z > h.sill + h.h + 0.01 || across > t / 2 + 0.01 || across < -t / 2 - 0.01;
      }),
    );
    check(own.length > 8 && !strays.length, `walls: ${label}'s ${own.length} frame, sash, glass and fitting parts inside its opening${strays.length ? ` (${strays.map((p) => p.name).join(", ")})` : ""}`);
  }
  const sill = parts.find((p) => p.name === "Window 1 sill");
  check(!!sill && Math.max(...plan(sill).map((q) => -((q.x - seg(0).a.x) * seg(0).n.x + (q.y - seg(0).a.y) * seg(0).n.y))) > t / 2 + 20, "walls: Window 1's sill projects past the wall's outer face");
  check(parts.some((p) => p.name === "Window 2 lintel") && parts.some((p) => p.name === "Door 1 step"), "walls: the sash window has its lintel and the door its step");
  check(parts.filter((p) => p.category === "Glazing").every((p) => p.opacity === 35), "walls: glass is 35% opaque");
}

// ---- roofs --------------------------------------------------------------------------------------

{
  const turn = (p: Pt): Pt => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    return P(2000 + p.x * c - p.y * s, 1000 + p.x * s + p.y * c);
  };
  const outline = rect(0, 0, 8000, 5000).map(turn);
  const tan = Math.tan((40 * Math.PI) / 180);
  const cos = Math.cos((40 * Math.PI) / 180);
  const under = 2500 + tan * 2500;
  const roof = (extra: object): BuildPart[] => buildParts([{ kind: "roof", outline, eaves: 2500, pitch: 40, wallLine: "outer", ...extra }]).parts;
  const ridgeOf = (parts: readonly BuildPart[]): { top: number; length: number; lowest: number; underRidge: boolean } => {
    const v = parts.filter((p) => / slope /.test(p.name)).flatMap(verts);
    const top = Math.max(...v.map((q) => q[2]));
    const at = v.filter((q) => Math.abs(q[2] - top) < 0.01);
    let length = 0;
    for (const a of at) for (const b of at) length = Math.max(length, Math.hypot(a[0] - b[0], a[1] - b[1]));
    return { top, length, lowest: Math.min(...v.map((q) => q[2])), underRidge: v.some((q) => Math.abs(q[2] - under) < 0.01) };
  };
  const gable = roof({ material: "slate" });
  wellFormed("gable roof", gable, false);
  const g = ridgeOf(gable);
  check(Math.abs(g.top - (under + 200 / cos)) < 0.01 && g.underRidge, `gable roof: ridge underside at 2500 + tan 40° × 2500 = ${under.toFixed(2)}, its top ${(under + 200 / cos).toFixed(2)} (found ${g.top.toFixed(2)})`);
  check(Math.abs(g.length - 8400) < 0.01, `gable roof: ridge 8000 + 2 × 200 verge long (found ${g.length.toFixed(2)})`);
  check(Math.abs(g.lowest - (2500 - tan * 300)) < 0.01, `gable roof: eaves underside 300 out at 2500 - tan 40° × 300 (found ${g.lowest.toFixed(2)})`);
  const gw = gable.filter((p) => / gable wall$/.test(p.name));
  check(gw.length === 2 && gw.every((p) => Math.abs(Math.max(...zs(p)) - under) < 0.01 && Math.abs(Math.min(...zs(p)) - 2500) < 0.01), "gable roof: two gable walls fill from the eaves up to the ridge's underside");
  check(gable.some((p) => / ridge$/.test(p.name)), "gable roof: slate gets ridge tiles");

  const hip = roof({ style: "hip" });
  wellFormed("hip roof", hip);
  const h = ridgeOf(hip);
  check(Math.abs(h.top - g.top) < 0.01 && h.underRidge, `hip roof: ridge at the same height as the gable's (found ${h.top.toFixed(2)})`);
  check(Math.abs(h.length - 3000) < 0.01, `hip roof: ridge 8000 - 5000 long (found ${h.length.toFixed(2)})`);
  check(hip.filter((p) => / slope /.test(p.name)).length === 4 && !hip.some((p) => / gable wall$/.test(p.name)), "hip roof: four slopes, no gable walls");

  const thatch = roof({ material: "thatch" });
  wellFormed("thatched roof", thatch);
  const tt = (ridgeOf(thatch).top - under) * cos;
  const tile = (ridgeOf(roof({ material: "tile" })).top - under) * cos;
  check(tt > tile + 150, `thatched roof: ${tt.toFixed(0)} thick, against tile's ${tile.toFixed(0)}`);
  check(thatch.some((p) => / ridge$/.test(p.name)), "thatched roof: has a ridge block");

  const sampler: [string, object, RegExp | null][] = [
    ["half-hip roof", { style: "half-hip" }, null],
    ["mansard roof", { style: "mansard" }, null],
    ["mono roof", { style: "mono", rises: 120, material: "metal" }, null],
    ["flat roof with a parapet", { style: "flat", parapet: 600 }, null],
    ["gable roof with dormers", { dormers: [{ at: turn(P(2000, 0)) }, { at: turn(P(5500, 300)), style: "flat", height: 700 }, { at: turn(P(4000, 5000)), style: "eyebrow", windowStyle: "sash" }] }, null],
    ["thatched hip with an eyebrow dormer", { style: "hip", material: "thatch", dormers: [{ at: turn(P(4000, 0)), style: "eyebrow" }] }, null],
  ];
  for (const [name, extra] of sampler) wellFormed(name, roof(extra));
  const dormered = roof(sampler[4][1]);
  check(dormered.filter((p) => /^Dormer \d cheek$/.test(p.name)).length === 6 && dormered.filter((p) => p.category === "Glazing").length >= 3, "gable roof with dormers: each of 3 dormers has two cheeks and glazing");
  const odd = (name: string, poly: Pt[], extra: object, note: RegExp): void => {
    const { parts, notes } = buildParts([{ kind: "roof", outline: poly, eaves: 2500, ...extra }]);
    wellFormed(name, parts);
    check(notes.some((n) => note.test(n)), `${name}: noted (${notes.join("; ")})`);
  };
  odd("L-shaped roof", [P(0, 0), P(9000, 0), P(9000, 4000), P(4000, 4000), P(4000, 8000), P(0, 8000)], {}, /2 rectangles, roofed as intersecting roofs/);
  odd("T-shaped hipped roof", [P(0, 0), P(10000, 0), P(10000, 4000), P(7000, 4000), P(7000, 8000), P(3000, 8000), P(3000, 4000), P(0, 4000)], { style: "hip" }, /2 rectangles/);
  odd("U-shaped roof", [P(0, 0), P(10000, 0), P(10000, 8000), P(7000, 8000), P(7000, 3500), P(3000, 3500), P(3000, 8000), P(0, 8000)], { material: "thatch" }, /3 rectangles/);
  odd("hexagonal roof", [0, 1, 2, 3, 4, 5].map((i) => P(4000 * Math.cos((i * Math.PI) / 3), 4000 * Math.sin((i * Math.PI) / 3))), {}, /isn't a rectangle, so it was given a hipped roof/);
  odd("irregular roof", [P(0, 0), P(8000, 1000), P(7000, 6000), P(4000, 3000), P(1000, 6000)], {}, /flat roof/);
}

// ---- refusals and notes ------------------------------------------------------------------------

refuses([{ kind: "balcony" }], /^element 1 \(balcony\): unknown kind "balcony"/, "an unknown kind");
refuses([{ kind: "box", at: P(0, 0), size: [1, 1, 1] }, { kind: "slab", top: 0 }], /^element 2 \(slab\): outline is needed/, "a slab without an outline");
refuses([{ kind: "roof", outline: rect(0, 0, 8000, 5000), pitch: 85 }], /^element 1 \(roof\): pitch must be between 5 and 75°$/, "a roof pitched at 85°");
refuses([{ kind: "walls", path: [P(0, 0), P(4000, 0)], openings: [{ at: 2000, width: 5000 }] }], /^element 1 \(walls\), opening 1: the window is 5000 wide, wider than the 4000 of straight wall on segment 0/, "an opening wider than its wall");
refuses([{ kind: "walls", path: [P(0, 0), P(6000, 0)], openings: [{ at: 2000, width: 1200 }, { at: 2800, type: "door" }] }], /openings 1 and 2 overlap on segment 0/, "overlapping openings");
refuses([{ kind: "walls", path: [P(0, 0), P(6000, 0)], height: 2000, openings: [{ at: 2000, sill: 1200, height: 1200 }] }], /opening 1: sill \+ height \(2400\) is above the wall's height of 2000/, "a window above the wall's top");
refuses([{ kind: "walls", path: [P(0, 0), P(6000, 0), P(6000, 4000)], openings: [{ at: 2000 }] }], /opening 1: give segment/, "an opening placed by at alone on a path of two segments");
refuses([{ kind: "hedge", path: [P(0, 0), "x"] }], /^element 1 \(hedge\): path\[1\] must be a point/, "a path with a bad point");
refuses([{ kind: "tree", at: P(0, 0), color: "green" }], /^element 1 \(tree\): color must be a colour "#rrggbb"/, "a colour by name");
refuses([{ kind: "fence", path: [P(0, 0), P(5000, 0)], style: "chain-link" }], /style must be one of panel, picket, post-and-rail, close-board/, "an unknown fence style");
refuses([{ kind: "roof", outline: rect(0, 0, 8000, 5000), dormers: [{ at: P(4000, 0), height: 3000 }] }], /dormer 1: is too tall for the roof/, "a dormer too tall for its roof");
refuses([{ kind: "chimney", at: P(0, 0) }], /^element 1 \(chimney\): top is needed/, "a chimney without a top");
refuses({ kind: "box" }, /must be a list/, "elements not in a list");
{
  const { notes } = buildParts([{ kind: "slab", outline: rect(0, 0, 1000, 1000), thicknes: 300 }]);
  check(notes.some((n) => /^element 1 \(slab\): ignored thicknes/.test(n)), `an unknown field is noted (${notes.join("; ")})`);
  const { parts } = buildParts([
    { kind: "window", name: "Bay", at: P(0, 0), facing: 270 },
    { kind: "window", name: "Bay", at: P(3000, 0), facing: 270 },
  ]);
  check(new Set(parts.map((p) => p.group)).size === 2, "two windows of one name stay two groups");
  const ab = buildParts([{ kind: "door", a: P(0, 0), b: P(1000, 0), style: "french" }]).parts;
  check(ab.every((p) => plan(p).every((q) => q.x >= -0.01 && q.x <= 1000.01) || / step$/.test(p.name)) && ab.every((p) => plan(p).every((q) => q.y >= -300.01)), "a door placed by a and b fills the gap between them, inside the wall on the left of a→b");
}

// ---- a product's part ------------------------------------------------------------------------------

{
  // a bracket: a rounded plate with two screw holes, an upright along x with a bore along y, and
  // a counterbore pocket, the shapes overlapping and the cuts nested in what they open
  const { parts, notes } = buildParts([
    {
      kind: "part",
      name: "Bracket",
      color: "#3a7bd5",
      add: [
        { rect: [0, 0, 60, 40], round: 6, from: 0, to: 5 },
        { box: [0, 15, 0, 60, 25, 30] },
      ],
      cut: [
        { circle: [8, 8, 1.6], from: -1, to: 6 },
        { circle: [52, 8, 1.6], from: -1, to: 6 },
        { circle: [8, 8, 3], sides: 24, from: 3, to: 6 },
        { plane: "xz", circle: [30, 20, 4], from: 14, to: 26 },
      ],
    },
  ]);
  check(parts.length === 1 && parts[0].shape.kind === "mesh" && parts[0].category === "Parts" && parts[0].name === "Bracket" && !notes.length, `part: one mesh named Bracket in Parts (${parts.length} parts; ${notes.join("; ")})`);
  wellFormed("part", parts, false);
  if (parts[0]?.shape.kind === "mesh") {
    const tris = parts[0].shape.faces.flatMap((f) => {
      const v = corners(f);
      return v.slice(1, -1).flatMap((b, i) => [...v[0], ...b, ...v[i + 2]]);
    });
    const shut = closureOf(tris);
    check(shut.open === 0, `part: closed by check_3d's measure (${shut.open} open edges)`);
    let vol = 0;
    for (let i = 0; i < tris.length; i += 9) vol += dot3([tris[i], tris[i + 1], tris[i + 2]], cross3([tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]])) / 6;
    // the plate less its rounded corners, the upright over it, less the holes, the pocket and the bore
    const n = (r: number, k: number): number => (k / 2) * r * r * Math.sin((2 * Math.PI) / k);
    const corner = 8 * 0.5 * 6 * 6 * Math.sin(Math.PI / 16);
    const plate = 60 * 40 * 5 - 4 * (36 - corner) * 5;
    const upright = 60 * 10 * 25;
    const want = plate + upright - n(1.6, 32) * 5 * 2 - (n(3, 24) - n(1.6, 32)) * 2 - n(4, 32) * 10;
    check(Math.abs(vol - want) < 1, `part: volume ${vol.toFixed(1)} mm³ as worked out (${want.toFixed(1)})`);
    const ys = tris.filter((_, i) => i % 3 === 1);
    check(Math.min(...ys) > -1e-6 && Math.max(...ys) < 40 + 1e-6, "part: the plate's footprint bounds it in y");
  }
  refuses([{ kind: "part" }], /add is needed/, "a part without add");
  refuses([{ kind: "part", add: [{ circle: [0, 0, 5] }] }], /add 1: from and to are needed/, "a profile without from and to");
  refuses([{ kind: "part", add: [{ plane: "ab", circle: [0, 0, 5], from: 0, to: 1 }] }], /plane is one of/, "a part with a bad plane");
  refuses([{ kind: "part", add: [{ cylinder: [0, 0, 5], from: 0, to: 1 }] }], /unknown field cylinder/, "a part shape with an unknown field");
  refuses([{ kind: "part", add: [{ box: [0, 0, 0, 10, 10, 10] }], cut: [{ box: [-1, -1, -1, 11, 11, 11] }] }], /nothing is left/, "a part cut away entirely");
}

// ---- a cottage using every kind -------------------------------------------------------------------

const cottage: unknown[] = [
  { kind: "ground", outline: rect(-13000, -12500, 21000, 12500) },
  { kind: "lawn", name: "Front lawn", outline: rect(-2500, -10500, 10000, -1900) },
  { kind: "planting", outline: rect(300, -1700, 3800, -500) },
  { kind: "shrub", at: P(900, -1100), size: 900 },
  { kind: "bush", at: P(2100, -1150), size: [1100, 800] },
  { kind: "path", path: [P(4500, -1085), P(4500, -10500)], width: 1100, edging: true },
  { kind: "driveway", path: [P(13000, -12500), P(13000, -6000), P(13200, -400)], width: 3200, edging: { height: 30 } },
  { kind: "gravel", outline: rect(10600, 5800, 15500, 9000) },
  { kind: "paving", outline: rect(-2500, 5900, 300, 9000) },
  { kind: "patio", outline: rect(500, 5900, 6000, 9000) },
  { kind: "decking", outline: rect(6200, 5900, 9500, 9000) },
  { kind: "water", name: "Pond", outline: [P(-6000, -7500), P(-3500, -8200), P(-2000, -6500), P(-2800, -4800), P(-5200, -4600), P(-6600, -5900)] },
  { kind: "floor", name: "Ground floor", outline: rect(0, 0, 9000, 5500), top: 400, thickness: 400 },
  {
    kind: "walls",
    name: "Cottage",
    path: rect(0, 0, 9000, 5500),
    closed: true,
    thickness: 350,
    height: 3000,
    color: "#efe6d2",
    openings: [
      { segment: 0, at: 1600, width: 1200, height: 1200, sill: 1300, panes: [2, 2], lintel: "timber" },
      { segment: 0, at: 4500, type: "door", width: 950, height: 2100, sill: 400, letterbox: true, knocker: true, step: 150, name: "Front door" },
      { segment: 0, at: 7400, width: 1000, height: 1500, sill: 1100, style: "sash", lintel: "stone" },
      { segment: 1, at: 1500, width: 700, height: 700, sill: 1900, style: "fixed" },
      { segment: 1, at: 4000, width: 900, height: 1200, sill: 1300, style: "tilt" },
      { segment: 2, at: 6000, type: "door", style: "stable", sill: 400, step: true },
      { segment: 2, at: 2500, width: 2000, height: 1200, sill: 1300, panes: [1, 2] },
      { segment: 3, at: 1200, type: "opening", width: 900, height: 2000, sill: 400 },
    ],
  },
  { kind: "door", name: "Side door", a: P(-175, 4750), b: P(-175, 3850), style: "glazed", sill: 400, height: 2000, wallThickness: 350 },
  {
    kind: "roof",
    name: "Thatch",
    outline: rect(0, 0, 9000, 5500),
    eaves: 3000,
    material: "thatch",
    wallThickness: 350,
    wallColor: "#efe6d2",
    dormers: [
      { at: P(2000, 0), style: "eyebrow", width: 800, height: 800 },
      { at: P(7000, 0), style: "eyebrow", width: 800, height: 800 },
    ],
  },
  { kind: "chimney", at: P(250, 2750), size: [700, 1100], top: 7800, pots: 2 },
  { kind: "steps", at: P(4500, -1085), angle: 90, width: 1300, count: 2, rise: 125 },
  { kind: "walls", name: "Garage", path: rect(11000, 0, 15500, 4500), closed: true, height: 2600, openings: [{ segment: 0, at: 2200, type: "door", style: "double", width: 2600 }, { segment: 1, at: 2250, width: 1200, height: 1000, sill: 1100, panes: [3, 2] }] },
  { kind: "roof", outline: rect(11000, 0, 15500, 4500), eaves: 2600, style: "hip", pitch: 35 },
  { kind: "chimney", at: P(14500, 3000), top: 5200, size: [500, 500] },
  { kind: "walls", name: "Barn", path: [P(-11000, 0), P(-4000, 0), P(-4000, 3500), P(-7500, 3500), P(-7500, 7500), P(-11000, 7500)], closed: true, height: 2400, color: "#9a5a42", openings: [{ segment: 0, at: 3500, type: "door", style: "ledged", width: 1100, height: 2000 }, { segment: 0, at: 1500, type: "opening", width: 1000, height: 900, sill: 1000 }] },
  { kind: "window", a: P(-10000, -150), b: P(-9000, -150), facing: 270, sill: 1000, height: 900, panes: [2, 3] },
  { kind: "roof", outline: [P(-11000, 0), P(-4000, 0), P(-4000, 3500), P(-7500, 3500), P(-7500, 7500), P(-11000, 7500)], eaves: 2400, pitch: 42, material: "slate" },
  { kind: "walls", name: "Shed", path: rect(11300, 6300, 14300, 8300), closed: true, height: 2100, thickness: 120, openings: [{ segment: 0, at: 1500, type: "door", style: "plank", width: 800, height: 1800 }] },
  { kind: "roof", style: "mono", outline: rect(11300, 6300, 14300, 8300), eaves: 2100, pitch: 12, material: "metal", wallThickness: 120 },
  { kind: "hedge", path: [P(3800, -12000), P(-12000, -12000), P(-12000, 11500)], width: 700, height: 1600 },
  { kind: "fence", style: "picket", path: [P(5200, -12000), P(11200, -12000)] },
  { kind: "fence", style: "post-and-rail", path: [P(20500, -12000), P(20500, 12000)] },
  { kind: "fence", style: "panel", path: [P(20500, 12200), P(-12000, 12200)] },
  { kind: "fence", style: "close-board", path: [P(16500, -1000), P(16500, 5000), P(10000, 5000)] },
  { kind: "tree", at: P(-9000, -8500), height: 7500, spread: 5500 },
  { kind: "tree", type: "conifer", at: P(18500, 8000), height: 9000, spread: 3800 },
  { kind: "tree", type: "fruit", at: P(2000, 10500) },
  { kind: "cylinder", name: "Table top", at: P(2800, 7500), radius: 500, base: 700, top: 740 },
  { kind: "box", name: "Bench", at: P(2800, 8500), size: [1400, 400, 450] },
  { kind: "prism", name: "Plinth", outline: rect(-1500, -4000, -1100, -3600), top: 800 },
  { kind: "sphere", name: "Gazing ball", at: P(-1300, -3800), z: 1000, radius: 200 },
  { kind: "cone", name: "Topiary", at: P(7600, -1000), radius: 280, base: 450, top: 1900, sides: 10 },
  { kind: "cone", name: "Planter", at: P(8800, -1000), radius: 250, topRadius: 350, top: 450 },
];
{
  const { parts, notes } = buildParts(cottage);
  wellFormed("cottage", parts, false);
  const kinds = new Set(cottage.map((e) => (e as { kind: string }).kind));
  const every = ["walls", "window", "door", "floor", "roof", "chimney", "steps", "lawn", "paving", "patio", "path", "driveway", "gravel", "planting", "water", "decking", "ground", "hedge", "fence", "tree", "shrub", "bush", "box", "prism", "cylinder", "sphere", "cone"];
  check(every.every((k) => kinds.has(k)), "cottage: uses every kind");
  const faces = parts.reduce((s, p) => s + faceCount(p), 0);
  check(faces < 8000, `cottage: ${parts.length} parts, ${faces} faces (under 8000)`);
  const groups = new Set(parts.map((p) => p.group).filter(Boolean));
  console.log(`     ${groups.size} groups; notes: ${notes.join(" | ")}`);
  const byCategory = new Map<string, { parts: number; faces: number; meshes: number }>();
  for (const p of parts) {
    const c = byCategory.get(p.category) ?? { parts: 0, faces: 0, meshes: 0 };
    c.parts++;
    c.faces += faceCount(p);
    if (p.shape.kind === "mesh") c.meshes++;
    byCategory.set(p.category, c);
  }
  for (const [cat, c] of [...byCategory].sort((a, b) => b[1].faces - a[1].faces)) {
    console.log(`     ${cat.padEnd(10)} ${String(c.parts).padStart(4)} parts (${String(c.meshes).padStart(3)} meshes) ${String(c.faces).padStart(5)} faces`);
  }
}

check(BUILD_REFERENCE.length < 4500, `the reference is ${BUILD_REFERENCE.length} characters`);
check(
  ["walls", "window", "door", "slab", "roof", "chimney", "steps", "lawn", "driveway", "decking", "hedge", "fence", "tree", "shrub", "box", "prism", "cylinder", "sphere", "cone", "part"].every((k) => new RegExp(`\\b${k}\\b`).test(BUILD_REFERENCE)),
  "the reference names every kind",
);

if (failures) {
  console.error(`${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("all checks passed");
