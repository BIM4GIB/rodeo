// A building model (import/building.ts) written into a drawing, as one change: a story per storey,
// each with a design layer at its elevation, a class per category, a record format per property set,
// walls as Rodeo's walls with the openings of their doors and windows cut through them, floors as
// extrudes of their outlines (a storey's in a few changes), and every other element as a mesh (a
// group of meshes when it has several colours) in its exact colours, each element carrying its
// properties as records; a body that is only its element's box is drawn see-through. A door or
// window is drawn by its own body, standing in its wall's opening: Rodeo sets no door or window
// object in a wall it makes. No DOM here, so the checks and the import's worker (revitImport.ts)
// run it.

import { type Attributes, type EditSession, type FieldKind, MAX_FIELD_NAME, type MeshElement, type NewShape, type PlainWallSpec, type Pt, type RecordFieldSpec, type RecordValue } from "../core/index.ts";
import type { Body, BuildingModel, Placement, Property, PropertySets, Rgb, Slab } from "../import/building.ts";

export interface BuildingWritten {
  /** the design layer of each storey */
  layers: string[];
  walls: number;
  slabs: number;
  openings: number;
  objects: number;
  /** symbols made of elements of one type, each placed for every one of them */
  symbols: number;
  /** 2D objects */
  drawing: number;
  /** what couldn't be made, by kind (plural), with how many */
  failed: Record<string, number>;
}

/**
 * A field's kind for a property's. Rodeo makes new number fields only as plain numbers or lengths,
 * so areas, volumes and angles are numbers, their unit in the field's name (see `fieldValue`).
 */
const FIELD_KIND: Readonly<Record<Property["kind"], FieldKind>> = {
  text: "text",
  integer: "integer",
  number: "number",
  boolean: "boolean",
  length: "dimension",
  area: "number",
  volume: "number",
  angle: "number",
};

