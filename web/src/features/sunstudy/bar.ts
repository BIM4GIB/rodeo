// Sun Study's bar over the 3D view (View > Sun Study): the date, the solar time between sunrise and
// sunset, the seasons, Play Day and Play Year, the north dial, and the place (latitude, longitude,
// a search by name, or the device's location). Every change goes through setViz. Turning the study
// on puts the sun on the Heliodon with shadows; turning it off puts back the settings it found.

import { byId, h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { dayLabel, hourLabel, sunPlace, type Viz3D } from "../../app/heliodon.ts";
import { setViz, store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { bearing, clampHour, daylight, hourRange, SEASONS } from "./sun.ts";
import "./sunstudy.css";

const LOCATION_KEY = "openvwx.sunStudy.location";
const NOMINATIM = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=";
/** Play Day: a quarter hour every quarter second, so the hour sweeps the day at an hour a second. */
const DAY_STEP_MS = 250;
const DAY_STEP_HOURS = 0.25;
/** Play Year: a week every half second. */
const YEAR_STEP_MS = 500;
const YEAR_STEP_DAYS = 7;
/** The compass needle: the drawing's north, pointing from the centre (a CSS rotation, set by refresh). */
const DIAL_SVG = `<svg viewBox="-24 -24 48 48" aria-hidden="true"><circle class="sunstudy-dial-ring" r="22"/><g class="sunstudy-needle"><path class="sunstudy-needle-head" d="M0 -18 L4.5 -7 L-4.5 -7 Z"/><path class="sunstudy-needle-tail" d="M0 -7 L0 12"/></g></svg>`;

/** The place the study was last set to. The latitude is also the Visualization setting; the rest is kept here. */
interface Spot {
  latitude: number;
  longitude: number | null;
  name: string;
}

interface Place {
  latitude: number;
  longitude: number;
  name: string;
}

interface Ui {
  root: HTMLElement;
  date: HTMLInputElement;
  dateOut: HTMLElement;
  time: HTMLInputElement;
  timeOut: HTMLElement;
  sun: HTMLElement;
  note: HTMLElement;
  playDay: HTMLButtonElement;
  playYear: HTMLButtonElement;
  dial: HTMLElement;
  needle: SVGGElement;
  northOut: HTMLElement;
  lat: HTMLInputElement;
  lon: HTMLInputElement;
  place: HTMLElement;
}

let on = false;
let opening = false;
/** the sun and shadows the study found when it turned on, put back when it turns off (the date, time and place it leaves set) */
let saved: Pick<Viz3D, "sun" | "shadows"> | null = null;
let spot: Spot | null = readSpot();
let ui: Ui | null = null;
let playing: { kind: "day" | "year"; timer: number } | null = null;

/** Whether the study is on (View > Sun Study is checked). */
export function studyOn(): boolean {
  return on;
}

/** View > Sun Study: turns the study on (opening the 3D view when it is shut) or off. */
export async function toggleStudy(): Promise<void> {
  if (on) {
    turnOff();
    return;
  }
  if (opening || !store.session) return;
  const ctx = appContext();
  if (!ctx) return;
  opening = true;
  try {
    const view = await ctx.show3d();
    if (!view || !store.session) return;
    ui ??= build();
    byId("view3d-host").append(ui.root);
    saved = { sun: store.viz3d.sun, shadows: store.viz3d.shadows };
    on = true;
    setViz({ sun: "heliodon", shadows: true, ...(spot ? { latitude: spot.latitude } : {}) });
    refresh();
  } finally {
    opening = false;
  }
}

/** Stops Play Day and Play Year (the export does this before it sets the sun itself). */
export function pausePlayback(): void {
  stopPlaying();
}

function turnOff(): void {
  if (!on) return;
  stopPlaying();
  on = false;
  const prev = saved;
  saved = null;
  if (prev) setViz(prev);
  refresh();
}

function onView3d(): void {
  if (!store.view3d) stopPlaying();
  refresh();
}

function setDay(day: number): void {
  const v = store.viz3d;
  setViz({ dayOfYear: day, hour: clampHour(v.hour, hourRange(v.latitude, day)) });
}

function setLatitude(latitude: number): void {
  const v = store.viz3d;
  setViz({ latitude, hour: clampHour(v.hour, hourRange(latitude, v.dayOfYear)) });
}

function setNorth(deg: number): void {
  setViz({ north: bearing(deg) });
}

function togglePlay(kind: "day" | "year"): void {
  if (playing?.kind === kind) {
    stopPlaying();
    return;
  }
  stopPlaying();
  const timer = window.setInterval(() => step(kind), kind === "day" ? DAY_STEP_MS : YEAR_STEP_MS);
  playing = { kind, timer };
  refresh();
}

function stopPlaying(): void {
  if (!playing) return;
  window.clearInterval(playing.timer);
  playing = null;
  refresh();
}

/** One frame of Play Day (the hour, looping over the day) or Play Year (a week on, at the same hour). */
function step(kind: "day" | "year"): void {
  const v = store.viz3d;
  if (kind === "day") {
    const range = hourRange(v.latitude, v.dayOfYear);
    const next = clampHour(v.hour, range) + DAY_STEP_HOURS;
    setViz({ hour: next > range[1] ? range[0] : next });
    return;
  }
  const day = ((v.dayOfYear - 1 + YEAR_STEP_DAYS) % 365) + 1;
  setViz({ dayOfYear: day, hour: clampHour(v.hour, hourRange(v.latitude, day)) });
}

/** Shows the bar's values from the settings, and whether the bar is shown (the study is on and the 3D view is). */
function refresh(): void {
  const u = ui;
  if (!u) return;
  const v = store.viz3d;
  const range = hourRange(v.latitude, v.dayOfYear);
  const day = daylight(v.latitude, v.dayOfYear);
  u.root.hidden = !(on && store.view3d);
  u.date.value = String(v.dayOfYear);
  u.dateOut.textContent = dayLabel(v.dayOfYear);
  u.time.min = String(range[0]);
  u.time.max = String(range[1]);
  u.time.value = String(v.hour);
  u.timeOut.textContent = `${hourLabel(v.hour)} solar time`;
  const at = sunPlace(v);
  u.sun.textContent = at.altitude > 0 ? `The sun is ${Math.round(at.altitude)}° up, ${Math.round(at.azimuth)}° from north.` : "The sun is below the horizon.";
  u.note.textContent = day.kind === "up" ? "The sun stays up all day at this latitude." : day.kind === "down" ? "The sun does not rise on this day at this latitude." : "";
  u.note.hidden = day.kind === "rise-set";
  u.needle.style.transform = `rotate(${-v.north}deg)`;
  u.northOut.textContent = `${Math.round(v.north)}°`;
  u.dial.setAttribute("aria-valuenow", String(Math.round(v.north)));
  if (document.activeElement !== u.lat) u.lat.value = v.latitude.toFixed(2);
  if (document.activeElement !== u.lon) u.lon.value = spot?.longitude != null ? spot.longitude.toFixed(2) : "";
  u.place.textContent = spot && Math.abs(spot.latitude - v.latitude) < 1e-9 ? spot.name : "";
  u.playDay.textContent = playing?.kind === "day" ? "Stop Day" : "Play Day";
  u.playYear.textContent = playing?.kind === "year" ? "Stop Year" : "Play Year";
  u.playDay.setAttribute("aria-pressed", String(playing?.kind === "day"));
  u.playYear.setAttribute("aria-pressed", String(playing?.kind === "year"));
}

/** Builds the bar once; it is shown and hidden with the study and the 3D view. */
function build(): Ui {
  const date = h("input", { cls: "sunstudy-range", attrs: { type: "range", min: "1", max: "365", step: "1", "aria-label": "Date" } });
  const dateOut = h("span", { cls: "sunstudy-out" });
  const time = h("input", { cls: "sunstudy-range", attrs: { type: "range", min: "0", max: "24", step: "0.25", "aria-label": "Solar time" } });
  const timeOut = h("span", { cls: "sunstudy-out" });
  date.addEventListener("input", () => setDay(Number(date.value)));
  time.addEventListener("input", () => setViz({ hour: Number(time.value) }));

  const seasons = SEASONS.map((s) => {
    const btn = h("button", { cls: "btn small", text: s.label, attrs: { type: "button" } });
    btn.addEventListener("click", () => setDay(s.day));
    return btn;
  });
  const close = h("button", {
    cls: "btn small sunstudy-close",
    text: "×",
    title: "Turn Sun Study off",
    attrs: { type: "button", "aria-label": "Turn Sun Study off" },
  });
  close.addEventListener("click", () => turnOff());

  const playDay = h("button", { cls: "btn small", text: "Play Day", attrs: { type: "button", "aria-pressed": "false" } });
  playDay.addEventListener("click", () => togglePlay("day"));
  const playYear = h("button", { cls: "btn small", text: "Play Year", attrs: { type: "button", "aria-pressed": "false" } });
  playYear.addEventListener("click", () => togglePlay("year"));
  const record = h("button", {
    cls: "btn small",
    text: "Export…",
    title: "Record this day as an animated GIF or a video",
    attrs: { type: "button" },
  });
  record.addEventListener("click", () => {
    import("./record.ts")
      .then((m) => m.recordSunStudy())
      .catch(report);
  });

  const sun = h("span", { cls: "sunstudy-sun" });
  const note = h("span", { cls: "sunstudy-sun", hidden: true });

  // the north dial: the needle points at the drawing's north; drag it, or use the left and right arrows
  const dial = h("div", {
    cls: "sunstudy-dial",
    html: DIAL_SVG,
    attrs: { role: "slider", tabindex: "0", "aria-label": "North", "aria-valuemin": "-180", "aria-valuemax": "180" },
  });
  const needle = dial.querySelector(".sunstudy-needle") as SVGGElement;
  const northOut = h("span", { cls: "sunstudy-out" });
  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    turnDial(dial, e);
  });
  dial.addEventListener("pointermove", (e) => {
    if (dial.hasPointerCapture(e.pointerId)) turnDial(dial, e);
  });
  dial.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? -5 : e.key === "ArrowLeft" ? 5 : 0;
    if (step === 0) return;
    e.preventDefault();
    setNorth(store.viz3d.north + step);
  });

  const lat = h("input", { cls: "sunstudy-num", attrs: { type: "number", min: "-90", max: "90", step: "0.01", "aria-label": "Latitude" } });
  const lon = h("input", { cls: "sunstudy-num", attrs: { type: "number", min: "-180", max: "180", step: "0.01", "aria-label": "Longitude" } });
  lat.addEventListener("change", () => {
    const n = numberOf(lat.value, 90);
    if (n === null) {
      refresh();
      return;
    }
    setLatitude(n);
    rememberSpot(spot?.longitude ?? null, "", n);
    refresh();
  });
  lon.addEventListener("change", () => {
    if (lon.value.trim() === "") rememberSpot(null, "");
    else {
      const n = numberOf(lon.value, 180);
      if (n === null) {
        refresh();
        return;
      }
      rememberSpot(n, "");
    }
    refresh();
  });

  const place = h("span", { cls: "sunstudy-place" });
  const locate = h("button", { cls: "btn small", text: "Use My Location", attrs: { type: "button" } });
  const find = h("button", { cls: "btn small", text: "Find…", title: "Find a place by name", attrs: { type: "button", "aria-expanded": "false" } });
  const query = h("input", {
    cls: "menu-dialog-input sunstudy-query",
    attrs: { type: "search", placeholder: "A place, e.g. Lisbon", "aria-label": "Place" },
  });
  const results = h("ul", { cls: "sunstudy-results" });
  const findForm = h(
    "form",
    { cls: "sunstudy-find", hidden: true },
    query,
    h("button", { cls: "btn small", text: "Search", attrs: { type: "submit" } }),
    results,
  );

  /** Puts the study at a place: its latitude, and the longitude and name kept with it. */
  const choose = (p: Place): void => {
    setLatitude(p.latitude);
    rememberSpot(p.longitude, p.name);
    findForm.hidden = true;
    find.setAttribute("aria-expanded", "false");
    results.replaceChildren();
    refresh();
  };
  let searchSerial = 0;
  find.addEventListener("click", () => {
    findForm.hidden = !findForm.hidden;
    find.setAttribute("aria-expanded", String(!findForm.hidden));
    if (!findForm.hidden) query.focus();
  });
  findForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = query.value.trim();
    if (text === "") return;
    const serial = ++searchSerial;
    results.replaceChildren(h("li", { cls: "sunstudy-note", text: "Searching…" }));
    findPlaces(text).then(
      (found) => {
        if (serial !== searchSerial) return;
        if (found.length === 0) {
          results.replaceChildren(h("li", { cls: "sunstudy-note", text: "No place found." }));
          return;
        }
        results.replaceChildren(
          ...found.map((p) => {
            const btn = h("button", { cls: "btn small sunstudy-result", text: p.name, attrs: { type: "button", title: p.name } });
            btn.addEventListener("click", () => choose(p));
            return h("li", {}, btn);
          }),
        );
      },
      (err: unknown) => {
        if (serial !== searchSerial) return;
        results.replaceChildren(h("li", { cls: "sunstudy-note", text: `The search failed: ${errorMessage(err)}` }));
      },
    );
  });
  locate.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("This browser cannot give its location.", "info");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ latitude: round4(pos.coords.latitude), longitude: round4(pos.coords.longitude), name: "My location" }),
      (err) => toast(`The location is not available: ${err.message}`, "info"),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
    );
  });

  const root = h(
    "div",
    { cls: "sunstudy", attrs: { role: "toolbar", "aria-label": "Sun Study" }, hidden: true },
    h(
      "div",
      { cls: "sunstudy-row" },
      h("span", { cls: "sunstudy-title", text: "Sun Study" }),
      field("Date", date, dateOut),
      h("div", { cls: "sunstudy-seasons" }, ...seasons),
      close,
    ),
    h("div", { cls: "sunstudy-row" }, field("Time", time, timeOut), playDay, playYear, record),
    h("p", { cls: "sunstudy-status" }, sun, note),
    h(
      "div",
      { cls: "sunstudy-row" },
      h("span", { cls: "sunstudy-north" }, dial, h("span", { cls: "sunstudy-field-label", text: "North" }), northOut),
      field("Latitude", lat),
      field("Longitude", lon),
      find,
      locate,
      place,
    ),
    findForm,
  );

  store.on("view3d", onView3d);
  store.on("viz3d", refresh);
  return { root, date, dateOut, time, timeOut, sun, note, playDay, playYear, dial, needle, northOut, lat, lon, place };
}

