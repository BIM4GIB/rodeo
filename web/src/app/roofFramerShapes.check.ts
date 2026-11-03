// Node check of Roof Framer's geometry, on roofs Create Roof builds. Run from web/: npx tsx src/app/roofFramerShapes.check.ts

import assert from "node:assert/strict";
import earcut from "earcut";
import type { Pt } from "../core/index.ts";
import { frameRoof, rafterPlaces, roofFaces, roofLines, type RoofFramerSpec, type RoofMember } from "./roofFramerShapes.ts";
import { buildRoof, roofOutline, type RoofSpec } from "./roofShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const rad = (d: number): number => (d * Math.PI) / 180;

/** A solid's faces as triangles, each wound as its face is. */
function triangles(solid: readonly number[][]): number[] {
  const out: number[] = [];
  for (const f of solid) {
    const pts = Array.from({ length: f.length / 3 }, (_, i) => [f[3 * i], f[3 * i + 1], f[3 * i + 2]]);
    const n = [0, 0, 0];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const drop = Math.abs(n[2]) >= Math.abs(n[0]) && Math.abs(n[2]) >= Math.abs(n[1]) ? 2 : Math.abs(n[1]) >= Math.abs(n[0]) ? 1 : 0;
    const keep = [0, 1, 2].filter((k) => k !== drop);
    const idx = earcut(pts.flatMap((p) => keep.map((k) => p[k])));
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [pts[idx[i]], pts[idx[i + 1]], pts[idx[i + 2]]];
      const t = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const same = t[0] * n[0] + t[1] * n[1] + t[2] * n[2] >= 0;
      out.push(...a, ...(same ? b : c), ...(same ? c : b));
    }
  }
  return out;
}

