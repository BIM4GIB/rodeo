// A Revit model, as rvt-rs reads it (rvtModel.ts), turned into the building model Rodeo imports
// (building.ts). rvt-rs places each element at its location (the middle of its plan box, at its
// foot), turned by its rotation about z, with a profile centred there and extruded up its height:
// a wall's profile runs its length along the wall (the longer side when its line wasn't decoded and
// only its box was) and its thickness across it, a floor's is its outline. Walls and floors become
// Rodeo's walls and slabs from those; everything else (and a wall or floor rvt-rs gives a body
// of another shape: curved, tapered, sloped) takes its body from rvt-rs's glTF, which draws each
// element's as rvt-rs's IFC export does. Rooms become their outline and name in plan. What rvt-rs
// couldn't decode is drawn as the element's box, see-through, and the notes say how many. An RPC
// tree, person or car (Revit's photo entourage, which keeps no geometry for it) is drawn as a plain
// trunk and crown, figure or car body filling its box instead, so a site's trees don't hide the
// building in 3D.

import type { Pt } from "../core/types.ts";
import type { Body, BuildingModel, BuildingObject, Category, Component, Material, Opening, Property, PropertySets, Rgb, Slab, Wall } from "./building.ts";
import { parseGltf } from "./mesh.ts";
import type { RvtEntity, RvtPropertySet, RvtRead, RvtValue } from "./rvtModel.ts";

const FT = 304.8;

/** Revit's categories, by the IFC class rvt-rs files an element under (and the predefined type where it splits one). */
const CATEGORIES: Readonly<Record<string, string>> = {
  IFCWALL: "Walls",
  IFCCURTAINWALL: "Curtain Walls",
  IFCSLAB: "Floors",
  "IFCSLAB.ROOF": "Roofs",
  "IFCSLAB.LANDING": "Stairs",
  IFCROOF: "Roofs",
  IFCDOOR: "Doors",
  IFCWINDOW: "Windows",
  IFCCOLUMN: "Columns",
  IFCBEAM: "Structural Framing",
  IFCMEMBER: "Curtain Wall Mullions",
  IFCPLATE: "Curtain Panels",
  IFCFOOTING: "Structural Foundations",
  IFCSTAIR: "Stairs",
  IFCSTAIRFLIGHT: "Stairs",
  IFCRAMP: "Ramps",
  IFCRAILING: "Railings",
  IFCCOVERING: "Ceilings",
  IFCFURNITURE: "Furniture",
  IFCSANITARYTERMINAL: "Plumbing Fixtures",
  IFCWASTETERMINAL: "Plumbing Fixtures",
  IFCLIGHTFIXTURE: "Lighting Fixtures",
  IFCELECTRICAPPLIANCE: "Electrical Equipment",
  IFCAIRTERMINAL: "Air Terminals",
  IFCDUCTSEGMENT: "Ducts",
  IFCDUCTFITTING: "Duct Fittings",
  IFCPIPESEGMENT: "Pipes",
  IFCPIPEFITTING: "Pipe Fittings",
  IFCFIRESUPPRESSIONTERMINAL: "Sprinklers",
  IFCALARM: "Fire Alarm Devices",
  IFCTRANSPORTELEMENT: "Elevators",
  IFCSHADINGDEVICE: "Shading Devices",
  IFCREINFORCINGBAR: "Structural Rebar",
  IFCSPACE: "Rooms",
  IFCBUILDINGELEMENTPROXY: "Generic Models",
};

/** rvt-rs's own notes on how it read an element, which aren't the element's parameters. */
const READING_NOTE = /(Source|Resolved|Stream)$|^Join|ElementId$|^BoundingBox|^RevitClass$/;

/** How far a wall's box may be thicker than its own thickness before it is taken to run on a slant inside it, ft. */
const SLANT_SLACK = 0.1;