/** Writes `model` into the drawing `s` is editing; `progress` hears each step. */
export function writeBuilding(s: EditSession, model: BuildingModel, progress?: (step: string) => void): BuildingWritten {
  const failed: Record<string, number> = {};
  const fail = (kind: string): void => {
    failed[kind] = (failed[kind] ?? 0) + 1;
  };
  return s.batch(() => {
    progress?.("Making the levels");
    const colorOf = exactColors(s, model);
    const scale = s.doc.layers().find((l) => l.kind === "design")?.scale ?? 100;
    const first = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).length === 0);
    const storeys = model.storeys.length ? model.storeys : [{ name: "Level 1", elevation: 0 }];
    const layers = storeys.map((st, i) => {
      const story = named(st.name, (n) => s.createStory(n, String(i + 1), st.elevation));
      const id = i === 0 && first ? first.id : named(`${st.name} Model`, (n) => s.createLayer(n, "design", scale));
      if (id === first?.id) named(`${st.name} Model`, (n) => s.renameLayer(id, n));
      s.setLayerStory(id, story);
      s.setLayerElevation(id, st.elevation);
      return id;
    });
    const elevation = (storey: number): number => storeys[storey]?.elevation ?? 0;
    const layerOf = (storey: number): string => layers[storey] ?? layers[0];

    const classes = model.categories.map((c) => {
      const index = named(c.name, (n) => s.createClass(n));
      if (c.color) {
        const k = colorOf(c.color);
        s.setClassAttributes(index, { fillPattern: 1, fillFore: k, fillBack: k });
      }
      if (c.hidden) s.setClassVisibility(index, "hidden");
      return index;
    });
    const classOf = (category: number): number | undefined => classes[category];

    // a record format per property set, its fields every property any element gives it
    const formats = new Map<string, { index: number; kinds: Map<string, Property["kind"]>; names: Map<string, string> }>();
    const elements = [...model.walls, ...model.slabs, ...model.openings, ...model.objects];
    const fieldsOf = new Map<string, Map<string, Property["kind"]>>();
    for (const e of elements)
      for (const [set, props] of Object.entries(e.properties)) {
        const kinds = fieldsOf.get(set) ?? fieldsOf.set(set, new Map()).get(set)!;
        for (const p of props) if (!kinds.has(p.name)) kinds.set(p.name, p.kind);
      }
    const ftin = model.units === "ftin";
    for (const [set, kinds] of fieldsOf) {
      // a field per property, named for it (with its unit when the number doesn't say), each name
      // short enough and unlike the others whatever their case
      const names = new Map<string, string>();
      const taken = new Set<string>();
      const fields: RecordFieldSpec[] = [];
      for (const [name, kind] of kinds) {
        const unit = kind === "area" ? (ftin ? " (sq ft)" : " (m²)") : kind === "volume" ? (ftin ? " (cu ft)" : " (m³)") : "";
        const base = (name.trim() || "Value").slice(0, MAX_FIELD_NAME - unit.length - 4) + unit;
        let field = base;
        for (let n = 2; taken.has(field.toLowerCase()); n++) field = `${base} ${n}`;
        taken.add(field.toLowerCase());
        names.set(name, field);
        fields.push({ name: field, kind: FIELD_KIND[kind], value: blank(kind) });
      }
      formats.set(set, { index: named(set.slice(0, MAX_FIELD_NAME - 4), (n) => s.createRecordFormat(n, fields)), kinds, names });
    }
    /** the records the objects made wait for, attached at the end in one change */
    const records: { id: string; format: number; fields: Record<string, RecordValue> }[] = [];
    const carry = (id: string, properties: PropertySets): void => {
      for (const [set, props] of Object.entries(properties)) {
        const f = formats.get(set);
        if (!f) continue;
        const fields: Record<string, RecordValue> = {};
        for (const p of props) if (f.kinds.get(p.name) === p.kind) fields[f.names.get(p.name)!] = fieldValue(p, ftin);
        records.push({ id, format: f.index, fields });
      }
    };

    progress?.("Making the walls");
    // each wall's openings: a hole in its elevation, along its line from its start and up from its
    // foot, for each of its doors and windows and each its file cuts out of it
    const holes = new Map<number, Pt[][]>();
    model.walls.forEach((w, k) => w.cutOuts?.length && holes.set(k, [...w.cutOuts]));
    for (const o of model.openings) {
      const w = o.wall !== undefined ? model.walls[o.wall] : undefined;
      if (!w) continue;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      if (!(len > 0 && o.width > 0 && o.height > 0)) continue;
      const along = ((o.at.x - w.start.x) * (w.end.x - w.start.x) + (o.at.y - w.start.y) * (w.end.y - w.start.y)) / len;
      const [x0, x1, y0, y1] = [along - o.width / 2, along + o.width / 2, o.sill - w.bottom, o.sill - w.bottom + o.height];
      (holes.get(o.wall!) ?? holes.set(o.wall!, []).get(o.wall!)!).push([
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]);
    }
    // a storey's walls in one change
    const wallsOn = new Map<number, number[]>();
    model.walls.forEach((w, k) => (wallsOn.get(w.storey) ?? wallsOn.set(w.storey, []).get(w.storey)!).push(k));
    let walls = 0;
    for (const [storey, list] of wallsOn) {
      const at = elevation(storey);
      const specs: PlainWallSpec[] = list.map((k) => {
        const w = model.walls[k];
        return { start: w.start, end: w.end, thickness: w.thickness, bottom: w.bottom - at, top: w.bottom - at + w.height, classIndex: classOf(w.category), openings: holes.get(k) };
      });
      const make = (some: PlainWallSpec[]): string[] => {
        try {
          return s.addPlainWalls(layerOf(storey), some);
        } catch {
          // one wall it can't make: the rest one at a time, so only that one is lost
          return some.map((spec) => {
            try {
              return s.addPlainWalls(layerOf(storey), [spec])[0];
            } catch {
              return "";
            }
          });
        }
      };
      const ids = make(specs);
      // a wall its openings leave nothing of (one that only holds a door or window its own size)
      // stands uncut, as it did before walls were cut, rather than be lost with its records
      const whole = ids.flatMap((id, j) => (!id && specs[j].openings?.length ? [j] : []));
      if (whole.length) make(whole.map((j) => ({ ...specs[j], openings: undefined }))).forEach((id, k) => (ids[whole[k]] = id));
      ids.forEach((id, j) => {
        if (!id) return fail("walls");
        carry(id, model.walls[list[j]].properties);
        walls++;
      });
    }

    progress?.("Making the floors");
    let slabs = 0;
    const oneFloor = (f: Slab): void => {
      try {
        const outline = s.addObject(layerOf(f.storey), { kind: "polygon", points: f.outline, closed: true }, classOf(f.category));
        const [id] = s.extrudeObjects([outline], f.thickness);
        s.moveObjects3D([id], 0, 0, f.bottom - elevation(f.storey));
        carry(id, f.properties);
        slabs++;
      } catch {
        fail("floors");
      }
    };
    // a storey's floors of one category in a few changes (a change rebuilds the drawing): their
    // outlines at once, an extrude per thickness, a move per foot. A group that doesn't come out one
    // for one is taken away again and made a floor at a time.
    const floorGroups = new Map<string, Slab[]>();
    for (const f of model.slabs) {
      const key = `${f.storey}/${f.category}`;
      (floorGroups.get(key) ?? floorGroups.set(key, []).get(key)!).push(f);
    }
    for (const group of floorGroups.values()) {
      const { storey, category } = group[0];
      const made: string[] = [];
      let outlines: string[] = [];
      try {
        outlines = s.addObjects(
          layerOf(storey),
          group.map((f) => ({ kind: "polygon", points: f.outline, closed: true })),
          classOf(category),
        );
        if (outlines.length !== group.length) throw new Error("not an outline per floor");
        const solids: string[] = [];
        const byThickness = new Map<number, number[]>();
        group.forEach((f, k) => (byThickness.get(f.thickness) ?? byThickness.set(f.thickness, []).get(f.thickness)!).push(k));
        for (const [thickness, ks] of byThickness) {
          // extrudeObjects keeps the order it is given and skips what it can't extrude
          const ids = s.extrudeObjects(
            ks.map((k) => outlines[k]),
            thickness,
          );
          made.push(...ids);
          if (ids.length !== ks.length) throw new Error("not an extrude per outline");
          ks.forEach((k, j) => (solids[k] = ids[j]));
        }
        const byFoot = new Map<number, string[]>();
        group.forEach((f, k) => {
          const dz = f.bottom - elevation(storey);
          (byFoot.get(dz) ?? byFoot.set(dz, []).get(dz)!).push(solids[k]);
        });
        for (const [dz, ids] of byFoot) if (dz) s.moveObjects3D(ids, 0, 0, dz);
        group.forEach((f, k) => carry(solids[k], f.properties));
        slabs += group.length;
      } catch {
        // the extrudes first (an extruded outline went inside its extrude), then any outline left
        for (const id of [...made, ...outlines])
          try {
            s.deleteObjects([id]);
          } catch {
            // already gone with its extrude
          }
        group.forEach(oneFloor);
      }
    }

    progress?.("Making the other elements");
    type Item = (BuildingModel["openings"][number] | BuildingModel["objects"][number]) & { opening: boolean };
    const items: Item[] = [...model.openings.map((o) => ({ ...o, opening: true })), ...model.objects.map((o) => ({ ...o, opening: false }))];
    const partsOf = (bodies: readonly Body[]) => ({
      parts: bodies.map((b) => b.faces),
      attrs: bodies.map((b) => (b.color ? solid(colorOf(b.color), b.box) : b.box ? { fillOpacity: SEE_THROUGH } : undefined)),
    });
    // elements of one type whose bodies are alike in their own frames: a symbol for two or more. A
    // reader doesn't always know how an instance is turned, that it is flipped, or quite where its
    // origin is, and cuts each one's faces into triangles its own way: so elements are compared by
    // their corners and areas, from the corner of their box, each also tried a quarter turn round,
    // square to its wall, and mirrored.
    const placed = new Map<Item, { symbol: number; frame: Frame }>();
    let symbols = 0;
    type Variant = { bodies: Body[]; shape: string; areas: number[]; corners: number[][]; members: { item: Item; frame: Frame }[] };
    const kinds = new Map<string, Variant[]>();
    for (const item of items) {
      if (!item.typeKey || !item.placement || !item.bodies.length || item.bodies.some((b) => b.box || !b.faces.length)) continue;
      const variants = kinds.get(item.typeKey) ?? kinds.set(item.typeKey, []).get(item.typeKey)!;
      const shape = shapeOf(item.bodies);
      const areas = item.bodies.map(areaOf);
      const own: Frame = { ...item.placement, mirror: false };
      const w = item.opening && "wall" in item && item.wall !== undefined ? model.walls[item.wall] : undefined;
      const square = w ? Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x) : undefined;
      const like = variants.filter((v) => v.shape === shape && v.areas.every((x, k) => Math.abs(x - areas[k]) <= ALIKE * Math.sqrt(x) + 1));
      let found = false;
      if (like.length)
        for (const turned of framesOf(own, square)) {
          const { frame, corners } = cornersOf(item.bodies, turned);
          const same = like.find((v) => alikeCorners(v.corners, corners));
          if (same) {
            same.members.push({ item, frame });
            found = true;
            break;
          }
        }
      if (!found) {
        const { frame, corners } = cornersOf(item.bodies, own);
        variants.push({ bodies: ownBodies(item.bodies, frame), shape, areas, corners, members: [{ item, frame }] });
      }
    }
    const repeated = [...kinds].flatMap(([key, variants]) => variants.filter((v) => v.members.length > 1).map((v) => ({ key, ...v })));
    if (repeated.length) {
      try {
        const indexes = s.addMeshSymbols(repeated.map((v) => ({ name: v.key, ...partsOf(v.bodies), classIndex: classOf(v.members[0].item.category) })));
        repeated.forEach((v, k) => v.members.forEach(({ item, frame }) => placed.set(item, { symbol: indexes[k], frame })));
        symbols = indexes.length;
      } catch {
        // each made as its own meshes instead
      }
    }
    // a storey's elements in one change (a change rebuilds the drawing, so a big model takes few)
    const byStorey = new Map<number, Item[]>();
    for (const item of items) (byStorey.get(item.storey) ?? byStorey.set(item.storey, []).get(item.storey)!).push(item);
    let openings = 0;
    let objects = 0;
    for (const [storey, list] of byStorey) {
      const dz = elevation(storey);
      const elements = list.map((item): MeshElement => {
        const instance = placed.get(item);
        const classIndex = classOf(item.category);
        if (instance) {
          const { at, turn, mirror } = instance.frame;
          const [c, n, m] = [Math.cos(turn), Math.sin(turn), mirror ? -1 : 1];
          // its own x axis (backwards when it is mirrored), y and z, then where its origin lies
          return { symbol: instance.symbol, matrix: [m * c, m * n, 0, -n, c, 0, 0, 0, 1, at.x, at.y, at.z - dz], classIndex };
        }
        const bodies = item.bodies.filter((b) => b.faces.length);
        const { parts, attrs } = partsOf(bodies);
        return { parts: parts.map((faces) => faces.map((f) => f.map((v, i) => (i % 3 === 2 ? v - dz : v)))), attrs, classIndex };
      });
      let ids: string[];
      try {
        ids = s.addMeshElements(layerOf(storey), elements);
      } catch {
        ids = list.map(() => "");
      }
      ids.forEach((id, k) => {
        const item = list[k];
        if (!id) return fail(item.opening ? "doors or windows" : "other elements");
        carry(id, item.properties);
        if (item.opening) openings++;
        else objects++;
      });
    }

    progress?.("Drawing the plans");
    let drawing = 0;
    const sheets = new Map<string, { storey: number; category: number; shapes: NewShape[]; attrs: (Partial<Attributes> | undefined)[] }>();
    for (const d of model.drawing) {
      const key = `${d.storey}/${d.category}`;
      const sheet = sheets.get(key) ?? sheets.set(key, { storey: d.storey, category: d.category, shapes: [], attrs: [] }).get(key)!;
      sheet.shapes.push(d.shape);
      sheet.attrs.push(d.attrs);
    }
    for (const { storey, category, shapes, attrs } of sheets.values()) {
      try {
        drawing += s.addObjects(layerOf(storey), shapes, classOf(category), attrs).length;
      } catch {
        // one shape it can't make: the rest one at a time, so only that one is lost
        shapes.forEach((shape, k) => {
          try {
            s.addObject(layerOf(storey), shape, classOf(category), attrs[k]);
            drawing++;
          } catch {
            fail("2D objects");
          }
        });
      }
    }

    progress?.("Attaching the parameters");
    if (records.length) s.attachRecords(records);
    return { layers, walls, slabs, openings, objects, symbols, drawing, failed };
  });
}

