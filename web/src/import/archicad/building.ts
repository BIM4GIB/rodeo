// An Archicad file's decoded contents (read.ts) as a building model (../building.ts), which
// app/buildingWrite.ts makes into a drawing. Stories become storeys at their levels and Archicad's
// layers categories (Rodeo classes), hidden when the layer is; surfaces become materials. Archicad
// stores metres (and radians) from project zero; the model is millimetres, z up, absolute.
//
// What goes where:
// - a straight, upright wall of one thickness is a wall on its centreline, with its composite's
//   skins as components; any other wall (curved, slanted, trapezoid, profiled) is its plan outline
//   standing from its foot to its top;
// - slabs are slabs (outline, holes, foot and thickness); roofs, terrain meshes and morphs are
//   bodies built from what they store; shells, whose shape isn't decoded, are left out;
// - beams and columns are bodies of their section along their axis; curtain walls are their
//   frames and panels; stairs and railings, whose 3D parts Archicad generates, are their step
//   lines and reference lines in plan;
// - doors and windows sit in their walls at their size, sill and height, and placed objects and
//   lamps stand at their A × B × height: their real shapes are GDL scripts, which aren't run, so
//   each is drawn see-through, with its plan footprint, and keeps its GDL parameters as records;
// - drafting (lines, arcs, polylines, splines, fills, texts, dimensions, level dimensions,
//   hotspots and zones) is 2D with its pens' colours and weights: a floor plan's on its storey,
//   a section's, elevation's, detail's, worksheet's or layout's in a view of its own (`views`).
// A hotlinked module's elements come in where it is placed: the file holds a placed copy of each
// in the project, alongside the module's own copy on its own stories, which isn't drawn. Cameras
// are counted as left out.

import type { Attributes, NewShape, Pt } from "../../core/types.ts";
import type { Body, BuildingModel, BuildingObject, Category, Component, Material, Opening, Property, PropertySets, Slab, Storey, Wall } from "../building.ts";
import type { ArchicadPen, ArchicadStory, Rgb as Rgb255 } from "./attributes.ts";
import { arcBetween, area2, boxFaces, cleanRing, contourWithArcs, flatPrism, keyhole, memberBox, memberCylinder, memberSection, prismFaces, sheetFaces, terrainFaces, type Vec } from "./bodies.ts";
import { wallTop, type Polygon as ConstructionPolygon, type Wall as ArchicadWall } from "./construction.ts";
import type { Polygon as DraftPolygon, Placement as DraftPlacement } from "./drafting.ts";
import type { GdlParam, WallOpening } from "./libparts.ts";
import type { ArchicadRead } from "./read.ts";

/** Millimetres in a metre. */
const M = 1000;

/** Paper millimetres to mils (a line weight). */
const MILS = 1 / 0.0254;

/** The scale floor plan text and dimensions are drawn at (1:100), as model text sizes are paper sizes. */
const PLAN_SCALE = 100;

/** A colour for curtain wall glass and frames, which take theirs from parts not read here. */
const GLASS = { r: 0.72, g: 0.84, b: 0.9 };
const FRAME = { r: 0.55, g: 0.57, b: 0.6 };

/** Drafting in a view that isn't a story's plan (a detail, worksheet, section, elevation or layout), for a layer of its own. */
export interface ArchicadView {
  name: string;
  /** a layout, drawn at paper size on a sheet layer; the rest are design layers */
  sheet: boolean;
  items: { category: number; shape: NewShape; attrs?: Partial<Attributes> }[];
}

/** A building model with the views' drafting, which a building model has no place for. */
export interface ArchicadModel extends BuildingModel {
  views: ArchicadView[];
}

/** Where drafting goes, and the scale its paper sizes are drawn at. */
interface Sink {
  scale: number;
  put: (category: number, shape: NewShape, attrs?: Partial<Attributes>) => void;
}

const VIEW_NAMES: Readonly<Record<string, string>> = {
  section: "Section",
  elevation: "Elevation",
  interiorElevation: "Interior Elevation",
  iesCommon: "Elevation Dimensions",
  detail: "Detail",
  worksheet: "Worksheet",
  layout: "Layout",
  masterLayout: "Master Layout",
  document3d: "3D Document",
};

/** The drawing's palette index nearest an Archicad colour (0..255 channels). */
export type PaletteOf = (c: Rgb255) => number;

/**
 * The building model of the Archicad file `fileName` as `r` read it; `palette` picks the drawing's
 * colour for a pen's.
 */
