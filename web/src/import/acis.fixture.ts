// SAT text written by hand for the ACIS checks (acis.check.ts, solids.check.ts): a box and a cylinder in
// the version 400 and version 700 layouts, placed by a quarter turn about z and a shift.

import type { V3 } from "./brep.ts";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Builds the text of one SAT file: records are added with optional keys, and a "$key" in a record's
 * fields is replaced by that record's index once every record is in place. Version 700 records carry an
 * id and a pattern after their attribute pointer (transform carries only the id); version 400 carries
 * neither.
 */
class SatText {
  private readonly records: { key: string | undefined; text: string }[] = [];

  constructor(private readonly version: number) {}

  add(key: string | undefined, name: string, fields: string, pattern = true): void {
    const head = this.version >= 700 ? (pattern ? "$-1 -1 $-1" : "$-1 -1") : "$-1";
    this.records.push({ key, text: `${name} ${head} ${fields} #` });
  }

  /** The file: the header lines, the records, the end marker. */
  text(): string {
    const index = new Map<string, number>();
    this.records.forEach((r, i) => {
      if (r.key !== undefined) index.set(r.key, i);
    });
    const body = this.records.map((r) =>
      r.text.replace(/\$([A-Za-z]\w*)/g, (_, key: string) => {
        const i = index.get(key);
        if (i === undefined) throw new Error(`no record called ${key}`);
        return `$${i}`;
      }),
    );
    const header = [`${this.version} 0 1 0`, "16 Autodesk AutoCAD 20 ASM 230.7.0.65535 NT 0", "25.4 9.999999999999999547e-07 1.000000000000000036e-10"];
    return [...header, ...body, "End-of-ACIS-data", ""].join("\n");
  }
}

/**
 * An edge's fields: version 700 gives each end its parameter and a convexity, and version 400 leaves them
 * out. t0 and t1 are curve parameters, which the file gives along the edge, so negated when it is reversed.
 */
function edgeFields(version: number, sv: string, t0: number, ev: string, t1: number, coedge: string, curve: string, reversed: boolean): string {
  const sense = reversed ? "reversed" : "forward";
  const k = reversed ? -1 : 1;
  return version >= 700
    ? `$${sv} ${k * t0} $${ev} ${k * t1} $${coedge} $${curve} ${sense} @7 unknown`
    : `$${sv} $${ev} $${coedge} $${curve} ${sense}`;
}

/** The transform the handwritten bodies are placed by: a quarter turn about z, then a shift. Rows are the images of the axes. */
const PLACE_M: readonly number[] = [0, 1, 0, -1, 0, 0, 0, 0, 1];
const PLACE_T: V3 = [10, 20, 30];
/** A body-frame point under the transform, computed from the rule p·M + t (rows of M are the images of the axes). */
export function placed(p: V3): V3 {
  const m = PLACE_M;
  return [
    p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + PLACE_T[0],
    p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + PLACE_T[1],
    p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + PLACE_T[2],
  ];
}

function transformFields(): string {
  return `${PLACE_M.join(" ")} ${PLACE_T.join(" ")} 1 no_rotate no_reflect no_shear`;
}

