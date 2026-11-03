// File > Document Settings > Georeferencing…, Modify > Move Geographic… and the drawing's place on
// the Earth they keep. Vectorworks saves a drawing's georeferencing in the file and each design layer
// can have its own; here there is one for the drawing, kept per file name in this browser as saved
// views are (a drawing's own georeferencing isn't read yet).

import type { Pt } from "../core/index.ts";
import { moveBy, selectionBounds } from "./commands.ts";
import { h } from "./dom.ts";
import { destination, drawingToGeo, formatDegrees, geoToDrawing, parseDegrees, georefThrough, systemName, systemOfEpsg, unprojected, type GeoSystem, type Georef, type LatLon } from "./geoShapes.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

const STORAGE_PREFIX = "openvwx.georef.";
const SYSTEMS: readonly { readonly value: GeoSystem; readonly label: string }[] = [
  { value: "local", label: "Local Transverse Mercator" },
  { value: "utm", label: "WGS 84 / UTM" },
  { value: "pseudo-mercator", label: "WGS 84 / Pseudo-Mercator" },
];

let current: Georef | null = null;
let loadedFor: unknown = null;
let loadedName = "";
const listeners = new Set<() => void>();

function sync(): void {
  const name = store.session ? store.fileName : "";
  if (store.session === loadedFor && name === loadedName) return;
  // a drawing saved under a new name keeps its place
  if (store.session === loadedFor) {
    loadedName = name;
    persist();
    return;
  }
  loadedFor = store.session;
  loadedName = name;
  current = load(name);
  for (const fn of listeners) fn();
}

store.on(["session", "file"], sync);

function persist(): void {
  if (!loadedName) return;
  try {
    if (current) localStorage.setItem(STORAGE_PREFIX + loadedName, JSON.stringify(current));
    else localStorage.removeItem(STORAGE_PREFIX + loadedName);
  } catch {
    // storage full or blocked: it lasts for this visit
  }
}

function load(name: string): Georef | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + name) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.lat !== "number" || typeof r.lon !== "number" || typeof r.north !== "number" || !SYSTEMS.some((s) => s.value === r.system)) return null;
    return {
      system: r.system as GeoSystem,
      lat: r.lat,
      lon: r.lon,
      north: r.north,
      ...(typeof r.zone === "number" ? { zone: r.zone } : {}),
      ...(typeof r.south === "boolean" ? { south: r.south } : {}),
    };
  } catch {
    return null;
  }
}

/** The drawing's georeferencing; null when it has none. */
export function documentGeoref(): Georef | null {
  sync();
  return current;
}

export function setDocumentGeoref(g: Georef | null): void {
  sync();
  current = g;
  persist();
  for (const fn of listeners) fn();
}

/** Calls `fn` when the drawing's georeferencing changes; returns a function that stops it. */
export function onGeoref(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The drawing's georeferencing, or the dialog asking for it first, as Vectorworks' GIS tools open it. */
export async function ensureGeoref(): Promise<Georef | null> {
  return documentGeoref() ?? georeferencingDialog();
}

const textInput = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } });
const fieldOf = (label: string, el: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
const radio = (name: string, value: string, on: boolean): HTMLInputElement => h("input", { checked: on, attrs: { type: "radio", name, value } });
const degreeText = (v: number): string => String(Number(v.toFixed(8)));

function readAngle(el: HTMLInputElement): number | null {
  const v = Number(el.value.trim().replace(",", ".").replace(/°$/, ""));
  return el.value.trim() && Number.isFinite(v) ? v : null;
}

function readLatLon(lat: HTMLInputElement, lon: HTMLInputElement): LatLon | { error: string; focus: HTMLElement } {
  const a = parseDegrees(lat.value);
  if (a === null || Math.abs(a) > 90) return { error: "Latitude: enter degrees from -90 to 90, as 39.18, 39° 10' 32\" or 39d 10m 32s.", focus: lat };
  const o = parseDegrees(lon.value);
  if (o === null || Math.abs(o) > 180) return { error: "Longitude: enter degrees from -180 to 180, as 39.18, 39° 10' 32\" or 39d 10m 32s.", focus: lon };
  return { lat: a, lon: o };
}

/** File > Document Settings > Georeferencing…: the coordinate system, where the internal origin is and the angle to true north. Null when cancelled or left off. */
export async function georeferencingDialog(): Promise<Georef | null> {
  const was = documentGeoref();
  const on = h("input", { checked: true, attrs: { type: "checkbox" } });
  const system = h(
    "select",
    { cls: "menu-dialog-input", attrs: { "aria-label": "Coordinate System", style: "width: 200px" } },
    ...SYSTEMS.map(({ value, label }) => {
      const o = h("option", { text: label, attrs: { value } });
      o.selected = value === (was?.system ?? "local");
      return o;
    }),
  );
  const startEpsg = was?.system === "utm" && was.zone ? String((was.south ? 32700 : 32600) + was.zone) : "";
  const epsg = textInput("EPSG code", startEpsg);
  const lat = textInput("Latitude", degreeText(was?.lat ?? 0));
  const lon = textInput("Longitude", degreeText(was?.lon ?? 0));
  const north = textInput("Angle to True North", String(was?.north ?? 0));
  const v = await showDialog<Georef | "off">({
    title: "Document Georeferencing",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-check" }, on, "Georeference this drawing"),
      fieldOf("Coordinate System", system),
      fieldOf("Or EPSG Code (3857, 326xx, 327xx)", epsg),
      fieldOf("Internal Origin's Latitude", lat),
      fieldOf("Internal Origin's Longitude", lon),
      fieldOf("Angle to True North", north, "°"),
      h("p", { cls: "muted", text: "Local Transverse Mercator runs along the location's own meridian, and UTM takes the location's zone. Enter degrees as 39.18, 39° 10' 32\" or 39d 10m 32s, with a minus, S or W where it applies. The angle is true north's, clockwise from the drawing's Y axis. It's kept with the file's name in this browser, not in the file." }),
    ],
    check: () => {
      if (!on.checked) return { value: "off" };
      const place = readLatLon(lat, lon);
      if ("error" in place) return place;
      const angle = readAngle(north);
      if (angle === null) return { error: "Angle to True North: enter a number of degrees.", focus: north };
      const code = epsg.value.trim().replace(/^epsg:/i, "");
      if (code) {
        const known = /^\d+$/.test(code) ? systemOfEpsg(Number(code)) : null;
        if (!known) return { error: "That EPSG code isn't one Rodeo has yet: it has 3857, and UTM's 326xx and 327xx.", focus: epsg };
        return { value: { ...place, ...known, north: angle } };
      }
      return { value: { ...place, system: system.value as GeoSystem, north: angle } };
    },
  });
  if (v === null) return null;
  if (v === "off") {
    setDocumentGeoref(null);
    toast("This drawing is no longer georeferenced.", "info");
    return null;
  }
  setDocumentGeoref(v);
  toast(`Georeferenced: ${systemName(v)}.`, "info");
  return v;
}

