// File > Export > Export STEP (3D only): the 3D model as STEP (ISO 10303-21, AP214), for mechanical CAD
// such as SolidWorks, Fusion, Inventor, FreeCAD or Rhino. Each object's flat faces (the 3D view's
// triangles merged back into the faces they were cut from, core/faces3d.ts) become planar B-rep faces
// with straight edges, its pieces that join along their edges one body: a solid when its faces close
// round it (every edge shared by two faces running opposite ways), else a surface model, named as the
// object. With `trimmed` every face is a body of its own, as Vectorworks' Export Solid as Trimmed
// Surfaces exports a cube as six. Bodies take their object's colour (a face of another colour its own),
// and each layer is a presentation layer holding its bodies. Millimetres, z up, as the drawing holds
// them; all of it one part. Curved surfaces go as the 3D view draws them, flat-faceted.

import { facesOf } from "../core/faces3d.ts";
import { stepString } from "./ifc.ts";
import type { Model3D } from "./scene3d.ts";

/** points this close (mm) are one vertex, as faces3d welds them */
const WELD = 1e-4;

export interface StepExport {
  readonly text: string;
  readonly solids: number;
  readonly surfaces: number;
  readonly faces: number;
}

/** A STEP real: always with a point, to a millionth (1.E-07 for an exponent). */
function real(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  const s = String(Object.is(r, -0) ? 0 : r);
  if (!s.includes("e")) return s.includes(".") ? s : `${s}.`;
  return s.includes(".") ? s.replace("e", "E") : s.replace("e", ".E");
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** A face: its corners as vertex numbers in order round it (counter-clockwise seen from outside), and its colour. */
interface Face {
  readonly v: number[];
  readonly color: string;
}

/** The faces' bodies: those joined along an edge, together. */
function bodies(faces: readonly Face[]): Face[][] {
  const up = faces.map((_, i) => i);
  const find = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]];
    return i;
  };
  const byEdge = new Map<string, number>();
  faces.forEach((f, i) => {
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const other = byEdge.get(key);
      if (other === undefined) byEdge.set(key, i);
      else up[find(i)] = find(other);
    }
  });
  const groups = new Map<number, Face[]>();
  faces.forEach((f, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(f);
    else groups.set(root, [f]);
  });
  return [...groups.values()];
}

/**
 * A body's faces turned to agree: each edge two faces share run opposite ways by them (the 3D view
 * draws both sides, so a cap can come wound as its opposite one), then all of them turned to face out
 * (a closed body's volume positive) or, open, the way most of them came. As they came when an edge
 * has more than two faces or they can't agree (a Möbius strip).
 */
function orient(faces: readonly Face[], pts: readonly V3[]): Face[] {
  const onEdge = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      onEdge.set(key, [...(onEdge.get(key) ?? []), i]);
    }
  });
  if ([...onEdge.values()].some((l) => l.length > 2)) return [...faces];
  /** whether face i runs a to b */
  const runs = (i: number, a: number, b: number): boolean => {
    const v = faces[i].v;
    const k = v.indexOf(a);
    return v[(k + 1) % v.length] === b;
  };
  const flip: (boolean | undefined)[] = faces.map(() => undefined);
  for (let start = 0; start < faces.length; start++) {
    if (flip[start] !== undefined) continue;
    flip[start] = false;
    const queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      const v = faces[i].v;
      for (let k = 0; k < v.length; k++) {
        const a = v[k];
        const b = v[(k + 1) % v.length];
        const other = onEdge.get(a < b ? `${a},${b}` : `${b},${a}`)!.find((j) => j !== i);
        if (other === undefined) continue;
        // as turned, i runs a to b exactly when it isn't flipped; other must then run b to a
        const want = runs(other, a, b) !== flip[i];
        if (flip[other] === undefined) {
          flip[other] = want;
          queue.push(other);
        } else if (flip[other] !== want) return [...faces];
      }
    }
  }
  let turned = faces.map((f, i) => (flip[i] ? { ...f, v: [...f.v].reverse() } : f));
  let outward: boolean;
  if (closes(turned)) {
    let volume = 0;
    for (const f of turned) {
      const p = pts[f.v[0]];
      for (let k = 1; k + 1 < f.v.length; k++) {
        const q = pts[f.v[k]];
        const r = pts[f.v[k + 1]];
        volume += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
      }
    }
    outward = volume >= 0;
  } else outward = flip.filter(Boolean).length * 2 <= faces.length;
  if (!outward) turned = turned.map((f) => ({ ...f, v: [...f.v].reverse() }));
  return turned;
}