/** Where an element's own frame lies: its origin and turn, and whether its own x runs backwards (a flipped door). */
type Frame = Placement & { mirror: boolean };

/** The frames an element might stand in: its own first, then a quarter turn round from it and square to its wall, each also mirrored. */
function* framesOf(own: Frame, square: number | undefined): Generator<Frame> {
  const turns = [own.turn];
  for (const from of square === undefined ? [own.turn] : [own.turn, square])
    for (let k = 0; k < 4; k++) {
      const t = from + (k * Math.PI) / 2;
      if (!turns.some((u) => Math.abs(Math.atan2(Math.sin(t - u), Math.cos(t - u))) < 1e-6)) turns.push(t);
    }
  for (const mirror of [false, true]) for (const turn of turns) yield { at: own.at, turn, mirror };
}

/** Bodies in an element's own frame: placed at its origin, turned back by its turn, and mirrored back when it is. */
function ownBodies(bodies: readonly Body[], { at, turn, mirror }: Frame): Body[] {
  const [c, n, m] = [Math.cos(turn), Math.sin(turn), mirror ? -1 : 1];
  return bodies.map((b) => ({
    ...b,
    faces: b.faces.map((f) => {
      const out = new Array<number>(f.length);
      for (let k = 0; k + 2 < f.length; k += 3) {
        const [dx, dy] = [f[k] - at.x, f[k + 1] - at.y];
        out[k] = m * (dx * c + dy * n);
        out[k + 1] = dy * c - dx * n;
        out[k + 2] = f[k + 2] - at.z;
      }
      return out;
    }),
  }));
}

