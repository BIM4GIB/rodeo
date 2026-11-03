// File > Export > Export KML…'s writing: the 3D view's triangles as KML polygons on the Earth, a
// folder for each layer and a placemark for each object, in its colour, for Google Earth to show.
// Vectorworks' help says only that it exports 3D components to KML, so the shape of the file is
// KML 2.2's plain geometry: no COLLADA model inside a KMZ.

import type { Mesh3D, Pt } from "../core/types.ts";

export interface KmlPlace {
  readonly lat: number;
  readonly lon: number;
}

export interface KmlOptions {
  readonly name: string;
  /** a layer's name by its id, and an object's */
  layerName(id: string): string;
  objectName(id: string): string;
  /** where a drawing point (mm) is */
  place(p: Pt): KmlPlace;
  /** added to each height, mm */
  zOffset: number;
}

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fixed = (v: number, places: number): string => String(Number(v.toFixed(places)));

/** A CSS colour as KML has it: alpha, blue, green, red. */
function kmlColour(css: string, opacity: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css);
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return m ? `${alpha}${m[3]}${m[2]}${m[1]}`.toLowerCase() : `${alpha}c8c8c8`;
}

/** The meshes as a KML document. */
export function kmlDocument(meshes: readonly Mesh3D[], o: KmlOptions): string {
  const styles = new Map<string, string>();
  const layers = new Map<string, Mesh3D[]>();
  for (const m of meshes) {
    const colour = kmlColour(m.color, m.opacity);
    if (!styles.has(colour)) styles.set(colour, `c${styles.size}`);
    const list = layers.get(m.layerId);
    if (list) list.push(m);
    else layers.set(m.layerId, [m]);
  }
  const corner = (t: Float32Array | readonly number[], i: number): string => {
    const p = o.place({ x: t[i], y: t[i + 1] });
    return `${fixed(p.lon, 9)},${fixed(p.lat, 9)},${fixed((t[i + 2] + o.zOffset) / 1000, 3)}`;
  };
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', "<Document>", `<name>${escapeXml(o.name)}</name>`];
  for (const [colour, id] of styles) out.push(`<Style id="${id}"><LineStyle><width>0</width></LineStyle><PolyStyle><color>${colour}</color><outline>0</outline></PolyStyle></Style>`);
  for (const [layerId, list] of layers) {
    out.push("<Folder>", `<name>${escapeXml(o.layerName(layerId))}</name>`);
    // an object's meshes go in one placemark
    const objects = new Map<string, Mesh3D[]>();
    for (const m of list) {
      const of = objects.get(m.objectId);
      if (of) of.push(m);
      else objects.set(m.objectId, [m]);
    }
    for (const [objectId, parts] of objects) {
      out.push("<Placemark>", `<name>${escapeXml(o.objectName(objectId))}</name>`, `<styleUrl>#${styles.get(kmlColour(parts[0].color, parts[0].opacity))}</styleUrl>`, "<MultiGeometry>");
      for (const m of parts) {
        const t = m.triangles;
        for (let i = 0; i + 8 < t.length; i += 9) {
          const ring = [corner(t, i), corner(t, i + 3), corner(t, i + 6), corner(t, i)];
          out.push(`<Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${ring.join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`);
        }
      }
      out.push("</MultiGeometry>", "</Placemark>");
    }
    out.push("</Folder>");
  }
  out.push("</Document>", "</kml>", "");
  return out.join("\n");
}
