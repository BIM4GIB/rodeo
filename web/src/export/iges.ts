// File > Export > Export IGES (3D only): the 3D model as IGES 5.3, as Vectorworks writes it: a closed
// solid as a manifold solid B-rep object (Type 186: its shell, faces, loops, edge list and vertex list,
// 514/510/508/504/502) and an open one as a collection of trimmed surfaces (Type 144, each a flat face's
// outline as a curve on a parametric surface, 142, bounding a planar NURBS patch, 128). With `trimmed`
// every face is a trimmed surface of its own, as Export Solid as Trimmed Surfaces exports a cube as six.
// The bodies are export/bodies.ts's: an object's flat faces, those that join one body, turned to face
// out. Each object is named (a Name property, 406 form 15), coloured (a colour definition, 314) and on
// the level numbered as its layer. Millimetres, z up; curved surfaces flat-faceted as the 3D view draws them.

import { closes, facePlane, objectBodies, sub, type Face, type V3 } from "./bodies.ts";
import type { Model3D } from "./scene3d.ts";

export interface IgesExport {
  readonly text: string;
  readonly solids: number;
  readonly surfaces: number;
  readonly faces: number;
}

/** Directory entry status numbers: visible, then independent or physically dependent, the use flag, top-down. */
const INDEPENDENT = "00000000";
const DEPENDENT = "00010000";
/** a curve in a surface's parameter space */
const PARAMETRIC = "00010500";
/** a definition (a colour) */
const DEFINITION = "00000200";

/** An IGES real: always with a point, an exponent as E. */
function real(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  const s = String(Object.is(r, -0) ? 0 : r);
  if (s.includes("e")) {
    const [m, e] = s.split("e");
    return `${m.includes(".") ? m : `${m}.0`}E${e}`;
  }
  return s.includes(".") ? s : `${s}.0`;
}

