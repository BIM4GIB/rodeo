// A Revit model, as rvt-rs reads it (rvtModel.ts), turned into the building model Rodeo imports
// (building.ts). rvt-rs places each element at its location (the middle of its plan box, at its
// foot), turned by its rotation about z, with a profile centred there and extruded up its height:
// a wall's profile runs its length along the wall (the longer side when its line wasn't decoded and
// only its box was) and its thickness across it, a floor's is its outline. Walls and floors become
// Rodeo's walls and slabs from those; everything else (and a wall or floor rvt-rs gives a body
// of another shape: curved, tapered, sloped) takes its body from rvt-rs's glTF, which draws each
// element's as rvt-rs's IFC export does. Rooms become their outline and name in plan. What rvt-rs
// couldn't decode is drawn as the element's box, see-through, and the notes say how many.

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

  ents.forEach((e, i) => {
    if (e.kind !== "BuildingElement") return;
    const source = e.property_set?.properties.find((p) => p.name === "BodySource")?.value.value;
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
    const boxed = typeof source === "string" && /bbox|box/.test(source);
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
    const own = boxed ? bodies.get(i)?.map((b) => ({ ...b, box: true })) : bodies.get(i);
    if (!own?.length) {
      // curtain walls are drawn by their panels and mullions
      if (e.ifc_type !== "IFCCURTAINWALL") skip(`${categories[base.category].name.toLowerCase()} without a body`);
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