export function revitBuilding(read: RvtRead, fileName: string): BuildingModel {
  const { model } = read;
  const ents = model.entities;
  const notes: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };

  const storeys = (model.building_storeys.length ? model.building_storeys : [{ name: "Level 1", elevation_feet: 0 }]).map((s, i) => ({ name: s.name || `Level ${i + 1}`, elevation: s.elevation_feet * FT, from: i }));
  storeys.sort((a, b) => a.elevation - b.elevation);
  const storeyOf = new Map(storeys.map((s, i) => [s.from, i]));
  /** an element's storey: its own, else the highest at or below its foot */
  const storey = (e: RvtEntity, z: number): number => {
    const own = e.storey_index != null ? storeyOf.get(e.storey_index) : undefined;
    if (own !== undefined) return own;
    let best = 0;
    storeys.forEach((s, i) => {
      if (s.elevation <= z + 1) best = i;
    });
    return best;
  };

  const materials: Material[] = model.materials.map((m) => ({
    name: m.name,
    ...(m.color_packed != null ? { color: packed(m.color_packed) } : {}),
    ...(m.transparency ? { transparency: Math.min(1, Math.max(0, m.transparency)) } : {}),
  }));

  const categories: Category[] = [];
  const categoryIndex = new Map<string, number>();
  const category = (e: RvtEntity): number => {
    const ifc = e.ifc_type ?? "";
    const name = CATEGORIES[`${ifc}.${e.predefined_type ?? ""}`] ?? CATEGORIES[ifc] ?? (ifc ? title(ifc.replace(/^IFC/, "")) : "Other");
    let i = categoryIndex.get(name);
    if (i === undefined) {
      i = categories.length;
      categories.push({ name });
      categoryIndex.set(name, i);
    }
    return i;
  };

  // the element's parameters, and the IFC property sets rvt-rs files for it
  const extraSets = new Map<number, RvtPropertySet[]>();
  for (const e of ents) if (e.kind === "ElementPropertySet" && e.element !== undefined && e.set) (extraSets.get(e.element) ?? extraSets.set(e.element, []).get(e.element)!).push(e.set);
  const propertiesOf = (e: RvtEntity, i: number): PropertySets => {
    const sets: PropertySets = {};
    const [family, type, id] = splitName(e.name ?? "");
    const revit: Property[] = [];
    if (family) revit.push({ name: "Family", kind: "text", value: family });
    if (type) revit.push({ name: "Type", kind: "text", value: type });
    if (id) revit.push({ name: "Element ID", kind: "integer", value: Number(id) });
    for (const p of e.property_set?.properties ?? []) {
      if (READING_NOTE.test(p.name) || p.name === "FamilyName" || p.name === "TypeName") continue;
      const v = property(p.name, p.value);
      if (v) revit.push(v);
    }
    if (revit.length) sets.Revit = revit;
    // IFC's own sets keep their names; Revit's parameter groups ("Constraints", "Phasing") say they are Revit's
    for (const s of extraSets.get(i) ?? []) {
      const props = s.properties.map((p) => property(p.name, p.value)).filter((p) => p !== null);
      const name = /^(Pset|Qto)_/.test(s.name) ? s.name : `Revit ${s.name}`;
      if (props.length) sets[name] = [...(sets[name] ?? []), ...props];
    }
    return sets;
  };

  // each element's body as rvt-rs draws it: glTF metres, y up, into mm, z up
  const bodies = new Map<number, Body[]>();
  for (const part of parseGltf(read.glb, Number.MAX_SAFE_INTEGER).parts) {
    const index = (part.extras as { entityIndex?: number } | undefined)?.entityIndex;
    if (index === undefined || !part.faces.length) continue;
    const faces = part.faces.map((f) => {
      const out = new Array<number>(f.length);
      for (let k = 0; k < f.length; k += 3) {
        out[k] = f[k] * 1000;
        out[k + 1] = -f[k + 2] * 1000;
        out[k + 2] = f[k + 1] * 1000;
      }
      return out;
    });
    (bodies.get(index) ?? bodies.set(index, []).get(index)!).push({ faces, ...(part.color ? { color: part.color } : {}) });
  }

  const walls: Wall[] = [];
  const wallOf = new Map<number, number>();
  const slabs: Slab[] = [];
  const openings: Opening[] = [];
  /** each opening's host as rvt-rs gives it, an entity index */
  const hostOf: (number | undefined)[] = [];
  const objects: BuildingObject[] = [];
  const drawing: BuildingModel["drawing"] = [];
  let boxes = 0;
  const standIns = { tree: 0, person: 0, vehicle: 0 };
  const flights = ents.some((e) => e.ifc_type === "IFCSTAIRFLIGHT");

  ents.forEach((e, i) => {
    if (e.kind !== "BuildingElement") return;
    const props = e.property_set?.properties ?? [];
    const source = props.find((p) => p.name === "BodySource")?.value.value;
    // a floor or ceiling drawn from its sketch profile keeps the record box's BodySource
    const profiled = props.some((p) => p.name === "ProfileResolved" && p.value.value === true);
    const loc = e.location_feet;
    const z = (loc?.[2] ?? 0) * FT;
    const base = {
      storey: storey(e, z),
      category: category(e),
      name: "",
      type: splitName(e.name ?? "")[1],
      properties: propertiesOf(e, i),
      ...(e.material_index != null && materials[e.material_index] ? { material: e.material_index } : {}),
    };
    // a room is drawn as its outline and name, never as its box
    const boxed = typeof source === "string" && /bbox|box/.test(source) && !profiled && e.ifc_type !== "IFCSPACE";
    if (boxed) boxes++;
    const ex = e.extrusion;
    const turn = e.rotation_radians ?? 0;
    const placed = (x: number, y: number): Pt => ({
      x: ((loc?.[0] ?? 0) + x * Math.cos(turn) - y * Math.sin(turn)) * FT,
      y: ((loc?.[1] ?? 0) + x * Math.sin(turn) + y * Math.cos(turn)) * FT,
    });

    if (e.ifc_type === "IFCWALL" && ex && loc && !e.solid_shape && !/arc|tapered/.test(String(source))) {
      // along the profile's longer side, through the middle; a box much thicker than the wall holds a slanted one
      const alongX = ex.width_feet >= ex.depth_feet;
      const length = Math.max(ex.width_feet, ex.depth_feet);
      const across = Math.min(ex.width_feet, ex.depth_feet);
      const own = e.property_set?.properties.find((p) => p.name === "Thickness")?.value.value;
      const thickness = typeof own === "number" && own > 0 ? own : across;
      if (across <= thickness + SLANT_SLACK && length > 0 && thickness > 0) {
        const half = length / 2;
        wallOf.set(i, walls.length);
        walls.push({
          ...base,
          start: alongX ? placed(-half, 0) : placed(0, -half),
          end: alongX ? placed(half, 0) : placed(0, half),
          thickness: thickness * FT,
          bottom: z,
          height: ex.height_feet * FT,
          ...componentsOf(e, model.material_layer_sets, thickness),
        });
        return;
      }
    }

    if (e.ifc_type === "IFCSLAB" && ex && loc && !e.solid_shape && e.predefined_type !== "ROOF") {
      const outline = profileOutline(ex.profile_override, ex.width_feet, ex.depth_feet);
      if (outline) {
        slabs.push({ ...base, outline: outline.map(([x, y]) => placed(x, y)), bottom: z, thickness: ex.height_feet * FT, ...componentsOf(e, model.material_layer_sets, ex.height_feet) });
        return;
      }
    }

    if (e.ifc_type === "IFCSPACE") {
      // a room: its outline in plan (its profile, else the box round its body) and its name, not a body filling it
      const profile = ex && loc ? profileOutline(ex.profile_override, ex.width_feet, ex.depth_feet) : null;
      const b = bodies.get(i);
      const box = b ? planBox(b) : null;
      const outline = profile
        ? profile.map(([x, y]) => placed(x, y))
        : box && [
            { x: box.x0, y: box.y0 },
            { x: box.x1, y: box.y0 },
            { x: box.x1, y: box.y1 },
            { x: box.x0, y: box.y1 },
          ];
      if (outline) {
        const name = roomName(e, extraSets.get(i));
        drawing.push({ storey: base.storey, category: base.category, shape: { kind: "polygon", points: outline, closed: true } });
        if (name) drawing.push({ storey: base.storey, category: base.category, shape: { kind: "text", at: placed(0, 0), text: name, height: 250 } });
      } else skip("rooms without an outline");
      return;
    }

    // an opening is the hole in its host, not a body of its own
    if (e.ifc_type === "IFCOPENINGELEMENT") return;
    const kind = boxed ? entourage(e.name ?? "", ex) : null;
    const stood =
      kind === "tree"
        ? standInTree(bodies.get(i) ?? [])
        : kind && ex && loc
          ? (kind === "person" ? standInPerson : standInCar)(ex.width_feet * FT, ex.depth_feet * FT, ex.height_feet * FT).map((b) => ({
              ...b,
              faces: b.faces.map((f) => {
                const out: number[] = [];
                for (let k = 0; k < f.length; k += 3) {
                  const at = placed(f[k] / FT, f[k + 1] / FT);
                  out.push(at.x, at.y, z + f[k + 2]);
                }
                return out;
              }),
            }))
          : null;
    if (stood && kind) {
      boxes--;
      standIns[kind]++;
    }
    const own = stood ?? (boxed ? bodies.get(i)?.map((b) => ({ ...b, box: true })) : bodies.get(i));
    if (!own?.length) {
      // curtain walls are drawn by their panels and mullions, and a stair by its flights and landings
      if (e.ifc_type !== "IFCCURTAINWALL" && !(e.ifc_type === "IFCSTAIR" && flights)) skip(`${categories[base.category].name.toLowerCase()} without a body`);
      return;
    }

    // its family and type, and where its own frame lies, so those alike can be one symbol
    const [family, type] = splitName(e.name ?? "");
    const typeKey = [family, type].filter(Boolean).join(": ");
    const typed = typeKey && loc && !boxed ? { typeKey, placement: { at: { x: loc[0] * FT, y: loc[1] * FT, z }, turn } } : {};
    if ((e.ifc_type === "IFCDOOR" || e.ifc_type === "IFCWINDOW") && ex && loc) {
      hostOf.push(e.host_element_index ?? undefined);
      openings.push({ ...base, ...typed, kind: e.ifc_type === "IFCDOOR" ? "door" : "window", at: placed(0, 0), width: ex.width_feet * FT, height: ex.height_feet * FT, sill: z, bodies: own });
      return;
    }
    objects.push({ ...base, ...typed, bodies: own });
  });

  // a door or window in a wall: the opening it cuts, which is what of its body lies within the
  // wall's thickness (its frame; not the trim on the wall's faces, nor a sill jutting out below)
  openings.forEach((o, k) => {
    const host = hostOf[k];
    const w = host !== undefined ? wallOf.get(host) : undefined;
    if (w === undefined) return;
    const wall = walls[w];
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const u = { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len };
    let a0 = Infinity;
    let a1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const b of o.bodies)
      for (const f of b.faces)
        for (let i = 0; i < f.length; i += 3) {
          const dx = f[i] - wall.start.x;
          const dy = f[i + 1] - wall.start.y;
          if (Math.abs(dy * u.x - dx * u.y) > wall.thickness / 2 + 1) continue;
          const along = dx * u.x + dy * u.y;
          a0 = Math.min(a0, along);
          a1 = Math.max(a1, along);
          z0 = Math.min(z0, f[i + 2]);
          z1 = Math.max(z1, f[i + 2]);
        }
    // else as rvt-rs sizes it, about its middle
    if (!(a1 > a0 && z1 > z0)) {
      const along = (o.at.x - wall.start.x) * u.x + (o.at.y - wall.start.y) * u.y;
      [a0, a1, z0, z1] = [along - o.width / 2, along + o.width / 2, o.sill, o.sill + o.height];
    }
    o.wall = w;
    o.at = { x: wall.start.x + u.x * ((a0 + a1) / 2), y: wall.start.y + u.y * ((a0 + a1) / 2) };
    o.width = a1 - a0;
    o.sill = z0;
    o.height = z1 - z0;
  });

  // a wall's edited elevation profile: the holes it cuts, outlines in the wall's plane along its
  // axis from where the wall is placed (its middle) and up from its foot
  for (const e of ents) {
    const w = e.kind === "WallProfileOpening" && e.host !== undefined ? wallOf.get(e.host) : undefined;
    const placed = e.host !== undefined ? ents[e.host].location_feet : undefined;
    if (w === undefined || !placed || !e.outline_feet || e.outline_feet.length < 3) continue;
    const wall = walls[w];
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const u = { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len };
    const turn = (ents[e.host!].rotation_radians ?? 0) + (e.axis_turn_radians ?? 0);
    // its axis along the wall's line, either way; across it the outline isn't the wall's
    const way = Math.cos(turn) * u.x + Math.sin(turn) * u.y;
    if (Math.abs(Math.abs(way) - 1) > 1e-3) continue;
    const from = (placed[0] * FT - wall.start.x) * u.x + (placed[1] * FT - wall.start.y) * u.y;
    (wall.cutOuts ??= []).push(e.outline_feet.map(([a, z]) => ({ x: from + Math.sign(way) * a * FT, y: z * FT })));
  }

  if (boxes) notes.push(`${boxes.toLocaleString()} element${boxes === 1 ? " is" : "s are"} drawn as ${boxes === 1 ? "its" : "their"} bounding box${boxes === 1 ? "" : "es"}, see-through: Revit's geometry for ${boxes === 1 ? "it" : "them"} isn't decoded yet`);
  const { tree: trees, person: people, vehicle: vehicles } = standIns;
  if (trees) notes.push(`${trees.toLocaleString()} RPC tree${trees === 1 ? " is" : "s are"} drawn as a plain trunk and crown, their size: Revit keeps no model of ${trees === 1 ? "it" : "them"}`);
  if (people) notes.push(`${people.toLocaleString()} RPC ${people === 1 ? "person is" : "people are"} drawn as a plain figure, ${people === 1 ? "its" : "their"} size: Revit keeps no model of ${people === 1 ? "it" : "them"}`);
  if (vehicles) notes.push(`${vehicles.toLocaleString()} RPC vehicle${vehicles === 1 ? " is" : "s are"} drawn as a plain car body, ${vehicles === 1 ? "its" : "their"} size: Revit keeps no model of ${vehicles === 1 ? "it" : "them"}`);
  for (const w of read.diagnostics.warnings ?? []) if (/not read whole|resource limit/i.test(w)) notes.push(w);

  return {
    name: model.project_name?.trim() || fileName.replace(/\.[^.]+$/, ""),
    units: imperial(ents) ? "ftin" : "mm",
    storeys: storeys.map(({ name, elevation }) => ({ name, elevation })),
    categories,
    materials,
    walls,
    slabs,
    openings,
    objects,
    drawing,
    skipped,
    notes,
  };
}

