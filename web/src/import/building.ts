// A building model as an import hands it to Rodeo, whatever file it came from (Revit through
// rvtBuilding.ts; Archicad and IFC to follow): its storeys, and on them its walls, slabs, openings,
// other objects and 2D drawing, each with its category, type and properties. Lengths are mm, z up,
// heights absolute (a storey's elevation is in them); plan points are { x, y }. app/buildingWrite.ts
// makes a Rodeo drawing of it: a story and design layer per storey, a class per category, a record
// format per property set, and the elements as Rodeo's own objects where Rodeo has them.

import type { Attributes, NewShape, Pt } from "../core/types.ts";

export interface BuildingModel {
  /** the project's name, which the new drawing takes */
  name: string;
  /** the units the file was drawn in, so the drawing shows them */
  units: "mm" | "ftin";
  /** lowest first */
  storeys: Storey[];
  categories: Category[];
  materials: Material[];
  walls: Wall[];
  slabs: Slab[];
  /** doors and windows, in a wall or standing alone */
  openings: Opening[];
  /** everything else with a body: columns, beams, roofs, stairs, furniture, fixtures, ducts... */
  objects: BuildingObject[];
  /** 2D drawing on a storey's plan, each shape with its own pen, fill and line type over its class's when given */
  drawing: { storey: number; category: number; shape: NewShape; attrs?: Partial<Attributes> }[];
  /** what was left out, by kind (plural: "stairs without a body"), with how many */
  skipped: Record<string, number>;
  /** what the reader said it approximated or couldn't read */
  notes: string[];
}

export interface Storey {
  name: string;
  /** mm */
  elevation: number;
}

/** What an element is, as its file groups it (a Revit category, an Archicad layer): a class in Rodeo. */
export interface Category {
  name: string;
  /** 0..1 channels; the class's fill when given */
  color?: Rgb;
  /** hidden in the file (an Archicad layer turned off): the class starts hidden */
  hidden?: boolean;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Material {
  name: string;
  color?: Rgb;
  /** 0 opaque .. 1 clear */
  transparency?: number;
}

/** A property: what a record field holds. Lengths are mm, areas mm², volumes mm³, angles degrees. */
export interface Property {
  name: string;
  kind: "text" | "integer" | "number" | "boolean" | "length" | "area" | "volume" | "angle";
  value: string | number | boolean;
}

/** Named sets of properties (a Revit element's parameters, an IFC property set). */
export type PropertySets = Record<string, Property[]>;

interface Element {
  storey: number;
  category: number;
  /** the element's own name or mark; may be "" */
  name: string;
  /** its type ("Basic Wall: Generic 200mm"); may be "" */
  type: string;
  properties: PropertySets;
  /** a material for the whole element */
  material?: number;
}

/** A layer of a wall or slab, outside (or top) first. */
export interface Component {
  material?: number;
  /** mm */
  thickness: number;
  name?: string;
}

export interface Wall extends Element {
  /** the centreline's ends */
  start: Pt;
  end: Pt;
  /** a curved wall bulges by this much at its middle, to the left of start → end; 0 or absent is straight */
  bulge?: number;
  thickness: number;
  /** absolute z of its foot and its height above that */
  bottom: number;
  height: number;
  components?: Component[];
  /** holes through it its file gives as outlines (an edited elevation profile): x along its line from `start`, y up from its foot */
  cutOuts?: Pt[][];
}

export interface Slab extends Element {
  /** its outline in plan, counter-clockwise or not */
  outline: Pt[];
  /** holes through it */
  holes?: Pt[][];
  /** absolute z of its underside */
  bottom: number;
  thickness: number;
  components?: Component[];
}

/** A body as faces: flat corner lists, x, y, z triples in mm, absolute z. */
export interface Body {
  faces: number[][];
  color?: Rgb;
  /** only the box round the element: its own shape wasn't read, so it is drawn see-through */
  box?: boolean;
}

/** Where an element's own frame lies: its origin (mm, absolute z) and its turn about z (radians, anticlockwise). */
export interface Placement {
  at: { x: number; y: number; z: number };
  turn: number;
}

/**
 * An element that may be one of many of its type (a Revit family's type): those sharing `typeKey`,
 * each with its `placement`, whose bodies are alike in their own frames are made one symbol, named
 * for the key, placed for each.
 */
interface Typed {
  typeKey?: string;
  placement?: Placement;
}

export interface Opening extends Element, Typed {
  kind: "door" | "window";
  /** the wall it is set in (an index into walls), when it is in one */
  wall?: number;
  /** its middle in plan, on its wall's line when it is in one */
  at: Pt;
  /** across its opening, its height, and the absolute z of its sill (a door's foot) */
  width: number;
  height: number;
  sill: number;
  /** its own body: frame, leaf, glass */
  bodies: Body[];
}

export interface BuildingObject extends Element, Typed {
  bodies: Body[];
}