/** A box of half-width 1: 8 corners, 12 edges, 6 faces. Faces alternate three ways of storing their normal and sense. */
export function boxText(version: number): string {
  const s = new SatText(version);
  const corner = (i: number): V3 => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
  const edgeKey = (a: number, b: number): string => `e${Math.min(a, b)}_${Math.max(a, b)}`;
  const edges: { a: number; b: number; reversed: boolean }[] = [];
  for (let a = 0; a < 8; a++) {
    for (let b = a + 1; b < 8; b++) {
      if ((a ^ b) === 1 || (a ^ b) === 2 || (a ^ b) === 4) edges.push({ a, b, reversed: edges.length % 3 === 1 });
    }
  }
  const faceNormals: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faceAxes: [V3, V3][] = [
    [[0, 1, 0], [0, 0, 1]],
    [[0, 0, 1], [0, 1, 0]],
    [[0, 0, 1], [1, 0, 0]],
    [[1, 0, 0], [0, 0, 1]],
    [[1, 0, 0], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0]],
  ];

  s.add("body", "body", "$lump $-1 $tr");
  s.add("lump", "lump", "$-1 $shell $body");
  s.add("shell", "shell", "$-1 $-1 $f0 $-1 $lump");
  /** the coedge record that uses each edge, so an edge record can point at one of its uses */
  const coedgeOf = new Map<string, string>();
  faceNormals.forEach((n, f) => {
    // variant 0: stored normal is outward; 1: the same, with reverse_v set (which does not turn it over);
    // 2: stored normal is inward and the sense is reversed
    const variant = f % 3;
    const stored = variant === 2 ? scale(n, -1) : n;
    const flag = variant === 1 ? "reverse_v" : "forward_v";
    const sense = variant === 2 ? "reversed" : "forward";
    const origin = n;
    const uDir = faceAxes[f][0];
    s.add(`f${f}`, "face", `$${f < 5 ? `f${f + 1}` : "-1"} $l${f} $shell $-1 $pl${f} ${sense} single`);
    s.add(`l${f}`, "loop", `$-1 $k${f}_0 $f${f}`);
    s.add(`pl${f}`, "plane-surface", `${origin.join(" ")} ${stored.join(" ")} ${uDir.join(" ")} ${flag} I I I I`);
    // four coedges around the face, counterclockwise about its outward normal
    const axis = faceAxes[f];
    const ring: number[] = [];
    for (let i = 0; i < 8; i++) {
      const c = corner(i);
      if (Math.abs(dot(c, n) - 1) < 1e-9) ring.push(i);
    }
    ring.sort((p, q) => Math.atan2(dot(corner(p), axis[1]), dot(corner(p), axis[0])) - Math.atan2(dot(corner(q), axis[1]), dot(corner(q), axis[0])));
    for (let j = 0; j < 4; j++) {
      const from = ring[j];
      const to = ring[(j + 1) % 4];
      const e = edges.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
      if (!e) throw new Error("no edge between face corners");
      const reversed = from === e.b;
      coedgeOf.set(edgeKey(e.a, e.b), `k${f}_${j}`);
      s.add(`k${f}_${j}`, "coedge",`$k${f}_${(j + 1) % 4} $k${f}_${(j + 3) % 4} $-1 $${edgeKey(e.a, e.b)} ${reversed ? "reversed" : "forward"} $l${f} $-1`);
    }
  });
  for (const e of edges) {
    const { a, b, reversed } = e;
    const key = edgeKey(a, b);
    const topoCoedge = coedgeOf.get(key) ?? "-1";
    const t0 = reversed ? 1 : 0;
    const t1 = reversed ? 0 : 1;
    const origin = reversed ? corner(b) : corner(a);
    const dir = reversed ? sub(corner(a), corner(b)) : sub(corner(b), corner(a));
    s.add(key, "edge", edgeFields(version, `v${a}`, t0, `v${b}`, t1, topoCoedge, `c${key}`, reversed));
    s.add(`c${key}`, "straight-curve", `${origin.join(" ")} ${dir.join(" ")} I I`);
  }
  for (let i = 0; i < 8; i++) {
    const incident = edges.find((e) => e.a === i || e.b === i);
    if (!incident) throw new Error("corner with no edge");
    s.add(`v${i}`, "vertex", `$${edgeKey(incident.a, incident.b)} ${version >= 700 ? "0 " : ""}$p${i}`);
    s.add(`p${i}`, "point", corner(i).join(" "));
  }
  s.add("tr", "transform", transformFields(), false);
  return s.text();
}

/**
 * A cylinder of radius 1 and height 2 on the z axis: one cone face with two circular edges and a seam,
 * and two planar caps. The side loop runs bottom circle, seam up, top circle backward, seam down.
 */
export function cylinderText(version: number): string {
  const s = new SatText(version);
  const full = 2 * Math.PI;
  s.add("body", "body", "$lump $-1 $tr");
  s.add("lump", "lump", "$-1 $shell $body");
  s.add("shell", "shell", "$-1 $-1 $side $-1 $lump");
  s.add("side", "face", "$top $ls $shell $-1 $cone forward single");
  s.add("top", "face", "$bottom $lt $shell $-1 $plt forward single");
  s.add("bottom", "face", "$-1 $lb $shell $-1 $plb forward single");
  s.add("ls", "loop", "$-1 $sb $side");
  s.add("lt", "loop", "$-1 $ct $top");
  s.add("lb", "loop", "$-1 $cb $bottom");
  s.add("sb", "coedge", "$ss $sr $-1 $eBot forward $ls $-1");
  s.add("ss", "coedge", "$st $sb $-1 $eSeam forward $ls $-1");
  s.add("st", "coedge", "$sr $ss $-1 $eTop reversed $ls $-1");
  s.add("sr", "coedge", "$sb $st $-1 $eSeam reversed $ls $-1");
  s.add("ct", "coedge", "$ct $ct $-1 $eTop forward $lt $-1");
  s.add("cb", "coedge", "$cb $cb $-1 $eBot reversed $lb $-1");
  s.add("eBot", "edge", edgeFields(version, "vBot", 0, "vBot", full, "sb", "circBot", false));
  s.add("eTop", "edge", edgeFields(version, "vTop", 0, "vTop", full, "st", "circTop", false));
  s.add("eSeam", "edge", edgeFields(version, "vBot", 0, "vTop", 1, "ss", "lineSeam", false));
  s.add("circBot", "ellipse-curve", "0 0 0 0 0 1 1 0 0 1 I I");
  s.add("circTop", "ellipse-curve", "0 0 2 0 0 1 1 0 0 1 I I");
  s.add("lineSeam", "straight-curve", "1 0 0 0 0 2 I I");
  s.add("vBot", "vertex", `$eBot ${version >= 700 ? "0 " : ""}$pBot`);
  s.add("vTop", "vertex", `$eTop ${version >= 700 ? "0 " : ""}$pTop`);
  s.add("pBot", "point", "1 0 0");
  s.add("pTop", "point", "1 0 2");
  s.add("cone", "cone-surface", "0 0 0 0 0 1 1 0 0 1 I I 0 1 1 forward_v I I I I");
  s.add("plt", "plane-surface", "0 0 2 0 0 1 1 0 0 forward_v I I I I");
  s.add("plb", "plane-surface", "0 0 0 0 0 -1 1 0 0 forward_v I I I I");
  s.add("tr", "transform", transformFields(), false);
  return s.text();
}
