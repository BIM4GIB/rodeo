// View > Set Sun Position…, as Vectorworks Fundamentals has it: sunlight as a directional light
// shining the way the sun does at a site on a date at a time. The dialog takes the site's latitude
// and longitude, its time zone's meridian, page north, the date, the clock time and daylight
// saving, and shows as they are typed where the sun is: its azimuth from south (west positive) and
// from north (clockwise), both before page north turns them, its elevation and the true solar time.
// OK aims the directional lights that are selected (ones the drawing places), else adds one at the
// view's centre on the active layer, selected: a copy of a light the drawing has, as the Light
// tool's are. Page north is how far the drawing's north is turned from straight up, counter-clockwise.
// A sun below the horizon is refused. What was typed is kept for next time; the first time starts
// from the 3D view's sun.

import type { Vec3 } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { checkRow } from "./engineeringProperties.ts";
import { appContext } from "./ext.ts";
import { dayOfYear, equationOfTime, MONTHS, sunPlace, type SunPlace } from "./heliodon.ts";
import { canAimLight, lightOf } from "./lightView.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import "./sunPosition.css";

/** Where and when the sun is wanted. */
export interface SunSettings {
  /** degrees, north positive */
  readonly latitude: number;
  /** degrees, east positive */
  readonly longitude: number;
  /** the time zone's meridian, degrees, east positive (15° an hour) */
  readonly meridian: number;
  /** the drawing's north, degrees counter-clockwise from straight up */
  readonly north: number;
  /** 1 to 12 */
  readonly month: number;
  readonly day: number;
  /** the clock's time, hours */
  readonly time: number;
  readonly daylightSaving: boolean;
}

/** a ceiling's height, where a new light goes, as the Light tool puts one (mm) */
const ELEVATION = 2400;

/** what was typed last, for next time */
let last: SunSettings | null = null;

/** True solar time, hours: the clock less daylight saving, moved by the site's longitude against its meridian and by the equation of time. */
export function trueSolarTime(s: SunSettings): number {
  return s.time - (s.daylightSaving ? 1 : 0) + (s.longitude - s.meridian) / 15 + equationOfTime(dayOfYear(s.month, s.day)) / 60;
}

export function sunFor(s: SunSettings): SunPlace {
  return sunPlace({ latitude: s.latitude, dayOfYear: dayOfYear(s.month, s.day), hour: trueSolarTime(s), north: s.north });
}

/** The azimuth from south, -180° to 180°, west positive, for one clockwise from north. */
export function azimuthFromSouth(fromNorth: number): number {
  return ((((fromNorth - 180) % 360) + 540) % 360) - 180;
}

/** Days in `month` (1 to 12) of a year of 365 days. */
function daysIn(month: number): number {
  return new Date(Date.UTC(2025, month, 0)).getUTCDate();
}

