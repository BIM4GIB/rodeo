// The Looks palette (Stage > Lighting > Looks): the show's named looks, each a level for every channel with its
// fade time. Go fades the levels from what they show now into a look (crossfade.ts); New Look keeps the sliders as
// a look; the channel sliders move the levels by hand. Export Cue List writes the looks as a USITT ASCII cue list
// (cues.ts). The looks are kept in the drawing (show.ts), so they undo with it and travel with the file.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { naturalCompare } from "../fixture.ts";
import { colorOf, hexOf } from "../gels.ts";
import { fixtures } from "../instrument.ts";
import { levelOf, onLevels, setLevels } from "../levels.ts";
import { readShow, writeShow } from "../show.ts";
import { LOOKS_KEY, type Look } from "../showTypes.ts";
import { downloadText } from "../ui.ts";
import { easeInOut, levelsBetween } from "./crossfade.ts";
import { cueListAsc } from "./cues.ts";

/** the palette's id, as Window > Palettes and Stage > Lighting > Looks know it */
export const LOOKS_PALETTE = "stageLooks";

/** the fade a new look starts with, in seconds */
const NEW_FADE_SECONDS = 3;

const NOTE = "A look sets each channel's level. Go fades to it over its fade time. A slider you move takes effect at once.";

/** A channel to set, with the purpose and colour of the first instrument on it. */
interface Channel {
  readonly channel: string;
  readonly purpose: string;
  readonly color: string;
}

/** The look being shown, until the levels are moved by hand; null for none. */
let current: string | null = null;
/** the animation frame of a fade in progress, 0 for none */
let fading = 0;
/** each listed channel's slider and its percent label */
const sliders = new Map<string, { readonly input: HTMLInputElement; readonly pct: HTMLElement }>();
let shownLooks = "";
let shownChannels = "";

const note = h("p", { cls: "th-note looks-note" });
const listBox = h("ol", { cls: "looks-list" });
const chanBox = h("div", { cls: "looks-channels" });
const fill = h("div", { cls: "looks-progress-fill" });
const bar = h("div", { cls: "looks-progress", hidden: true }, fill);