export function archicadBuilding(r: ArchicadRead, fileName: string, palette: PaletteOf): ArchicadModel {
  const a = r.attributes;
  const skipped: Record<string, number> = {};
  const skip = (kind: string, n = 1): void => {
    if (n > 0) skipped[kind] = (skipped[kind] ?? 0) + n;
  };
  const approximated = new Map<string, number>();
  const approx = (note: string): void => void approximated.set(note, (approximated.get(note) ?? 0) + 1);

  // storeys: the project's own stories; an element on a hotlinked module's story is the module's own
  // copy, not drawn (each placement of the module has its own copy on the project's stories)
  const stories: readonly ArchicadStory[] = a.stories.length ? a.stories : [{ guid: "", index: 0, name: "Ground Floor", level: 0, height: 3, showOnSections: true }];
  const storeys: Storey[] = stories.map((s) => ({ name: s.name.trim() || `Story ${s.index}`, elevation: round(s.level * M) }));
  const byFloor = new Map(stories.map((s, i) => [s.guid, i]));
  const byIndex = new Map(stories.map((s, i) => [s.index, i]));
  const moduleFloors = new Set(a.modules.flatMap((m) => m.stories.map((s) => s.guid)));
  const ground = Math.max(0, stories.findIndex((s) => s.index === 0));
  /** the storey of an element on the story `floor` (its EDB::Floor) or numbered `story`; null for a hotlinked module's own copy */
  const storeyOf = (floor: string | null | undefined, story?: number | null): number | null => {
    if (floor) {
      const i = byFloor.get(floor);
      if (i !== undefined) return i;
      if (moduleFloors.has(floor)) return null;
    }
    if (story !== null && story !== undefined) {
      const i = byIndex.get(story);
      if (i !== undefined) return i;
    }
    return ground;
  };
  const elevation = (storey: number): number => storeys[storey].elevation;

  // categories: Archicad's layers, then any an element names that the file doesn't list
  const categories: Category[] = a.layers.map((l) => ({ name: l.name.trim() || `Layer ${l.index}`, hidden: l.hidden || undefined }));
  const byLayer = new Map(a.layers.map((l, i) => [l.index, i]));
  const categoryOf = (layer: number | null | undefined): number => {
    const known = layer === null || layer === undefined ? undefined : byLayer.get(layer);
    if (known !== undefined) return known;
    const key = layer && layer > 0 ? layer : 0;
    const name = key ? `Archicad Layer ${key}` : "Archicad Layer";
    let i = categories.findIndex((c) => c.name === name);
    if (i < 0) i = categories.push({ name }) - 1;
    byLayer.set(key, i);
    return i;
  };

  // materials: the surfaces; a building material or composite skin is drawn in its surface
  const materials: Material[] = a.surfaces.map((s) => ({ name: s.name.trim() || `Surface ${s.index}`, color: unitRgb(s.color), transparency: s.transparency / 100 || undefined }));
  const bySurface = new Map(a.surfaces.map((s, i) => [s.index, i]));
  const buildingMaterials = new Map(a.buildingMaterials.map((b) => [b.index, b]));
  const composites = new Map(a.composites.map((c) => [c.index, c]));
  const materialOfSurface = (index: number | null | undefined): number | undefined => (index === null || index === undefined ? undefined : bySurface.get(index));
  const materialOfBuilding = (index: number | null | undefined): number | undefined => materialOfSurface(index === null || index === undefined ? undefined : buildingMaterials.get(index)?.surface);
  const colorOfSurface = (index: number | null | undefined): Body["color"] => {
    const m = materialOfSurface(index);
    return m === undefined ? undefined : materials[m].color;
  };
  const componentsOf = (structure: string | null, composite: number): Component[] | undefined => {
    const c = structure === "composite" ? composites.get(composite) : undefined;
    if (!c?.skins.length) return undefined;
    return c.skins.map((s) => ({ material: materialOfBuilding(s.buildingMaterial), thickness: round(s.thickness * M), name: buildingMaterials.get(s.buildingMaterial)?.name.trim() || undefined }));
  };
  const typeOf = (structure: string | null, buildingMaterial: number, composite: number): string =>
    (structure === "composite" ? composites.get(composite)?.name : buildingMaterials.get(buildingMaterial)?.name)?.trim() ?? "";

  // pens: the model view pen set's colours and weights
  const pens = new Map<number, ArchicadPen>(a.pens.modelPens.map((p) => [p.index, p]));
  const penAttrs = new Map<number, Partial<Attributes>>();
  const penOf = (pen: number): Partial<Attributes> => {
    let at = penAttrs.get(pen);
    if (!at) {
      const p = pens.get(pen);
      at = p ? { penFore: palette(p.color), lineWeight: Math.max(1, Math.round(p.weight * MILS)) } : {};
      penAttrs.set(pen, at);
    }
    return at;
  };
  const colorOfPen = (pen: number): number | undefined => {
    const p = pens.get(pen);
    return p ? palette(p.color) : undefined;
  };

  const walls: Wall[] = [];
  const slabs: Slab[] = [];
  const openings: Opening[] = [];
  const objects: BuildingObject[] = [];
  const drawing: BuildingModel["drawing"] = [];
  const draw = (storey: number, category: number, shape: NewShape, attrs?: Partial<Attributes>): void => void drawing.push({ storey, category, shape, attrs });
  const outlineAttrs: Partial<Attributes> = { fillPattern: 0 };

  // ---- walls -------------------------------------------------------------------------------------
  const c = r.construction;
  // a wall whose top is linked to a story reaches that story's level (its stored height is stale)
  const levels = new Map([...a.stories, ...a.modules.flatMap((m) => m.stories)].map((s) => [s.guid, s.level]));
  const levelOf = (floor: string): number | undefined => levels.get(floor);
  /** where each wall's doors and windows go: along its reference line, then across to its centre */
  const hosts = new Map<string, { storey: number; category: number; wall?: number; along: (d: number) => { p: Pt; dir: Pt }; centre: number; thickness: number }>();
  for (const w of c.walls) {
    const storey = storeyOf(w.floor, w.story);
    if (storey === null) continue;
    const category = categoryOf(w.layer);
    const bottom = elevation(storey) + w.bottomOffset * M;
    const height = (wallTop(w, levelOf) - w.bottomOffset) * M;
    const element = {
      storey,
      category,
      name: w.id,
      type: typeOf(w.structure, w.buildingMaterial, w.composite),
      properties: { "Archicad Wall": [text("Element ID", w.id), length("Thickness", w.thickness), length("Height", height / M), length("Bottom Offset", w.bottomOffset), text("Structure", w.structure ?? "")] },
      material: w.structure === "basic" ? materialOfBuilding(w.buildingMaterial) : undefined,
    };
    const centre = ((w.faces.outside + (w.faces.insideBegin + w.faces.insideEnd) / 2) / 2) * M;
    const thickness = Math.abs(w.faces.insideBegin - w.faces.outside) * M || w.thickness * M;
    const host = { storey, category, along: alongWall(w), centre, thickness };
    const plain = !w.arcAngle && w.profileType === 0 && Math.abs(w.faces.insideBegin - w.faces.insideEnd) < 1e-6 && w.structure !== "profile";
    if (plain && height > 0 && thickness > 0) {
      const b = { x: w.begin.x * M, y: w.begin.y * M };
      const e = { x: w.end.x * M, y: w.end.y * M };
      const len = Math.hypot(e.x - b.x, e.y - b.y);
      if (len > 0) {
        const n = { x: -(e.y - b.y) / len, y: (e.x - b.x) / len };
        walls.push({
          ...element,
          start: { x: b.x + n.x * centre, y: b.y + n.y * centre },
          end: { x: e.x + n.x * centre, y: e.y + n.y * centre },
          thickness: round(thickness),
          bottom: round(bottom),
          height: round(height),
          components: componentsOf(w.structure, w.composite),
        });
        hosts.set(w.guid, { ...host, wall: walls.length - 1 });
        continue;
      }
    }
    // any other wall: its outline standing from its foot to its top
    const outline = w.footprint ? rings(w.footprint) : wallOutline(w);
    if (!outline?.length || height <= 0) {
      skip("walls with no outline");
      continue;
    }
    approx(w.arcAngle ? "curved walls are bodies, not walls" : w.profileType ? "slanted walls stand upright" : w.structure === "profile" ? "profiled walls are their outline's height" : "walls of two thicknesses are bodies, not walls");
    objects.push({ ...element, bodies: [{ faces: flatPrism(outline[0], outline.slice(1), bottom, bottom + height), color: colorOfSurface(w.surfaces[0].index) }] });
    hosts.set(w.guid, host);
  }

  // ---- slabs, roofs, meshes, morphs ----------------------------------------------------------------
  for (const s of c.slabs) {
    const storey = storeyOf(s.floor, s.story);
    if (storey === null) continue;
    const outline = rings(s.outline);
    if (!outline.length || s.thickness <= 0) {
      skip("slabs with no outline");
      continue;
    }
    const top = elevation(storey) + s.top * M;
    slabs.push({
      storey,
      category: categoryOf(s.layer),
      name: s.id,
      type: typeOf(s.structure, s.buildingMaterial, s.composite),
      properties: { "Archicad Slab": [text("Element ID", s.id), length("Thickness", s.thickness), length("Top", s.top), area("Area", outline)] },
      material: s.structure === "basic" ? materialOfBuilding(s.buildingMaterial) : undefined,
      outline: outline[0],
      holes: outline.length > 1 ? outline.slice(1) : undefined,
      bottom: round(top - s.thickness * M),
      thickness: round(s.thickness * M),
      components: componentsOf(s.structure, s.composite),
    });
  }

  for (const roof of c.roofs) {
    const storey = storeyOf(roof.floor, roof.story);
    if (storey === null) continue;
    const outline = rings(roof.outline);
    const b = { x: roof.pivot.begin.x * M, y: roof.pivot.begin.y * M };
    const e = { x: roof.pivot.end.x * M, y: roof.pivot.end.y * M };
    const len = Math.hypot(e.x - b.x, e.y - b.y);
    if (!outline.length || !len || roof.thickness <= 0) {
      skip("roofs with no outline");
      continue;
    }
    // the underside rises from the pivot line to its left
    const n = { x: -(e.y - b.y) / len, y: (e.x - b.x) / len };
    const rise = Math.tan(roof.slope);
    const pivot = elevation(storey) + roof.level * M;
    const under = (p: Pt): number => pivot + rise * ((p.x - b.x) * n.x + (p.y - b.y) * n.y);
    const depth = (roof.thickness * M) / Math.cos(roof.slope);
    const category = categoryOf(roof.layer);
    objects.push({
      storey,
      category,
      name: roof.id,
      type: typeOf(roof.composite > 0 ? "composite" : "basic", roof.buildingMaterial, roof.composite),
      properties: { "Archicad Roof": [text("Element ID", roof.id), length("Thickness", roof.thickness), angle("Slope", roof.slope), length("Pivot Height", roof.level)] },
      material: materialOfBuilding(roof.buildingMaterial),
      bodies: [{ faces: prismFaces(outline[0], outline.slice(1), under, (p) => under(p) + depth), color: colorOfSurface(roof.surfaces[0].index) }],
    });
    draw(storey, category, { kind: "polygon", points: outline[0], closed: true }, outlineAttrs);
  }

  for (const m of c.meshes) {
    const storey = storeyOf(m.floor, m.story);
    if (storey === null) continue;
    const level = elevation(storey) + m.level * M;
    const outline = m.outline.map((ring) => ring.map((p): Vec => [p.x * M, p.y * M, level + p.z * M]));
    const faces = terrainFaces(
      outline,
      m.points.map((p): Vec => [p.x * M, p.y * M, level + p.z * M]),
      level - m.skirt * M,
    );
    if (!faces.length) {
      skip("meshes with no outline");
      continue;
    }
    objects.push({
      storey,
      category: categoryOf(m.layer),
      name: m.id,
      type: "Mesh",
      properties: { "Archicad Mesh": [text("Element ID", m.id), length("Level", m.level), length("Skirt", m.skirt)] },
      bodies: [{ faces, color: colorOfSurface(m.surfaces[0]) }],
    });
  }

  for (const m of c.morphs) {
    const storey = storeyOf(m.floor, m.story);
    if (storey === null) continue;
    const z0 = elevation(storey);
    // a body per surface
    const bySurfaceFaces = new Map<number, number[][]>();
    const p = m.positions;
    for (let t = 0; t < m.triangles.length; t += 3) {
      const face: number[] = [];
      for (const v of [m.triangles[t], m.triangles[t + 1], m.triangles[t + 2]]) face.push(p[3 * v] * M, p[3 * v + 1] * M, z0 + p[3 * v + 2] * M);
      const s = m.triangleSurfaces[t / 3] ?? -1;
      (bySurfaceFaces.get(s) ?? bySurfaceFaces.set(s, []).get(s)!).push(face);
    }
    if (!bySurfaceFaces.size) {
      skip("morphs with no body");
      continue;
    }
    if (m.failedPolygons) approx("some morph faces couldn't be read");
    objects.push({
      storey,
      category: categoryOf(m.layer),
      name: m.id,
      type: "Morph",
      properties: { "Archicad Morph": [text("Element ID", m.id)] },
      bodies: [...bySurfaceFaces].map(([s, faces]) => ({ faces, color: colorOfSurface(s >= 0 ? s : undefined) })),
    });
  }
  skip("shells (their shape isn't read yet)", c.shells.length);

  // ---- beams, columns, curtain walls, stairs, railings ---------------------------------------------
  const st = r.structure;
  const profiles = new Map(a.profiles.map((p) => [p.index, p]));
  /** a member's bodies: its section along `from` → `to`, a complex profile part by part in their materials; a profile not in the file is the see-through box of its bounds */
  const memberBodies = (from: Vec, to: Vec, seg: (typeof st.beams)[number]["segments"][number] | undefined, turnBy: number): Body[] | null => {
    const section = seg?.section ?? null;
    const color = colorOfSurface(seg?.surface) ?? colorOfSurface(buildingMaterials.get(seg?.material ?? -1)?.surface);
    if (section?.kind === "profile") {
      const profile = section.profile !== null ? profiles.get(section.profile) : undefined;
      // the profile's box centred on the axis, as the axis is the section's centre
      const parts = profile?.parts.map((part) => part.contours.map((c) => contourWithArcs(c.points.map((p) => ({ x: p.x * M, y: p.y * M })), new Map(c.arcs.map((arc) => [arc.from, arc.angle]))))) ?? [];
      const all = parts.flat(2);
      if (all.length) {
        const cx = (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2;
        const cy = (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2;
        const bodies = parts
          .map((rings, k): Body => {
            const moved = rings.map((ring) => cleanRing(ring.map((p) => ({ x: p.x - cx, y: p.y - cy }))));
            return { faces: memberSection(from, to, moved[0] ?? [], moved.slice(1), turnBy), color: colorOfSurface(buildingMaterials.get(profile!.parts[k].buildingMaterial)?.surface) };
          })
          .filter((b) => b.faces.length);
        if (bodies.length) return bodies;
      }
    }
    const body = memberBody(from, to, section, seg?.bounds ?? null, turnBy);
    return body ? [{ ...body, color: body.box ? undefined : color }] : null;
  };
  for (const b of st.beams) {
    const storey = storeyOf(b.floor, b.story);
    if (storey === null) continue;
    const z0 = elevation(storey);
    const seg = b.segments[0];
    const section = seg?.section;
    // the section's centre line: from Archicad's cache, else the reference line raised by the anchor
    let from: Vec;
    let to: Vec;
    if (b.axis) {
      from = [b.axis.begin.x * M, b.axis.begin.y * M, z0 + b.axis.begin.z * M];
      to = [b.axis.end.x * M, b.axis.end.y * M, z0 + b.axis.end.z * M];
    } else {
      const depth = section?.kind === "rectangular" ? section.height : section?.kind === "circular" ? section.diameter : 0;
      const row = Math.floor(b.anchor / 3);
      const z = z0 + (b.level + (row === 0 ? depth / 2 : row === 2 ? -depth / 2 : 0)) * M;
      const len = Math.hypot(b.end.x - b.begin.x, b.end.y - b.begin.y) * M;
      from = [b.begin.x * M, b.begin.y * M, z];
      to = [b.end.x * M, b.end.y * M, z + Math.tan(b.slant) * len];
    }
    if (b.arc) approx("curved beams are straight");
    const bodies = memberBodies(from, to, seg, 0);
    if (!bodies) {
      skip("beams with no section");
      continue;
    }
    objects.push({
      storey,
      category: categoryOf(b.layer),
      name: b.id,
      type: sectionName(section ?? null),
      properties: { "Archicad Beam": [text("Element ID", b.id), length("Level", b.level), angle("Slant", b.slant)] },
      material: section?.kind === "profile" ? undefined : materialOfBuilding(seg?.material),
      bodies,
    });
  }

  for (const col of st.columns) {
    const storey = storeyOf(col.floor, col.story);
    if (storey === null) continue;
    const bottom = elevation(storey) + col.bottomOffset * M;
    const topStorey = col.topFloor ? byFloor.get(col.topFloor) : undefined;
    const height =
      col.height !== null ? col.height * M : topStorey !== undefined ? elevation(topStorey) + col.topOffset * M - bottom : col.storedHeight * M;
    const seg = col.segments[0];
    const section = seg?.section ?? null;
    const o = { x: col.origin.x * M, y: col.origin.y * M };
    if (col.slant && Math.abs(col.slant - Math.PI / 2) > 1e-6) approx("slanted columns stand upright");
    const bodies = height > 0 ? memberBodies([o.x, o.y, bottom], [o.x, o.y, bottom + height], seg, col.rotation) : null;
    if (!bodies) {
      skip("columns with no section");
      continue;
    }
    const category = categoryOf(col.layer);
    objects.push({
      storey,
      category,
      name: col.id,
      type: sectionName(section),
      properties: { "Archicad Column": [text("Element ID", col.id), length("Height", height / M), length("Bottom Offset", col.bottomOffset)] },
      material: section?.kind === "profile" ? undefined : materialOfBuilding(seg?.material),
      bodies,
    });
    // its section in plan
    const plan = sectionOutline(section, seg?.bounds ?? null, o, col.rotation);
    if (plan) draw(storey, category, { kind: "polygon", points: plan, closed: true }, outlineAttrs);
  }

  for (const cw of st.curtainWalls) {
    const storey = storeyOf(cw.floor, cw.story);
    if (storey === null) continue;
    const segments = new Map(cw.segments.map((s) => [s.guid, s]));
    // frames' and panels' z are absolute (their segments' are above the story)
    const at = (p: { x: number; y: number; z: number }): Vec => [p.x * M, p.y * M, p.z * M];
    const frames: number[][] = [];
    for (const f of cw.frames) {
      const seg = (f.segment && segments.get(f.segment)) || cw.segments[0];
      if (f.section && seg) {
        const [a, b] = [at(f.axis.begin), at(f.axis.end)];
        const d = [seg.end.x - seg.begin.x, seg.end.y - seg.begin.y];
        const dl = Math.hypot(d[0], d[1]) || 1;
        const n: Vec = [-d[1] / dl, d[0] / dl, 0];
        const along: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const al = Math.hypot(...along);
        if (!al) continue;
        // across the face: square to the axis, in the curtain wall's plane
        const across = cross(n, along.map((v) => v / al) as unknown as Vec);
        const w = f.section.width * M;
        const o: Vec = [a[0] + n[0] * f.section.depthFrom * M - across[0] * (w / 2), a[1] + n[1] * f.section.depthFrom * M - across[1] * (w / 2), a[2] - across[2] * (w / 2)];
        const depth = (f.section.depthTo - f.section.depthFrom) * M;
        if (!depth || !w) continue;
        frames.push(...boxFaces(o, along, [across[0] * w, across[1] * w, across[2] * w], [n[0] * depth, n[1] * depth, 0]));
      } else if (f.boundsOfBody) {
        const [lo, hi] = [at(f.bounds.min), at(f.bounds.max)];
        frames.push(...boxFaces(lo, [hi[0] - lo[0], 0, 0], [0, hi[1] - lo[1], 0], [0, 0, hi[2] - lo[2]]));
      }
    }
    const panels: number[][] = [];
    let open = 0;
    for (const p of cw.panels) {
      if (p.polygon && p.polygon.length >= 3) panels.push(...sheetFaces(p.polygon.map(at)));
      else open++;
    }
    if (open) approx("some curtain wall panels couldn't be placed");
    const bodies: Body[] = [];
    if (frames.length) bodies.push({ faces: frames, color: FRAME });
    if (panels.length) bodies.push({ faces: panels, color: GLASS });
    if (!bodies.length) {
      skip("curtain walls with no frames or panels");
      continue;
    }
    objects.push({ storey, category: categoryOf(cw.layer), name: cw.id, type: "Curtain Wall", properties: { "Archicad Curtain Wall": [text("Element ID", cw.id)] }, bodies });
  }

  let stairsDrawn = 0;
  for (const s of st.stairs) {
    const storey = storeyOf(s.floor, s.story);
    if (storey === null) continue;
    if (!s.placement || !s.stepLines.length) {
      skip("stairs with no step lines");
      continue;
    }
    const place = placer(s.placement);
    const category = categoryOf(s.layer);
    for (const l of s.stepLines) draw(storey, category, { kind: "line", a: place(l.a), b: place(l.b) });
    if (s.outline.length >= 3) draw(storey, category, { kind: "polygon", points: s.outline.map(place), closed: true }, outlineAttrs);
    if (s.walkingLine.length >= 2) draw(storey, category, { kind: "polygon", points: s.walkingLine.map(place), closed: false }, outlineAttrs);
    stairsDrawn++;
  }
  if (stairsDrawn) approx("stairs are their outline, step lines and walking line in plan, with no 3D");

  let railingsDrawn = 0;
  for (const rl of st.railings) {
    const storey = storeyOf(rl.floor, rl.story);
    if (storey === null) continue;
    const nodes = rl.nodes.filter((p) => p !== null);
    if (nodes.length < 2) {
      skip("railings with no reference line");
      continue;
    }
    const place = rl.placement ? placer(rl.placement) : (p: { x: number; y: number }): Pt => ({ x: p.x * M, y: p.y * M });
    draw(storey, categoryOf(rl.layer), { kind: "polygon", points: nodes.map(place), closed: false });
    railingsDrawn++;
  }
  if (railingsDrawn) approx("railings are their reference lines in plan, with no 3D");

  // ---- doors, windows, skylights, objects, lamps ---------------------------------------------------
  const lp = r.libparts;
  const gdlSet = (name: string | undefined, params: readonly GdlParam[]): PropertySets => {
    const props = params.map(gdlProperty).filter((p) => p !== null);
    return props.length ? { [`${name?.trim() || "Library Part"}`]: props } : {};
  };
  for (const [kind, list] of [
    ["door", lp.doors],
    ["window", lp.windows],
  ] as const) {
    for (const o of list) {
      const host = o.wall ? hosts.get(o.wall) : undefined;
      if (!host) {
        skip(`${kind}s in walls that weren't made`);
        continue;
      }
      const width = o.width * M;
      const height = o.height * M;
      if (width <= 0 || height <= 0) {
        skip(`${kind}s of no size`);
        continue;
      }
      const { p, dir } = host.along(openingCentre(o) * M);
      const n = { x: -dir.y, y: dir.x };
      const at = { x: p.x + n.x * host.centre, y: p.y + n.y * host.centre };
      const sill = elevation(host.storey) + o.sill * M;
      const t = Math.max(host.thickness, 1);
      const corner: Vec = [at.x - (dir.x * width) / 2 - (n.x * t) / 2, at.y - (dir.y * width) / 2 - (n.y * t) / 2, sill];
      const category = o.layer > 0 ? categoryOf(o.layer) : host.category;
      openings.push({
        kind,
        storey: host.storey,
        category,
        name: o.id,
        type: o.libPart?.name ?? "",
        properties: { [`Archicad ${kind === "door" ? "Door" : "Window"}`]: [text("Element ID", o.id), text("Library Part", o.libPart?.name ?? ""), length("Width", o.width), length("Height", o.height), length("Sill", o.sill)], ...gdlSet(o.libPart?.name, o.params) },
        wall: host.wall,
        at,
        width: round(width),
        height: round(height),
        sill: round(sill),
        bodies: [{ faces: boxFaces(corner, [dir.x * width, dir.y * width, 0], [n.x * t, n.y * t, 0], [0, 0, height]), box: true }],
      });
      // its footprint across the wall in plan
      draw(host.storey, category, { kind: "polygon", points: footprint(corner, dir, n, width, t), closed: true }, outlineAttrs);
    }
  }

  for (const s of lp.skylights) {
    const storey = storeyOf(s.floor);
    if (storey === null) continue;
    const width = s.width * M;
    const height = s.height * M;
    if (width <= 0 || height <= 0) {
      skip("skylights of no size");
      continue;
    }
    // a pane across the roof's pitch, rising along its azimuth
    const u: Vec = [Math.cos(s.azimuth) * width, Math.sin(s.azimuth) * width, 0];
    const v: Vec = [-Math.sin(s.azimuth) * Math.cos(s.pitch) * height, Math.cos(s.azimuth) * Math.cos(s.pitch) * height, Math.sin(s.pitch) * height];
    const z = elevation(storey) + s.level * M;
    const o: Vec = [s.position.x * M - u[0] / 2, s.position.y * M - u[1] / 2, z];
    openings.push({
      kind: "window",
      storey,
      category: categoryOf(s.layer),
      name: s.id,
      type: s.libPart?.name ?? "",
      properties: { "Archicad Skylight": [text("Element ID", s.id), text("Library Part", s.libPart?.name ?? ""), length("Width", s.width), length("Height", s.height)], ...gdlSet(s.libPart?.name, s.params) },
      at: { x: s.position.x * M, y: s.position.y * M },
      width: round(width),
      height: round(height),
      sill: round(z),
      bodies: [{ faces: boxFaces(o, u, v, [0, 0, 50]), box: true }],
    });
  }

  const owned = new Map<string, number>();
  for (const o of [...lp.objects, ...lp.lamps]) {
    if (o.owner) {
      owned.set(o.owner.kind, (owned.get(o.owner.kind) ?? 0) + 1);
      continue;
    }
    const storey = storeyOf(o.floor);
    if (storey === null) continue;
    const a2 = o.a * M;
    const b2 = o.b * M;
    const h = (o.height ?? 0) * M;
    if (a2 <= 0 && b2 <= 0) {
      skip("objects of no size");
      continue;
    }
    // the part's own x runs along its angle (mirrored: the other way), y square to it
    const dir = { x: Math.cos(o.angle), y: Math.sin(o.angle) };
    const n = { x: -dir.y, y: dir.x };
    const sx = o.mirrored ? -1 : 1;
    const z = elevation(storey) + o.position.z * M;
    const corner: Vec = [o.position.x * M, o.position.y * M, z];
    const u: Vec = [dir.x * a2 * sx, dir.y * a2 * sx, 0];
    const v: Vec = [n.x * b2, n.y * b2, 0];
    const category = categoryOf(o.layer);
    objects.push({
      storey,
      category,
      name: o.id,
      type: o.libPart?.name ?? "",
      properties: { [`Archicad ${"on" in o ? "Lamp" : "Object"}`]: [text("Element ID", o.id), text("Library Part", o.libPart?.name ?? ""), length("A", o.a), length("B", o.b), length("Height", o.height ?? 0)], ...gdlSet(o.libPart?.name, o.params) },
      bodies: [{ faces: boxFaces(corner, u, v, [0, 0, Math.max(h, 10)]), box: true }],
    });
    draw(storey, category, { kind: "polygon", points: footprint(corner, { x: u[0] / (a2 || 1), y: u[1] / (a2 || 1) }, n, a2, b2), closed: true }, outlineAttrs);
  }
  // parts Archicad generates for stairs and railings are placed by their element's scripts, not where they stand
  let parts = 0;
  for (const [kind, n] of owned)
    if (/stair|rail/.test(kind)) parts += n;
    else if (kind === "section segment") skip("section markers", n);
  skip("stair and railing parts (Archicad makes them from scripts)", parts);
  if (lp.doors.length + lp.windows.length + lp.skylights.length + lp.objects.length + lp.lamps.length)
    approx("doors, windows and objects are boxes of their size, as their shapes are GDL scripts");

  // ---- drafting: on its story's plan, or in its view (a layer of its own) ---------------------------
  const d = r.drafting;
  const views = new Map<string, ArchicadView>();
  const viewCount = new Map<string, number>();
  const planSinks = new Map<number, Sink>();
  /** where a drafting item is drawn: its story's plan, or its view's layer; null for a hotlinked module's own copy */
  const sinkOf = (p: DraftPlacement): Sink | null => {
    const where = p.ownerKind;
    if (where === "hotlinkModule") return null;
    if (where && where !== "floorPlan" && p.owner) {
      let view = views.get(p.owner);
      if (!view) {
        const label = VIEW_NAMES[where] ?? "View";
        const n = (viewCount.get(label) ?? 0) + 1;
        viewCount.set(label, n);
        view = { name: `${label} ${n}`, sheet: where === "layout" || where === "masterLayout", items: [] };
        views.set(p.owner, view);
      }
      const items = view.items;
      return { scale: view.sheet ? 1 : PLAN_SCALE, put: (category, shape, attrs) => void items.push({ category, shape, attrs }) };
    }
    const storey = storeyOf(p.floor, p.story);
    if (storey === null) return null;
    let sink = planSinks.get(storey);
    if (!sink) planSinks.set(storey, (sink = { scale: PLAN_SCALE, put: (category, shape, attrs) => draw(storey, category, shape, attrs) }));
    return sink;
  };
  const pt = (x: number, y: number): Pt => ({ x: x * M, y: y * M });

  for (const l of d.lines) {
    const out = sinkOf(l);
    if (out) out.put(categoryOf(l.layer), { kind: "line", a: pt(l.begin.x, l.begin.y), b: pt(l.end.x, l.end.y) }, penOf(l.pen));
  }
  for (const arc of d.arcs) {
    const out = sinkOf(arc);
    if (out) out.put(categoryOf(arc.layer), arcShape(arc), penOf(arc.pen));
  }
  for (const pl of d.polylines) {
    const out = sinkOf(pl);
    if (!out) continue;
    const runs = draftRings(pl.shape, !pl.closed);
    for (const run of runs) if (run.length >= 2) out.put(categoryOf(pl.layer), { kind: "polygon", points: run, closed: pl.closed }, { ...penOf(pl.pen), fillPattern: 0 });
  }
  for (const sp of d.splines) {
    const out = sinkOf(sp);
    if (out && sp.points.length >= 4) out.put(categoryOf(sp.layer), { kind: "polygon", points: splinePoints(sp.points, sp.handles), closed: false }, { ...penOf(sp.pen), fillPattern: 0 });
  }
  const fills = new Map(a.fills.map((f) => [f.index, f]));
  let hatched = 0;
  for (const f of d.fills) {
    const out = sinkOf(f);
    if (!out) continue;
    const contours = draftRings(f.shape, false).filter((ring) => ring.length >= 3);
    if (!contours.length) continue;
    const category = categoryOf(f.layer);
    const kind = fills.get(f.fill)?.kind ?? "solid";
    // a hatch is drawn as its background (Rodeo has no Archicad hatches); a solid fill in its pen
    const fillColor = kind === "empty" ? (f.backgroundPen >= 0 ? colorOfPen(f.backgroundPen) : undefined) : kind === "solid" ? colorOfPen(f.pen) : f.backgroundPen >= 0 ? colorOfPen(f.backgroundPen) : undefined;
    if (kind !== "solid" && kind !== "empty") hatched++;
    const contour = f.contourShown ? penOf(f.contourPen) : null;
    if (fillColor !== undefined) {
      const shape = contours.length > 1 ? keyhole(contours[0], contours.slice(1)) : contours[0];
      out.put(category, { kind: "polygon", points: shape, closed: true }, { fillPattern: 1, fillFore: fillColor, fillBack: fillColor, lineStyle: contour && contours.length === 1 ? 2 : 0, ...(contour && contours.length === 1 ? contour : {}) });
      if (contour && contours.length > 1) for (const ring of contours) out.put(category, { kind: "polygon", points: ring, closed: true }, { ...contour, fillPattern: 0 });
    } else if (contour) for (const ring of contours) out.put(category, { kind: "polygon", points: ring, closed: true }, { ...contour, fillPattern: 0 });
  }
  if (hatched) approx("hatched fills are their background colour");
  for (const t of d.texts) {
    const out = sinkOf(t);
    if (!out || !t.content.trim()) continue;
    const run = t.runs[0];
    const justify = t.paragraphs[0]?.justify;
    out.put(
      categoryOf(t.layer),
      { kind: "text", at: pt(t.point.x, t.point.y), text: t.content, height: Math.max(1, (run?.size ?? 2.5) * out.scale), angle: deg(t.angle), hAlign: justify === "center" ? 2 : justify === "right" ? 3 : 1 },
      run ? penOf(run.pen) : undefined,
    );
  }
  for (const dim of d.dimensions) {
    const out = sinkOf(dim);
    if (!out) continue;
    const on = dim.points.map((p) => p.onLine).filter((p) => p !== null);
    if (on.length < 2) continue;
    const category = categoryOf(dim.layer);
    const line = on.map((p) => pt(p.x, p.y));
    out.put(category, { kind: "line", a: line[0], b: line.at(-1)! });
    const tick = 1.25 * out.scale;
    const len = Math.hypot(dim.direction.x, dim.direction.y) || 1;
    const u = { x: dim.direction.x / len, y: dim.direction.y / len };
    for (const p of dim.points) {
      if (!p.onLine) continue;
      const q = line[on.indexOf(p.onLine)];
      // its witness line from the measured point, when that is known, and a tick
      if (!p.element && (p.point.x || p.point.y)) out.put(category, { kind: "line", a: pt(p.point.x, p.point.y), b: q });
      out.put(category, { kind: "line", a: { x: q.x - ((u.x - u.y) * tick) / 2, y: q.y - ((u.y + u.x) * tick) / 2 }, b: { x: q.x + ((u.x - u.y) * tick) / 2, y: q.y + ((u.y + u.x) * tick) / 2 } });
    }
    for (let k = 1; k < line.length; k++) {
      const [p, q] = [line[k - 1], line[k]];
      const value = Math.hypot(q.x - p.x, q.y - p.y);
      if (value < 0.5) continue;
      out.put(category, {
        kind: "text",
        at: { x: (p.x + q.x) / 2 - u.y * tick * 0.4, y: (p.y + q.y) / 2 + u.x * tick * 0.4 },
        text: String(Math.round(value)),
        height: 2 * out.scale,
        hAlign: 2,
        angle: uprightDeg(Math.atan2(u.y, u.x)),
      });
    }
  }
  if (d.dimensions.length) approx("dimensions are lines and texts");
  for (const lv of d.levelDimensions) {
    const out = sinkOf(lv);
    if (!out) continue;
    const at = pt(lv.point.x, lv.point.y);
    out.put(categoryOf(lv.layer), { kind: "locus", at });
    if (lv.level !== null) out.put(categoryOf(lv.layer), { kind: "text", at: { x: at.x + out.scale, y: at.y + out.scale }, text: `${lv.level >= 0 ? "+" : ""}${lv.level.toFixed(2)}`, height: 2 * out.scale });
  }
  for (const h of d.hotspots) {
    const out = sinkOf(h);
    if (out) out.put(categoryOf(h.layer), { kind: "locus", at: pt(h.point.x, h.point.y) });
  }
  for (const z of d.zones) {
    const out = sinkOf(z);
    if (!out) continue;
    const contours = draftRings(z.shape, false).filter((ring) => ring.length >= 3);
    if (!contours.length) continue;
    const category = categoryOf(z.layer);
    for (const ring of contours) out.put(category, { kind: "polygon", points: ring, closed: true }, outlineAttrs);
    const c0 = centroid(contours[0]);
    const label = [z.name.trim(), z.number.trim()].filter(Boolean).join("\r");
    const m2 = (Math.abs(area2(contours[0])) - contours.slice(1).reduce((s, h2) => s + Math.abs(area2(h2)), 0)) / 2 / 1e6;
    out.put(category, { kind: "text", at: c0, text: `${label}${label ? "\r" : ""}${m2.toFixed(2)} m²`, height: 2.5 * out.scale, hAlign: 2 });
  }
  skip("cameras", d.cameras.length);

  // ---- notes -------------------------------------------------------------------------------------
  const notes = [...approximated.keys()];
  const problems = Object.values({ ...a.problems, ...c.problems, ...st.problems, ...d.problems, ...lp.problems }).reduce((s, n) => s + n, 0);
  if (problems) notes.push(`${problems.toLocaleString("en")} of the file's records couldn't be read`);

  return {
    name: fileName.replace(/\.[^.]+$/, ""),
    units: "mm",
    storeys,
    categories,
    materials,
    walls,
    slabs,
    openings,
    objects,
    drawing,
    skipped,
    notes,
    views: [...views.values()].filter((v) => v.items.length),
  };
}

// ---- helpers -------------------------------------------------------------------------------------

const round = (v: number): number => Math.round(v * 1000) / 1000;
const deg = (rad: number): number => (rad * 180) / Math.PI;
/** An angle, in degrees, that reads upright. */
const uprightDeg = (rad: number): number => {
  let a = deg(rad) % 360;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};
const unitRgb = (c: Rgb255): { r: number; g: number; b: number } => ({ r: c.r / 255, g: c.g / 255, b: c.b / 255 });

const text = (name: string, value: string): Property => ({ name, kind: "text", value });
const length = (name: string, metres: number): Property => ({ name, kind: "length", value: round(metres * M) });
const angle = (name: string, rad: number): Property => ({ name, kind: "angle", value: round(deg(rad)) });
function area(name: string, rings: readonly Pt[][]): Property {
  const mm2 = Math.abs(area2(rings[0])) / 2 - rings.slice(1).reduce((s, r) => s + Math.abs(area2(r)) / 2, 0);
  return { name, kind: "area", value: round(mm2) };
}

/** A GDL parameter as a property; null for titles, separators, dictionaries and arrays. */
function gdlProperty(p: GdlParam): Property | null {
  const v = p.value;
  if (v === null || Array.isArray(v) || !p.name) return null;
  switch (p.type) {
    case "length":
      return typeof v === "number" ? { name: p.name, kind: "length", value: round(v * M) } : null;
    case "angle":
      return typeof v === "number" ? { name: p.name, kind: "angle", value: round(v) } : null;
    case "real":
    case "intensity":
      return typeof v === "number" ? { name: p.name, kind: "number", value: v } : null;
    case "integer":
    case "lineType":
    case "material":
    case "fillPattern":
    case "penColor":
    case "buildingMaterial":
    case "profile":
      return typeof v === "number" ? { name: p.name, kind: "integer", value: Math.round(v) } : null;
    case "boolean":
    case "lightSwitch":
      return { name: p.name, kind: "boolean", value: Boolean(v) };
    case "string":
      return typeof v === "string" ? { name: p.name, kind: "text", value: v } : null;
    default:
      return null;
  }
}

/** A construction polygon's contours, arcs made points, in mm: the outline then holes. */
function rings(poly: ConstructionPolygon): Pt[][] {
  return poly.contours
    .map((contour, k) => {
      const arcs = new Map(poly.arcs.filter((a) => a.contour === k).map((a) => [a.edge, a.angle]));
      return cleanRing(contourWithArcs(contour.map((p) => ({ x: p.x * M, y: p.y * M })), arcs));
    })
    .filter((r) => r.length >= 3);
}

/** A drafting polygon's contours (or an open polyline's one run), arcs made points, in mm. */
function draftRings(poly: DraftPolygon, open: boolean): Pt[][] {
  const out: Pt[][] = [];
  const arcs = new Map<number, number>();
  for (let i = 0; i + 2 < poly.arcs.length; i += 3) arcs.set(poly.arcs[i], poly.arcs[i + 2]);
  let start = 0;
  for (const end of poly.ends) {
    const ring: Pt[] = [];
    for (let i = start; i < end; i++) {
      const p = { x: poly.points[2 * i] * M, y: poly.points[2 * i + 1] * M };
      ring.push(p);
      const angle = arcs.get(i);
      const next = i + 1 < end ? i + 1 : open ? -1 : start;
      if (angle && next >= 0) ring.push(...arcBetween(p, { x: poly.points[2 * next] * M, y: poly.points[2 * next + 1] * M }, angle));
    }
    out.push(open ? ring : cleanRing(ring));
    start = end;
  }
  return out;
}

/** An Archicad arc or circle as a Rodeo arc, or as points when it is a turned ellipse. */
function arcShape(a: { center: { x: number; y: number }; radius: number; axisAngle: number; ratio: number; beginAngle: number; endAngle: number; reflected: boolean; whole: boolean }): NewShape {
  const center = { x: a.center.x * M, y: a.center.y * M };
  const r = a.radius * M;
  let sweep = a.whole ? 360 : deg(a.endAngle - a.beginAngle);
  if (!a.whole) {
    if (a.reflected) sweep = -(((-sweep % 360) + 360) % 360 || 360);
    else sweep = ((sweep % 360) + 360) % 360 || 360;
  }
  const elliptic = Math.abs(a.ratio - 1) > 1e-6;
  if (!elliptic) return { kind: "arc", center, radius: r, startAngle: a.whole ? 0 : ((deg(a.beginAngle) % 360) + 360) % 360, sweepAngle: sweep };
  if (Math.abs(a.axisAngle) < 1e-9) return { kind: "arc", center, radius: r, radiusY: r * a.ratio, startAngle: a.whole ? 0 : ((deg(a.beginAngle) % 360) + 360) % 360, sweepAngle: sweep };
  // a turned ellipse: its points (the angles taken as parametric about its own axes)
  const n = Math.max(8, Math.ceil(Math.abs(sweep) / 5));
  const pts: Pt[] = [];
  const [c, s] = [Math.cos(a.axisAngle), Math.sin(a.axisAngle)];
  const t0 = a.whole ? 0 : a.beginAngle - a.axisAngle;
  for (let k = 0; k <= n; k++) {
    const t = t0 + (((sweep * Math.PI) / 180) * k) / n;
    const [x, y] = [r * Math.cos(t), r * a.ratio * Math.sin(t)];
    pts.push({ x: center.x + x * c - y * s, y: center.y + x * s + y * c });
  }
  return { kind: "polygon", points: pts, closed: a.whole };
}

/** A spline's Bézier runs as points, mm: handles per point are its length before, after, and direction. */
function splinePoints(points: Float64Array, handles: Float64Array): Pt[] {
  const n = points.length / 2;
  const out: Pt[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const p0 = { x: points[2 * i], y: points[2 * i + 1] };
    const p3 = { x: points[2 * i + 2], y: points[2 * i + 3] };
    const [, after0, dir0] = [handles[3 * i], handles[3 * i + 1], handles[3 * i + 2]];
    const [before1, , dir1] = [handles[3 * i + 3], handles[3 * i + 4], handles[3 * i + 5]];
    const p1 = { x: p0.x + after0 * Math.cos(dir0), y: p0.y + after0 * Math.sin(dir0) };
    const p2 = { x: p3.x - before1 * Math.cos(dir1), y: p3.y - before1 * Math.sin(dir1) };
    const steps = 12;
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({
        x: (u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x) * M,
        y: (u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y) * M,
      });
    }
  }
  return out;
}

/** The centre of a plan outline (by area), mm. */
function centroid(ring: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** The plan rectangle from `corner` along `dir` for `a` and across it (along `n`) for `b`. */
function footprint(corner: Vec, dir: Pt, n: Pt, a: number, b: number): Pt[] {
  const o = { x: corner[0], y: corner[1] };
  return [o, { x: o.x + dir.x * a, y: o.y + dir.y * a }, { x: o.x + dir.x * a + n.x * b, y: o.y + dir.y * a + n.y * b }, { x: o.x + n.x * b, y: o.y + n.y * b }];
}

/** Where along its wall an opening's middle is, metres from the wall's begin: `along` places its middle, or an edge when the anchor says so. */
function openingCentre(o: WallOpening): number {
  return o.along + (o.anchor < 0 ? o.width / 2 : o.anchor > 0 ? -o.width / 2 : 0);
}

/** A point `d` mm along a wall's reference line (an arc when it is curved), and the direction there. */
function alongWall(w: ArchicadWall): (d: number) => { p: Pt; dir: Pt } {
  const b = { x: w.begin.x * M, y: w.begin.y * M };
  const e = { x: w.end.x * M, y: w.end.y * M };
  if (w.arcAngle && w.centre) {
    const c = { x: w.centre.x * M, y: w.centre.y * M };
    const r = Math.hypot(b.x - c.x, b.y - c.y) || 1;
    const a0 = Math.atan2(b.y - c.y, b.x - c.x);
    const sign = Math.sign(w.arcAngle);
    return (d) => {
      const t = a0 + (sign * d) / r;
      return { p: { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }, dir: { x: -Math.sin(t) * sign, y: Math.cos(t) * sign } };
    };
  }
  const len = Math.hypot(e.x - b.x, e.y - b.y) || 1;
  const dir = { x: (e.x - b.x) / len, y: (e.y - b.y) / len };
  return (d) => ({ p: { x: b.x + dir.x * d, y: b.y + dir.y * d }, dir });
}

/** A wall's plan outline from its reference line and faces, mm, for a wall Archicad cached none for. */
function wallOutline(w: ArchicadWall): Pt[][] | null {
  const b = { x: w.begin.x * M, y: w.begin.y * M };
  const e = { x: w.end.x * M, y: w.end.y * M };
  const len = Math.hypot(e.x - b.x, e.y - b.y);
  if (!len) return null;
  const [outside, inBegin, inEnd] = [w.faces.outside * M, w.faces.insideBegin * M, w.faces.insideEnd * M];
  if (w.arcAngle && w.centre) {
    // the faces are arcs about the same centre, offset from the reference arc
    const c = { x: w.centre.x * M, y: w.centre.y * M };
    const r = Math.hypot(b.x - c.x, b.y - c.y);
    const a0 = Math.atan2(b.y - c.y, b.x - c.x);
    const n = Math.max(2, Math.ceil(Math.abs(w.arcAngle) / (Math.PI / 18)));
    // the left normal of a counter-clockwise arc points to its centre
    const side = (k: number, off: number): Pt => {
      const t = a0 + (w.arcAngle * k) / n;
      const rr = r - Math.sign(w.arcAngle) * off;
      return { x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) };
    };
    const out = Array.from({ length: n + 1 }, (_, k) => side(k, outside));
    const inner = Array.from({ length: n + 1 }, (_, k) => side(n - k, inBegin + ((inEnd - inBegin) * (n - k)) / n));
    return [cleanRing([...out, ...inner])];
  }
  const nx = -(e.y - b.y) / len;
  const ny = (e.x - b.x) / len;
  const at = (p: Pt, off: number): Pt => ({ x: p.x + nx * off, y: p.y + ny * off });
  return [[at(b, outside), at(e, outside), at(e, inEnd), at(b, inBegin)]];
}

/** Local to world, mm, for a stair's or railing's plan points. */
function placer(pl: { origin: { x: number; y: number; z: number }; matrix: readonly number[] }): (p: { x: number; y: number }) => Pt {
  const m = pl.matrix;
  return (p) => ({ x: (pl.origin.x + m[0] * p.x + m[1] * p.y) * M, y: (pl.origin.y + m[3] * p.x + m[4] * p.y) * M });
}

type Section = { kind: "rectangular"; width: number; height: number } | { kind: "circular"; diameter: number } | { kind: "profile"; profileObject: string | null; profile: number | null };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** A member's body: its section along `from` → `to`; a profiled one is the box of its profile, drawn see-through. */
function memberBody(from: Vec, to: Vec, section: Section | null, bounds: Bounds | null, turnBy: number): Body | null {
  if (section?.kind === "rectangular" && section.width > 0 && section.height > 0) return { faces: memberBox(from, to, section.width * M, section.height * M, turnBy) };
  if (section?.kind === "circular" && section.diameter > 0) return { faces: memberCylinder(from, to, section.diameter * M) };
  if (bounds && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) return { faces: memberBox(from, to, (bounds.maxX - bounds.minX) * M, (bounds.maxY - bounds.minY) * M, turnBy), box: true };
  return null;
}

/** "Rectangular 300 × 500", "Round Ø 400", "Profile". */
function sectionName(s: Section | null): string {
  if (s?.kind === "rectangular") return `Rectangular ${Math.round(s.width * M)} × ${Math.round(s.height * M)}`;
  if (s?.kind === "circular") return `Round Ø ${Math.round(s.diameter * M)}`;
  return s ? "Profile" : "";
}

/** A column's section in plan about its origin, turned by `rotation`; mm. */
function sectionOutline(s: Section | null, bounds: Bounds | null, o: Pt, rotation: number): Pt[] | null {
  const [c, sn] = [Math.cos(rotation), Math.sin(rotation)];
  const at = (x: number, y: number): Pt => ({ x: o.x + x * c - y * sn, y: o.y + x * sn + y * c });
  if (s?.kind === "circular" && s.diameter > 0) {
    const r = (s.diameter * M) / 2;
    return Array.from({ length: 24 }, (_, k) => at(r * Math.cos((k * Math.PI) / 12), r * Math.sin((k * Math.PI) / 12)));
  }
  const [w, h] = s?.kind === "rectangular" ? [s.width * M, s.height * M] : bounds ? [(bounds.maxX - bounds.minX) * M, (bounds.maxY - bounds.minY) * M] : [0, 0];
  if (!(w > 0 && h > 0)) return null;
  return [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
