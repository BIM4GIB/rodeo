// File > Export > Export KML…, Vectorworks' command of that name: the 3D objects as KML, for Google
// Earth. A georeferenced drawing's place fills in the Site Mapping and can't be changed here; otherwise
// it's a reference point's X and Y, the Latitude and Longitude it goes to and the Page North. The Z
// Height Offset lifts everything off the ground, and the layers are the active one or all the 3D view
// shows. Rodeo doesn't take the reference point from a click, or filter by the kind of object.

import { kmlDocument } from "../export/kml.ts";
import { stlMeshes } from "../export/stl.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { drawingToGeo, formatDegrees, georefThrough, parseDegrees, systemName, type Georef } from "./geoShapes.ts";
import { documentGeoref } from "./georef.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** a file this many triangles long is more than Google Earth will show */
const MAX_TRIANGLES = 250000;

/** the last values, degrees as typed and lengths in mm */
const last = { lat: "0", lon: "0", north: "0", x: 0, y: 0, z: 0, all: true };

export async function exportKmlDialog(layers3d: ReadonlySet<string>): Promise<void> {
  const session = store.session;
  if (!session) return;
  const units = session.doc.info.units;
  const suffix = lengthSuffix(units);
  const located = documentGeoref();
  const here = located ? drawingToGeo(located, { x: 0, y: 0 }) : null;
  const text = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, disabled: !!located, attrs: { type: "text", "aria-label": label, style: "width: 150px" } });
  const length = (label: string, mm: number): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const field = (label: string, el: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const refX = length("Reference Point X", located ? 0 : last.x);
  const refY = length("Reference Point Y", located ? 0 : last.y);
  refX.disabled = !!located;
  refY.disabled = !!located;
  const lat = text("Latitude", here ? formatDegrees(here.lat, "dms", 2, "NS") : last.lat);
  const lon = text("Longitude", here ? formatDegrees(here.lon, "dms", 2, "EW") : last.lon);
  const north = text("Page North", located ? String(located.north) : last.north);
  const z = length("Z Height Offset", last.z);
  const scope = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Layer(s) to export from" } }, h("option", { value: "all", text: "All visible layers" }), h("option", { value: "active", text: "The active layer" }));
  scope.value = last.all ? "all" : "active";
  const v = await showDialog<{ g: Georef; zOffset: number; all: boolean }>({
    title: "KML Export Options",
    okLabel: "Export",
    body: [
      located ? h("p", { cls: "muted", text: `The drawing's georeferencing sets the Site Mapping: ${systemName(located)}.` }) : null,
      field("Reference Point X", refX, suffix),
      field("Reference Point Y", refY, suffix),
      field("Latitude", lat),
      field("Longitude", lon),
      field("Page North", north, "°"),
      field("Z Height Offset", z, suffix),
      field("Layer(s) to export from", scope),
      h("p", { cls: "muted", text: "Degrees go as 39.18 or 39d 12m 34s N. The file holds plain KML polygons, one for each triangle of the 3D view, without textures." }),
    ].filter((n): n is HTMLElement => !!n),
    check: () => {
      const zOffset = parseLength(z.value, units);
      if (zOffset === null) return { error: "Z Height Offset: enter a length.", focus: z };
      const all = scope.value === "all";
      if (located) return { value: { g: located, zOffset, all } };
      const x = parseLength(refX.value, units);
      if (x === null) return { error: "Reference Point X: enter a length.", focus: refX };
      const y = parseLength(refY.value, units);
      if (y === null) return { error: "Reference Point Y: enter a length.", focus: refY };
      const a = parseDegrees(lat.value);
      if (a === null || Math.abs(a) > 90) return { error: "Latitude: enter degrees from -90 to 90.", focus: lat };
      const o = parseDegrees(lon.value);
      if (o === null || Math.abs(o) > 180) return { error: "Longitude: enter degrees from -180 to 180.", focus: lon };
      const n = parseDegrees(north.value);
      if (n === null) return { error: "Page North: enter an angle in degrees.", focus: north };
      Object.assign(last, { lat: lat.value, lon: lon.value, north: north.value, x, y });
      return { value: { g: georefThrough({ system: "local", lat: a, lon: o, north: n }, { x, y }, { lat: a, lon: o }), zOffset, all } };
    },
  });
  if (!v || store.session !== session) return;
  last.z = v.zOffset;
  last.all = v.all;
  const doc = withoutHidden(session.doc);
  const layers = v.all ? layers3d : new Set(store.activeLayerId ? [store.activeLayerId] : []);
  const meshes = stlMeshes(doc, layers);
  if (!meshes.length) {
    toast(v.all ? "No 3D objects on the visible design layers." : "No 3D objects on the active layer.", "info");
    return;
  }
  const triangles = meshes.reduce((a, m) => a + m.triangles.length / 9, 0);
  if (triangles > MAX_TRIANGLES) {
    toast(`That's ${Math.round(triangles).toLocaleString()} triangles, more than Google Earth would show. Export a layer with fewer.`, "error");
    return;
  }
  const name = store.fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";
  try {
    const kml = kmlDocument(meshes, {
      name,
      layerName: (id) => doc.layers().find((l) => l.id === id)?.name ?? id,
      objectName: (id) => doc.object(id)?.name || doc.object(id)?.typeName || "Object",
      place: (p) => drawingToGeo(v.g, p),
      zOffset: v.zOffset,
    });
    downloadBlob(`${name}.kml`, new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }));
  } catch (err) {
    toast(`KML export failed: ${errorMessage(err)}`);
  }
}