function volume(solid: readonly number[][]): number {
  let v = 0;
  for (const f of solid) {
    for (let i = 3; i + 5 < f.length; i += 3) {
      const [ax, ay, az] = [f[0], f[1], f[2]];
      const [bx, by, bz] = [f[i], f[i + 1], f[i + 2]];
      const [cx, cy, cz] = [f[i + 3], f[i + 4], f[i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
}

const rect = (w: number, d: number): Pt[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];

function roof(outline: Pt[], gablesWhere: (a: Pt, b: Pt) => boolean, over: Partial<RoofSpec> = {}): number[] {
  const o = roofOutline(outline);
  const gables = new Set(o.map((_, i) => i).filter((i) => gablesWhere(o[i], o[(i + 1) % o.length])));
  const built = buildRoof({ outline: o, gables, eave: "square", vertical: 0, thickness: 200, bearingInset: 0, pitch: rad(30), bearingHeight: 3000, overhang: 0, gableWall: 0, ...over });
  assert.ok(built, "roof built");
  return triangles(built.solid);
}

const base: RoofFramerSpec = {
  rafters: { width: 50, height: 200, minSpacing: 600, maxSpacing: 600, surface: "top", match: true },
  ridges: { width: 50, height: 250, elevation: "flushTop", notch: 0, aff: 0 },
  hips: { width: 50, height: 250, surface: "top" },
  purlins: null,
  plates: null,
};
const of = (ms: readonly RoofMember[], kind: RoofMember["kind"]): RoofMember[] => ms.filter((m) => m.kind === kind);
const framed = (tris: number[], spec: RoofFramerSpec): RoofMember[] => {
  const ms = frameRoof(tris, spec);
  assert.ok(typeof ms !== "string", String(ms));
  return ms;
};

// spacing
assert.deepEqual(rafterPlaces(0, 1050, 50, 300, 600), [25, 525, 1025]);
assert.deepEqual(rafterPlaces(0, 1050, 50, 600, 600), [25, 625, 1025]);
assert.deepEqual(rafterPlaces(0, 40, 50, 600, 600), [20]);

// a gable roof 10 m by 6 m, gables at its short ends
const gable = roof(rect(10000, 6000), (a, b) => Math.abs(a.x - b.x) < 1);
{
  const faces = roofFaces(gable);
  assert.equal(faces.length, 2, "two slopes");
  assert.ok(faces.every((f) => f.bottom), "each with its underside");
  const lines = roofLines(faces);
  assert.deepEqual(lines.map((l) => l.kind), ["ridge"]);
  near(Math.hypot(lines[0].b[0] - lines[0].a[0], lines[0].b[1] - lines[0].a[1]), 10000, 1);
  const top = Math.max(...gable.filter((_, i) => i % 3 === 2));
  near(lines[0].a[2], top, 1e-6);

  const ms = framed(gable, base);
  const rafters = of(ms, "rafter");
  // 600 apart from one end, 17 of them, and the last at the other end: 18 a side
  assert.equal(rafters.length, 36, `rafters ${rafters.length}`);
  // matched: each rafter has one opposite at the same x
  const xs = (y: (v: number) => boolean): number[] => rafters.filter((m) => y(m.line[0][1])).map((m) => Math.round(m.line[0][0])).sort((a, b) => a - b);
  assert.deepEqual(xs((y) => y < 3000), xs((y) => y > 3000), "rafters meet across the ridge");
  // their tops on the roof's top, short of the ridge by half its width
  for (const m of rafters) {
    const hi = m.line[0][2] > m.line[1][2] ? m.line[0] : m.line[1];
    near(Math.abs(hi[1] - 3000), 25, 1e-6);
    near(hi[2], top - 25 * Math.tan(rad(30)), 1e-6);
    near(volume(m.solid), 50 * 200 * m.length, 1e-3 * m.length);
  }
  const [ridge] = of(ms, "ridge");
  near(ridge.line[0][2], top, 1e-6);
  near(volume(ridge.solid), 50 * 250 * 10000, 10);
  assert.equal(of(ms, "hip").length, 0);

  // rafters on the underside: a plumb thickness lower
  const low = framed(gable, { ...base, rafters: { ...base.rafters!, surface: "bottom" }, ridges: null });
  const r0 = of(low, "rafter")[0];
  const r1 = rafters.find((m) => Math.abs(m.line[0][0] - r0.line[0][0]) < 1e-6 && Math.sign(m.line[1][1] - 3000) === Math.sign(r0.line[1][1] - 3000))!;
  near(r1.line[1][2] - r0.line[1][2], 200 / Math.cos(rad(30)), 1e-6);

  // flush to the rafters' bottom: the ridge's bottom at the rafters' plumb cut
  const fb = of(framed(gable, { ...base, ridges: { ...base.ridges!, elevation: "flushBottom" } }), "ridge")[0];
  near(fb.line[0][2] - 250, top - 200 / Math.cos(rad(30)), 1e-6);
  const aff = of(framed(gable, { ...base, ridges: { ...base.ridges!, elevation: "aff", aff: 4000 } }), "ridge")[0];
  near(aff.line[0][2], 4250, 1e-6);

  // purlins: three level ones each side, from 3.5 m up to 300 below the top
  const pu = of(framed(gable, { ...base, rafters: null, ridges: null, purlins: { width: 75, height: 150, first: 3500, last: 300, by: "count", count: 3, distance: 0, position: "top", fromLowerEnd: false, rotate: false, inset: 0 } }), "purlin");
  assert.equal(pu.length, 6, `purlins ${pu.length}`);
  const tops = [...new Set(pu.map((m) => Math.round(m.line[0][2])))].sort((a, b) => a - b);
  assert.deepEqual(tops, [3650, Math.round((3650 + top - 300) / 2), Math.round(top - 300)]);
  for (const m of pu) near(m.line[0][2], m.line[1][2], 1e-9);
  // by distance
  const pd = of(framed(gable, { ...base, rafters: null, ridges: null, purlins: { width: 75, height: 150, first: 3500, last: 300, by: "distance", count: 0, distance: 400, position: "top", fromLowerEnd: false, rotate: true, inset: 0 } }), "purlin");
  assert.equal(pd.length, 2 * (Math.floor((top - 300 - 150 - 3500) / 400) + 1));

  // plates along both eaves, 100 in, under the rafters
  const pl = of(framed(gable, { ...base, plates: { width: 140, height: 90, inset: 100, notched: false, notch: 0 } }), "plate");
  assert.equal(pl.length, 2);
  near(pl[0].length, 10000, 1e-6);
  // the plate's top at the rafters' underside over its outer face, 100 in from the eave
  const eaveTop = Math.min(...faces[0].tris.flatMap((t) => t.map((p) => p[2])));
  for (const p of pl) near(p.line[0][2], eaveTop + 100 * Math.tan(rad(30)) - 200 / Math.cos(rad(30)), 1e-6);
  assert.match(String(frameRoof(gable, { ...base, plates: { width: 140, height: 90, inset: 100, notched: true, notch: 100 } })), /third of the rafters' height/);
}

// a hip roof on the same outline
const hip = roof(rect(10000, 6000), () => false);
{
  const faces = roofFaces(hip);
  assert.equal(faces.length, 4);
  const kinds = roofLines(faces).map((l) => l.kind).sort();
  assert.deepEqual(kinds, ["hip", "hip", "hip", "hip", "ridge"]);
  const ms = framed(hip, base);
  const [ridge] = of(ms, "ridge");
  near(ridge.length, 4000, 1);
  const hips = of(ms, "hip");
  assert.equal(hips.length, 4);
  for (const h of hips) near(h.length, Math.hypot(3000, 3000, 3000 * Math.tan(rad(30))), 1);
  // jack rafters stop short of the hips
  const jacks = of(ms, "rafter").filter((m) => m.length < 3000 / Math.cos(rad(30)) - 30);
  assert.ok(jacks.length >= 8, `jacks ${jacks.length}`);
}

// an L: the inside corner makes a valley
const ell = roof([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 6000, y: 6000 }, { x: 6000, y: 12000 }, { x: 0, y: 12000 }], () => false);
{
  const kinds = roofLines(roofFaces(ell)).map((l) => l.kind);
  assert.equal(kinds.filter((k) => k === "valley").length, 1, kinds.join(" "));
  assert.equal(kinds.filter((k) => k === "hip").length, 5, kinds.join(" "));
  const ms = framed(ell, base);
  assert.equal(of(ms, "valley").length, 1);
}

assert.match(String(frameRoof(triangles([[0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 0]]), base)), /no sloping faces|sloping faces/);
console.log("roofFramerShapes: all passed");