/** True when every edge of `faces` is run once each way: they close round a solid. */
function closes(faces: readonly Face[]): boolean {
  const runs = new Map<string, number>();
  for (const f of faces) {
    for (let k = 0; k < f.v.length; k++) {
      const key = `${f.v[k]},${f.v[(k + 1) % f.v.length]}`;
      runs.set(key, (runs.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of runs) {
    const [a, b] = key.split(",");
    if (n !== 1 || runs.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

/** The model as a STEP file named `fileName`; `trimmed` makes each face a body of its own. */
export function exportStep(model: Model3D, trimmed: boolean, fileName: string, now = new Date()): StepExport {
  const lines: string[] = [];
  const add = (entity: string): string => {
    lines.push(`#${lines.length + 1}=${entity};`);
    return `#${lines.length}`;
  };
  const title = fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";

  // the part, its units and its frame
  const app = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const product = add(`PRODUCT(${stepString(title)},${stepString(title)},'',(${add(`PRODUCT_CONTEXT('',${app},'mechanical')`)}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const definition = add(`PRODUCT_DEFINITION('design','',${add(`PRODUCT_DEFINITION_FORMATION('','',${product})`)},${add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`)})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
  const radian = add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
  const steradian = add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
  const accuracy = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-04),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${accuracy})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  const origin = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const frame = add(`AXIS2_PLACEMENT_3D('',${origin},${add("DIRECTION('',(0.,0.,1.))")},${add("DIRECTION('',(1.,0.,0.))")})`);
  const root = add(`SHAPE_REPRESENTATION('',(${frame}),${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${root})`);

  // a colour's style, made once
  const styles = new Map<string, string>();
  const styleOf = (css: string): string => {
    let s = styles.get(css);
    if (s) return s;
    const hex = /^#([0-9a-f]{6})$/i.exec(css)?.[1] ?? "808080";
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const colour = add(`COLOUR_RGB('',${real(r)},${real(g)},${real(b)})`);
    const fill = add(`FILL_AREA_STYLE('',(${add(`FILL_AREA_STYLE_COLOUR('',${colour})`)}))`);
    const side = add(`SURFACE_SIDE_STYLE('',(${add(`SURFACE_STYLE_FILL_AREA(${fill})`)}))`);
    s = add(`PRESENTATION_STYLE_ASSIGNMENT((${add(`SURFACE_STYLE_USAGE(.BOTH.,${side})`)}))`);
    styles.set(css, s);
    return s;
  };
  const styled: string[] = [];
  const solids: string[] = [];
  const surfaces: string[] = [];
  let faceCount = 0;

  for (const layer of model.layers) {
    const onLayer: string[] = [];
    for (const obj of layer.objects) {
      // the object's corners welded into vertices, its faces round them
      const pts: V3[] = [];
      const byKey = new Map<string, number>();
      const vertex = (x: number, y: number, z: number): number => {
        const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
        let n = byKey.get(key);
        if (n === undefined) {
          n = pts.length;
          pts.push([x, y, z]);
          byKey.set(key, n);
        }
        return n;
      };
      const faces: Face[] = [];
      for (const piece of obj.pieces) {
        for (const f of facesOf(piece.triangles)) {
          const v: number[] = [];
          for (let i = 0; i + 2 < f.length; i += 3) {
            const n = vertex(f[i], f[i + 1], f[i + 2]);
            if (v[v.length - 1] !== n) v.push(n);
          }
          while (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
          if (v.length >= 3) faces.push({ v, color: piece.color });
        }
      }
      if (!faces.length) continue;

      // each vertex and edge written once for the body it bounds
      let vertexIds = new Map<number, { point: string; vertex: string }>();
      const vertexOf = (n: number): { point: string; vertex: string } => {
        let e = vertexIds.get(n);
        if (!e) {
          const point = add(`CARTESIAN_POINT('',(${pts[n].map(real).join(",")}))`);
          e = { point, vertex: add(`VERTEX_POINT('',${point})`) };
          vertexIds.set(n, e);
        }
        return e;
      };
      let edges = new Map<string, { id: string; from: number }>();
      const edgeOf = (a: number, b: number): { id: string; from: number } => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        let e = edges.get(key);
        if (!e) {
          const d = sub(pts[b], pts[a]);
          const l = len(d);
          const dir = add(`DIRECTION('',(${d.map((c) => real(c / l)).join(",")}))`);
          const line = add(`LINE('',${vertexOf(a).point},${add(`VECTOR('',${dir},${real(l)})`)})`);
          e = { id: add(`EDGE_CURVE('',${vertexOf(a).vertex},${vertexOf(b).vertex},${line},.T.)`), from: a };
          edges.set(key, e);
        }
        return e;
      };
      /** A face as a planar face bounded by its edges; null when its corners lie on a line. */
      const faceOf = (f: Face): string | null => {
        // Newell's normal, which runs out of the face's front
        const n: V3 = [0, 0, 0];
        for (let k = 0; k < f.v.length; k++) {
          const p = pts[f.v[k]];
          const q = pts[f.v[(k + 1) % f.v.length]];
          n[0] += (p[1] - q[1]) * (p[2] + q[2]);
          n[1] += (p[2] - q[2]) * (p[0] + q[0]);
          n[2] += (p[0] - q[0]) * (p[1] + q[1]);
        }
        const nl = len(n);
        const first = sub(pts[f.v[1]], pts[f.v[0]]);
        // the plane's x along the first edge, made square to its normal
        const along = first[0] * n[0] + first[1] * n[1] + first[2] * n[2];
        const x: V3 = [first[0] - (along * n[0]) / (nl * nl), first[1] - (along * n[1]) / (nl * nl), first[2] - (along * n[2]) / (nl * nl)];
        const xl = len(x);
        if (!(nl > 1e-9) || !(xl > 1e-9)) return null;
        const oriented = f.v.map((a, k) => {
          const b = f.v[(k + 1) % f.v.length];
          const e = edgeOf(a, b);
          return add(`ORIENTED_EDGE('',*,*,${e.id},${e.from === a ? ".T." : ".F."})`);
        });
        const bound = add(`FACE_OUTER_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
        const axes = add(
          `AXIS2_PLACEMENT_3D('',${vertexOf(f.v[0]).point},${add(`DIRECTION('',(${n.map((c) => real(c / nl)).join(",")}))`)},${add(`DIRECTION('',(${x.map((c) => real(c / xl)).join(",")}))`)})`,
        );
        faceCount++;
        return add(`ADVANCED_FACE('',(${bound}),${add(`PLANE('',${axes})`)},.T.)`);
      };

      const name = stepString(obj.name);
      const turned = bodies(faces).map((b) => orient(b, pts));
      for (const body of trimmed ? turned.flat().map((f) => [f]) : turned) {
        vertexIds = new Map();
        edges = new Map();
        const written = body.map((f) => ({ f, id: faceOf(f) })).filter((w): w is { f: Face; id: string } => w.id !== null);
        if (!written.length) continue;
        const ids = written.map((w) => w.id).join(",");
        // the body takes the colour most of its faces have; the others keep theirs
        const counts = new Map<string, number>();
        for (const w of written) counts.set(w.f.color, (counts.get(w.f.color) ?? 0) + 1);
        const main = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        let item: string;
        if (!trimmed && closes(body) && written.length === body.length) {
          item = add(`MANIFOLD_SOLID_BREP(${name},${add(`CLOSED_SHELL('',(${ids}))`)})`);
          solids.push(item);
        } else {
          item = add(`SHELL_BASED_SURFACE_MODEL(${name},(${add(`OPEN_SHELL('',(${ids}))`)}))`);
          surfaces.push(item);
        }
        onLayer.push(item);
        styled.push(add(`STYLED_ITEM('color',(${styleOf(main)}),${item})`));
        for (const w of written) if (w.f.color !== main) styled.push(add(`STYLED_ITEM('color',(${styleOf(w.f.color)}),${w.id})`));
      }
    }
    if (onLayer.length) add(`PRESENTATION_LAYER_ASSIGNMENT(${stepString(layer.name || "Layer")},'',(${onLayer.join(",")}))`);
  }

  if (solids.length) add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${root},${add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[frame, ...solids].join(",")}),${ctx})`)})`);
  if (surfaces.length) add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${root},${add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(${[frame, ...surfaces].join(",")}),${ctx})`)})`);
  if (styled.length) add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.join(",")}),${ctx})`);

  const stamp = now.toISOString().slice(0, 19);
  const text = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Rodeo 3D model'),'2;1');",
    `FILE_NAME(${stepString(`${title}.stp`)},'${stamp}',(''),(''),'Rodeo','Rodeo','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
  return { text, solids: solids.length, surfaces: surfaces.length, faces: faceCount };
}