/** A Revit element's name, "Family:Type:id", in its parts ("" where it has none). */
function splitName(name: string): [string, string, string] {
  const parts = name.split(":");
  const id = parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1]) ? parts.pop()! : "";
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(":"), id];
  return ["", parts[0] ?? "", id];
}

/** True when the project's types are sized in feet and inches ("36\" x 84\"", "13 5/8\" Rainscreen") rather than millimetres: rvt-rs doesn't say which units the project shows. */
function imperial(ents: readonly RvtEntity[]): boolean {
  let inches = 0;
  let mm = 0;
  for (const e of ents) {
    if (e.kind !== "BuildingElement") continue;
    const type = splitName(e.name ?? "")[1];
    if (/\d"|\d'|\d+\/\d+"/.test(type)) inches++;
    else if (/\d\s?mm\b/i.test(type)) mm++;
  }
  return inches > mm;
}

/** A Revit colour as rvt-rs packs it: red in the low byte. */
function packed(c: number): Rgb {
  return { r: (c & 0xff) / 255, g: ((c >> 8) & 0xff) / 255, b: ((c >> 16) & 0xff) / 255 };
}

function title(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** A parameter as a property; lengths, areas and volumes from feet into mm. */
function property(name: string, v: RvtValue): Property | null {
  const k = v.kind;
  const value = v.value;
  if (typeof value === "boolean") return { name, kind: "boolean", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (/Length/i.test(k)) return { name, kind: "length", value: value * FT };
    if (/Area/i.test(k)) return { name, kind: "area", value: value * FT * FT };
    if (/Volume/i.test(k)) return { name, kind: "volume", value: value * FT * FT * FT };
    if (/Angle/i.test(k)) return { name, kind: "angle", value: /Radian/i.test(k) ? (value * 180) / Math.PI : value };
    if (/Integer|Count/i.test(k)) return { name, kind: "integer", value: Math.round(value) };
    return { name, kind: "number", value };
  }
  if (typeof value === "string") return value.trim() ? { name, kind: "text", value } : null;
  return null;
}

/** A profile's outline, around its own origin, ft. */
function profileOutline(p: unknown, width: number, depth: number): [number, number][] | null {
  const closed = (p as { ArbitraryClosed?: { points?: [number, number][] } } | null | undefined)?.ArbitraryClosed?.points;
  if (closed && closed.length >= 3) return closed;
  if (p && !(p as { Rectangle?: unknown }).Rectangle) return null;
  const w = (p as { Rectangle?: { width_feet: number; depth_feet: number } } | null)?.Rectangle?.width_feet ?? width;
  const d = (p as { Rectangle?: { width_feet: number; depth_feet: number } } | null)?.Rectangle?.depth_feet ?? depth;
  if (!(w > 0 && d > 0)) return null;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
}

/** A wall's or floor's layers when they add up to its thickness (ft), outside first. */
function componentsOf(e: RvtEntity, sets: { layers: { material_index: number; thickness_feet: number }[] }[], thickness: number): { components?: Component[] } {
  const set = e.material_layer_set_index != null ? sets[e.material_layer_set_index] : undefined;
  if (!set?.layers.length) return {};
  const sum = set.layers.reduce((s, l) => s + l.thickness_feet, 0);
  if (Math.abs(sum - thickness) > 0.01) return {};
  return { components: set.layers.map((l) => ({ material: l.material_index, thickness: l.thickness_feet * FT })) };
}

/** The plan box round some bodies' faces. */
function planBox(bodies: readonly Body[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bodies)
    for (const f of b.faces)
      for (let k = 0; k < f.length; k += 3) {
        x0 = Math.min(x0, f[k]);
        x1 = Math.max(x1, f[k]);
        y0 = Math.min(y0, f[k + 1]);
        y1 = Math.max(y1, f[k + 1]);
      }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** A room's name and number, as Revit shows them in a room tag. */
function roomName(e: RvtEntity, sets: RvtPropertySet[] | undefined): string {
  const ref = sets?.flatMap((s) => s.properties).find((p) => p.name === "Reference")?.value.value;
  if (typeof ref === "string" && ref.trim()) return ref.trim();
  return splitName(e.name ?? "")[1];
}

/** RPC entourage: Revit's photo trees, people and cars, which carry no geometry ("M_RPC" in metric
 * libraries; rvt-rs names one it has no type for "Entourage-<id>"). */
const RPC = /(^|[^a-z])RPC\b|^Entourage\b/i;
const RPC_TREE = /\b(tree|plant|shrub|bush|palm|conifer|deciduous|evergreen)/i;
const RPC_PERSON = /\b(male|female|man|woman|people|person|child|kid|boy|girl)\b/i;
const RPC_VEHICLE = /\b(beetle|car|truck|van|bus|suv|sedan|vehicle|jeep|taxi|lorry|pickup)\b/i;

/** What an RPC element stands for, from its name, else its box's shape (feet): a person stands
 * taller than wide, a vehicle is long and low. */
export function entourage(name: string, ex: { width_feet: number; depth_feet: number; height_feet: number } | null | undefined): "tree" | "person" | "vehicle" | null {
  if (!RPC.test(name)) return null;
  if (RPC_TREE.test(name)) return "tree";
  if (!ex) return null;
  if (RPC_PERSON.test(name)) return "person";
  if (RPC_VEHICLE.test(name)) return "vehicle";
  const [w, d, h] = [ex.width_feet, ex.depth_feet, ex.height_feet];
  if (h > 3.5 && h < 8 && Math.max(w, d) < h / 1.5) return "person";
  if (Math.max(w, d) > 8 && h < Math.max(w, d) / 2) return "vehicle";
  return null;
}

/** A prism up z between two heights, its plan a convex ring of (x, y) corners anticlockwise. */
function prism(ring: readonly (readonly [number, number])[], z0: number, z1: number): number[][] {
  const n = ring.length;
  const sides = ring.map(([x, y], k) => {
    const [u, v] = ring[(k + 1) % n];
    return [x, y, z0, u, v, z0, u, v, z1, x, y, z1];
  });
  return [[...ring].reverse().flatMap(([x, y]) => [x, y, z0]), ring.flatMap(([x, y]) => [x, y, z1]), ...sides];
}

/** An ellipse's corners about (cx, cy). */
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 10): [number, number][] =>
  Array.from({ length: n }, (_, k) => [cx + rx * Math.cos((2 * Math.PI * k) / n), cy + ry * Math.sin((2 * Math.PI * k) / n)]);

/** An RPC person as a plain figure filling its box (mm, about the box's foot): legs, a body and arms
 * as prisms, a head as a stack of rings. In the box's own frame, z up from its foot. */
export function standInPerson(w: number, d: number, h: number): Body[] {
  const s = Math.min(w, d, h / 2.4) / 2;
  const leg = h * 0.05;
  const clothes = [
    ...prism(ellipse(-leg * 1.2, 0, leg, leg * 1.1, 8), 0, h * 0.48),
    ...prism(ellipse(leg * 1.2, 0, leg, leg * 1.1, 8), 0, h * 0.48),
    ...prism(ellipse(0, 0, Math.min(s, h * 0.13), Math.min(s, h * 0.13) * 0.6), h * 0.46, h * 0.82),
    ...[-1, 1].flatMap((side) => prism(ellipse(side * Math.min(s, h * 0.13) * 1.2, 0, h * 0.035, h * 0.035, 6), h * 0.5, h * 0.8)),
  ];
  // the head: a sphere of rings about its middle
  const r = h * 0.065;
  const zc = h - r;
  const RINGS = 4;
  const rings = Array.from({ length: RINGS + 1 }, (_, j) => {
    const a = -Math.PI / 2 + (Math.PI * j) / RINGS;
    return ellipse(0, 0, r * Math.cos(a), r * Math.cos(a), 8).map(([x, y]) => [x, y, zc + r * Math.sin(a)]);
  });
  const head: number[][] = [];
  for (let j = 0; j < RINGS; j++)
    for (let k = 0; k < 8; k++) {
      const [a, b, c, e] = [rings[j][k], rings[j][(k + 1) % 8], rings[j + 1][(k + 1) % 8], rings[j + 1][k]];
      head.push(j === 0 ? [...a, ...c, ...e] : j === RINGS - 1 ? [...a, ...b, ...c] : [...a, ...b, ...c, ...e]);
    }
  return [
    { faces: clothes, color: { r: 0.36, g: 0.42, b: 0.52 } },
    { faces: head, color: { r: 0.78, g: 0.64, b: 0.52 } },
  ];
}

/** An RPC vehicle as a plain car filling its box (mm, about the box's foot), its length along x: a
 * body and a narrower cabin, each a side profile run across, on four wheels. */
export function standInCar(l: number, w: number, h: number): Body[] {
  // a convex side profile (x along the car, z up) run across y from -half to half
  const across = (profile: readonly (readonly [number, number])[], half: number): number[][] => {
    const n = profile.length;
    const sides = profile.map(([x, z], k) => {
      const [u, v] = profile[(k + 1) % n];
      return [x, half, z, u, half, v, u, -half, v, x, -half, z];
    });
    return [profile.flatMap(([x, z]) => [x, -half, z]), [...profile].reverse().flatMap(([x, z]) => [x, half, z]), ...sides];
  };
  const r = Math.min(h * 0.22, l * 0.12);
  const body = across(
    [[-l / 2, r * 0.9], [l / 2, r * 0.9], [l / 2, h * 0.45], [l * 0.45, h * 0.58], [-l * 0.45, h * 0.6], [-l / 2, h * 0.5]],
    w * 0.47,
  );
  const cabin = across([[l * 0.25, h * 0.58], [l * 0.05, h], [-l * 0.3, h], [-l * 0.42, h * 0.6]], w * 0.42);
  // a wheel: a ring in x-z run across y, at each corner
  const wheel = (cx: number, cy: number): number[][] =>
    across(ellipse(cx, r, r, r, 12), w * 0.07).map((f) => f.map((c, k) => (k % 3 === 1 ? c + cy : c)));
  const wheels = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => wheel(sx * l * 0.32, sy * w * 0.4)));
  return [
    { faces: [...body, ...cabin], color: { r: 0.55, g: 0.58, b: 0.62 } },
    { faces: wheels, color: { r: 0.18, g: 0.18, b: 0.2 } },
  ];
}

