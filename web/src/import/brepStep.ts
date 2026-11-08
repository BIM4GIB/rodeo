// Meshing ACIS solids through OpenCascade. The neutral B-rep of import/brep.ts is written as an ISO
// 10303-21 AP214 file (brepToStep), occt-import-js reads that file and meshes it (meshBreps), and the
// triangles come back per solid. OpenCascade cannot read ACIS, so the ACIS conventions are settled here
// on the way out: a cone with a negative cosHalf (or ratio), and a sphere or torus with a negative radius
// (or minor radius), have normals pointing inwards, so each STEP surface is written with its normal
// turned to match, and each face's same_sense says whether its outward normal agrees with the surface's. Elliptical cones have no STEP form and are left out, as are faces on
// unknown surfaces and faces with no loops on a surface other than a sphere or torus. A face with no
// loops covers its whole surface, and STEP wants a bound, so those are meshed here as parametric grids.

import { stepString } from "../export/ifc.ts";
import type { BrepBody, BrepCurve, BrepEdge, BrepFace, BrepLoop, BrepSurface, V3 } from "./brep.ts";
import type { Occt, OcctParams, OcctResult } from "./occt.ts";

/** A STEP real, written as given: always with a point, and an exponent for the very small or large. */
function real(v: number): string {
  const s = String(Object.is(v, -0) ? 0 : v);
  const e = s.indexOf("e");
  if (e < 0) return s.includes(".") ? s : `${s}.`;
  const mantissa = s.slice(0, e);
  return `${mantissa.includes(".") ? mantissa : `${mantissa}.`}E${s.slice(e + 1)}`;
}

const xyz = (v: V3): string => `${real(v[0])},${real(v[1])},${real(v[2])}`;
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale(a, 1 / len(a));

/** The knot vector as STEP has it: ACIS may leave out the first and last knot, count + degree − 1 knots, and they are the ends of the list. Null when the length fits neither. */
function fullKnots(knots: readonly number[], count: number, degree: number): number[] | null {
  if (knots.length === count + degree + 1) return [...knots];
  if (knots.length === count + degree - 1) return [knots[0], ...knots, knots[knots.length - 1]];
  return null;
}

/** A knot vector as its distinct knots with their multiplicities, the form a STEP B-spline takes. */
function knotRuns(knots: readonly number[]): { values: string; mults: string } {
  const values: number[] = [];
  const mults: number[] = [];
  for (const k of knots) {
    if (values.length && values[values.length - 1] === k) mults[mults.length - 1]++;
    else {
      values.push(k);
      mults.push(1);
    }
  }
  return { values: values.map(real).join(","), mults: mults.join(",") };
}