/** A button of the palette, run on click. */
function button(label: string, run: () => void, cls = "btn"): HTMLButtonElement {
  const b = h("button", { cls, text: label, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
}

const body = h(
  "div",
  { cls: "looks-palette" },
  note,
  h(
    "div",
    { cls: "th-toolbar looks-tools" },
    button("New Look", newLook, "btn primary"),
    button("All Off", allOff),
    button("All Full", allFull),
    button("Blackout: Show Everything", showEverything),
  ),
  bar,
  h("h3", { cls: "looks-head", text: "Looks" }),
  listBox,
  h("h3", { cls: "looks-head", text: "Channels" }),
  chanBox,
  h("div", { cls: "looks-foot" }, button("Export Cue List (.asc)", exportCues)),
);

/** The palette's body, built once; its looks and channels follow the drawing. */
export function looksPaletteBody(): HTMLElement {
  return body;
}

/** The show's looks, in order. */
function looksNow(): Look[] {
  return readShow<Look[]>(LOOKS_KEY, []);
}

/** The channels the drawing's instruments patch, in natural order. */
function channelsNow(): Channel[] {
  const seen = new Map<string, Channel>();
  for (const f of fixtures()) {
    if (!f.channel || seen.has(f.channel)) continue;
    seen.set(f.channel, { channel: f.channel, purpose: f.purpose, color: f.color });
  }
  return [...seen.values()].sort((a, b) => naturalCompare(a.channel, b.channel));
}

/** Each channel's level now, as a look keeps it. */
function snapshot(channels: readonly Channel[]): Record<string, number> {
  return Object.fromEntries(channels.map((c): [string, number] => [c.channel, levelOf(c.channel)]));
}

function mapOf(levels: Readonly<Record<string, number>>): Map<string, number> {
  return new Map(Object.entries(levels));
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Whether a drawing is open; if not, the user is told. */
function haveDrawing(): boolean {
  if (store.session) return true;
  toast("Open a drawing first.", "info");
  return false;
}

/** Stops a fade in progress. */
function cancelFade(): void {
  if (fading) cancelAnimationFrame(fading);
  fading = 0;
  bar.hidden = true;
}

/** Rebuilds the list of looks, to show which is up. */
function refreshLooks(): void {
  shownLooks = "";
  sync();
}

/** New Look: keeps the sliders' levels as a look after the others, and shows it as up. */
function newLook(): void {
  if (!haveDrawing()) return;
  const chans = channelsNow();
  if (!chans.length) {
    toast("No instrument has a channel yet, so there are no levels to keep.", "info");
    return;
  }
  const list = looksNow();
  const look: Look = { id: newId(), name: `Look ${list.length + 1}`, levels: snapshot(chans), fadeSeconds: NEW_FADE_SECONDS };
  if (!writeShow("New Look", LOOKS_KEY, [...list, look])) return;
  current = look.id;
  refreshLooks();
}

/** Update: the look takes the sliders' levels now, keeping its name and fade time. */
function updateLook(id: string): void {
  const chans = channelsNow();
  writeShow(
    "Update Look",
    LOOKS_KEY,
    looksNow().map((l) => (l.id === id ? { ...l, levels: snapshot(chans) } : l)),
  );
}

/** Delete: takes the look out of the show. */
function deleteLook(id: string): void {
  if (current === id) current = null;
  writeShow("Delete Look", LOOKS_KEY, looksNow().filter((l) => l.id !== id));
}

/** Moves a look one place up (-1) or down (1). */
function moveLook(id: string, by: number): void {
  const list = [...looksNow()];
  const i = list.findIndex((l) => l.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  writeShow("Move Look", LOOKS_KEY, list);
}

/** Renames a look from its name field; an empty name puts the old one back. */
function renameLook(id: string, text: string): void {
  const list = looksNow();
  const look = list.find((l) => l.id === id);
  const name = text.trim();
  if (!look) return;
  if (!name) {
    refreshLooks();
    return;
  }
  if (name === look.name) return;
  writeShow("Rename Look", LOOKS_KEY, list.map((l) => (l.id === id ? { ...l, name } : l)));
}

/** Sets a look's fade time from its field, in seconds, 0 or more. */
function setFade(id: string, text: string): void {
  const seconds = Number(text);
  const look = looksNow().find((l) => l.id === id);
  if (!look) return;
  if (!Number.isFinite(seconds) || seconds < 0) {
    refreshLooks();
    toast("A fade time is a number of seconds, 0 or more.", "info");
    return;
  }
  if (seconds === look.fadeSeconds) return;
  writeShow("Set Fade Time", LOOKS_KEY, looksNow().map((l) => (l.id === id ? { ...l, fadeSeconds: seconds } : l)));
}

/** Go: fades the levels from what they show now into the look over its fade time. */
function go(look: Look): void {
  cancelFade();
  const from = snapshot(channelsNow());
  const ms = Math.max(0, look.fadeSeconds) * 1000;
  const start = performance.now();
  current = look.id;
  refreshLooks();
  const step = (now: number): void => {
    const t = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
    setLevels(mapOf(levelsBetween(from, look.levels, easeInOut(t))));
    fill.style.width = `${t * 100}%`;
    bar.hidden = t >= 1;
    fading = t < 1 ? requestAnimationFrame(step) : 0;
  };
  fill.style.width = "0%";
  step(start);
}

/** A slider moved: the levels become what they are with that channel at `percent`. */
function moveChannel(channel: string, percent: number): void {
  cancelFade();
  const levels = mapOf(snapshot(channelsNow()));
  levels.set(channel, percent / 100);
  if (current !== null) {
    current = null;
    refreshLooks();
  }
  setLevels(levels);
}

/** All Off: every channel at 0. */
function allOff(): void {
  cancelFade();
  current = null;
  setLevels(new Map());
  refreshLooks();
}

/** All Full: every channel at 1. */
function allFull(): void {
  cancelFade();
  current = null;
  setLevels(new Map(channelsNow().map((c): [string, number] => [c.channel, 1])));
  refreshLooks();
}

/** Blackout: Show Everything: no look at all, so everything shows at full. */
function showEverything(): void {
  cancelFade();
  current = null;
  setLevels(null);
  refreshLooks();
}

/** Export Cue List (.asc): every look in order, as a USITT ASCII cue list. */
function exportCues(): void {
  const list = looksNow();
  if (!list.length) {
    toast("There are no looks to export yet.", "info");
    return;
  }
  downloadText("cue-list.asc", cueListAsc(list), "text/plain");
}

function lookRow(look: Look, i: number, count: number): HTMLLIElement {
  const name = h("input", { cls: "th-cell looks-name", value: look.name, attrs: { type: "text", "aria-label": "Look name" } });
  name.addEventListener("change", () => renameLook(look.id, name.value));
  const fade = h("input", {
    cls: "th-cell looks-fade",
    value: String(look.fadeSeconds),
    attrs: { type: "number", min: "0", step: "0.5", "aria-label": "Fade time in seconds" },
  });
  fade.addEventListener("change", () => setFade(look.id, fade.value));
  const up = button("↑", () => moveLook(look.id, -1));
  up.title = "Move up";
  up.setAttribute("aria-label", "Move up");
  up.disabled = i === 0;
  const down = button("↓", () => moveLook(look.id, 1));
  down.title = "Move down";
  down.setAttribute("aria-label", "Move down");
  down.disabled = i === count - 1;
  return h(
    "li",
    { cls: current === look.id ? "looks-row on" : "looks-row" },
    h("div", { cls: "looks-row-top" }, h("span", { cls: "looks-no", text: String(i + 1) }), name, up, down),
    h(
      "div",
      { cls: "looks-row-btns" },
      h("label", { cls: "looks-fade-label" }, fade, h("span", { text: "s" })),
      button("Go", () => go(look), "btn primary"),
      button("Update", () => updateLook(look.id)),
      button("Delete", () => deleteLook(look.id)),
    ),
  );
}

function renderLooks(list: readonly Look[]): void {
  if (!list.length) {
    listBox.replaceChildren(h("li", { cls: "looks-empty", text: store.session ? "No looks yet. Set the channels, then press New Look." : "" }));
    return;
  }
  listBox.replaceChildren(...list.map((look, i) => lookRow(look, i, list.length)));
}

function channelRow(c: Channel): HTMLElement {
  const input = h("input", {
    cls: "looks-slider",
    attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": `Channel ${c.channel} level` },
  });
  const pct = h("span", { cls: "looks-pct" });
  input.addEventListener("input", () => moveChannel(c.channel, Number(input.value)));
  sliders.set(c.channel, { input, pct });
  const swatch = h("span", { cls: "looks-swatch", title: c.color || "Open (white)" });
  swatch.style.background = hexOf(colorOf(c.color));
  const label = h("span", { cls: "looks-chan-label" }, h("b", { text: `Ch ${c.channel}` }), c.purpose ? h("span", { cls: "looks-purpose", text: c.purpose }) : null);
  return h("div", { cls: "looks-chan" }, swatch, label, input, pct);
}

/** The channels, grouped by purpose, each with a slider. */
function renderChannels(chans: readonly Channel[]): void {
  sliders.clear();
  if (!chans.length) {
    chanBox.replaceChildren(h("p", { cls: "th-empty", text: store.session ? "No instrument has a channel yet." : "" }));
    return;
  }
  const byPurpose = new Map<string, Channel[]>();
  for (const c of chans) byPurpose.set(c.purpose, [...(byPurpose.get(c.purpose) ?? []), c]);
  const purposes = [...byPurpose.keys()].sort((a, b) => Number(a === "") - Number(b === "") || naturalCompare(a, b));
  chanBox.replaceChildren(...purposes.flatMap((p) => [h("div", { cls: "looks-group", text: p || "No purpose" }), ...(byPurpose.get(p) ?? []).map(channelRow)]));
  syncSliders();
}

/** Each slider shows its channel's level now. */
function syncSliders(): void {
  for (const [channel, { input, pct }] of sliders) {
    const v = Math.round(levelOf(channel) * 100);
    if (Number(input.value) !== v) input.value = String(v);
    const text = `${v}%`;
    if (pct.textContent !== text) pct.textContent = text;
  }
}

/** The drawing or its looks changed: the list and the channels are read again where they changed. */
function sync(): void {
  const open = store.session !== null;
  note.textContent = open ? NOTE : "Open a drawing to keep its looks with it.";
  const list = open ? looksNow() : [];
  const listText = JSON.stringify(list);
  if (listText !== shownLooks) {
    shownLooks = listText;
    renderLooks(list);
  }
  const chans = open ? channelsNow() : [];
  const chanText = JSON.stringify(chans);
  if (chanText !== shownChannels) {
    shownChannels = chanText;
    renderChannels(chans);
  }
  syncSliders();
}

let syncQueued = false;
/** The drawing changed: the palette follows once the drawing's own listeners have cleared their reads, so it reads the drawing as it is now. */
function onDrawingChange(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    sync();
  });
}

store.on("session", onDrawingChange);
onLevels(syncSliders);
sync();
