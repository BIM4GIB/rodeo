// File > Export > Export Simple VectorScript (3D only), its text (exportScript.ts asks for the view and
// downloads it): the 3D objects as a plain Pascal-like script other programs can read, each flat face a
// Poly3D call through its corners' x, y, z, and each object's faces a group. Front view turns the model
// so its front faces the script's top: x stays, z goes up the page as y, and the depth toward the viewer
// is z; the current view does the same for the way the view looks. Coordinates are in the drawing's
// units. Plain data in and out.

import { facesOf } from "../../core/faces3d.ts";

export type Vec3 = readonly [number, number, number];
/** where x, y and z go: the directions that become the script's x (right), y (up) and z (toward the viewer) */
export type Basis = readonly [Vec3, Vec3, Vec3];

export const TOP_BASIS: Basis = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const FRONT_BASIS: Basis = [
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
];

/** Poly3D calls a procedure of the script holds, so no procedure grows past what Vectorworks compiles quickly. */
const PART = 400;
/** Corners a line of a Poly3D call holds. */
const PER_LINE = 4;

/** A number as Vectorscript writes it: up to six decimals, no exponent (as Export Script writes them). */
function num(v: number): string {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : v;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The basis of a view looking from `eye` to `target` with z up; one looking straight down or up keeps `right` (the plan's x on screen). */
export function viewBasis(eye: Vec3, target: Vec3, right: Vec3 = [1, 0, 0]): Basis {
  const f = unit([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const side = cross(f, [0, 0, 1]);
  const r = Math.hypot(...side) > 1e-9 ? unit(side) : unit(right);
  const up = unit(cross(r, f));
  return [r, up, [-f[0], -f[1], -f[2]]];
}

/** An object to write: the triangles it shows (9 numbers a triangle, in mm). */
export interface SimpleObject {
  readonly triangles: ArrayLike<number>;
}

export interface SimpleScript {
  readonly text: string;
  readonly objects: number;
  readonly faces: number;
}

/**
 * The script for `objects`, turned by `basis` and written in units `mm` millimetres long (`unitName`);
 * `file` and `view` name them in its first lines.
 */
export function simpleScript(objects: readonly SimpleObject[], basis: Basis, mm: number, unitName: string, file: string, view: string): SimpleScript {
  const parts: string[][] = [];
  let lines: string[] = [];
  let calls = 0;
  let written = 0;
  let faces = 0;
  const at = (x: number, y: number, z: number): string => {
    const p: Vec3 = [x, y, z];
    return basis.map((axis) => num(dot(axis, p) / mm)).join(", ");
  };
  for (const o of objects) {
    const polys = facesOf(o.triangles).filter((f) => f.length >= 9);
    if (!polys.length) continue;
    // an object's faces stay in one procedure, the next one starting when this one is full
    if (calls > 0 && calls + polys.length > PART) {
      parts.push(lines);
      lines = [];
      calls = 0;
    }
    const pad = polys.length > 1 ? "            " : "        ";
    if (polys.length > 1) lines.push("        BeginGroup;");
    for (const f of polys) {
      const corners: string[] = [];
      for (let i = 0; i + 2 < f.length; i += 3) corners.push(at(f[i], f[i + 1], f[i + 2]));
      const rows: string[] = [];
      for (let i = 0; i < corners.length; i += PER_LINE) rows.push(corners.slice(i, i + PER_LINE).join(",  "));
      lines.push(`${pad}Poly3D(${rows.join(`,\n${pad}       `)});`);
    }
    if (polys.length > 1) lines.push("        EndGroup;");
    calls += polys.length;
    faces += polys.length;
    written++;
  }
  if (lines.length) parts.push(lines);

  const out: string[] = [];
  out.push(`{ ${file}: written by Rodeo (File > Export > Export Simple VectorScript (3D only)) on ${new Date().toISOString().slice(0, 10)}, in ${view}. }`);
  out.push(`{ ${written} ${written === 1 ? "object" : "objects"} as ${faces} ${faces === 1 ? "3D polygon" : "3D polygons"}, one for each flat face, each object's grouped; in ${unitName}. }`);
  out.push("PROCEDURE Simple3D;");
  parts.forEach((part, i) => {
    out.push("");
    out.push(`    PROCEDURE Part${i + 1};`);
    out.push("    BEGIN");
    out.push(...part);
    out.push("    END;");
  });
  out.push("");
  out.push("BEGIN");
  out.push("    ClosePoly;");
  for (let i = 0; i < parts.length; i++) out.push(`    Part${i + 1};`);
  out.push("END;");
  out.push("RUN(Simple3D);");
  return { text: out.join("\n") + "\n", objects: written, faces };
}