/** Text as an IGES Hollerith string: printable ASCII, at most 60 characters (one parameter line). */
function holl(s: string): string {
  const a = s.replace(/[^\x20-\x7e]/g, "?").slice(0, 60);
  return a ? `${a.length}H${a}` : "";
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface Entity {
  readonly type: number;
  readonly form: number;
  readonly params: readonly string[];
  readonly status: string;
  readonly level: number;
  readonly color: number;
}

/** `tokens` joined by commas and ended by a semicolon, in lines of at most `width` that don't split a token. */
function wrap(tokens: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  tokens.forEach((t, i) => {
    const piece = t + (i === tokens.length - 1 ? ";" : ",");
    if (cur && cur.length + piece.length > width) {
      lines.push(cur);
      cur = "";
    }
    cur += piece;
  });
  if (cur) lines.push(cur);
  return lines;
}

const seq = (letter: string, n: number): string => letter + String(n).padStart(7);

/** The model as an IGES file named `fileName`; `trimmed` makes each face a trimmed surface of its own. */
export function exportIges(model: Model3D, trimmed: boolean, fileName: string, now = new Date()): IgesExport {
  const ents: Entity[] = [];
  /** Adds an entity, returning its directory entry's number (its pointer); `props` are property entities it carries. */
  const add = (type: number, params: readonly (string | number)[], o: { form?: number; status?: string; level?: number; color?: number } = {}, props: readonly number[] = []): number => {
    const p = params.map(String);
    ents.push({ type, form: o.form ?? 0, params: props.length ? [...p, "0", String(props.length), ...props.map(String)] : p, status: o.status ?? DEPENDENT, level: o.level ?? 0, color: o.color ?? 0 });
    return 2 * ents.length - 1;
  };
  const title = fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";

  const colours = new Map<string, number>();
  const colourOf = (css: string): number => {
    let c = colours.get(css);
    if (c === undefined) {
      const hex = /^#([0-9a-f]{6})$/i.exec(css)?.[1] ?? "808080";
      const pct = [0, 2, 4].map((i) => real((parseInt(hex.slice(i, i + 2), 16) / 255) * 100));
      c = add(314, [...pct, holl(css)], { status: DEFINITION });
      colours.set(css, c);
    }
    return c;
  };
  /** A degree-1 NURBS curve through `points` (closed when its ends meet), in the plane square to `normal`. */
  const polyline = (points: readonly V3[], normal: V3, status: string, level: number): number => {
    const k = points.length - 1;
    const knots = [0, ...Array.from({ length: k + 1 }, (_, i) => i), k];
    const ends = sub(points[0], points[k]);
    return add(126, [k, 1, 1, dot(ends, ends) < 1e-18 ? 1 : 0, 1, 0, ...knots.map(real), ...points.map(() => "1.0"), ...points.flatMap((p) => p.map(real)), "0.0", real(k), ...normal.map(real)], { status, level });
  };
  /** A face's box in its plane, x and y along it and its normal (x × y) out of its front, with its corners there; null for one too thin for a plane. */
  const boxOf = (f: Face, pts: readonly V3[]): { o: V3; x: V3; y: V3; n: V3; u0: number; u1: number; v0: number; v1: number; uv: [number, number][] } | null => {
    const plane = facePlane(f, pts);
    if (!plane) return null;
    const { n, x } = plane;
    const y = cross(n, x);
    const o = pts[f.v[0]];
    const uv = f.v.map((i): [number, number] => {
      const d = sub(pts[i], o);
      return [dot(d, x), dot(d, y)];
    });
    const [u0, u1] = [Math.min(...uv.map((p) => p[0])), Math.max(...uv.map((p) => p[0]))];
    const [v0, v1] = [Math.min(...uv.map((p) => p[1])), Math.max(...uv.map((p) => p[1]))];
    return u1 - u0 > 1e-6 && v1 - v0 > 1e-6 ? { o, x, y, n, u0, u1, v0, v1, uv } : null;
  };
  /** The flat NURBS patch over a face's box, its normal (u × v) the face's front; with the face's corners in its parameters. */
  const patch = (b: NonNullable<ReturnType<typeof boxOf>>, level: number): { surface: number; params: [number, number][] } => {
    const { o, x, y, u0, u1, v0, v1, uv } = b;
    const at = (u: number, v: number): string[] => [0, 1, 2].map((k) => real(o[k] + u * x[k] + v * y[k]));
    const surface = add(128, [1, 1, 1, 1, 0, 0, 1, 0, 0, "0.0", "0.0", "1.0", "1.0", "0.0", "0.0", "1.0", "1.0", "1.0", "1.0", "1.0", "1.0", ...at(u0, v0), ...at(u1, v0), ...at(u0, v1), ...at(u1, v1), "0.0", "1.0", "0.0", "1.0"], { level });
    return { surface, params: uv.map(([u, v]) => [(u - u0) / (u1 - u0), (v - v0) / (v1 - v0)]) };
  };

  let solids = 0;
  let surfaces = 0;
  let faceCount = 0;
  let extent = 0;
  model.layers.forEach((layer, li) => {
    const level = li + 1;
    for (const obj of layer.objects) {
      const { pts, bodies } = objectBodies(obj.pieces);
      for (const p of pts) extent = Math.max(extent, ...p.map(Math.abs));
      const named = (): number[] => (obj.name ? [add(406, [1, holl(obj.name)], { form: 15 })] : []);
      for (const body of bodies) {
        const counts = new Map<string, number>();
        for (const f of body) counts.set(f.color, (counts.get(f.color) ?? 0) + 1);
        const main = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        const boxes = body.map((f) => boxOf(f, pts));
        if (!trimmed && closes(body) && boxes.every((b) => b !== null)) {
          // a solid: its vertices and edges listed once, its faces bounded by loops of them
          const vertex = new Map<number, number>();
          for (const f of body) for (const v of f.v) if (!vertex.has(v)) vertex.set(v, vertex.size + 1);
          const vertices = add(502, [vertex.size, ...[...vertex.keys()].flatMap((v) => pts[v].map(real))], { form: 1, level });
          const edges = new Map<string, { index: number; from: number; line: number }>();
          for (const f of body) {
            f.v.forEach((a, k) => {
              const b = f.v[(k + 1) % f.v.length];
              const key = a < b ? `${a},${b}` : `${b},${a}`;
              if (!edges.has(key)) edges.set(key, { index: edges.size + 1, from: a, line: add(110, [...pts[a].map(real), ...pts[b].map(real)], { level }) });
            });
          }
          const list = add(504, [edges.size, ...[...edges].flatMap(([key, e]) => {
            const to = e.from === Number(key.split(",")[0]) ? Number(key.split(",")[1]) : Number(key.split(",")[0]);
            return [e.line, vertices, vertex.get(e.from)!, vertices, vertex.get(to)!];
          })], { form: 1, level });
          const faces = body.map((f, i) => {
            const loop = add(508, [f.v.length, ...f.v.flatMap((a, k) => {
              const b = f.v[(k + 1) % f.v.length];
              const e = edges.get(a < b ? `${a},${b}` : `${b},${a}`)!;
              return [0, list, e.index, e.from === a ? 1 : 0, 0];
            })], { form: 1, level });
            return add(510, [patch(boxes[i]!, level).surface, 1, 1, loop], { form: 1, level, color: f.color === main ? 0 : -colourOf(f.color) });
          });
          const shell = add(514, [faces.length, ...faces.flatMap((face) => [face, 1])], { form: 1, level });
          add(186, [shell, 1, 0], { status: INDEPENDENT, level, color: -colourOf(main) }, named());
          solids++;
          faceCount += faces.length;
          continue;
        }
        // surfaces: each face a trimmed surface bounded by its outline (a face too thin for a plane left out)
        for (const [i, f] of body.entries()) {
          const b = boxes[i];
          if (!b) continue;
          const p = patch(b, level);
          const ring = [...f.v, f.v[0]];
          const inParams = polyline(ring.map((_, k) => [...p.params[k % f.v.length], 0] as V3), [0, 0, 1], PARAMETRIC, level);
          const inModel = polyline(ring.map((v) => pts[v]), b.n, DEPENDENT, level);
          const bound = add(142, [1, p.surface, inParams, inModel, 2], { level });
          add(144, [p.surface, 1, 0, bound], { status: INDEPENDENT, level, color: -colourOf(f.color) }, named());
          surfaces++;
          faceCount++;
        }
      }
    }
  });

  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", ".").slice(0, 15);
  const start = [`Rodeo IGES export of ${title}, millimetres, z up`.replace(/[^\x20-\x7e]/g, "?").slice(0, 72)];
  const global = wrap(
    ["1H,", "1H;", holl(title), holl(`${title}.igs`), holl("Rodeo"), holl("Rodeo IGES 5.3"), "32", "38", "6", "308", "15", holl(title), "1.0", "2", "2HMM", "1", "1.0", holl(stamp), "1.0E-4", real(extent || 1), "", "", "11", "0", holl(stamp)],
    72,
  );
  // the parameter lines first, as the directory points into them
  const pLines: string[] = [];
  const pointers = ents.map((e, i) => {
    const first = pLines.length + 1;
    for (const line of wrap([String(e.type), ...e.params], 64)) pLines.push(line.padEnd(64) + " " + String(2 * i + 1).padStart(7) + seq("P", pLines.length + 1));
    return { first, count: pLines.length + 1 - first };
  });
  const field = (v: string | number): string => String(v).padStart(8);
  const dLines = ents.flatMap((e, i) => [
    [e.type, pointers[i].first, 0, 0, e.level, 0, 0, 0, e.status].map(field).join("") + seq("D", 2 * i + 1),
    [e.type, 0, e.color, pointers[i].count, e.form, "", "", "", 0].map(field).join("") + seq("D", 2 * i + 2),
  ]);
  const text = [
    ...start.map((l, i) => l.padEnd(72) + seq("S", i + 1)),
    ...global.map((l, i) => l.padEnd(72) + seq("G", i + 1)),
    ...dLines,
    ...pLines,
    (seq("S", start.length) + seq("G", global.length) + seq("D", dLines.length) + seq("P", pLines.length)).padEnd(72) + seq("T", 1),
    "",
  ].join("\n");
  return { text, solids, surfaces, faces: faceCount };
}
