// File > Export > Export STEP (3D only): the 3D model as STEP (ISO 10303-21, AP214), for mechanical CAD
// such as SolidWorks, Fusion, Inventor, FreeCAD or Rhino. Each object's flat faces (the 3D view's
// triangles merged back into the faces they were cut from, core/faces3d.ts) become planar B-rep faces
// with straight edges, its pieces that join along their edges one body: a solid when its faces close
// round it (every edge shared by two faces running opposite ways), else a surface model, named as the
// object. With `trimmed` every face is a body of its own, as Vectorworks' Export Solid as Trimmed
// Surfaces exports a cube as six. Bodies take their object's colour (a face of another colour its own),
// and each layer is a presentation layer holding its bodies. Millimetres, z up, as the drawing holds
// them; all of it one part. Curved surfaces go as the 3D view draws them, flat-faceted.

import { closes, facePlane, objectBodies, sub, len, type Face } from "./bodies.ts";
import { stepString } from "./ifc.ts";
import type { Model3D } from "./scene3d.ts";


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
      const { pts, bodies: turned } = objectBodies(obj.pieces);
      if (!turned.length) continue;

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
        const plane = facePlane(f, pts);
        if (!plane) return null;
        const oriented = f.v.map((a, k) => {
          const b = f.v[(k + 1) % f.v.length];
          const e = edgeOf(a, b);
          return add(`ORIENTED_EDGE('',*,*,${e.id},${e.from === a ? ".T." : ".F."})`);
        });
        const bound = add(`FACE_OUTER_BOUND('',${add(`EDGE_LOOP('',(${oriented.join(",")}))`)},.T.)`);
        const axes = add(
          `AXIS2_PLACEMENT_3D('',${vertexOf(f.v[0]).point},${add(`DIRECTION('',(${plane.n.map(real).join(",")}))`)},${add(`DIRECTION('',(${plane.x.map(real).join(",")}))`)})`,
        );
        faceCount++;
        return add(`ADVANCED_FACE('',(${bound}),${add(`PLANE('',${axes})`)},.T.)`);
      };

      const name = stepString(obj.name);
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