/** Bodies' faces counted, and their colours: those alike share it. */
function shapeOf(bodies: readonly Body[]): string {
  return bodies.map((b) => `${b.faces.length}${b.color ? `#${b.color.r},${b.color.g},${b.color.b}` : ""}`).join("|");
}

/** A body's area (mm²): its faces' summed, each by its corners (Newell's). */
function areaOf(body: Body): number {
  let sum = 0;
  for (const f of body.faces) {
    let [x, y, z] = [0, 0, 0];
    for (let k = 0; k + 2 < f.length; k += 3) {
      const j = (k + 3) % f.length;
      x += (f[k + 1] - f[j + 1]) * (f[k + 2] + f[j + 2]);
      y += (f[k + 2] - f[j + 2]) * (f[k] + f[j]);
      z += (f[k] - f[j]) * (f[k + 1] + f[j + 1]);
    }
    sum += Math.hypot(x, y, z) / 2;
  }
  return sum;
}

/** How far apart two elements' corners may lie and the elements still be one symbol (mm): readers' geometry is often single precision. */
const ALIKE = 1;

/**
 * Each body's corners in `frame`, unrepeated and in order, from the corner of the element's box,
 * and the frame moved there: what elements alike share however their faces are cut.
 */
function cornersOf(bodies: readonly Body[], frame: Frame): { frame: Frame; corners: number[][] } {
  const { at, turn, mirror } = frame;
  const [c, n, m] = [Math.cos(turn), Math.sin(turn), mirror ? -1 : 1];
  const lo = [Infinity, Infinity, Infinity];
  const own = bodies.map((b) => {
    const out: number[] = [];
    for (const f of b.faces)
      for (let k = 0; k + 2 < f.length; k += 3) {
        const [dx, dy] = [f[k] - at.x, f[k + 1] - at.y];
        const p = [m * (dx * c + dy * n), dy * c - dx * n, f[k + 2] - at.z];
        p.forEach((v, i) => (lo[i] = Math.min(lo[i], v)));
        out.push(...p);
      }
    return out;
  });
  const corners = own.map((pts) => {
    const unique = new Map<string, number[]>();
    for (let k = 0; k < pts.length; k += 3) {
      const p = [pts[k] - lo[0], pts[k + 1] - lo[1], pts[k + 2] - lo[2]];
      unique.set(p.map(Math.round).join(","), p);
    }
    return [...unique]
      .sort(([, a], [, b]) => Math.round(a[0]) - Math.round(b[0]) || Math.round(a[1]) - Math.round(b[1]) || Math.round(a[2]) - Math.round(b[2]))
      .flatMap(([, p]) => p);
  });
  // the box's corner, back in the world: the element's own x (backwards when mirrored) and y turned
  const origin = { x: at.x + m * lo[0] * c - lo[1] * n, y: at.y + m * lo[0] * n + lo[1] * c, z: at.z + lo[2] };
  return { frame: { at: origin, turn, mirror }, corners };
}

/** True when two elements' corners, body by body, lie within ALIKE of each other. */
function alikeCorners(a: readonly number[][], b: readonly number[][]): boolean {
  return a.length === b.length && a.every((x, i) => x.length === b[i].length && x.every((v, k) => Math.abs(v - b[i][k]) <= ALIKE));
}

/** A property's value as its field holds it: areas in m² or square feet, volumes in m³ or cubic feet. */
function fieldValue(p: Property, ftin: boolean): RecordValue {
  if (typeof p.value !== "number") return p.value;
  if (p.kind === "area") return p.value / (ftin ? 304.8 ** 2 : 1e6);
  if (p.kind === "volume") return p.value / (ftin ? 304.8 ** 3 : 1e9);
  return p.value;
}

/** A field's empty value. */
function blank(kind: Property["kind"]): RecordValue {
  return kind === "text" ? "" : kind === "boolean" ? false : 0;
}

/** How opaque a body is that is only its element's box, %. */
const SEE_THROUGH = 35;

function solid(c: number, box = false): Partial<Attributes> {
  return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: box ? SEE_THROUGH : 100 };
}

/** What `make` makes named `name`, or "name 2" and on when the drawing has the name already (layers, classes, stories and formats share names). */
function named<T>(name: string, make: (name: string) => T): T {
  const base = name.trim() || "Unnamed";
  for (let n = 1; ; n++) {
    try {
      return make(n === 1 ? base : `${base} ${n}`);
    } catch (err) {
      if (!/already/.test(String(err)) || n > 999) throw err;
    }
  }
}

/** The drawing's colour index for each colour the model uses: its own where it has it exactly, else one added to its colours (one change for them all). */
function exactColors(s: EditSession, model: BuildingModel): (c: Rgb) => number {
  const hex = (c: Rgb): string => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
  const used = new Set<string>();
  for (const c of model.categories) if (c.color) used.add(hex(c.color));
  for (const o of [...model.openings, ...model.objects]) for (const b of o.bodies) if (b.color) used.add(hex(b.color));
  const css = [...used];
  const indices = css.length ? s.addColors(css) : [];
  const index = new Map(css.map((c, k) => [c, indices[k]]));
  return (c) => index.get(hex(c)) ?? s.addColors([hex(c)])[0];
}