function turnDial(dial: HTMLElement, e: PointerEvent): void {
  const r = dial.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  if (dx === 0 && dy === 0) return;
  // degrees clockwise from the top of the dial; the drawing's north is measured the other way
  const clockwise = (Math.atan2(dx, -dy) * 180) / Math.PI;
  setNorth(-clockwise);
}

function field(label: string, ...controls: Node[]): HTMLElement {
  return h("label", { cls: "sunstudy-field" }, h("span", { cls: "sunstudy-field-label", text: label }), ...controls);
}

/** A number from text, when it is finite and within `limit` either way; otherwise null. */
function numberOf(text: string, limit: number): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function rememberSpot(longitude: number | null, name: string, latitude = store.viz3d.latitude): void {
  spot = { latitude, longitude, name };
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(spot));
  } catch {
    // storage blocked or full: the place lasts for this visit
  }
}

function readSpot(): Spot | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "null") as Partial<Spot> | null;
    if (typeof saved?.latitude !== "number" || !Number.isFinite(saved.latitude) || Math.abs(saved.latitude) > 90) return null;
    const lon = typeof saved.longitude === "number" && Number.isFinite(saved.longitude) && Math.abs(saved.longitude) <= 180 ? saved.longitude : null;
    return { latitude: saved.latitude, longitude: lon, name: typeof saved.name === "string" ? saved.name : "" };
  } catch {
    return null;
  }
}

/** Places named by the search service (Nominatim, OpenStreetMap), with their coordinates. */
async function findPlaces(text: string): Promise<Place[]> {
  const res = await fetch(NOMINATIM + encodeURIComponent(text), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`the search service answered ${res.status}`);
  const rows = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
  const out: Place[] = [];
  for (const row of rows) {
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) out.push({ latitude, longitude, name: row.display_name ?? text });
  }
  return out;
}

function report(err: unknown): void {
  toast(`Sun Study: ${errorMessage(err)}`);
}
