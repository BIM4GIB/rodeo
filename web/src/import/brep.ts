// The neutral boundary-representation model: bodies of shells of faces, each face a surface with
// loops of oriented edges, and each edge a curve with two vertices. Nothing here is specific to one
// file format. acis.ts fills it from ACIS SAT and SAB data (the solids inside AutoCAD's 3DSOLID,
// REGION and BODY entities), and brepStep.ts writes it as STEP for OpenCascade to mesh.
//
// Conventions shared by every reader: points and vectors are in the file's own world units, after
// the body's transform has been applied; a surface's normal is the one its faces are measured
// against, and each face says whether its outward normal runs against it.

/** A point or vector: x, y, z. */
export type V3 = readonly [number, number, number];

/** A surface a face lies on. Parameters are not stored; a face is bounded by its loops alone. */
export type BrepSurface =
  /** the plane through origin with unit normal normal; uDir lies in it */
  | { readonly kind: "plane"; readonly origin: V3; readonly normal: V3; readonly uDir: V3 }
  /** cylinders and cones, elliptical ones too: the cross-section at origin is the ellipse with semi-major `major` (a vector, its length the radius there) and semi-minor ratio·|major| about `axis`; sinHalf/cosHalf are the half-angle's sine and cosine as ACIS stores them (a cylinder has sinHalf 0) */
  | { readonly kind: "cone"; readonly origin: V3; readonly axis: V3; readonly major: V3; readonly ratio: number; readonly sinHalf: number; readonly cosHalf: number }
  | { readonly kind: "sphere"; readonly center: V3; readonly radius: number; readonly uDir: V3; readonly pole: V3 }
  | { readonly kind: "torus"; readonly center: V3; readonly axis: V3; readonly major: number; readonly minor: number; readonly uDir: V3 }
  /** control points row by row: index iu * countV + iv; weights null when not rational */
  | { readonly kind: "nurbs"; readonly degreeU: number; readonly degreeV: number; readonly knotsU: readonly number[]; readonly knotsV: readonly number[]; readonly countU: number; readonly countV: number; readonly points: readonly V3[]; readonly weights: readonly number[] | null }
  /** a surface this model cannot yet describe; name is the file's own name for it */
  | { readonly kind: "unknown"; readonly name: string };

/** A curve an edge runs along. */
export type BrepCurve =
  /** points origin + t·dir */
  | { readonly kind: "line"; readonly origin: V3; readonly dir: V3 }
  /** points center + major·cos t + (normal × major)·ratio·sin t */
  | { readonly kind: "ellipse"; readonly center: V3; readonly normal: V3; readonly major: V3; readonly ratio: number }
  | { readonly kind: "nurbs"; readonly degree: number; readonly knots: readonly number[]; readonly points: readonly V3[]; readonly weights: readonly number[] | null }
  /** a curve this model cannot yet describe; name is the file's own name for it */
  | { readonly kind: "unknown"; readonly name: string };

/** One edge: a curve between two vertices. */
export interface BrepEdge {
  /** the point at t0 on the curve (the edge's start vertex) */
  readonly start: V3;
  /** the point at t1 on the curve (the edge's end vertex) */
  readonly end: V3;
  /** null for an edge with no curve (a cone's apex) */
  readonly curve: BrepCurve | null;
  /** the edge's parameter range on its curve, as the file gives it, t0 at start */
  readonly t0: number;
  readonly t1: number;
  /** true when the edge runs against its curve's direction */
  readonly reversed: boolean;
}

/** One use of an edge inside a loop. */
export interface BrepCoedge {
  readonly edge: BrepEdge;
  /** true when this use of the edge runs from its end to its start */
  readonly reversed: boolean;
}

/** A closed ring of coedges, each one's end the next one's start. */
export interface BrepLoop {
  readonly coedges: readonly BrepCoedge[];
}

/** One face: a piece of a surface bounded by its loops (one outer ring and any holes, in no fixed order). */
export interface BrepFace {
  readonly surface: BrepSurface;
  /** true when the face's outward normal is against the surface's */
  readonly reversed: boolean;
  readonly loops: readonly BrepLoop[];
  /** true when the face may be seen from both sides (a sheet rather than a solid's skin) */
  readonly doubleSided: boolean;
}

/** A connected skin of faces. A closed shell bounds a solid. */
export interface BrepShell {
  readonly faces: readonly BrepFace[];
}

/** One solid, sheet or wire of a file's geometry. */
export interface BrepBody {
  readonly shells: readonly BrepShell[];
}