/** A plain tree filling the box round `bodies` (mm, z up): a trunk up the middle and a crown above it; null with no box. */
function standInTree(bodies: readonly Body[]): Body[] | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies)
    for (const f of b.faces)
      for (let k = 0; k < f.length; k++) {
        lo[k % 3] = Math.min(lo[k % 3], f[k]);
        hi[k % 3] = Math.max(hi[k % 3], f[k]);
      }
  const [w, d, h] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  if (!(w > 0 && d > 0 && h > 0)) return null;
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  const SIDES = 8;
  const ring = (rx: number, ry: number, z: number): number[][] =>
    Array.from({ length: SIDES }, (_, k) => [cx + rx * Math.cos((2 * Math.PI * k) / SIDES), cy + ry * Math.sin((2 * Math.PI * k) / SIDES), z]);
  // the trunk: an eighth of the crown's width, up to a third of the height
  const r = Math.max(75, Math.min(w, d) / 16);
  const top = lo[2] + h / 3;
  const foot = ring(r, r, lo[2]);
  const head = ring(r, r, top);
  const trunk = foot.map((p, k) => [...p, ...foot[(k + 1) % SIDES], ...head[(k + 1) % SIDES], ...head[k]]);
  // the crown: an ellipsoid from a quarter of the height up, its rings' corners joined in quads
  const zc = lo[2] + (h * 5) / 8;
  const rz = (h * 3) / 8;
  const RINGS = 6;
  const rings = Array.from({ length: RINGS + 1 }, (_, j) => {
    const a = -Math.PI / 2 + (Math.PI * j) / RINGS;
    return ring((w / 2) * Math.cos(a), (d / 2) * Math.cos(a), zc + rz * Math.sin(a));
  });
  const crown: number[][] = [];
  for (let j = 0; j < RINGS; j++)
    for (let k = 0; k < SIDES; k++) {
      const [a, b, c, e] = [rings[j][k], rings[j][(k + 1) % SIDES], rings[j + 1][(k + 1) % SIDES], rings[j + 1][k]];
      // the poles' rings are points: a triangle there
      crown.push(j === 0 ? [...a, ...c, ...e] : j === RINGS - 1 ? [...a, ...b, ...c] : [...a, ...b, ...c, ...e]);
    }
  return [
    { faces: trunk, color: { r: 0.42, g: 0.31, b: 0.2 } },
    { faces: crown, color: { r: 0.36, g: 0.55, b: 0.28 } },
  ];
}