/** The STEP file for `bodies` (millimetres, as given), how many faces it left out and how many it wrote. */
export function writeBrep(bodies: readonly BrepBody[]): { text: string; skipped: number; written: number } {
  const lines: string[] = [];
  const add = (entity: string): string => {
    lines.push(`#${lines.length + 1}=${entity};`);
    return `#${lines.length}`;
  };
  let skipped = 0;
  let written = 0;

  // the part, its units and its frame, as export/step.ts writes them
  const app = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const product = add(`PRODUCT('solid','solid','',(${add(`PRODUCT_CONTEXT('',${app},'mechanical')`)}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const definition = add(`PRODUCT_DEFINITION('design','',${add(`PRODUCT_DEFINITION_FORMATION('','',${product})`)},${add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`)})`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
  const radian = add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
  const steradian = add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
  const accuracy = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${accuracy})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`,
  );
  const origin = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const frame = add(`AXIS2_PLACEMENT_3D('',${origin},${add("DIRECTION('',(0.,0.,1.))")},${add("DIRECTION('',(1.,0.,0.))")})`);
  const root = add(`SHAPE_REPRESENTATION('',(${frame}),${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${root})`);

  const point = (p: V3): string => add(`CARTESIAN_POINT('',(${xyz(p)}))`);
  const direction = (d: V3): string => add(`DIRECTION('',(${xyz(unit(d))}))`);

  /** An AXIS2_PLACEMENT_3D at `origin` with `z` as its axis and `x` as its reference direction, made to stand square to it. */
  const placement = (origin: V3, z: V3, x: V3): string => {
    const zu = unit(z);
    const xu = unit(sub(x, scale(zu, dot(x, zu))));
    return add(`AXIS2_PLACEMENT_3D('',${point(origin)},${direction(zu)},${direction(xu)})`);
  };

  // vertices are shared by exact coordinates
  const vertices = new Map<string, { point: string; vertex: string }>();
  const vertexOf = (p: V3): { point: string; vertex: string } => {
    const key = p.join(",");
    let v = vertices.get(key);
    if (!v) {
      const id = point(p);
      v = { point: id, vertex: add(`VERTEX_POINT('',${id})`) };
      vertices.set(key, v);
    }
    return v;
  };

  /** A curve as the STEP curve it is, and whether the STEP curve runs the other way (a negative ratio); null when it has none. */
  const curveOf = (c: BrepCurve): { ref: string; flip: boolean } | null => {
    switch (c.kind) {
      case "line":
        return { ref: add(`LINE('',${point(c.origin)},${add(`VECTOR('',${direction(c.dir)},1.)`)})`), flip: false };
      case "ellipse": {
        const a = len(c.major);
        const place = placement(c.center, c.normal, c.major);
        const flip = c.ratio < 0;
        const ref = Math.abs(Math.abs(c.ratio) - 1) < 1e-9 ? `CIRCLE('',${place},${real(a)})` : `ELLIPSE('',${place},${real(a)},${real(Math.abs(c.ratio) * a)})`;
        return { ref: add(ref), flip };
      }
      case "nurbs": {
        const knots = fullKnots(c.knots, c.points.length, c.degree);
        if (!knots) return null;
        const ids = c.points.map(point).join(",");
        const { values, mults } = knotRuns(knots);
        const curve = `B_SPLINE_CURVE_WITH_KNOTS('',${c.degree},(${ids}),.UNSPECIFIED.,.F.,.F.,(${mults}),(${values}),.UNSPECIFIED.)`;
        if (!c.weights) return { ref: add(curve), flip: false };
        const rational = `(BOUNDED_CURVE() B_SPLINE_CURVE(${c.degree},(${ids}),.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS((${mults}),(${values}),.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE((${c.weights.map(real).join(",")})) REPRESENTATION_ITEM(''))`;
        return { ref: add(rational), flip: false };
      }
      case "unknown":
        return null;
    }
  };

  /** A straight LINE from an edge's start to its end, for an edge on an unknown curve; null when it has no length. */
  const straight = (e: BrepEdge): { ref: string; flip: boolean } | null => {
    const d = sub(e.end, e.start);
    return len(d) === 0 ? null : curveOf({ kind: "line", origin: e.start, dir: d });
  };

  // edges are written once each, shared by the two coedges that use them; a curve-less edge (a cone's
  // apex) belongs only to a vertex loop, so it has no STEP edge
  const edges = new Map<BrepEdge, string | null>();
  const edgeOf = (e: BrepEdge): string | null => {
    const known = edges.get(e);
    if (known !== undefined) return known;
    const curve = e.curve === null ? null : e.curve.kind === "unknown" ? straight(e) : curveOf(e.curve);
    const id = curve
      ? add(`EDGE_CURVE('',${vertexOf(e.start).vertex},${vertexOf(e.end).vertex},${curve.ref},${(!e.reversed) !== curve.flip ? ".T." : ".F."})`)
      : null;
    edges.set(e, id);
    return id;
  };

  /** A surface as its STEP entity, and the sign of its STEP normal against the ACIS one (-1 when it is reversed); null when it has no STEP form. */
  const surfaceOf = (s: BrepSurface): { ref: string; sign: number } | null => {
    switch (s.kind) {
      case "plane":
        return { ref: add(`PLANE('',${placement(s.origin, s.normal, s.uDir)})`), sign: 1 };
      case "cone": {
        if (s.sinHalf === 0 && s.cosHalf === 0) return null;
        const flip = s.ratio < 0 ? -1 : 1;
        const major = len(s.major);
        const circular = Math.abs(Math.abs(s.ratio) - 1) < 1e-9;
        if (s.sinHalf === 0) {
          // a cylinder, or an elliptical one as its ellipse swept along the axis; the normal is the cosHalf's side
          const sign = Math.sign(s.cosHalf) * flip;
          if (circular) return { ref: add(`CYLINDRICAL_SURFACE('',${placement(s.origin, s.axis, s.major)},${real(major)})`), sign };
          const ellipse = add(`ELLIPSE('',${placement(s.origin, s.axis, s.major)},${real(major)},${real(Math.abs(s.ratio) * major)})`);
          return { ref: add(`SURFACE_OF_LINEAR_EXTRUSION('',${ellipse},${add(`VECTOR('',${direction(s.axis)},1.)`)})`), sign };
        }
        // STEP cones open along their axis, and this one's radius may shrink along it: the axis then
        // turns to the side the cone opens to, and the normal follows the cosHalf and the ratio
        if (!circular) return null;
        const sign = Math.sign(s.cosHalf) * flip;
        const axis = scale(unit(s.axis), sign * Math.sign(s.sinHalf));
        const semi = Math.atan2(Math.abs(s.sinHalf), Math.abs(s.cosHalf));
        return { ref: add(`CONICAL_SURFACE('',${placement(s.origin, axis, s.major)},${real(major)},${real(semi)})`), sign };
      }
      case "sphere":
        if (s.radius === 0) return null;
        return { ref: add(`SPHERICAL_SURFACE('',${placement(s.center, s.pole, s.uDir)},${real(Math.abs(s.radius))})`), sign: Math.sign(s.radius) };
      case "torus":
        if (s.minor === 0) return null;
        return { ref: add(`TOROIDAL_SURFACE('',${placement(s.center, s.axis, s.uDir)},${real(Math.abs(s.major))},${real(Math.abs(s.minor))})`), sign: Math.sign(s.minor) };
      case "nurbs": {
        const ku = fullKnots(s.knotsU, s.countU, s.degreeU);
        const kv = fullKnots(s.knotsV, s.countV, s.degreeV);
        if (!ku || !kv || s.points.length !== s.countU * s.countV) return null;
        const ids: string[] = s.points.map(point);
        const rows: string[] = [];
        for (let iu = 0; iu < s.countU; iu++) rows.push(`(${ids.slice(iu * s.countV, (iu + 1) * s.countV).join(",")})`);
        const grid = `(${rows.join(",")})`;
        const u = knotRuns(ku);
        const v = knotRuns(kv);
        if (!s.weights) {
          return { ref: add(`B_SPLINE_SURFACE_WITH_KNOTS('',${s.degreeU},${s.degreeV},${grid},.UNSPECIFIED.,.F.,.F.,.F.,(${u.mults}),(${v.mults}),(${u.values}),(${v.values}),.UNSPECIFIED.)`), sign: 1 };
        }
        const wrows: string[] = [];
        for (let iu = 0; iu < s.countU; iu++) wrows.push(`(${s.weights.slice(iu * s.countV, (iu + 1) * s.countV).map(real).join(",")})`);
        const rational = `(BOUNDED_SURFACE() B_SPLINE_SURFACE(${s.degreeU},${s.degreeV},${grid},.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS((${u.mults}),(${v.mults}),(${u.values}),(${v.values}),.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE((${wrows.join(",")})) REPRESENTATION_ITEM('') SURFACE())`;
        return { ref: add(rational), sign: 1 };
      }
      case "unknown":
        return null;
    }
  };

  /** A loop as a FACE_BOUND, or null when it cannot be written; `uses` collects the edges it runs along. */
  const loopOf = (loop: BrepLoop, uses: BrepEdge[]): string | null => {
    const { coedges } = loop;
    if (!coedges.length) return null;
    // a loop of curve-less edges is a single point, a cone's apex
    if (coedges.every((c) => c.edge.curve === null)) return add(`FACE_BOUND('',${add(`VERTEX_LOOP('',${vertexOf(coedges[0].edge.start).vertex})`)},.T.)`);
    const oriented: string[] = [];
    for (const c of coedges) {
      const e = edgeOf(c.edge);
      if (!e) return null;
      uses.push(c.edge);
      oriented.push(add(`ORIENTED_EDGE('',*,*,${e},${c.reversed ? ".F." : ".T."})`));
    }
    return add(`FACE_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
  };

  /** A face as an ADVANCED_FACE with the edges its loops use; null when it cannot be written. */
  const faceOf = (face: BrepFace): { id: string; uses: BrepEdge[] } | null => {
    const surface = surfaceOf(face.surface);
    if (!surface || !face.loops.length) return null;
    const uses: BrepEdge[] = [];
    const bounds: string[] = [];
    for (const loop of face.loops) {
      const bound = loopOf(loop, uses);
      if (!bound) return null;
      bounds.push(bound);
    }
    // the STEP surface's normal is the face's outward normal when the two signs agree
    const sameSense = surface.sign * (face.reversed ? -1 : 1) > 0;
    return { id: add(`ADVANCED_FACE('',(${bounds.join(",")}),${surface.ref},${sameSense ? ".T." : ".F."})`), uses };
  };

  // each body's shells: the closed ones are solids (the first the outer shell, the rest voids), the
  // open ones a surface model
  const solids: string[] = [];
  const surfaces: string[] = [];
  bodies.forEach((body, i) => {
    const name = stepString(`body ${i + 1}`);
    const closed: string[] = [];
    const open: string[] = [];
    for (const shell of body.shells) {
      const faces: { id: string; uses: BrepEdge[] }[] = [];
      for (const face of shell.faces) {
        const w = faceOf(face);
        if (w) {
          faces.push(w);
          written++;
        }
        // a sphere or torus with no loops is meshed as a grid instead of written
        else if (!(face.loops.length === 0 && (face.surface.kind === "sphere" || face.surface.kind === "torus"))) skipped++;
      }
      if (!faces.length) continue;
      const uses = new Map<BrepEdge, number>();
      for (const f of faces) for (const e of f.uses) uses.set(e, (uses.get(e) ?? 0) + 1);
      const ids = faces.map((f) => f.id).join(",");
      const isClosed = uses.size > 0 && [...uses.values()].every((n) => n === 2);
      (isClosed ? closed : open).push(add(isClosed ? `CLOSED_SHELL('',(${ids}))` : `OPEN_SHELL('',(${ids}))`));
    }
    if (closed.length) {
      const [outer, ...voids] = closed;
      solids.push(
        voids.length
          ? add(`BREP_WITH_VOIDS(${name},${outer},(${voids.map((v) => add(`ORIENTED_CLOSED_SHELL('',*,${v},.F.)`)).join(",")}))`)
          : add(`MANIFOLD_SOLID_BREP(${name},${outer})`),
      );
    }
    if (open.length) surfaces.push(add(`SHELL_BASED_SURFACE_MODEL(${name},(${open.join(",")}))`));
  });

  if (solids.length) add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${root},${add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[frame, ...solids].join(",")}),${ctx})`)})`);
  if (surfaces.length) add(`SHAPE_REPRESENTATION_RELATIONSHIP('','',${root},${add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(${[frame, ...surfaces].join(",")}),${ctx})`)})`);

  const stamp = new Date().toISOString().slice(0, 19);
  const text = ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('Rodeo B-rep solids'),'2;1');", `FILE_NAME('solids.stp','${stamp}',(''),(''),'Rodeo','Rodeo','');`,"FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  return { text, skipped, written };
}

/** The bodies as a STEP file, in the units given: see writeBrep for what it leaves out. */
export function brepToStep(bodies: readonly BrepBody[]): string {
  return writeBrep(bodies).text;
}

/** The deflection as a ratio of the average bounding box (a per mille, as a STEP import has it), and the angular one in radians (a circle in 32 sides): volumes come out within about 0.7 per cent on the checks' shapes. */
const DEFLECTION: OcctParams = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.2 };

/** The triangles of a sphere or torus face with no loops, a parametric grid turned to the face's outward normal. */
function gridOf(face: BrepFace, out: number[]): void {
  const s = face.surface;
  if (s.kind !== "sphere" && s.kind !== "torus") return;
  // the frame the STEP surface is written in: z the axis or pole, x the reference direction
  const z = unit(s.kind === "sphere" ? s.pole : s.axis);
  const xu = unit(sub(s.uDir, scale(z, dot(s.uDir, z))));
  const y = cross(z, xu);
  const at = (u: number, v: number): V3 => {
    const cu = Math.cos(u);
    const su = Math.sin(u);
    if (s.kind === "sphere") {
      const r = Math.abs(s.radius) * Math.cos(v);
      const c = s.center;
      return [c[0] + r * (cu * xu[0] + su * y[0]) + Math.abs(s.radius) * Math.sin(v) * z[0], c[1] + r * (cu * xu[1] + su * y[1]) + Math.abs(s.radius) * Math.sin(v) * z[1], c[2] + r * (cu * xu[2] + su * y[2]) + Math.abs(s.radius) * Math.sin(v) * z[2]];
    }
    const r = Math.abs(s.major) + Math.abs(s.minor) * Math.cos(v);
    const c = s.center;
    const h = Math.abs(s.minor) * Math.sin(v);
    return [c[0] + r * (cu * xu[0] + su * y[0]) + h * z[0], c[1] + r * (cu * xu[1] + su * y[1]) + h * z[1], c[2] + r * (cu * xu[2] + su * y[2]) + h * z[2]];
  };
  // the grid's own normal points out for a positive radius or minor radius; the face's sign turns it
  const sign = (s.kind === "sphere" ? Math.sign(s.radius) : Math.sign(s.minor)) * (face.reversed ? -1 : 1);
  const nu = 96;
  const nv = 48;
  const v0 = s.kind === "sphere" ? -Math.PI / 2 : 0;
  const v1 = s.kind === "sphere" ? Math.PI / 2 : 2 * Math.PI;
  const grid: V3[][] = [];
  for (let i = 0; i <= nu; i++) {
    const row: V3[] = [];
    for (let j = 0; j <= nv; j++) row.push(at((2 * Math.PI * i) / nu, v0 + ((v1 - v0) * j) / nv));
    grid.push(row);
  }
  const corner = (a: V3, b: V3, c: V3): void => {
    if (sign > 0) out.push(...a, ...b, ...c);
    else out.push(...a, ...c, ...b);
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      corner(a, b, c);
      corner(a, c, d);
    }
  }
}

/** Each solid's triangles: flat x, y, z per corner, counter-clockwise seen from outside, in the bodies' units; null where nothing could be meshed. */
export function meshBreps(occt: Occt, solids: readonly (readonly BrepBody[])[]): (Float32Array | null)[] {
  const encoder = new TextEncoder();
  return solids.map((bodies) => {
    const out: number[] = [];
    // one STEP file per solid, so every mesh OpenCascade returns for it is this solid's
    const { text, written } = writeBrep(bodies);
    if (written) {
      // OpenCascade throws, rather than saying so, on a file it can't make sense of: that solid has no triangles from it
      let result: OcctResult | null = null;
      try {
        result = occt.ReadStepFile(encoder.encode(text), DEFLECTION);
      } catch {
        result = null;
      }
      if (result?.success) {
        for (const mesh of result.meshes) {
          const p = mesh.attributes.position.array;
          for (const i of mesh.index.array) out.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
        }
      }
    }
    for (const body of bodies) for (const shell of body.shells) for (const face of shell.faces) if (!face.loops.length) gridOf(face, out);
    return out.length ? Float32Array.from(out) : null;
  });
}