/** Survey Point Coordinates Setup: where a drawing point is on the Earth and the angle to true north, which place the drawing. Null when cancelled. */
export async function surveyPointSetup(at: Pt, base: Georef): Promise<Georef | null> {
  const place = drawingToGeo(base, at);
  const asGeo = radio("survey-coords", "geo", true);
  const asCart = radio("survey-coords", "cart", false);
  const lat = textInput("Latitude", degreeText(place.lat));
  const lon = textInput("Longitude", degreeText(place.lon));
  const east = textInput("Easting", "0");
  const northing = textInput("Northing", "0");
  const north = textInput("Angle to True North", String(base.north));
  return showDialog<Georef>({
    title: "Survey Point Coordinates Setup",
    okLabel: "OK",
    body: [
      h("p", { cls: "muted", text: `Coordinate system: ${systemName(base)}.` }),
      h("label", { cls: "menu-dialog-check" }, asGeo, "Specify geographical coordinates"),
      fieldOf("Latitude", lat),
      fieldOf("Longitude", lon),
      h("label", { cls: "menu-dialog-check" }, asCart, "Specify Cartesian coordinates"),
      fieldOf("Easting", east, "m"),
      fieldOf("Northing", northing, "m"),
      fieldOf("Angle to True North", north, "°"),
    ],
    check: () => {
      const angle = readAngle(north);
      if (angle === null) return { error: "Angle to True North: enter a number of degrees.", focus: north };
      const turned = { ...base, north: angle };
      if (asGeo.checked) {
        const p = readLatLon(lat, lon);
        if ("error" in p) return p;
        return { value: georefThrough(turned, at, p) };
      }
      const e = Number(east.value.trim().replace(",", "."));
      const n = Number(northing.value.trim().replace(",", "."));
      if (!east.value.trim() || !Number.isFinite(e)) return { error: "Easting: enter a number of metres.", focus: east };
      if (!northing.value.trim() || !Number.isFinite(n)) return { error: "Northing: enter a number of metres.", focus: northing };
      return { value: georefThrough(turned, at, unprojected(turned, { x: e, y: n })) };
    },
  });
}

export function canMoveGeographic(scene: Scene): boolean {
  return store.selection.size > 0 && selectionBounds(scene) !== null;
}

/** Modify > Move Geographic…: the selection, its middle going to a latitude and longitude, or along an azimuth for a distance over the Earth. */
export async function moveGeographicDialog(scene: Scene): Promise<void> {
  const g = await ensureGeoref();
  const box = selectionBounds(scene);
  if (!g || !box || !store.session) return;
  const middle = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  const here = drawingToGeo(g, middle);
  const units = store.session.doc.info.units;
  const toPlace = radio("move-geo", "place", true);
  const relative = radio("move-geo", "relative", false);
  const lat = textInput("Latitude", degreeText(here.lat));
  const lon = textInput("Longitude", degreeText(here.lon));
  const azimuth = textInput("Azimuth", "0");
  const distance = textInput("Distance", formatLengthValue(0, units));
  const v = await showDialog<LatLon>({
    title: "Move Geographic",
    okLabel: "Move",
    body: [
      h("label", { cls: "menu-dialog-check" }, toPlace, "Move to location"),
      fieldOf("Latitude", lat),
      fieldOf("Longitude", lon),
      h("label", { cls: "menu-dialog-check" }, relative, "Move relative"),
      fieldOf("Azimuth", azimuth, "°"),
      fieldOf("Distance", distance, lengthSuffix(units)),
      h("p", { cls: "muted", text: `The selection's middle is at ${formatDegrees(here.lat, "decimal", 6, "NS")}, ${formatDegrees(here.lon, "decimal", 6, "EW")}. An azimuth of 0° is the Y axis and 90° the X axis.` }),
    ],
    check: () => {
      if (toPlace.checked) {
        const p = readLatLon(lat, lon);
        return "error" in p ? p : { value: p };
      }
      const a = readAngle(azimuth);
      if (a === null) return { error: "Azimuth: enter a number of degrees.", focus: azimuth };
      const mm = parseLength(distance.value, units);
      if (mm === null) return { error: "Distance: enter a length.", focus: distance };
      // the drawing's Y axis is the angle's zero, so true north is taken off it
      return { value: destination(here, a - g.north, mm / 1000) };
    },
  });
  if (!v) return;
  const to = geoToDrawing(g, v);
  moveBy(to.x - middle.x, to.y - middle.y);
}