/** "15:04" for hours, wrapped to the day. */
function clockText(hours: number): string {
  const m = Math.round((((hours % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function degreeText(v: number): string {
  return `${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)}°`;
}

/** The time zones offered, as offsets from Greenwich in hours: every half hour, and the three a quarter hour off. */
const ZONES: readonly number[] = [...Array.from({ length: 53 }, (_, i) => -12 + i / 2), 5.75, 8.75, 12.75].sort((a, b) => a - b);

function zoneText(hours: number): string {
  const m = Math.round(Math.abs(hours) * 60);
  const deg = Math.abs(hours * 15);
  const side = hours === 0 ? "" : hours > 0 ? " E" : " W";
  return `GMT${hours < 0 ? "−" : "+"}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} (${Number(deg.toFixed(2))}°${side})`;
}

/** The directional lights the selection has that can be aimed. */
function selectedSuns(): string[] {
  return [...store.selection].filter((id) => lightOf(id)?.kind === "directional" && canAimLight(id));
}

function startingSettings(): SunSettings {
  if (last) return last;
  const v = store.viz3d;
  const date = new Date(Date.UTC(2025, 0, v.dayOfYear));
  return { latitude: v.latitude, longitude: 0, meridian: 0, north: v.north, month: date.getUTCMonth() + 1, day: date.getUTCDate(), time: Math.round(v.hour * 60) / 60, daylightSaving: false };
}

function input(label: string, value: string, type = "text"): HTMLInputElement {
  return h("input", { cls: "menu-dialog-input", value, attrs: { type, "aria-label": label, spellcheck: "false" } });
}

function select(label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...options.map(([v, text]) => h("option", { value: v, text })));
  el.value = value;
  return el;
}

function field(label: string, ...control: Node[]): HTMLElement {
  return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
}

/** A number of degrees as typed ("51.5", "51.5°"), or NaN. */
function degreesOf(el: HTMLInputElement): number {
  const t = el.value.replace(/°/g, "").trim();
  return t === "" ? NaN : Number(t);
}

/** Set Sun Position: asks where and when, then aims the selected directional lights or adds one. */
export async function setSunPosition(): Promise<void> {
  const s0 = startingSettings();
  const lat = input("Latitude", String(Math.abs(s0.latitude)));
  const ns = select("North or south", [["N", "N"], ["S", "S"]], s0.latitude < 0 ? "S" : "N");
  const lon = input("Longitude", String(Math.abs(s0.longitude)));
  const ew = select("East or west", [["E", "E"], ["W", "W"]], s0.longitude < 0 ? "W" : "E");
  const near = ZONES.reduce((a, b) => (Math.abs(b * 15 - s0.meridian) < Math.abs(a * 15 - s0.meridian) ? b : a));
  const zone = select("Time Zone Meridian", ZONES.map((z) => [String(z), zoneText(z)] as const), String(near));
  zone.classList.add("wide");
  const north = input("Page North", String(s0.north));
  const month = select("Month", MONTHS.map((m, i) => [String(i + 1), m] as const), String(s0.month));
  const day = input("Day", String(s0.day));
  const time = input("Time", clockText(s0.time), "time");
  const [dst, dstRow] = checkRow("Daylight Savings");
  dst.checked = s0.daylightSaving;

  const out = (label: string): HTMLOutputElement => h("output", { cls: "sun-out", attrs: { "aria-label": label } });
  const azS = out("Azimuth");
  const azN = out("Azimuth N. Relative");
  const elev = out("Elevation");
  const solar = out("True Solar Time");
  const suns = selectedSuns();
  const doing = h("p", {
    cls: "muted",
    text: suns.length
      ? `OK aims the ${suns.length === 1 ? "selected directional light" : `${suns.length} selected directional lights`} at the sun.`
      : "OK adds a directional light shining from the sun at the view's centre.",
  });

  /** The settings typed, or why they can't be read and the field to fix. */
  const read = (): SunSettings | { error: string; focus: HTMLElement } => {
    const la = degreesOf(lat);
    if (!(la >= 0 && la <= 90)) return { error: "Enter a latitude from 0° to 90°.", focus: lat };
    const lo = degreesOf(lon);
    if (!(lo >= 0 && lo <= 180)) return { error: "Enter a longitude from 0° to 180°.", focus: lon };
    const no = degreesOf(north);
    if (!Number.isFinite(no)) return { error: "Enter page north in degrees.", focus: north };
    const m = Number(month.value);
    const d = Number(day.value.trim());
    if (!(Number.isInteger(d) && d >= 1 && d <= daysIn(m))) return { error: `Enter a day from 1 to ${daysIn(m)}.`, focus: day };
    const t = /^(\d{1,2}):(\d{2})/.exec(time.value);
    if (!t || +t[1] > 23 || +t[2] > 59) return { error: "Enter a time.", focus: time };
    return {
      latitude: ns.value === "S" ? -la : la,
      longitude: ew.value === "W" ? -lo : lo,
      meridian: Number(zone.value) * 15,
      north: no,
      month: m,
      day: d,
      time: +t[1] + +t[2] / 60,
      daylightSaving: dst.checked,
    };
  };

  const update = (): void => {
    const s = read();
    if ("error" in s) {
      for (const o of [azS, azN, elev, solar]) o.value = "—";
      return;
    }
    const sun = sunFor(s);
    azS.value = degreeText(azimuthFromSouth(sun.azimuth));
    azN.value = degreeText(sun.azimuth);
    elev.value = degreeText(sun.altitude);
    solar.value = clockText(trueSolarTime(s));
  };

  const fields = h(
    "div",
    {},
    field("Latitude", lat, ns),
    field("Longitude", lon, ew),
    field("Time Zone Meridian", zone),
    field("Page North", north, h("span", { cls: "menu-dialog-unit", text: "°" })),
    field("Date", month, day),
    field("Time", time),
    dstRow,
  );
  fields.classList.add("sun-fields");
  fields.addEventListener("input", update);
  fields.addEventListener("change", update);
  update();

  const s = await showDialog<SunSettings>({
    title: "Set Sun Position",
    okLabel: "OK",
    cls: "sun-dialog",
    body: [
      fields,
      h("h3", { cls: "sun-head", text: "Results" }),
      field("Azimuth", azS),
      field("Azimuth N. Relative", azN),
      field("Elevation", elev),
      field("True Solar Time", solar),
      doing,
    ],
    check: () => {
      const r = read();
      if ("error" in r) return r;
      const alt = sunFor(r).altitude;
      if (alt <= 0) return { error: `The sun is below the horizon then (${degreeText(alt)}).`, focus: time };
      if (!suns.length && !store.session?.canAdd("light")) return { error: "This drawing has no light object to copy settings from.", focus: time };
      if (!suns.length && !store.activeLayerId) return { error: "There is no active layer to add the light to.", focus: time };
      return { value: r };
    },
  });
  if (!s) return;
  last = s;
  const dir = sunFor(s).dir;
  // the light shines from the sun, down
  const shine: Vec3 = [-dir.x, -dir.y, -dir.z];
  if (suns.length) {
    attempt("Set Sun Position", (x) => x.batch(() => suns.forEach((id) => x.setLight(id, { direction: shine }))));
    return;
  }
  const layerId = store.activeLayerId;
  const view = appContext()?.view;
  if (!layerId) return;
  const at = view ? { x: view.cx, y: view.cy } : { x: 0, y: 0 };
  const r = attempt("Set Sun Position", (x) => x.addObject(layerId, { kind: "light", at, z: ELEVATION, light: "directional", direction: shine }, store.activeClassIndex));
  // the new light goes on the layer, not into the group being edited, and is selected
  if (r) setEditGroup(null, [r.value]);
}
